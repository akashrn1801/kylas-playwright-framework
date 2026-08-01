import * as dotenv from 'dotenv';
dotenv.config();

type Environment = 'qa' | 'staging' | 'prod';
const ENV = (process.env.ENV || 'qa') as Environment;

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

const ENV_PREFIX = ENV.toUpperCase();

const urls: Record<Environment, { appUrl: string; apiBaseUrl: string }> = {
  qa: { appUrl: process.env.QA_APP_URL || '', apiBaseUrl: process.env.QA_API_BASE_URL || '' },
  staging: {
    appUrl: process.env.STAGING_APP_URL || '',
    apiBaseUrl: process.env.STAGING_API_BASE_URL || '',
  },
  prod: { appUrl: process.env.PROD_APP_URL || '', apiBaseUrl: process.env.PROD_API_BASE_URL || '' },
};

// WHY: only validate the active environment — other envs may not have
// secrets configured in CI and should not cause startup failures
if (!urls[ENV].appUrl) {
  throw new Error(`Missing required environment variable: ${ENV_PREFIX}_APP_URL`);
}

export const config = {
  env: ENV,
  appUrl: urls[ENV].appUrl,
  apiBaseUrl: urls[ENV].apiBaseUrl,
  users: {
    admin: {
      email: requireEnv(`${ENV_PREFIX}_ADMIN_EMAIL`),
      password: requireEnv(`${ENV_PREFIX}_ADMIN_PASSWORD`),
      role: 'admin',
    },
    restricted: {
      email: requireEnv(`${ENV_PREFIX}_RESTRICTED_EMAIL`),
      password: requireEnv(`${ENV_PREFIX}_RESTRICTED_PASSWORD`),
      role: 'restricted',
    },
  },
  timeouts: {
    default: Number(process.env.DEFAULT_TIMEOUT) || 30000,
    navigation: Number(process.env.NAVIGATION_TIMEOUT) || 60000,
    expect: Number(process.env.EXPECT_TIMEOUT) || 10000,
  },
  browser: {
    name: process.env.BROWSER || 'chromium',
    headless: process.env.HEADLESS === 'true',
  },
  // WHY: Centralised retry config — all page objects use this instead of
  // duplicating the same per-env values. Single place to tune retry behaviour.
  searchRetry: {
    qa: { retries: 5, wait: 3000 },
    staging: { retries: 3, wait: 5000 },
    // WHY: Prod indexing lag is higher — 5 retries x 5s = 25s max wait
    prod: { retries: 5, wait: 5000 },
  },
  // WHY: Meetings module needs more retries and longer wait — meeting list
  // loads slower due to calendar data aggregation on QA/Staging environments
  meetingRetry: {
    // WHY: Soft wait — waitFor polls until found or timeout, not a hard sleep
    qa: { retries: 8, wait: 10000 },
    staging: { retries: 5, wait: 8000 },
    // WHY: Prod is slower — increase wait to 8s to handle calendar aggregation lag
    prod: { retries: 5, wait: 8000 },
  },
  execution: {
    workers: Number(process.env.WORKERS) || 2,
    retryCount: Number(process.env.RETRY_COUNT) || 1,
  },
  deals: {
    adminDealName:
      ENV === 'prod'
        ? process.env.PROD_ADMIN_DEAL_NAME || ''
        : ENV === 'staging'
          ? process.env.STAGING_ADMIN_DEAL_NAME || ''
          : process.env.QA_ADMIN_DEAL_NAME || '',
    restrictedDealName:
      ENV === 'prod'
        ? process.env.PROD_RESTRICTED_DEAL_NAME || ''
        : ENV === 'staging'
          ? process.env.STAGING_RESTRICTED_DEAL_NAME || ''
          : process.env.QA_RESTRICTED_DEAL_NAME || '',
  },
};

export type UserRole = keyof typeof config.users;
export type Config = typeof config;

// WHY this exists (2026-07-28) — confirmed live TWICE independently, in two
// separate hand-rolled implementations, that config.apiBaseUrl's shape
// (whether it already ends in /v1) differs between local .env (has it) and
// the GitHub Actions CI secrets backing the same variable names (confirmed
// missing it): AuthManager.loginHeadless() 404'd on every headless login in
// CI until fixed with its own inline normalization (getLoginUrl()), and
// DealsPage.ts's fetchCurrentDealApiData() had the identical bug, missed
// during that first fix's own ripple-check because the line was
// pattern-matched but never actually opened and read. Rather than let a
// third hand-rolled copy exist (or leave the first two independently
// drifting), every call site that builds a live API request URL from
// config.apiBaseUrl must route through this ONE function — mirrors this
// codebase's own precedent for exactly this problem shape (see
// src/utils/navigation.ts's safeWaitForURL() consolidation history).
// WHY rewritten 2026-07-30 (a real CI run, 2026-07-29T11:45:35Z "CI — qa
// (regression)", hit `https://api-qa.sling-dev.com/v/v1/users/login` — a
// malformed, doubled path): the previous version only checked for the exact
// suffix `/v1` via `endsWith('/v1')`. A configured `apiBaseUrl` ending in the
// PARTIAL segment `/v` (not the full `/v1`) fails that check — `/v` !==
// `/v1` — so the old code appended `/v1` anyway, producing `.../v` + `/v1`
// = `.../v/v1`, exactly the malformed URL seen in CI. Confirmed via direct
// reproduction (not just theory): `buildApiUrl` with a base ending in `/v`
// reliably produced this doubled path before this fix.
// GitHub Actions masks the actual secret value in logs, so the EXACT
// current shape of the CI secret couldn't be directly confirmed — this fix
// is deliberately robust to any of the shapes that could produce this
// symptom, not just the one specific case that could be reproduced locally:
// a base ending in `/v1` (correct), `/v1/` (trailing slash), `/v` (partial/
// truncated), or even an already-doubled `/v/v1` (in case the corruption is
// baked into the stored value itself) — strips trailing `/v1` or `/v`
// segments REPEATEDLY until none remain, then appends exactly one canonical
// `/v1`. This guarantees a single, correct `/v1` regardless of how malformed
// the input already is, rather than only handling the one shape a given
// investigation happened to reproduce.
export function buildApiUrl(path: string): string {
  let base = config.apiBaseUrl.replace(/\/+$/, '');
  while (/\/v1?$/.test(base)) {
    base = base.replace(/\/v1?$/, '');
  }
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}/v1${suffix}`;
}
