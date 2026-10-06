/**
 * Regenerates config/expected-test-counts.json from a real
 * `npx playwright test --list --reporter=json` run — the committed baseline
 * that check-test-counts.ts compares every future --list run against (see
 * that file's own header for why this exists). Run this and commit the
 * result whenever a test is deliberately added/removed/renamed.
 *
 * WHY a separate generator script from the checker (2026-09-30): mirrors
 * scripts/plan-shards.ts's own "discover via a real --list run" pattern
 * exactly (down to reusing its identical extractJson() dotenv-banner-brace
 * workaround, duplicated here rather than imported — this is a small,
 * ~10-line helper, and importing across these two standalone CLI scripts
 * would create a coupling neither needs; see plan-shards.ts's own comment
 * for the full incident this specific workaround fixes).
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

const OUTPUT_PATH = path.join(__dirname, '../config/expected-test-counts.json');

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
  logger.info('[generate-expected-test-counts] Discovering tests: npx playwright test --project=chromium --list --reporter=json');
  const rawOutput = execSync('npx playwright test --project=chromium --list --reporter=json', {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(extractJson(rawOutput)) as PlaywrightListReport;
  const counts = collectFileCounts(report);
  const sortedKeys = Object.keys(counts).sort();
  const perFile: Record<string, number> = {};
  for (const key of sortedKeys) perFile[key] = counts[key];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const out = {
    _comment:
      'Generated from a real "npx playwright test --project=chromium --list --reporter=json" run — never hand-edited. Regenerate via: npx ts-node scripts/generate-expected-test-counts.ts',
    generatedAt: new Date().toISOString(),
    total,
    fileCount: sortedKeys.length,
    perFile,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n');
  logger.success(`[generate-expected-test-counts] Wrote ${OUTPUT_PATH} — total=${total} files=${sortedKeys.length}`);
}

main();
