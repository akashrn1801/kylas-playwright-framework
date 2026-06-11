import * as fs from 'fs';
import * as path from 'path';

// Manually load .env before anything else
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
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

async function main() {
  const { NotificationService } = await import('../NotificationService');
  const service = new NotificationService();

  const env_for_path = process.env.ENV || 'qa';
  const jsonReportPath = path.resolve(
    process.env.REPORT_PATH ||
    (process.env.CI
      ? path.join(process.cwd(), 'reports', 'playwright-report', 'results.json')
      : path.join(process.cwd(), 'reports', env_for_path, 'latest', 'playwright-report', 'results.json'))
  );

  const isJenkins = !!process.env.JENKINS_URL || !!process.env.BUILD_NUMBER;
  const isGHA     = !!process.env.GITHUB_ACTIONS;
  const env         = process.env.ENV || 'qa';
  const branch      = process.env.BRANCH_NAME || process.env.GITHUB_REF_NAME || 'unknown';
  const buildNumber = process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || 'local';
  const gitCommit   = process.env.GIT_COMMIT || process.env.GITHUB_SHA || 'unknown';
  let buildUrl    = '';
  let triggeredBy = 'local';

  if (isJenkins) {
    buildUrl    = process.env.BUILD_URL || '';
    triggeredBy = process.env.BUILD_USER || 'Jenkins';
  } else if (isGHA) {
    const repo  = process.env.GITHUB_REPOSITORY || '';
    const runId = process.env.GITHUB_RUN_ID || '';
    buildUrl    = `https://github.com/${repo}/actions/runs/${runId}`;
    triggeredBy = process.env.GITHUB_ACTOR || 'GitHub Actions';
  } else {
    triggeredBy = process.env.USER || 'local';
  }

  const runSource = isJenkins ? 'jenkins' : isGHA ? 'github-actions' : 'local';
  await service.notify({ jsonReportPath, env, branch, buildNumber, buildUrl, gitCommit, triggeredBy, runSource });
}

main().catch(err => { console.error('[Notification] Fatal error:', err); process.exit(0); });
