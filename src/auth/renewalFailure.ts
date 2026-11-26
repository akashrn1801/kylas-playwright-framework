import * as fs from 'fs';
import * as path from 'path';

// Why the CI `renew-session` job failed, written by src/auth/sessionRenewal.ts to reports/<env>/renew-session-failed.json and
// read by the notification (verdict, subject, banner) and the job summary (2026-11-24, sandbox run 45420781016: every test job
// was skipped and the email said only "Incomplete run"). Optional and graceful like shard-completeness.json: a missing or
// garbled file is "no information", never "renewal failed".
//
// Kinds that can still happen now that the logout sends the access token (probe 2026-11-24: a fresh login right after it gives a
// NEW 12 h session): the logout or a login fails, a token cannot be read, or, if the backend ever changes, the session is not
// renewed after a successful logout.
export type RenewalFailureKind = 'not-renewed-after-logout' | 'logout-failed' | 'login-failed' | 'token-unreadable' | 'other';

export interface RenewalFailure {
  version: 1;
  role: string;
  kind: RenewalFailureKind;
  minutesLeft: number | null;
  // When the session behind the last login ends (ISO).
  endIso: string | null;
  windowMin: number;
  // After a logout and a fresh login: was it the same session? null = never got that far.
  sameSession: boolean | null;
  // HTTP status of GET /v1/users/me with the old access token after the logout (400 = revoked, 200 = still accepted).
  oldTokenStatusAfterLogout: number | null;
  message: string;
  at: string;
}

export type RenewalErrorDetail = Pick<RenewalFailure, 'role' | 'kind' | 'minutesLeft' | 'endIso' | 'sameSession' | 'oldTokenStatusAfterLogout'>;

/** An Error that carries what the email and the summary need to say. */
export class RenewalError extends Error {
  constructor(
    message: string,
    public readonly detail: RenewalErrorDetail
  ) {
    super(message);
    this.name = 'RenewalError';
  }
}

export function getRenewalFailurePath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'renew-session-failed.json');
}

const KINDS: RenewalFailureKind[] = ['not-renewed-after-logout', 'logout-failed', 'login-failed', 'token-unreadable', 'other'];

export function parseRenewalFailure(raw: string): RenewalFailure | null {
  try {
    const p = JSON.parse(raw) as Partial<RenewalFailure>;
    if (p.version !== 1 || typeof p.role !== 'string' || !KINDS.includes(p.kind as RenewalFailureKind) || typeof p.message !== 'string') return null;
    return {
      version: 1,
      role: p.role,
      kind: p.kind as RenewalFailureKind,
      minutesLeft: typeof p.minutesLeft === 'number' ? p.minutesLeft : null,
      endIso: typeof p.endIso === 'string' ? p.endIso : null,
      windowMin: typeof p.windowMin === 'number' ? p.windowMin : 0,
      sameSession: typeof p.sameSession === 'boolean' ? p.sameSession : null,
      oldTokenStatusAfterLogout: typeof p.oldTokenStatusAfterLogout === 'number' ? p.oldTokenStatusAfterLogout : null,
      message: p.message,
      at: typeof p.at === 'string' ? p.at : '',
    };
  } catch {
    return null;
  }
}

export function loadRenewalFailure(env: string): RenewalFailure | null {
  try {
    const file = getRenewalFailurePath(env);
    if (!fs.existsSync(file)) return null;
    return parseRenewalFailure(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/** Never throws: the failure itself is what matters. */
export function writeRenewalFailure(env: string, failure: RenewalFailure): void {
  try {
    const file = getRenewalFailurePath(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(failure, null, 2));
  } catch {
    /* information only */
  }
}

/** The verdict label / subject segment: short, names the role and what went wrong. */
export function renewalFailureLabel(f: RenewalFailure): string {
  return f.kind === 'login-failed' ? `BLOCKED — ${f.role} login failed` : `BLOCKED — ${f.role} session not renewed`;
}

/** The cause in words, for the annotation, the job summary, the headline and the banner. */
export function describeRenewalFailure(f: RenewalFailure): string {
  const left = f.minutesLeft === null ? 'an unknown time' : `${f.minutesLeft} min`;
  switch (f.kind) {
    case 'not-renewed-after-logout':
      return (
        `The ${f.role} session had only ${left} left (a run needs ${f.windowMin} min) and the logout plus a fresh login did not renew it: ` +
        `${f.sameSession === true ? 'the login returned the same session' : 'the new session also has too little time'}` +
        `${f.oldTokenStatusAfterLogout === 200 ? ' (the old access token was still accepted after the logout)' : ''}` +
        `${f.endIso ? `, ending ${f.endIso}` : ''}. Every test job was skipped.`
      );
    case 'logout-failed':
      return `The ${f.role} session had only ${left} left (a run needs ${f.windowMin} min) and the logout failed: ${f.message}. Every test job was skipped.`;
    case 'login-failed':
      return `The ${f.role} login failed, so the session could not be checked or renewed: ${f.message}. Every test job was skipped.`;
    case 'token-unreadable':
      return `The ${f.role} login answer had no readable access token or expiry, so the session could not be checked: ${f.message}. Every test job was skipped.`;
    default:
      return `The ${f.role} session could not be renewed: ${f.message}. Every test job was skipped.`;
  }
}
