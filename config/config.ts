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
    prod: { retries: 5, wait: 3000 },
  },
  // WHY: Meetings module needs more retries and longer wait — meeting list
  // loads slower due to calendar data aggregation on QA/Staging environments
  meetingRetry: {
    qa: { retries: 8, wait: 8000 },
    staging: { retries: 5, wait: 8000 },
    prod: { retries: 5, wait: 3000 },
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
