/**
 * Single source of the "generated figures" that docs embed between
 * `<!-- GEN:<name>:START -->` / `<!-- GEN:<name>:END -->` markers. Used by
 * `npm run docs:refresh` (writes them) and `npm run check:docs` (compares
 * them), so a doc figure can never be hand-typed or silently stale.
 *
 * Two tiers, so the guard stays fast by default:
 *  - OFFLINE (no Playwright, no network): derived from the committed
 *    config/expected-test-counts.json baseline (itself guarded against the
 *    real suite by `npm run check:test-counts`) and from static workflow
 *    file text. Blocks: suite-totals, module-table, workflow-matrix.
 *  - LIVE (one `playwright test --list` + the shard planner, no app access):
 *    tag-counts, shard-plan. Only computed when asked (`--live` / refresh).
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { deriveModuleFromFile } from '../../src/notifications/ReportParser';

export const REPO_ROOT = path.join(__dirname, '../..');
export const OFFLINE_BLOCKS = ['suite-totals', 'module-table', 'workflow-matrix'] as const;
export const LIVE_BLOCKS = ['tag-counts', 'shard-plan'] as const;
export type BlockName = (typeof OFFLINE_BLOCKS)[number] | (typeof LIVE_BLOCKS)[number];

interface ExpectedTestCounts {
  total: number;
  fileCount: number;
  perFile: Record<string, number>;
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

export function loadBaseline(): ExpectedTestCounts {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config/expected-test-counts.json'), 'utf-8')) as ExpectedTestCounts;
}

// Same dotenv-banner-brace workaround as plan-shards.ts's extractJson().
function extractJson(raw: string): string {
  const match = raw.match(/(?:^|\n)(\{[\s\S]*)/);
  if (!match) throw new Error(`No JSON object found in playwright --list output:\n${raw}`);
  return match[1];
}

function runList(extraArgs: string): { total: number; perFile: Record<string, number> } {
  const raw = execSync(`npx playwright test --project=chromium --list --reporter=json ${extraArgs}`, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const report = JSON.parse(extractJson(raw)) as PlaywrightListReport;
  const perFile: Record<string, number> = {};
  let total = 0;
  const walk = (suite: PlaywrightListSuite): void => {
    for (const spec of suite.specs ?? []) {
      if (!spec.file) continue;
      const n = spec.tests?.length ?? 0;
      perFile[spec.file] = (perFile[spec.file] ?? 0) + n;
      total += n;
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const project of report.suites ?? []) walk(project);
  return { total, perFile };
}

function splitUiRbac(perFile: Record<string, number>): { ui: number; rbac: number } {
  let ui = 0;
  let rbac = 0;
  for (const [file, n] of Object.entries(perFile)) {
    const { type } = deriveModuleFromFile(file);
    if (type === 'UI') ui += n;
    else if (type === 'RBAC') rbac += n;
  }
  return { ui, rbac };
}

function suiteTotals(b: ExpectedTestCounts): string {
  const { ui, rbac } = splitUiRbac(b.perFile);
  return `**${b.total} tests** in **${b.fileCount} spec files** (UI ${ui} · RBAC ${rbac})`;
}

function moduleTable(b: ExpectedTestCounts): string {
  const moduleCounts = new Map<string, { ui: number; rbac: number }>();
  for (const [file, count] of Object.entries(b.perFile)) {
    const { name, type } = deriveModuleFromFile(file);
    if (!moduleCounts.has(name)) moduleCounts.set(name, { ui: 0, rbac: 0 });
    const entry = moduleCounts.get(name)!;
    if (type === 'UI') entry.ui += count;
    else if (type === 'RBAC') entry.rbac += count;
  }
  const rows = [...moduleCounts.entries()].sort((a, c) => a[0].localeCompare(c[0]));
  let totalUi = 0;
  let totalRbac = 0;
  const lines = ['| Module | UI tests | RBAC tests | Total |', '|---|---:|---:|---:|'];
  for (const [name, { ui, rbac }] of rows) {
    totalUi += ui;
    totalRbac += rbac;
    lines.push(`| ${name} | ${ui} | ${rbac > 0 ? String(rbac) : '—'} | ${ui + rbac} |`);
  }
  lines.push(`| **Total** | **${totalUi}** | **${totalRbac}** | **${totalUi + totalRbac}** |`);
  return lines.join('\n');
}

// Pulls each `npx playwright test ...` invocation (including `\`-continued
// lines) out of a CI file and reports its literal --workers / --grep values.
function playwrightInvocations(text: string): { workers: string[]; grep: string[] } {
  const workers = new Set<string>();
  const grep = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/npx playwright test\b/.test(lines[i]) || /^\s*(#|\/\/)/.test(lines[i]) || /\becho\b/.test(lines[i])) continue;
    let block = lines[i];
    while (/\\\s*$/.test(lines[i]) && i + 1 < lines.length) {
      i++;
      block += ' ' + lines[i];
    }
    const w = block.match(/--workers=(\S+)/);
    if (w) workers.add(w[1].replace(/^\$\{?WORKERS\}?$/, 'dynamic').replace(/^\$.*/, 'dynamic'));
    const g = block.match(/--grep\s+(@\w+)/);
    if (g) grep.add(g[1]);
  }
  return { workers: [...workers].sort(), grep: [...grep].sort() };
}

function workflowTrigger(text: string): string {
  const onBlock = text.match(/^on:\n((?:[ \t]+.*\n|\n)+?)(?=^\S)/m)?.[1] ?? '';
  const parts: string[] = [];
  const push = onBlock.match(/push:\s*\n\s*branches:\s*\[([^\]]+)\]/);
  if (push) parts.push(`push → ${push[1].trim()}`);
  if (/workflow_dispatch:/.test(onBlock)) parts.push('manual');
  return parts.join(' + ') || 'n/a';
}

function workflowMatrix(): string {
  const rows: string[] = ['| Pipeline file | Trigger | Scope (`--grep`) | `--workers` | Sharded by planner |', '|---|---|---|---|---|'];
  const wfDir = path.join(REPO_ROOT, '.github/workflows');
  for (const f of fs.readdirSync(wfDir).filter((n) => n.endsWith('.yml')).sort()) {
    const text = fs.readFileSync(path.join(wfDir, f), 'utf-8');
    const inv = playwrightInvocations(text);
    rows.push(
      `| \`${f}\` | ${workflowTrigger(text)} | ${inv.grep.join(', ') || 'full suite / selective'} | ${inv.workers.join(', ') || '—'} | ${/plan-shards\.ts/.test(text) ? 'yes' : 'no'} |`
    );
  }
  for (const f of fs.readdirSync(REPO_ROOT).filter((n) => /^Jenkinsfile/.test(n)).sort()) {
    const text = fs.readFileSync(path.join(REPO_ROOT, f), 'utf-8');
    const workers = new Set<string>();
    for (const m of text.matchAll(/--workers=(\d+)/g)) workers.add(m[1]);
    const grep = new Set<string>();
    for (const m of text.matchAll(/--grep (@\w+)/g)) grep.add(m[1]);
    rows.push(`| \`${f}\` | Jenkins | ${[...grep].sort().join(', ') || 'full suite / selective'} | ${[...workers].sort().join(', ') || '—'} | no |`);
  }
  return rows.join('\n');
}

function tagCounts(): string {
  const parts: string[] = [];
  for (const tag of ['@smoke', '@regression', '@prodSafe']) {
    parts.push(`\`${tag}\` ${runList(`--grep ${tag}`).total}`);
  }
  return parts.join(' · ');
}

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

interface PlannedShard {
  shardId: number;
  files: string[];
  testCount: number;
}

function planFor(grepArgs: string): PlannedShard[] {
  const raw = execSync(`npx ts-node scripts/plan-shards.ts ${grepArgs}`, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, GITHUB_OUTPUT: '' },
  });
  const jsonLine = stripAnsi(raw)
    .split('\n')
    .map((l) => l.replace(/^\[[^\]]*\]\s*\[[A-Z]+\]\s*/, '').trim())
    .reverse()
    .find((l) => l.startsWith('[{') && l.endsWith('}]'));
  if (!jsonLine) throw new Error(`plan-shards.ts produced no shard JSON for "${grepArgs}":\n${raw}`);
  return JSON.parse(jsonLine) as PlannedShard[];
}

function shardPlan(): string {
  const suites = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'config/sharedConfigSuites.json'), 'utf-8')) as Record<
    string,
    { entities: string[] }
  >;
  const formFieldsTrack = Object.values(suites).reduce((n, s) => n + s.entities.length, 0);
  const lines = ['| Scope | Core shards (file-atomic) | Tests per core shard | formFields shards (fixed, one per entity) |', '|---|---:|---|---:|'];
  for (const [label, args] of [
    ['`--grep @regression` (qa, escalated sandbox)', '--grep @regression'],
    ['full suite (stage, main)', ''],
  ] as const) {
    const plan = planFor(args);
    lines.push(`| ${label} | ${plan.length} | ${plan.map((s) => s.testCount).join(' / ')} | ${formFieldsTrack} |`);
  }
  return lines.join('\n');
}

export function computeBlocks(live: boolean): Partial<Record<BlockName, string>> {
  const b = loadBaseline();
  const out: Partial<Record<BlockName, string>> = {
    'suite-totals': suiteTotals(b),
    'module-table': moduleTable(b),
    'workflow-matrix': workflowMatrix(),
  };
  if (live) {
    out['tag-counts'] = tagCounts();
    out['shard-plan'] = shardPlan();
  }
  return out;
}

const blockRe = (name: string): RegExp =>
  new RegExp(`(<!-- GEN:${name}:START -->)\\n?([\\s\\S]*?)\\n?(<!-- GEN:${name}:END -->)`, 'g');

export function findBlocks(text: string): Array<{ name: string; body: string }> {
  const found: Array<{ name: string; body: string }> = [];
  for (const m of text.matchAll(/<!-- GEN:([\w-]+):START -->\n?([\s\S]*?)\n?<!-- GEN:\1:END -->/g)) {
    found.push({ name: m[1], body: m[2] });
  }
  return found;
}

export function applyBlock(text: string, name: string, body: string): string {
  return text.replace(blockRe(name), (_m, s: string, _old: string, e: string) => `${s}\n${body}\n${e}`);
}
