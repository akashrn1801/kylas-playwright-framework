import * as path from 'path';
import { execSync } from 'child_process';
import { loadDotEnv } from './loadDotEnv';
import { NotificationInput } from '../NotificationService';

// Manually load .env before anything else
loadDotEnv();

// WHY: added 2026-07-14 — branch/commit previously fell straight through to a
// static 'unknown' literal whenever no CI env var was set, even though this
// is always a real git checkout locally and the real values are one command
// away. Confirmed live: two separate real sends both showed "unknown" for
// whichever of branch/commit had no CI env var supplied. Wrapped in try/catch
// — a local run outside any git repo (unlikely but possible, e.g. a stripped
// CI artifact checkout) must still degrade to 'unknown' gracefully, not throw.
function localGitFallback(cmd: string): string | null {
  try {
    const out = execSync(cmd, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

// WHY: extracted as its own pure, exported function (2026-07-14, Phase 4
// verification) — previously this logic lived inline inside main(), which
// also calls service.notify() (a real, side-effecting email send whenever
// SMTP credentials are configured). That made it impossible to safely verify
// "does this actually derive triggeredBy/buildUrl/allureUrl dynamically from
// the environment" without risking a real send. This function has zero side
// effects on process.env or the filesystem — the local-git calls below are
// read-only (`branch --show-current` / `rev-parse`) — so it can be imported
// and called directly in a test/verification context with different env
// vars, and the exact real branches that run in production are the ones
// being verified, not a duplicated approximation of them.
export function resolveNotificationInput(): Omit<NotificationInput, 'jsonReportPath'> {
  const isJenkins = !!process.env.JENKINS_URL || !!process.env.BUILD_NUMBER;
  const isGHA = !!process.env.GITHUB_ACTIONS;
  const env = process.env.ENV || 'qa';
  const branch =
    process.env.BRANCH_NAME ||
    process.env.GITHUB_REF_NAME ||
    localGitFallback('git branch --show-current') ||
    'unknown';
  const buildNumber = process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || 'local';
  const gitCommit =
    process.env.GIT_COMMIT ||
    process.env.GITHUB_SHA ||
    localGitFallback('git rev-parse --short HEAD') ||
    'unknown';
  let buildUrl = '';
  let triggeredBy = 'local';
  // WHY: added 2026-07-14 during Phase 4 verification — EmailContext.allureUrl
  // was declared and rendered in EmailTemplate.ts but never actually assigned
  // anywhere in this pipeline (confirmed via grep across the whole
  // src/notifications tree), so the Allure CTA/link silently never rendered
  // in any real email, ever. Jenkins' `allure(...)` pipeline step (see
  // Jenkinsfile.qa/.staging/.prod) publishes its report at the real, standard
  // `${BUILD_URL}allure/` path — the same pattern EmailTemplate.ts's OLD
  // fallback logic already assumed but never had a real source to confirm.
  // GitHub Actions workflows do not run the Allure step anywhere (confirmed
  // via grep across .github/workflows/*.yml) — there is no real Allure URL to
  // derive there, so it's left undefined (graceful omission), not guessed.
  let allureUrl: string | undefined;

  if (isJenkins) {
    buildUrl = process.env.BUILD_URL || '';
    triggeredBy = process.env.BUILD_USER || 'Jenkins';
    if (buildUrl) allureUrl = `${buildUrl}allure/`;
  } else if (isGHA) {
    const repo = process.env.GITHUB_REPOSITORY || '';
    const runId = process.env.GITHUB_RUN_ID || '';
    buildUrl = `https://github.com/${repo}/actions/runs/${runId}`;
    triggeredBy = process.env.GITHUB_ACTOR || 'GitHub Actions';
  } else {
    triggeredBy = process.env.USER || 'local';
  }

  const runSource: NotificationInput['runSource'] = isJenkins
    ? 'jenkins'
    : isGHA
      ? 'github-actions'
      : 'local';

  return { env, branch, buildNumber, buildUrl, gitCommit, triggeredBy, runSource, allureUrl };
}

async function main() {
  const { NotificationService } = await import('../NotificationService');
  const service = new NotificationService();

  const env_for_path = process.env.ENV || 'qa';
  const jsonReportPath = path.resolve(
    process.env.REPORT_PATH ||
      (process.env.CI
        ? path.join(process.cwd(), 'reports', 'playwright-report', 'results.json')
        : path.join(
            process.cwd(),
            'reports',
            env_for_path,
            'latest',
            'playwright-report',
            'results.json'
          ))
  );

  await service.notify({ jsonReportPath, ...resolveNotificationInput() });
}

// WHY: guarded behind require.main === module (2026-07-14, added after a
// real incident) — this file previously called main() unconditionally at the
// top level, which meant importing ANYTHING from this file (e.g. the pure
// resolveNotificationInput() above, for safe testing) also executed main(),
// which reaches the real, side-effecting EmailAdapter.send() whenever SMTP
// credentials are configured. That is exactly what happened: an import
// intended only to exercise the pure derivation function instead sent a real
// email to the real configured recipient list. This guard ensures main()
// only runs when this file is executed directly as the entry script (`ts-node
// notify.ts` / `npm run notify`), never as a side effect of importing from it.
if (require.main === module) {
  main().catch((err) => {
    console.error('[Notification] Fatal error:', err);
    process.exit(0);
  });
}
