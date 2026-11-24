import { request as apiRequest, APIRequestContext } from '@playwright/test';
import { config, buildApiUrl } from '../../config/config';
import { accessTokenFromStoredToken } from './sessionCheck';
import { describeSessionEnd, describeToken, TokenDescription } from './sessionLifetime';
import { recordSessionInfo, SessionInfoEntry } from './sessionInfo';
import { RenewalError, RenewalFailure, describeRenewalFailure, writeRenewalFailure } from './renewalFailure';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { isLoginDatabaseError, isRetryableHttpStatus } from '../utils/retryableStatus';

// ADR 0017 (amended 2026-11-20): the CI `renew-session` job renews each role's session ONCE, before every test job.
// API only, no browser: `PUT /v1/users/login` returns {token: <JWT>} (the same call the app's login form makes) and
// the JWT carries its own expiry (data.expiry). A login inside a live session returns the SAME token, so this
// reads the real session end; under the full run window left = `DELETE /v1/tokens/logout` once (revokes the token
// for EVERY holder of the account: safe in CI only because the `kylas-staging` concurrency group allows one staging
// run at a time) and a fresh login. The shards then log in from their own globalSetup and get this session's token.
//
// 2026-11-24 (sandbox run 45420781016: "logged out (HTTP 200)" and the next login still had the same 37 min): the logout
// body was the whole login JWT, but the verified call (live test 2026-11-17, globalSetup.logoutSession) sends the ACCESS token
// inside it (payload.data.accessToken). The server answered 200 and revoked nothing, as far as the evidence shows (the log
// never said whether the token was the same). Now the access token is sent, and every step logs fingerprints, iat and expiry
// (never the token) plus what `GET /v1/users/me` says about the old access token after the logout, so the next run proves it.
export const ROLES = ['admin', 'restricted'] as const;
export type Role = (typeof ROLES)[number];
const LOGIN_ATTEMPTS = 3;

/** The three calls the renewal makes. The default talks to the real API; check-renew-session.ts supplies a fake. */
export interface RenewalApi {
  /** `PUT /v1/users/login`: the login JWT. */
  login(role: Role): Promise<string>;
  /** `DELETE /v1/tokens/logout` with the ACCESS token in the body. */
  logout(role: Role, accessToken: string): Promise<number>;
  /** HTTP status of `GET /v1/users/me` with this access token as Bearer (null = no answer). 400 001002 = revoked. */
  meStatus(accessToken: string): Promise<number | null>;
}

export interface RenewalDeps {
  api: RenewalApi;
  windowMs: number;
  now: () => number;
  info: (message: string) => void;
  warn: (message: string) => void;
  record: (entry: Omit<SessionInfoEntry, 'recordedAt'>) => void;
}

function describeForLog(label: string, role: Role, description: TokenDescription): string {
  return (
    `[renew-session] ${role} token ${label}: jwt=${description.jwtFingerprint} access=${description.accessFingerprint ?? 'none'} ` +
    `iat=${description.iatIso ?? 'n/a'} expiry=${description.expiryIso ?? 'n/a'} (${description.minutesLeft ?? '?'} min left)`
  );
}

/** Same session = the same access token (the Bearer value); the login JWT is the fallback when none can be read. */
export function sameSession(a: TokenDescription, b: TokenDescription): boolean {
  return a.accessFingerprint !== null && b.accessFingerprint !== null ? a.accessFingerprint === b.accessFingerprint : a.jwtFingerprint === b.jwtFingerprint;
}

function endOf(token: string, role: Role): { endIso: string; minutesLeft: number } {
  const end = describeSessionEnd(token);
  if (!end) throw new Error(`[renew-session] The ${role} session end could not be read from the token (no data.expiry)`);
  return end;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).replace(/^\[renew-session\]\s*/, '');

/** One role: log in, and when under the run window log out once and log in again. Throws a RenewalError when it cannot be renewed. */
export async function renewRole(role: Role, deps: RenewalDeps): Promise<void> {
  const { api, windowMs } = deps;
  const windowMin = Math.round(windowMs / 60000);
  const fail = (message: string, kind: RenewalError['detail']['kind'], extra: Partial<RenewalError['detail']> = {}): RenewalError =>
    new RenewalError(message, { role, kind, minutesLeft: null, endIso: null, sameSession: null, oldTokenStatusAfterLogout: null, ...extra });
  const login = async (): Promise<string> => {
    try {
      return await api.login(role);
    } catch (error) {
      throw fail(messageOf(error), 'login-failed');
    }
  };
  const endOrFail = (token: string, extra: Partial<RenewalError['detail']> = {}): { endIso: string; minutesLeft: number } => {
    try {
      return endOf(token, role);
    } catch (error) {
      throw fail(messageOf(error), 'token-unreadable', extra);
    }
  };

  const before = await login();
  const beforeDescription = describeToken(before, deps.now());
  let end = endOrFail(before);
  deps.info(describeForLog('before logout', role, beforeDescription));
  if (end.minutesLeft * 60000 >= windowMs) {
    deps.record({ role, endIso: end.endIso, minutesLeft: end.minutesLeft, belowRunWindow: false });
    deps.info(`[renew-session] ${role}: session OK, ends ${end.endIso} (${end.minutesLeft} min left; needs ${windowMin})`);
    return;
  }
  deps.warn(`[renew-session] ${role}: ${end.minutesLeft} min left, under the ${windowMin} min run window: logging out once and logging in fresh`);
  const accessToken = accessTokenFromStoredToken(before);
  if (!accessToken) {
    throw fail(`the login answer has no access token (payload.data.accessToken): cannot log the session out`, 'token-unreadable', { minutesLeft: end.minutesLeft, endIso: end.endIso });
  }
  let logoutStatus: number;
  try {
    logoutStatus = await api.logout(role, accessToken);
  } catch (error) {
    throw fail(messageOf(error), 'logout-failed', { minutesLeft: end.minutesLeft, endIso: end.endIso });
  }
  deps.info(`[renew-session] ${role}: logged out (HTTP ${logoutStatus})`);
  const oldStatus = await api.meStatus(accessToken);
  deps.info(
    `[renew-session] ${role}: old access token after logout: GET /v1/users/me -> ${oldStatus === null ? 'no answer' : `HTTP ${oldStatus}`} ` +
      `(${oldStatus === 400 ? 'revoked' : oldStatus === 200 ? 'STILL ACCEPTED: the logout did not revoke it' : 'unexpected'})`
  );
  const after = await login();
  const afterDescription = describeToken(after, deps.now());
  deps.info(describeForLog('after fresh login', role, afterDescription));
  const same = sameSession(beforeDescription, afterDescription);
  deps.info(`[renew-session] ${role}: the fresh login returned ${same ? 'the SAME session' : 'a NEW session'} as before the logout`);
  end = endOrFail(after, { oldTokenStatusAfterLogout: oldStatus });
  if (end.minutesLeft * 60000 < windowMs) {
    throw fail(
      `The ${role} session has only ${end.minutesLeft} min left after logout and a fresh login (needs ${windowMin}, ends ${end.endIso}; ` +
        `${same ? 'same session as before the logout' : 'a new session'}; old access token after logout: ${oldStatus === null ? 'no answer' : `HTTP ${oldStatus}`})`,
      'not-renewed-after-logout',
      { minutesLeft: end.minutesLeft, endIso: end.endIso, sameSession: same, oldTokenStatusAfterLogout: oldStatus }
    );
  }
  const renewedAt = new Date(deps.now()).toISOString();
  deps.record({ role, endIso: end.endIso, minutesLeft: end.minutesLeft, belowRunWindow: false, renewedAt });
  deps.info(`[renew-session] ${role}: session renewed at ${renewedAt}, ends ${end.endIso} (${end.minutesLeft} min left)`);
}

/** The failure as written to renew-session-failed.json, from whatever the renewal threw. */
export function failureFromError(error: unknown, windowMin: number, nowIso: string): RenewalFailure {
  const detail =
    error instanceof RenewalError
      ? error.detail
      : { role: 'unknown', kind: 'other' as const, minutesLeft: null, endIso: null, sameSession: null, oldTokenStatusAfterLogout: null };
  return { version: 1, ...detail, windowMin, message: messageOf(error), at: nowIso };
}

// GitHub workflow commands escape these three characters in the message.
const escapeCommand = (text: string): string => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

/**
 * Makes the failure impossible to miss in the run: an `::error` annotation (it shows on the run page) and a step summary block
 * (2026-11-24: the run said nothing about WHY every test job was skipped). Never throws.
 */
export function announceRenewalFailure(failure: RenewalFailure, summaryFile: string | undefined = process.env.GITHUB_STEP_SUMMARY): void {
  try {
    process.stdout.write(`::error title=Session renewal failed — no test ran::${escapeCommand(describeRenewalFailure(failure))}\n`);
    if (!summaryFile) return;
    const rows: [string, string][] = [
      ['role', failure.role],
      ['what failed', failure.kind],
      ['session time left', failure.minutesLeft === null ? 'unknown' : `${failure.minutesLeft} min (a run needs ${failure.windowMin})`],
      ['session ends', failure.endIso ?? 'unknown'],
      ['after logout + fresh login', failure.sameSession === null ? 'not reached' : failure.sameSession ? 'the SAME session' : 'a new session, still too short'],
      ['old access token after the logout', failure.oldTokenStatusAfterLogout === null ? 'not checked' : `HTTP ${failure.oldTokenStatusAfterLogout}${failure.oldTokenStatusAfterLogout === 400 ? ' (revoked)' : failure.oldTokenStatusAfterLogout === 200 ? ' (still accepted)' : ''}`],
    ];
    fs.appendFileSync(
      summaryFile,
      [
        '### Session renewal failed: no test ran',
        '',
        describeRenewalFailure(failure),
        '',
        '| | |',
        '|---|---|',
        ...rows.map(([k, v]) => `| ${k} | ${v} |`),
        '',
        'Every test job needs this job, so they were all skipped (not crashed); the email names this cause. Re-run the failed jobs once the cause is fixed.',
        '',
      ].join('\n')
    );
  } catch {
    /* information only */
  }
}

// ── the real API ─────────────────────────────────────────────────────────────────────────────────────────────────
export async function loginViaApi(context: APIRequestContext, role: Role): Promise<string> {
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

function realApi(context: APIRequestContext): RenewalApi {
  return {
    login: (role) => loginViaApi(context, role),
    async logout(role, accessToken) {
      // the ACCESS token goes in the body (no body: 400 000004). Never /tokens/force-logout: that logs out ALL users.
      const response = await context.delete(buildApiUrl('/tokens/logout'), { data: { token: accessToken } });
      if (!response.ok()) {
        throw new Error(`[renew-session] Logout of the ${role} session failed: HTTP ${response.status()} ${(await response.text()).slice(0, 200)}`);
      }
      return response.status();
    },
    async meStatus(accessToken) {
      try {
        const response = await context.get(buildApiUrl('/users/me'), { headers: { Authorization: `Bearer ${accessToken}` } });
        return response.status();
      } catch {
        return null;
      }
    },
  };
}

export async function renewSessionsForRun(): Promise<void> {
  const context = await apiRequest.newContext();
  const windowMs = config.auth.minRemainingForRunMs;
  try {
    const deps: RenewalDeps = {
      api: realApi(context),
      windowMs,
      now: () => Date.now(),
      info: (m) => logger.info(m),
      warn: (m) => logger.warn(m),
      record: (entry) => recordSessionInfo(config.env, entry),
    };
    for (const role of ROLES) await renewRole(role, deps);
  } catch (error) {
    // The email, the verdict and the job summary read this (never a silent "Incomplete run").
    const failure = failureFromError(error, Math.round(windowMs / 60000), new Date().toISOString());
    writeRenewalFailure(config.env, failure);
    announceRenewalFailure(failure);
    throw error;
  } finally {
    await context.dispose();
  }
}
