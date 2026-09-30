/**
 * Regenerates the per-module UI/RBAC/Total test-count table in README.md's
 * "Current suite size" section from a real `--list` run — the table lives
 * between `<!-- AUTO-GENERATED:module-table:START -->` and `...:END -->`
 * markers and must never be hand-edited (this is the exact figure this
 * repo's own CLAUDE.md's "Module Status" section already warns can go
 * stale — "any older count anywhere is stale and should be re-run, not
 * trusted"; this script makes that re-run a one-command, zero-manual-
 * transcription operation instead of a hand-copied table).
 *
 * WHY reusing ReportParser.deriveModuleFromFile(), not a second,
 * independently-maintained module-name-derivation copy (2026-09-30): that
 * function is already the real, live source of truth the notification
 * pipeline itself uses to label modules — importing it directly means this
 * doc's own module names can never drift out of sync with what Module
 * Analytics actually shows in a real CI email.
 *
 * Run via `npm run update:doc-numbers`.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { deriveModuleFromFile } from '../src/notifications/ReportParser';
import { logger } from '../src/utils/logger';

const README_PATH = path.join(__dirname, '../README.md');
const START_MARKER = '<!-- AUTO-GENERATED:module-table:START -->';
const END_MARKER = '<!-- AUTO-GENERATED:module-table:END -->';

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

function collectFileCounts(report: PlaywrightListReport): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (suite: PlaywrightListSuite): void => {
    for (const spec of suite.specs ?? []) {
      if (!spec.file) continue;
      counts.set(spec.file, (counts.get(spec.file) ?? 0) + (spec.tests?.length ?? 0));
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const project of report.suites ?? []) walk(project);
  return counts;
}

function buildTable(fileCounts: Map<string, number>): string {
  const moduleCounts = new Map<string, { ui: number; rbac: number }>();
  for (const [file, count] of fileCounts) {
    const { name, type } = deriveModuleFromFile(file);
    if (!moduleCounts.has(name)) moduleCounts.set(name, { ui: 0, rbac: 0 });
    const entry = moduleCounts.get(name)!;
    if (type === 'UI') entry.ui += count;
    else if (type === 'RBAC') entry.rbac += count;
    // WHY 'Other' is silently excluded from this table, not added as a row
    // (2026-09-30): confirmed via a real --list run that 'Other' is not a
    // genuine module — see deriveModuleFromFile()'s own fallback path,
    // which only reaches it for a file this function's regex can't parse
    // at all. A real occurrence here would mean a genuinely new, unhandled
    // path shape — that's worth a human noticing via this table looking
    // wrong (a module missing/undercounted), not a silent extra row.
  }

  const rows = [...moduleCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let totalUi = 0;
  let totalRbac = 0;
  const lines = ['| Module | UI tests | RBAC tests | Total |', '|---|---:|---:|---:|'];
  for (const [name, { ui, rbac } ] of rows) {
    totalUi += ui;
    totalRbac += rbac;
    const rbacCell = rbac > 0 ? String(rbac) : '—';
    lines.push(`| ${name} | ${ui} | ${rbacCell} | ${ui + rbac} |`);
  }
  lines.push(`| **Total** | **${totalUi}** | **${totalRbac}** | **${totalUi + totalRbac}** |`);
  return lines.join('\n');
}

function main(): void {
  logger.info('[update-doc-numbers] Discovering tests: npx playwright test --project=chromium --list --reporter=json');
  const rawOutput = execSync('npx playwright test --project=chromium --list --reporter=json', {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(extractJson(rawOutput)) as PlaywrightListReport;
  const fileCounts = collectFileCounts(report);
  const newTable = buildTable(fileCounts);

  const readme = fs.readFileSync(README_PATH, 'utf-8');
  const startIdx = readme.indexOf(START_MARKER);
  const endIdx = readme.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    logger.error(`[update-doc-numbers] Could not find both markers (${START_MARKER} / ${END_MARKER}) in ${README_PATH} — refusing to write anything.`);
    process.exitCode = 1;
    return;
  }

  const before = readme.slice(0, startIdx + START_MARKER.length);
  const after = readme.slice(endIdx);
  const updated = `${before}\n${newTable}\n${after}`;

  if (updated === readme) {
    logger.success('[update-doc-numbers] README.md module table already matches the real current suite — no change written.');
    return;
  }

  fs.writeFileSync(README_PATH, updated);
  logger.success('[update-doc-numbers] README.md module table regenerated from a real --list run.');
}

main();
