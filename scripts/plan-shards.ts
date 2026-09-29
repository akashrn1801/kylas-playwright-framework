/**
 * Replaces the "rest of suite" track's blind count-based `--shard=N/M` split
 * (qa.yml/stage.yml/main.yml/sandbox.yml) with a discovery-and-bin-pack
 * planner that keeps every spec FILE atomic — never split mid-file — unlike
 * Playwright's own internal splitter, which slices the discovered test list
 * purely by count with zero awareness of file boundaries. See
 * .claude/known-issues.md's dated 2026-09-29 "Dynamic per-module shard
 * planner" entry for the full incident/design history this fixes (the
 * formFields cross-shard config-mutation race).
 *
 * WHY formFields is EXCLUDED here, hardcoded, not a CLI flag (2026-09-29):
 * formFields keeps using its own separately-verified fixed 6-shard,
 * one-per-entity matrix (the `run-formfields-tests` job in every sharded
 * workflow) — that matrix was purpose-built and verified to solve the exact
 * cross-shard shared-config race this planner's own file-atomicity does NOT
 * by itself guarantee at the UI+RBAC-PAIR level (this planner guarantees one
 * FILE never splits across shards, not that two specific files always land
 * together). Making the exclusion a hardcoded constant, not a flag a caller
 * could pass or omit, means no future workflow edit can accidentally let
 * formFields' 12 files leak into this planner's own bin-packing and get
 * separated across shards again — the one failure mode this whole file
 * exists to prevent.
 *
 * Usage: npx ts-node scripts/plan-shards.ts [--tests-per-shard 125] [<extra playwright --list args, e.g. --grep @regression>]
 * Writes shard_total/shards_json/test_count to $GITHUB_OUTPUT when set
 * (mirrors the inline-bash "compute"/"decide" steps this replaces); prints
 * the same JSON to stdout otherwise, for local testing.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import { logger } from '../src/utils/logger';

// WHY hardcoded, see file-level WHY comment above — never exposed as a flag.
const FORMFIELDS_EXCLUDED_PREFIXES = ['ui/formFields/', 'rbac/formFields/'];

interface FileEntry {
  file: string;
  testCount: number;
}

interface Shard {
  shardId: number;
  files: string[];
  testCount: number;
}

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

function isFormFieldsFile(file: string): boolean {
  return FORMFIELDS_EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

function parseArgs(argv: string[]): { testsPerShard: number; playwrightArgs: string[] } {
  let testsPerShard = 125;
  const playwrightArgs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tests-per-shard') {
      const value = argv[i + 1];
      if (!value || Number.isNaN(Number(value)) || Number(value) <= 0) {
        throw new Error(`--tests-per-shard requires a positive numeric value, got: ${value}`);
      }
      testsPerShard = Number(value);
      i++;
    } else {
      playwrightArgs.push(argv[i]);
    }
  }
  return { testsPerShard, playwrightArgs };
}

// WHY matching a '{' that STARTS A LINE, not just the first '{' anywhere
// (found empirically 2026-09-29, live-testing this exact function): dotenv
// v17 (config/config.ts's `dotenv.config()`) prints a startup banner line to
// stdout ahead of Playwright's own JSON reporter output, and that banner's
// own tip text can itself contain a literal, mid-sentence '{' — confirmed
// real: "◇ injected env (32) from .env // tip: ⌘ override existing {
// override: true }". A naive "first '{' anywhere" search matches THAT brace
// instead of the real JSON root, producing a "position 2" parse error
// (caught by direct testing, not assumed). Playwright's JSON reporter always
// writes its root object starting at column 0 of its own line — requiring
// the '{' be preceded by start-of-string or a newline reliably distinguishes
// the two, without needing to touch config.ts's own dotenv call (out of
// scope, high blast-radius per rule 9).
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
      const n = spec.tests?.length ?? 0;
      counts.set(spec.file, (counts.get(spec.file) ?? 0) + n);
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const project of report.suites ?? []) walk(project);
  return counts;
}

// First-fit-decreasing bin packing, targeting `targetPerShard` tests/shard —
// same budget derivation as qa.yml's own top-of-file WHY comment (125,
// derived from real measured throughput). A single file whose own test count
// exceeds the target is never dropped or split — it's placed alone in its
// own (over-budget) shard, logged loudly, never silently absorbed elsewhere.
function binPack(entries: FileEntry[], targetPerShard: number): Shard[] {
  const sorted = [...entries].sort((a, b) => b.testCount - a.testCount);
  const shards: Omit<Shard, 'shardId'>[] = [];

  for (const entry of sorted) {
    const fit = shards.find((shard) => shard.testCount + entry.testCount <= targetPerShard);
    if (fit) {
      fit.files.push(entry.file);
      fit.testCount += entry.testCount;
      continue;
    }
    shards.push({ files: [entry.file], testCount: entry.testCount });
    if (entry.testCount > targetPerShard) {
      logger.warn(
        `[plan-shards] File ${entry.file} alone has ${entry.testCount} test(s), exceeding the ${targetPerShard}/shard target — placed in its own shard anyway (never dropped or split), but that shard's real runtime will exceed the norm.`
      );
    }
  }

  return shards.map((shard, i) => ({ shardId: i + 1, ...shard }));
}

function fail(message: string): never {
  // WHY a raw process.stderr.write here, not logger.error (2026-09-29):
  // logger.* prefixes a timestamp/ANSI color code, which would break GitHub
  // Actions' `::error::`-prefix annotation recognition — this one line must
  // start the line exactly with `::error::`, mirroring the equivalent plain
  // `echo "::error::..."` convention already used in every bash "compute"/
  // "decide" step this script replaces.
  process.stderr.write(`::error::${message}\n`);
  process.exit(1);
}

function main(): void {
  const { testsPerShard, playwrightArgs } = parseArgs(process.argv.slice(2));
  const command = `npx playwright test --project=chromium --list --reporter=json ${playwrightArgs.join(' ')}`.trim();
  logger.info(`[plan-shards] Discovering tests: ${command}`);

  let rawOutput: string;
  try {
    rawOutput = execSync(command, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message: string };
    fail(
      `npx playwright test --list failed — cannot compute a shard plan. stdout:\n${execErr.stdout ?? ''}\nstderr:\n${execErr.stderr ?? execErr.message}`
    );
  }

  let report: PlaywrightListReport;
  try {
    report = JSON.parse(extractJson(rawOutput)) as PlaywrightListReport;
  } catch (err) {
    fail(`Could not parse playwright --list JSON output: ${(err as Error).message}. Raw output:\n${rawOutput}`);
  }

  const fileCounts = collectFileCounts(report);
  if (fileCounts.size === 0) {
    fail(
      `npx playwright test --list matched zero tests for target "${playwrightArgs.join(' ')}" — almost certainly a broken --grep/path, not a legitimately empty suite.`
    );
  }

  const excluded: FileEntry[] = [];
  const included: FileEntry[] = [];
  for (const [file, testCount] of fileCounts) {
    (isFormFieldsFile(file) ? excluded : included).push({ file, testCount });
  }

  if (excluded.length > 0) {
    logger.info(
      `[plan-shards] Excluded ${excluded.length} formFields file(s) / ${excluded.reduce((a, e) => a + e.testCount, 0)} test(s) from bin-packing — formFields always uses its own separately-verified fixed 6-shard matrix (run-formfields-tests), never this planner.`,
      excluded.map((e) => e.file)
    );
  }

  if (included.length === 0) {
    fail(`After excluding formFields, zero test files remain for target "${playwrightArgs.join(' ')}" — this planner has nothing to shard.`);
  }

  const shards = binPack(included, testsPerShard);
  const totalTestCount = included.reduce((a, e) => a + e.testCount, 0);

  logger.info(
    `[plan-shards] Planned ${shards.length} shard(s) for ${totalTestCount} test(s) across ${included.length} file(s) (target ~${testsPerShard}/shard):`
  );
  for (const shard of shards) {
    logger.info(`  shard ${shard.shardId}: ${shard.testCount} test(s) across ${shard.files.length} file(s)`, shard.files);
  }

  const shardsJson = JSON.stringify(shards);
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (githubOutputPath) {
    const lines = [`shard_total=${shards.length}`, `shards_json=${shardsJson}`, `test_count=${totalTestCount}`, ''].join('\n');
    fs.appendFileSync(githubOutputPath, lines);
    logger.info(`[plan-shards] Wrote shard_total/shards_json/test_count to ${githubOutputPath}`);
  } else {
    logger.warn('[plan-shards] GITHUB_OUTPUT not set — skipping output write (local/test invocation). Shard JSON:');
    logger.info(shardsJson);
  }
}

main();
