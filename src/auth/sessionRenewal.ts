import { request as apiRequest, APIRequestContext } from '@playwright/test';
import { config, buildApiUrl } from '../../config/config';
import { describeSessionEnd } from './sessionLifetime';
import { recordSessionInfo } from './sessionInfo';
import { logger } from '../utils/logger';
import { isLoginDatabaseError, isRetryableHttpStatus } from '../utils/retryableStatus';

// ADR 0017 (amended 2026-11-20): the CI `renew-session` job renews each role's session ONCE, before every test job.
// API only, no browser: `PUT /v1/users/login` returns {token: <JWT>} (the same call the app's login form makes) and
// the JWT carries its own expiry (data.expiry). A login inside a live session returns the SAME token, so this
// reads the real session end; under the full run window left = `DELETE /v1/tokens/logout` once (revokes the token
// for EVERY holder of the account: safe in CI only because the `kylas-staging` concurrency group allows one staging
// run at a time) and a fresh login. The shards then log in from their own globalSetup and get this session's token.
const ROLES = ['admin', 'restricted'] as const;
type Role = (typeof ROLES)[number];
const LOGIN_ATTEMPTS = 3;

async function loginViaApi(context: APIRequestContext, role: Role): Promise<string> {
  const credentials = config.users[role];
  if (!credentials.email || !credentials.password) {
    throw new Error(
      `[renew-session] Credentials missing for ${role} (ENV=${config.env}): check ${config.env.toUpperCase()}_${role.toUpperCase()}_EMAIL and _PASSWORD`
    );
  }
  let last = '';
  // ADR 0014 section 1: only a transport error, 429 or 5xx is retried; the login 400 000004 "Database error" is the
  // one idempotent exception (ADR 0017). Any other answer is definitive.
  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++) {
    let status: number | null = null;
    let body = '';
    try {
      const response = await context.put(buildApiUrl('/users/login'), {
        data: { email: credentials.email, password: credentials.password, rememberMe: false },
      });
      status = response.status();
      body = await response.text();
      if (response.ok()) {
        const token = (JSON.parse(body) as { token?: string }).token;
        if (!token) throw new Error('the login answer has no token');
        return token;
      }
    } catch (error) {
      if (status !== null) throw new Error(`[renew-session] Login for ${role} failed: ${String(error)}`);
      last = `no response (${String(error)})`;
      logger.warn(`[renew-session] Login for ${role}: ${last}, attempt ${attempt}/${LOGIN_ATTEMPTS}`);
      continue;
    }
    last = `HTTP ${status} ${body.slice(0, 200)}`;
    const retryable = isRetryableHttpStatus(status) || isLoginDatabaseError(status, body);
    if (!retryable) break;
    logger.warn(`[renew-session] Login for ${role}: ${last}, attempt ${attempt}/${LOGIN_ATTEMPTS}`);
    if (attempt < LOGIN_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
  }
  throw new Error(`[renew-session] Login for ${role} (ENV=${config.env}) failed: ${last}`);
}

async function logoutViaApi(context: APIRequestContext, role: Role, token: string): Promise<void> {
  // the ACCESS token goes in the body (no body: 400 000004). Never /tokens/force-logout: that logs out ALL users.
  const response = await context.delete(buildApiUrl('/tokens/logout'), { data: { token } });
  if (!response.ok()) {
    throw new Error(`[renew-session] Logout of the ${role} session failed: HTTP ${response.status()} ${(await response.text()).slice(0, 200)}`);
  }
  logger.info(`[renew-session] ${role}: logged out (HTTP ${response.status()})`);
}

function endOf(token: string, role: Role): { endIso: string; minutesLeft: number } {
  const end = describeSessionEnd(token);
  if (!end) throw new Error(`[renew-session] The ${role} session end could not be read from the token (no data.expiry)`);
  return end;
}

export async function renewSessionsForRun(): Promise<void> {
  const windowMs = config.auth.minRemainingForRunMs;
  const windowMin = Math.round(windowMs / 60000);
  const context = await apiRequest.newContext();
  try {
    for (const role of ROLES) {
      const token = await loginViaApi(context, role);
      let end = endOf(token, role);
      if (end.minutesLeft * 60000 >= windowMs) {
        recordSessionInfo(config.env, { role, endIso: end.endIso, minutesLeft: end.minutesLeft, belowRunWindow: false });
        logger.info(`[renew-session] ${role}: session OK, ends ${end.endIso} (${end.minutesLeft} min left; needs ${windowMin})`);
        continue;
      }
      logger.warn(`[renew-session] ${role}: ${end.minutesLeft} min left, under the ${windowMin} min run window: logging out once and logging in fresh`);
      await logoutViaApi(context, role, token);
      end = endOf(await loginViaApi(context, role), role);
      if (end.minutesLeft * 60000 < windowMs) {
        throw new Error(
          `[renew-session] The ${role} session has only ${end.minutesLeft} min left after logout and a fresh login (needs ${windowMin}, ends ${end.endIso})`
        );
      }
      const renewedAt = new Date().toISOString();
      recordSessionInfo(config.env, { role, endIso: end.endIso, minutesLeft: end.minutesLeft, belowRunWindow: false, renewedAt });
      logger.info(`[renew-session] ${role}: session renewed at ${renewedAt}, ends ${end.endIso} (${end.minutesLeft} min left)`);
    }
  } finally {
    await context.dispose();
  }
}
