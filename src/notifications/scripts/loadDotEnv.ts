import * as fs from 'fs';
import * as path from 'path';

// WHY: Confirmed live (2026-07-07 reporting overhaul) — extracted from notify.ts,
// which previously hand-rolled this same block inline. syncHistory.ts needs the
// identical behaviour: Jenkinsfile (main) writes a `.env` file during its test
// stage (ENV=staging|prod, resolved dynamically from the branch), and both the
// notify step and the history-sync step run later in the SAME workspace but as
// separate `sh` invocations with no shared shell environment between them — the
// only thing carrying that ENV value forward is this file. Without loading it
// the same way notify.ts always has, syncHistory.ts would silently default to
// 'qa' inside Jenkinsfile's main pipeline regardless of which branch actually
// ran. GitHub Actions workflows don't need this (they pass ENV explicitly per
// step), but calling loadDotEnv() unconditionally is harmless there too — it's a
// no-op when .env doesn't exist.
export function loadDotEnv(): void {
  const envFile = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    const val = trimmed.substring(idx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
