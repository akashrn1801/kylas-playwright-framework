import * as fs from 'fs';
import * as path from 'path';

// ADR 0017: when each role's session ends, written by globalSetup and shown in the run email, so a failure near the
// session end (the app's token-refresh cascade) is recognisable. Missing file = nothing to show.
export interface SessionInfoEntry {
  role: string;
  endIso: string;
  minutesLeft: number;
  belowRunWindow: boolean;
  recordedAt: string;
  // set only by the CI `renew-session` job when it logged this role out and in again (ADR 0017)
  renewedAt?: string;
}

export function sessionInfoPath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'session-info.json');
}

/** Adds or replaces the entry of `entry.role`; never throws (this is information only). */
export function recordSessionInfo(env: string, entry: Omit<SessionInfoEntry, 'recordedAt'>): void {
  try {
    const file = sessionInfoPath(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const others = loadSessionInfo(env).filter((existing) => existing.role !== entry.role);
    fs.writeFileSync(file, JSON.stringify([...others, { ...entry, recordedAt: new Date().toISOString() }], null, 2));
  } catch {
    /* information only */
  }
}

export function loadSessionInfo(env: string): SessionInfoEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionInfoPath(env), 'utf8')) as SessionInfoEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
