/**
 * Turns the output of scripts/plan-shards.ts into plain lines the Jenkinsfile can
 * read without parsing JSON in Groovy, and decides which formFields entities run.
 * Used only by the sharded Jenkins engine.
 *
 * Input: the file plan-shards.ts appends to when GITHUB_OUTPUT points at it
 * (`shard_total=`, `shards_json=`, `test_count=` lines). plan-shards.ts itself is
 * not changed: four GitHub workflows use it. An empty or missing file means the
 * selection has no core files (for example only formFields paths were selected).
 *
 * Usage:
 *   npx ts-node scripts/jenkins-shard-plan.ts <plan-output-file> <lines-file> \
 *       --ff <all|none|matching|entity,entity,...> [--ff-grep <tag>] \
 *       [--sel-grep <tag>] [--sel-paths "<path> <path>"]
 *
 * --ff all       every entity in config/sharedConfigSuites.json
 * --ff none      no formFields track
 * --ff a,b       exactly those entities (each validated against the config)
 * --ff matching  the entities that have at least one test matching the selection
 *                (--sel-grep / --sel-paths), found with `playwright --list`
 *
 * Output lines (`|` separated, files space separated):
 *   meta|core_total=<n>|ff_total=<n>|test_count=<n>|ff_grep=<tag or empty>
 *   core|<shardId>|<testCount>|<files>
 *   ff|<entity>|<files>
 *
 * The formFields entities come from config/sharedConfigSuites.json, never from the
 * plan, so they can never be mixed into a core shard (ADR 0002). Anything
 * unexpected fails loudly: this never guesses a plan.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

interface PlannedShard {
  shardId: number;
  files: string[];
  testCount: number;
}

interface SharedConfigSuiteEntry {
  uiDir: string;
  rbacDir: string;
  entities: string[];
}

interface ListSpec {
  file?: string;
  tests?: unknown[];
}
interface ListSuite {
  specs?: ListSpec[];
  suites?: ListSuite[];
}

const REPO_ROOT = path.join(__dirname, '..');
const SHARED_CONFIG_SUITES_PATH = path.join(REPO_ROOT, 'config/sharedConfigSuites.json');
// Values end up on a shell command line, so anything outside these sets is refused
// rather than quoted.
const SAFE_PATH = /^[A-Za-z0-9_./-]+$/;
const SAFE_GREP = /^[A-Za-z0-9_@.-]+$/;

function fail(message: string): never {
  logger.error(`[jenkins-shard-plan] ${message}`);
  process.exit(1);
}

function readPlanOutput(file: string): Map<string, string> {
  const values = new Map<string, string>();
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) values.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return values;
}

function loadSuites(): Record<string, SharedConfigSuiteEntry> {
  try {
    return JSON.parse(fs.readFileSync(SHARED_CONFIG_SUITES_PATH, 'utf-8')) as Record<string, SharedConfigSuiteEntry>;
  } catch (err) {
    fail(`Could not read ${SHARED_CONFIG_SUITES_PATH}: ${(err as Error).message}`);
  }
}

function formFieldsSuite(suites: Record<string, SharedConfigSuiteEntry>): SharedConfigSuiteEntry {
  // The per-entity file names are formFields' own convention (the same one main.yml
  // uses). A second shared-config suite needs its own run rule, so refuse rather
  // than silently run it nowhere.
  const unsupported = Object.keys(suites).filter((n) => n !== 'formFields');
  if (unsupported.length > 0) {
    fail(`config/sharedConfigSuites.json has suite(s) this planner has no run rule for: ${unsupported.join(', ')}`);
  }
  const suite = suites.formFields;
  if (!suite || !Array.isArray(suite.entities) || suite.entities.length === 0) {
    fail('config/sharedConfigSuites.json has no formFields entities');
  }
  return suite;
}

function entityFiles(suite: SharedConfigSuiteEntry, entity: string): string[] {
  const files = [`${suite.uiDir}/${entity}FieldLimits.spec.ts`, `${suite.rbacDir}/${entity}FieldLimits.rbac.spec.ts`];
  for (const f of files) {
    if (!SAFE_PATH.test(f)) fail(`Unsafe characters in path ${f}`);
    if (!fs.existsSync(path.join(REPO_ROOT, f))) fail(`formFields entity "${entity}" expects ${f}, which does not exist`);
  }
  return files;
}

function extractJson(raw: string): string {
  // Same rule as plan-shards.ts: the dotenv banner can contain a '{', Playwright's
  // JSON root always starts a line.
  const match = raw.match(/(?:^|\n)(\{[\s\S]*)/);
  if (!match) fail(`No JSON object found in playwright --list output:\n${raw}`);
  return match[1];
}

function countsByFile(suite: ListSuite, counts: Map<string, number>): void {
  for (const spec of suite.specs ?? []) {
    if (spec.file) counts.set(spec.file, (counts.get(spec.file) ?? 0) + (spec.tests?.length ?? 0));
  }
  for (const child of suite.suites ?? []) countsByFile(child, counts);
}

// The entities with at least one selected test: used for dev/prod, whose GitHub
// twin runs the formFields tests that match the tag inside its one job.
function entitiesMatchingSelection(suite: SharedConfigSuiteEntry, selGrep: string, selPaths: string): string[] {
  const args = ['npx playwright test --project=chromium --list --reporter=json'];
  if (selGrep) args.push(`--grep ${selGrep}`);
  if (selPaths) args.push(selPaths);
  let raw: string;
  try {
    raw = execSync(args.join(' '), { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    fail(`playwright --list failed for the formFields selection check: ${e.stderr ?? e.message}\n${e.stdout ?? ''}`);
  }
  const report = JSON.parse(extractJson(raw)) as { suites?: ListSuite[] };
  const counts = new Map<string, number>();
  for (const project of report.suites ?? []) countsByFile(project, counts);
  const prefixes = [suite.uiDir, suite.rbacDir].map((d) => `${d.replace(/^tests\//, '').replace(/\/+$/, '')}/`);
  const selected = new Set<string>();
  for (const [file, n] of counts) {
    if (n === 0 || !prefixes.some((p) => file.startsWith(p))) continue;
    const m = file.match(/([A-Za-z]+)FieldLimits(?:\.rbac)?\.spec\.ts$/);
    if (m && suite.entities.includes(m[1])) selected.add(m[1]);
  }
  return suite.entities.filter((e) => selected.has(e));
}

function parseArgs(argv: string[]): { planFile: string; linesFile: string; ff: string; ffGrep: string; selGrep: string; selPaths: string } {
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      named[argv[i].slice(2)] = argv[i + 1] ?? '';
      i++;
    } else {
      positional.push(argv[i]);
    }
  }
  const [planFile, linesFile] = positional;
  if (!planFile || !linesFile || !named.ff) {
    fail('Usage: ts-node scripts/jenkins-shard-plan.ts <plan-output-file> <lines-file> --ff <all|none|matching|a,b> [--ff-grep T] [--sel-grep T] [--sel-paths "p q"]');
  }
  const ffGrep = named['ff-grep'] ?? '';
  const selGrep = named['sel-grep'] ?? '';
  const selPaths = (named['sel-paths'] ?? '').trim();
  for (const g of [ffGrep, selGrep]) if (g && !SAFE_GREP.test(g)) fail(`Unsafe grep value "${g}" (allowed: letters, digits, _ @ . -)`);
  for (const p of selPaths.split(/\s+/).filter(Boolean)) if (!SAFE_PATH.test(p)) fail(`Unsafe selection path "${p}"`);
  return { planFile, linesFile, ff: named.ff, ffGrep, selGrep, selPaths };
}

function main(): void {
  const { planFile, linesFile, ff, ffGrep, selGrep, selPaths } = parseArgs(process.argv.slice(2));

  const suites = loadSuites();
  const suite = formFieldsSuite(suites);
  // plan-shards.ts reports paths relative to the tests root (`ui/...`), config uses `tests/ui/...`.
  const excludedPrefixes = [suite.uiDir, suite.rbacDir].map((d) => `${d.replace(/^tests\//, '').replace(/\/+$/, '')}/`);

  // ---- core track ----------------------------------------------------------
  const values = readPlanOutput(planFile);
  let shards: PlannedShard[] = [];
  let testCount = 0;
  if (values.size > 0) {
    const shardsJson = values.get('shards_json');
    const shardTotal = Number(values.get('shard_total'));
    testCount = Number(values.get('test_count'));
    if (!shardsJson || !Number.isInteger(shardTotal) || shardTotal <= 0 || !Number.isInteger(testCount)) {
      fail(`${planFile} lacks a valid shard_total / shards_json / test_count (was plan-shards.ts run with GITHUB_OUTPUT pointing at it?)`);
    }
    try {
      shards = JSON.parse(shardsJson) as PlannedShard[];
    } catch (err) {
      fail(`shards_json is not valid JSON: ${(err as Error).message}`);
    }
    if (!Array.isArray(shards) || shards.length !== shardTotal) {
      fail(`shard_total=${shardTotal} but shards_json holds ${Array.isArray(shards) ? shards.length : 'no array'}`);
    }
  }

  const seenIds = new Set<number>();
  let planned = 0;
  const coreLines: string[] = [];
  for (const shard of shards) {
    if (!Number.isInteger(shard.shardId) || seenIds.has(shard.shardId)) fail(`Bad or duplicate shardId: ${shard.shardId}`);
    seenIds.add(shard.shardId);
    if (!Array.isArray(shard.files) || shard.files.length === 0) fail(`Shard ${shard.shardId} has no files`);
    if (!Number.isInteger(shard.testCount) || shard.testCount < 0) fail(`Shard ${shard.shardId} has a bad testCount`);
    for (const f of shard.files) {
      if (!SAFE_PATH.test(f)) fail(`Unsafe characters in planned file "${f}" (shard ${shard.shardId})`);
      if (excludedPrefixes.some((p) => f.startsWith(p))) {
        fail(`Shard ${shard.shardId} contains shared-config file ${f}: it must only run in the per-entity track (ADR 0002)`);
      }
    }
    planned += shard.testCount;
    coreLines.push(`core|${shard.shardId}|${shard.testCount}|${shard.files.join(' ')}`);
  }
  if (planned !== testCount) fail(`Shard test counts sum to ${planned} but test_count=${testCount}`);

  // ---- formFields track ----------------------------------------------------
  let entities: string[];
  if (ff === 'all') {
    entities = [...suite.entities];
  } else if (ff === 'none') {
    entities = [];
  } else if (ff === 'matching') {
    entities = entitiesMatchingSelection(suite, selGrep, selPaths);
  } else {
    const requested = ff.split(',').map((e) => e.trim()).filter(Boolean);
    const unknown = requested.filter((e) => !suite.entities.includes(e));
    if (unknown.length > 0) fail(`Unknown formFields entit${unknown.length === 1 ? 'y' : 'ies'}: ${unknown.join(', ')} (valid: ${suite.entities.join(', ')})`);
    entities = suite.entities.filter((e) => requested.includes(e));
  }

  if (shards.length === 0 && entities.length === 0) {
    fail('The selection matched no core test files and no formFields entity: nothing to run');
  }

  const lines = [
    `meta|core_total=${shards.length}|ff_total=${entities.length}|test_count=${testCount}|ff_grep=${ffGrep}`,
    ...coreLines,
    ...entities.map((e) => `ff|${e}|${entityFiles(suite, e).join(' ')}`),
    '',
  ];
  fs.writeFileSync(linesFile, lines.join('\n'));
  logger.info(
    `[jenkins-shard-plan] ${shards.length} core shard(s) / ${testCount} test(s) + ${entities.length} formFields entit${entities.length === 1 ? 'y' : 'ies'}${entities.length ? ` (${entities.join(', ')})` : ''} -> ${linesFile}`
  );
}

main();
