/**
 * ############################################################################################################
 * # WARNING: THIS SCRIPT LOGS OUT THE SHARED STAGING ADMIN SESSION. IT REVOKES THE TOKEN FOR EVERY HOLDER OF  #
 * # THE ACCOUNT (CI runs, Jenkins, laptops, a browser tab). NEVER RUN IT WHILE ANY TEST RUN USES THIS         #
 * # ENVIRONMENT. Run it only when staging is idle and the maintainer has said so.                            #
 * ############################################################################################################
 *
 * Staging probe for the renew-session question (2026-11-24, sandbox 45420781016): after `DELETE /v1/tokens/logout`, does a fresh
 * `PUT /v1/users/login` give a NEW 12 h session, immediately or after a delay, or the old one until it expires naturally?
 *
 * It LOGS THE ADMIN SESSION OUT (revokes the shared token for every holder): run it only when staging is idle and the
 * maintainer has said so. Prints fingerprints and times only, never a token. Reads ENV=staging credentials from .env.
 *
 *   ENV=staging npx ts-node scripts/probe-logout-login.ts [--role admin|restricted] [--also-old-body]
 *
 * Leg A: login -> GET /users/me -> logout with the ACCESS token (data.accessToken, the verified call) -> GET /users/me with the old
 * token -> a fresh login immediately and at +5 s, +30 s, +60 s, +5 min (each compared with the first session).
 * Leg B (--also-old-body, runs on the session leg A left): logout with the whole login JWT as the body (what renew-session sent
 * until 2026-11-24) -> is the access token still accepted? Tells whether that body ever revoked anything.
 */
import { request as apiRequest } from '@playwright/test';
import { buildApiUrl, config } from '../config/config';
import { accessTokenFromStoredToken } from '../src/auth/sessionCheck';
import { describeToken, TokenDescription } from '../src/auth/sessionLifetime';
import { loginViaApi, Role, sameSession } from '../src/auth/sessionRenewal';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const role = (arg('role') ?? 'admin') as Role;
const out = (line: string): void => void process.stdout.write(`${line}\n`);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const stamp = (): string => new Date().toISOString().slice(11, 19);

interface Row { step: string; at: string; http: string; jwt: string; access: string; expiry: string; left: string; session: string }
const rows: Row[] = [];
const row = (step: string, http: string, d: TokenDescription | null, first: TokenDescription | null): void => {
  rows.push({
    step, at: stamp(), http,
    jwt: d?.jwtFingerprint ?? '-', access: d?.accessFingerprint ?? '-', expiry: d?.expiryIso?.slice(0, 19) ?? '-', left: d?.minutesLeft === null || !d ? '-' : String(d.minutesLeft),
    session: !d || !first ? '-' : sameSession(first, d) ? 'SAME as first' : 'NEW',
  });
};

async function main(): Promise<void> {
  if (config.env !== 'staging') throw new Error(`refusing to run against ENV=${config.env}: this probe is for staging only`);
  const context = await apiRequest.newContext();
  const me = async (access: string): Promise<string> => {
    try {
      return `HTTP ${(await context.get(buildApiUrl('/users/me'), { headers: { Authorization: `Bearer ${access}` } })).status()}`;
    } catch {
      return 'no answer';
    }
  };
  const logout = async (body: string): Promise<string> => {
    const r = await context.delete(buildApiUrl('/tokens/logout'), { data: { token: body } });
    return `HTTP ${r.status()}`;
  };
  try {
    const first = await loginViaApi(context, role);
    const firstD = describeToken(first);
    const firstAccess = accessTokenFromStoredToken(first);
    if (!firstAccess) throw new Error('the login answer has no access token (payload.data.accessToken)');
    row('1 login (first session)', '200', firstD, firstD);
    row('2 GET /users/me, first access token', await me(firstAccess), null, firstD);
    row('3 logout with the ACCESS token', await logout(firstAccess), null, firstD);
    row('4 GET /users/me, OLD access token, right after', await me(firstAccess), null, firstD);
    let last = first;
    for (const [label, wait] of [['5a login immediately', 0], ['5b login at +5 s', 5000], ['5c login at +30 s', 25000], ['5d login at +60 s', 30000], ['5e login at +5 min', 240000]] as const) {
      if (wait) await sleep(wait);
      last = await loginViaApi(context, role);
      const d = describeToken(last);
      row(label, '200', d, firstD);
      row(`   GET /users/me, OLD access token (${label.slice(3)})`, await me(firstAccess), null, firstD);
    }
    if (process.argv.includes('--also-old-body')) {
      const lastAccess = accessTokenFromStoredToken(last);
      if (!lastAccess) throw new Error('the last login has no access token');
      const lastD = describeToken(last);
      row('B1 session before the old-body logout', '-', lastD, firstD);
      row('B2 logout with the whole login JWT as body', await logout(last), null, firstD);
      row('B3 GET /users/me, access token after the JWT-body logout', await me(lastAccess), null, firstD);
    }
  } finally {
    await context.dispose();
  }
  out(`\nProbe of ${role} on ${config.env} (${new Date().toISOString()}), fingerprints only:\n`);
  out('| step | UTC | answer | jwt fp | access fp | expiry | min left | session |');
  out('|---|---|---|---|---|---|---|---|');
  for (const r of rows) out(`| ${r.step} | ${r.at} | ${r.http} | ${r.jwt} | ${r.access} | ${r.expiry} | ${r.left} | ${r.session} |`);
}

main().catch((error) => {
  out(`probe stopped: ${String(error).split('\n')[0]}`);
  if (rows.length > 0) for (const r of rows) out(`| ${r.step} | ${r.at} | ${r.http} | ${r.jwt} | ${r.access} | ${r.expiry} | ${r.left} | ${r.session} |`);
  process.exitCode = 1;
});
