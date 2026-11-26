/**
 * Offline checks for the CI renew-session job (src/auth/sessionRenewal.ts): the logout sends the ACCESS token, the steps log
 * fingerprints and never a token, the old token's status after the logout is reported, and the failure texts say whether the
 * session was the same. A fake API stands in for Kylas; nothing touches the network.
 * Run: npm run check:renew-session
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { RenewalApi, RenewalDeps, Role, announceRenewalFailure, failureFromError, renewRole } from '../src/auth/sessionRenewal';
import { RenewalError, describeRenewalFailure, loadRenewalFailure, parseRenewalFailure, renewalFailureLabel, writeRenewalFailure } from '../src/auth/renewalFailure';

let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}\n`);
};

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
export function makeJwt(access: string, minutesLeft: number, nowMs = Date.now()): string {
  return `${b64({ alg: 'HS256' })}.${b64({ iat: Math.floor((nowMs - 3600_000) / 1000), data: { accessToken: access, expiry: nowMs + minutesLeft * 60_000 + 30_000 } })}.sig-${access}`;
}

interface Calls { logins: Role[]; logouts: string[]; me: string[] }
function setup(opts: { logins: string[]; meStatus?: number | null; windowMin?: number; logoutError?: string; loginError?: string }): { deps: RenewalDeps; calls: Calls; logs: string[]; records: unknown[] } {
  const calls: Calls = { logins: [], logouts: [], me: [] };
  const logs: string[] = [];
  const records: unknown[] = [];
  const queue = [...opts.logins];
  const api: RenewalApi = {
    login: async (role) => { calls.logins.push(role); if (opts.loginError) throw new Error(opts.loginError); const t = queue.shift(); if (!t) throw new Error('no more logins'); return t; },
    logout: async (_role, accessToken) => { calls.logouts.push(accessToken); if (opts.logoutError) throw new Error(opts.logoutError); return 200; },
    meStatus: async (accessToken) => { calls.me.push(accessToken); return opts.meStatus === undefined ? 400 : opts.meStatus; },
  };
  const deps: RenewalDeps = { api, windowMs: (opts.windowMin ?? 240) * 60_000, now: () => Date.now(), info: (m) => logs.push(m), warn: (m) => logs.push(m), record: (e) => records.push(e) };
  return { deps, calls, logs, records };
}

const caught = async (fn: () => Promise<void>): Promise<unknown> => {
  try { await fn(); } catch (e) { return e; }
  return undefined;
};

/** Item 3 (2026-11-24): the failure record, the ::error annotation, the step summary, and the completeness cause. */
async function failureReporting(): Promise<void> {
  // kinds from renewRole
  const same = makeJwt('ACCESS-F1', 37);
  const s1 = setup({ logins: [same, same], meStatus: 200 });
  const e1 = await caught(() => renewRole('admin', s1.deps));
  check(e1 instanceof RenewalError && e1.detail.kind === 'not-renewed-after-logout' && e1.detail.sameSession === true && e1.detail.oldTokenStatusAfterLogout === 200 && e1.detail.minutesLeft === 37, 'a session that stays the same after the logout is "not-renewed-after-logout" with the evidence', JSON.stringify((e1 as RenewalError)?.detail));
  const e2 = await caught(() => renewRole('admin', setup({ logins: [makeJwt('ACCESS-F2', 37)], logoutError: '[renew-session] Logout of the admin session failed: HTTP 500 boom' }).deps));
  check(e2 instanceof RenewalError && e2.detail.kind === 'logout-failed' && e2.detail.minutesLeft === 37 && !/^\[renew-session\]/.test(e2.message), 'a failing logout is "logout-failed" (with the minutes left)');
  const e3 = await caught(() => renewRole('restricted', setup({ logins: [], loginError: '[renew-session] Login for restricted (ENV=staging) failed: HTTP 401 {}' }).deps));
  check(e3 instanceof RenewalError && e3.detail.kind === 'login-failed' && e3.detail.role === 'restricted', 'a failing login is "login-failed" and names the role');
  const noExpiry = `${b64({})}.${b64({ data: { accessToken: 'x' } })}.sig`;
  const e4 = await caught(() => renewRole('admin', setup({ logins: [noExpiry] }).deps));
  check(e4 instanceof RenewalError && e4.detail.kind === 'token-unreadable', 'a token without an expiry is "token-unreadable"');
  check(!(await caught(() => renewRole('admin', setup({ logins: [makeJwt('A', 37), makeJwt('B', 719)] }).deps))), 'a session that IS renewed throws nothing (no failure record)');

  // the record
  const f = failureFromError(e1, 240, '2026-11-24T15:05:00.000Z');
  check(f.role === 'admin' && f.kind === 'not-renewed-after-logout' && f.windowMin === 240 && f.at === '2026-11-24T15:05:00.000Z' && f.version === 1, 'failureFromError fills role, kind, window and time');
  check(failureFromError(new Error('boom'), 240, 't').kind === 'other' && failureFromError(new Error('boom'), 240, 't').role === 'unknown', 'an unexpected error becomes kind "other"');
  const text = describeRenewalFailure(f);
  check(/admin session had only 37 min left \(a run needs 240 min\)/.test(text) && /same session/.test(text) && /still accepted/.test(text) && /Every test job was skipped/.test(text), 'the cause is stated in words: minutes left, window, same session, old token still accepted, tests skipped', text);
  check(renewalFailureLabel(f) === 'BLOCKED — admin session not renewed' && renewalFailureLabel({ ...f, kind: 'login-failed' }) === 'BLOCKED — admin login failed', 'labels name the role and what failed');
  // file round trip in a temp cwd
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renew-fail-'));
  process.chdir(dir);
  try {
    writeRenewalFailure('staging', f);
    const stable = (o: object | null): string => JSON.stringify(o, Object.keys(o ?? {}).sort());
    check(stable(loadRenewalFailure('staging')) === stable(f), 'renew-session-failed.json reads back exactly as written');
    check(parseRenewalFailure('{ nope') === null && parseRenewalFailure('{"version":2}') === null && parseRenewalFailure('{"version":1,"role":"a","kind":"nonsense","message":"m"}') === null, 'garbage, a wrong version or an unknown kind read as "no information"');
    check(loadRenewalFailure('qa') === null, 'no file = no failure');
  } finally {
    process.chdir(cwd);
  }
  // annotation + step summary
  const summary = path.join(dir, 'summary.md');
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown) = (chunk: string | Uint8Array): boolean => { writes.push(String(chunk)); return true; };
  try {
    announceRenewalFailure({ ...f, message: 'line1\nline2 100%' }, summary);
  } finally {
    process.stdout.write = original;
  }
  const annotation = writes.join('');
  check(/^::error title=Session renewal failed — no test ran::The admin session had only 37 min left/.test(annotation) && !/\n./.test(annotation.trimEnd()), 'the ::error annotation is one line and names the cause');
  const md = fs.readFileSync(summary, 'utf-8');
  check(/### Session renewal failed: no test ran/.test(md) && /\| session time left \| 37 min \(a run needs 240\) \|/.test(md) && /the SAME session/.test(md) && /HTTP 200 \(still accepted\)/.test(md) && /skipped \(not crashed\)/.test(md), 'the step summary has the cause, a table of the evidence and what happened to the test jobs');
  check(!/ACCESS-F1/.test(md + annotation), 'neither the annotation nor the summary holds a token');
  (process.stdout.write as unknown) = (): boolean => true;
  try {
    announceRenewalFailure(f, undefined); // no summary file: still no throw
  } finally {
    process.stdout.write = original;
  }
  fs.rmSync(dir, { recursive: true, force: true });

  // verify-shard-completeness.sh writes the cause from the renew-session job result
  const run = (result: string | undefined, blobs: number): { json: string; out: string } => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vsc-'));
    const blobDir = path.join(d, 'blobs');
    fs.mkdirSync(blobDir);
    for (let i = 0; i < blobs; i++) fs.writeFileSync(path.join(blobDir, `b${i}.zip`), '');
    const r = spawnSync('bash', [path.resolve(__dirname, '../.github/scripts/verify-shard-completeness.sh'), 'staging', '5', '6'], {
      cwd: d, encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', BLOB_DIR: blobDir, ...(result !== undefined ? { RENEW_SESSION_RESULT: result } : {}) },
    });
    const json = fs.readFileSync(path.join(d, 'reports', 'staging', 'shard-completeness.json'), 'utf-8').trim();
    fs.rmSync(d, { recursive: true, force: true });
    return { json, out: `${r.stdout}${r.stderr}` };
  };
  const failedJob = run('failure', 0);
  check(failedJob.json === '{"expected":11,"reported":0,"cause":"renew-session:failure"}' && /::error title=No test job ran::The renew-session job did not succeed \(result: failure\)/.test(failedJob.out), 'verify-shard-completeness: renew-session failed + no blobs = the cause is written and annotated', failedJob.json);
  check(run('success', 0).json === '{"expected":11,"reported":0}', 'verify-shard-completeness: renew-session succeeded + missing blobs = no renew cause (a real crash stays "crashed")');
  check(run(undefined, 3).json === '{"expected":11,"reported":3}' && run('failure', 11).json === '{"expected":11,"reported":11}', 'verify-shard-completeness: no result given, or a complete run, = no cause');
}

async function main(): Promise<void> {
  // OK: enough left, no logout, fingerprints logged
  {
    const jwt = makeJwt('ACCESS-OK-1', 600);
    const s = setup({ logins: [jwt] });
    await renewRole('admin', s.deps);
    check(s.calls.logouts.length === 0 && s.records.length === 1, 'enough time left: no logout, the session is recorded');
    check(s.logs.some((l) => /token before logout: jwt=[0-9a-f]{12} access=[0-9a-f]{12} iat=\S+ expiry=\S+ \(\d+ min left\)/.test(l)), 'the token is described by fingerprints, iat, expiry and minutes left');
    check(!s.logs.join('\n').includes(jwt) && !s.logs.join('\n').includes('ACCESS-OK-1'), 'no log line holds the token or the access token');
  }
  // renewed: logout sends the ACCESS token, old token revoked, new session
  {
    const old = makeJwt('ACCESS-OLD-2', 37);
    const fresh = makeJwt('ACCESS-NEW-2', 719);
    const s = setup({ logins: [old, fresh] });
    await renewRole('admin', s.deps);
    check(s.calls.logouts.length === 1 && s.calls.logouts[0] === 'ACCESS-OLD-2' && s.calls.logouts[0] !== old, 'the logout body is the ACCESS token (payload.data.accessToken), not the login JWT (sandbox 45420781016)', JSON.stringify(s.calls.logouts));
    check(s.calls.me.length === 1 && s.calls.me[0] === 'ACCESS-OLD-2', 'GET /v1/users/me is asked about the old access token after the logout');
    check(s.logs.some((l) => /old access token after logout: GET \/v1\/users\/me -> HTTP 400 \(revoked\)/.test(l)), 'the log says the old token is revoked');
    check(s.logs.some((l) => /returned a NEW session/.test(l)) && s.logs.some((l) => /token after fresh login:/.test(l)), 'the log says the fresh login is a new session and describes its token');
    check(s.records.length === 1 && (s.records[0] as { renewedAt?: string }).renewedAt !== undefined, 'a renewed session is recorded with renewedAt');
    check(!s.logs.join('\n').includes('ACCESS-OLD-2') && !s.logs.join('\n').includes('ACCESS-NEW-2') && !s.logs.join('\n').includes(old), 'still no token in any log line');
  }
  // not renewed: the server hands back the same session
  {
    const old = makeJwt('ACCESS-SAME-3', 37);
    const s = setup({ logins: [old, old], meStatus: 200 });
    let message = '';
    try { await renewRole('admin', s.deps); } catch (e) { message = String(e); }
    check(/only 37 min left after logout and a fresh login/.test(message) && /same session as before the logout/.test(message) && /old access token after logout: HTTP 200/.test(message), 'a same session after the logout fails with the evidence in the message', message);
    check(s.logs.some((l) => /STILL ACCEPTED/.test(l)) && s.logs.some((l) => /returned the SAME session/.test(l)), 'the log says the logout did not revoke the old token and the session is the same');
  }
  // a login answer without an access token cannot be logged out
  {
    const noAccess = `${b64({})}.${b64({ data: { expiry: Date.now() + 37 * 60_000 } })}.sig`;
    const s = setup({ logins: [noAccess] });
    let message = '';
    try { await renewRole('admin', s.deps); } catch (e) { message = String(e); }
    check(/no access token/.test(message) && s.calls.logouts.length === 0, 'a login answer without data.accessToken fails by name and logs nothing out');
  }
  await failureReporting();
  process.stdout.write(failed === 0 ? `\ncheck:renew-session — all ${total} checks passed\n` : `\ncheck:renew-session — ${failed} of ${total} check(s) FAILED\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
