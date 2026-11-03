/**
 * Picks the tests the rerun shard runs once more (ADR 0015) from a merged first-run JSON report.
 *
 *   npx ts-node scripts/rerun-select.ts --report reports/rerun/first-run.json --out reports/rerun/rerun-list.json --targets reports/rerun/targets.txt
 *
 * Env: RERUN_MAX_TESTS (default 60; more candidates than this = no rerun, a mass failure is an outage, not a flake),
 * RERUN_RETRIES (default 0, recorded for the manifest), RERUN_INCLUDE_FLAKY ('false' leaves flaky tests out),
 * GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT (stored so the combiner ignores a manifest of an earlier attempt),
 * GITHUB_OUTPUT (run=true|false, count, decision).
 *
 * Never fails the pipeline: any problem writes a "nothing to rerun" list and exits 0. All logic is in
 * src/notifications/RerunResults.ts (tested by `npm run check:rerun`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';
import { JsonReport, RerunList, SelectOptions, selectRerun } from '../src/notifications/RerunResults';

const TEST_DIR = 'tests'; // testDir of playwright.config.ts: spec paths in the JSON are relative to it
const SERIAL_PATTERN = /mode:\s*['"]serial['"]|describe\.serial/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    logger.warn(`[rerun-select] ${name}='${raw}' is not a non-negative integer — using ${fallback}`);
    return fallback;
  }
  return n;
}

function sharedConfigPrefixes(): string[] {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/sharedConfigSuites.json'), 'utf-8')) as Record<
    string,
    { uiDir?: string; rbacDir?: string }
  >;
  return Object.values(raw).flatMap((e) => [e.uiDir, e.rbacDir]).filter((p): p is string => !!p);
}

function isSerialFile(fileUnderTestDir: string): boolean {
  try {
    return SERIAL_PATTERN.test(fs.readFileSync(path.join(process.cwd(), TEST_DIR, fileUnderTestDir), 'utf-8'));
  } catch {
    return true; // cannot read it: rerun the whole file rather than a lone test of a possible serial block
  }
}

function emit(list: RerunList): void {
  const out = process.env.GITHUB_OUTPUT;
  if (!out) return;
  fs.appendFileSync(out, `run=${list.decision === 'run'}\ncount=${list.candidates.length}\ndecision=${list.decision}\n`);
}

function main(): void {
  const reportPath = arg('report');
  const outPath = arg('out');
  const targetsPath = arg('targets');
  if (!reportPath || !outPath || !targetsPath) {
    logger.error('[rerun-select] usage: --report <first-run.json> --out <rerun-list.json> --targets <targets.txt>');
    process.exitCode = 2;
    return;
  }
  const maxTests = intEnv('RERUN_MAX_TESTS', 60);
  const retries = intEnv('RERUN_RETRIES', 0);
  const includeFlaky = (process.env.RERUN_INCLUDE_FLAKY ?? 'true').toLowerCase() !== 'false';
  const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  const meta = { retries, runId: process.env.GITHUB_RUN_ID, runAttempt: Number.isInteger(attempt) ? attempt : undefined };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let list: RerunList;
  try {
    const opts: SelectOptions = { maxTests, includeFlaky, excludePrefixes: sharedConfigPrefixes(), testDir: TEST_DIR, isSerialFile };
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as JsonReport;
    list = selectRerun(report, opts, meta);
  } catch (err) {
    logger.warn(`[rerun-select] could not read/select from ${reportPath} (${(err as Error).message}) — nothing to rerun`);
    list = { version: 1, ...meta, decision: 'none', maxTests, retries, includeFlaky, candidates: [], excluded: [], targets: [] };
  }

  fs.writeFileSync(outPath, JSON.stringify(list, null, 2));
  fs.writeFileSync(targetsPath, list.targets.join('\n') + (list.targets.length ? '\n' : ''));
  logger.info(`[rerun-select] decision=${list.decision}: ${list.candidates.length} candidate(s) (cap ${maxTests}), ${list.excluded.length} excluded, ${list.targets.length} target(s)`);
  for (const c of list.candidates) logger.info(`[rerun-select]   ${c.first.padEnd(7)} ${c.target}  ${c.title}${c.reason ? `  (${c.reason})` : ''}`);
  for (const e of list.excluded) logger.info(`[rerun-select]   excluded ${e.file} ${e.title}: ${e.reason}`);
  if (list.decision === 'cap') {
    logger.warn(`[rerun-select] ${list.candidates.length} failed/flaky tests exceed RERUN_MAX_TESTS=${maxTests}: a mass failure points at the environment, so nothing is rerun`);
  }
  emit(list);
}

main();
