/**
 * Compares a fresh `npx playwright test --list` run against the committed
 * baseline (config/expected-test-counts.json, see
 * scripts/generate-expected-test-counts.ts) and fails with a clear,
 * per-file diff on any mismatch — a test silently added, removed, or moved
 * between files without anyone noticing (this repo's own history has real,
 * confirmed incidents of exactly this — see .claude/known-issues.md's
 * "Suite Drift Detected" entry for the notification-pipeline's own version
 * of this same problem at the CI-run level; this is the same idea, run
 * locally/pre-commit instead of only after a full CI run completes).
 *
 * Run via `npm run check:test-counts`. On a genuine, deliberate test
 * add/remove/rename, regenerate the baseline
 * (`npx ts-node scripts/generate-expected-test-counts.ts`) and commit the
 * result — this check is never meant to be silenced any other way.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

const BASELINE_PATH = path.join(__dirname, '../config/expected-test-counts.json');

interface PlaywrightListSpec {
  file?: string;
  tests?: unknown[];
}
interface PlaywrightListSuite {
  specs?: PlaywrightListSpec[];
  suites?: PlaywrightListSuite[];
}
interface PlaywrightListReport {
  suites?: PlaywrightListSuite[];
}

interface ExpectedTestCounts {
  total: number;
  fileCount: number;
  perFile: Record<string, number>;
}

// WHY identical to plan-shards.ts's own extractJson() — see that file's WHY
// comment for the full dotenv-banner-brace incident this works around.
function extractJson(raw: string): string {
  const match = raw.match(/(?:^|\n)(\{[\s\S]*)/);
  if (!match) {
    throw new Error(`No JSON object found in playwright --list output. Full output:\n${raw}`);
  }
  return match[1];
}

function collectFileCounts(report: PlaywrightListReport): Record<string, number> {
  const counts: Record<string, number> = {};
  const walk = (suite: PlaywrightListSuite): void => {
    for (const spec of suite.specs ?? []) {
      if (!spec.file) continue;
      counts[spec.file] = (counts[spec.file] ?? 0) + (spec.tests?.length ?? 0);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const project of report.suites ?? []) walk(project);
  return counts;
}

function main(): void {
  if (!fs.existsSync(BASELINE_PATH)) {
    logger.error(
      `[check-test-counts] ${BASELINE_PATH} does not exist — generate it first: npx ts-node scripts/generate-expected-test-counts.ts`
    );
    process.exitCode = 1;
    return;
  }
  const expected = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as ExpectedTestCounts;

  logger.info('[check-test-counts] Discovering tests: npx playwright test --project=chromium --list --reporter=json');
  const rawOutput = execSync('npx playwright test --project=chromium --list --reporter=json', {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(extractJson(rawOutput)) as PlaywrightListReport;
  const actual = collectFileCounts(report);

  const actualTotal = Object.values(actual).reduce((a, b) => a + b, 0);
  const allFiles = new Set([...Object.keys(expected.perFile), ...Object.keys(actual)]);
  const diffs: string[] = [];
  for (const file of [...allFiles].sort()) {
    const exp = expected.perFile[file] ?? 0;
    const act = actual[file] ?? 0;
    if (exp !== act) {
      if (!(file in expected.perFile)) {
        diffs.push(`  ${file}: NEW file, not in baseline (${act} test(s))`);
      } else if (!(file in actual)) {
        diffs.push(`  ${file}: MISSING — baseline expected ${exp} test(s), file not found (or has 0 tests) now`);
      } else {
        diffs.push(`  ${file}: expected ${exp}, got ${act} (${act > exp ? '+' : ''}${act - exp})`);
      }
    }
  }

  if (diffs.length === 0) {
    logger.success(`[check-test-counts] Matches baseline — ${actualTotal} test(s) across ${Object.keys(actual).length} file(s)`);
    return;
  }

  logger.error(
    `[check-test-counts] MISMATCH vs config/expected-test-counts.json (baseline: ${expected.total} total; live: ${actualTotal} total):`
  );
  for (const line of diffs) logger.error(line);
  logger.error(
    '[check-test-counts] If this is a deliberate test add/remove/rename, regenerate the baseline: npx ts-node scripts/generate-expected-test-counts.ts — then commit the result.'
  );
  process.exitCode = 1;
}

main();
