/**
 * Scenario suite for the rerun shard end to end, offline (ADR 0015): first-run report -> selection -> rerun results ->
 * combined report -> the REAL ReportParser / AutomationHealth / EmailTemplate / history record builder -> assertions on
 * what the email shows (status label and colour, both table columns, per-test lines) and what history stores.
 *
 *   npm run check:rerun        (runs scripts/check-rerun.ts, then this file)
 *
 * No network, no browser, no real CI. The attempt gate script is run against a stub `gh`. Exit 1 on any failed check.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ParsedReport, ReportParser } from '../src/notifications/ReportParser';
import { clusterFailures } from '../src/notifications/FailureAnalyzer';
import { buildFlakyFailureDetails, enrichClusters, EnrichmentContext } from '../src/notifications/FailureDetailBuilder';
import { computeHealthScore, computeOverallVerdict } from '../src/notifications/AutomationHealth';
import { EmailContext, EmailTemplate } from '../src/notifications/EmailTemplate';
import { MiscErrorReport } from '../src/error-collector/ErrorCollector';
import { ShardCompleteness } from '../src/notifications/ShardCompleteness';
import { RunHistoryRecord } from '../src/notifications/RunHistory';
import { buildCurrentRecord } from '../src/notifications/scripts/syncHistory';
import { JsonReport, JsonResult, JsonTest, RerunList, SelectOptions, combineRerun, selectRerun } from '../src/notifications/RerunResults';
import { RerunSummary, parseRerunSummary } from '../src/notifications/RerunSummary';

const ROOT = path.resolve(__dirname, '..');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'rerun-scenarios-'));
let failures = 0;
let checks = 0;
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const check = (ok: boolean, what: string, detail = ''): void => {
  checks += 1;
  if (!ok) failures += 1;
  out(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `\n      ${detail}` : ''}`);
};
const eq = (actual: unknown, expected: unknown, what: string): void => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, what, `expected ${e} but got ${a}`);
};

// ── fixtures (same shapes as scripts/check-rerun.ts) ──────────────────────────────────────────────────────────
const pass = (): JsonResult => ({ status: 'passed', duration: 100 });
const fail = (status = 'failed'): JsonResult => ({ status, duration: 100, error: { message: 'boom: element not found' }, errors: [{ message: 'boom: element not found' }] });
const skip = (): JsonResult => ({ status: 'skipped', duration: 0 });

type Kind = 'passed' | 'flaky' | 'failed' | 'timedOut' | 'did-not-run' | 'cut-off' | 'declared-skip' | 'annotated-skip';
function mkTest(kind: Kind): JsonTest {
  const b = { projectName: 'chromium', expectedStatus: 'passed', annotations: [] as { type: string; description?: string }[] };
  switch (kind) {
    case 'passed': return { ...b, status: 'expected', results: [pass()] };
    case 'flaky': return { ...b, status: 'flaky', results: [fail(), pass()] };
    case 'failed': return { ...b, status: 'unexpected', results: [fail(), fail()] };
    case 'timedOut': return { ...b, status: 'unexpected', results: [fail('timedOut'), fail('timedOut')] };
    case 'did-not-run': return { ...b, status: 'skipped', results: [skip(), skip()] };
    case 'cut-off': return { ...b, status: 'skipped', results: [{ status: 'interrupted', duration: 50 }] };
    case 'declared-skip': return { ...b, status: 'skipped', expectedStatus: 'skipped', annotations: [{ type: 'skip' }], results: [skip()] };
    case 'annotated-skip': return { ...b, status: 'skipped', annotations: [{ type: 'skip', description: 'no custom field' }], results: [skip()] };
  }
}
interface Def { file: string; title: string; line: number; kind: Kind }
const def = (file: string, title: string, line: number, kind: Kind): Def => ({ file, title, line, kind });
function mkReport(defs: Def[], duration = 600000): JsonReport {
  const byFile = new Map<string, Def[]>();
  for (const d of defs) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  return {
    config: { version: '1.60.0', workers: 1, projects: [{ name: 'chromium' }] },
    stats: { startTime: '2026-11-03T06:00:00.000Z', duration },
    startTime: '2026-11-03T06:00:00.000Z',
    suites: [...byFile].map(([file, ds]) => ({
      title: file,
      file,
      specs: ds.map((d) => ({ title: `@regression ${d.title}`, file, line: d.line, ok: d.kind === 'passed' || d.kind === 'flaky', tests: [mkTest(d.kind)] })),
    })),
  };
}
const many = (n: number, kind: Kind, prefix: string, file = 'ui/many/many.spec.ts', startLine = 100): Def[] =>
  Array.from({ length: n }, (_, i) => def(file, `${prefix} ${i + 1}`, startLine + i, kind));

const OPTS: SelectOptions = {
  maxTests: 60,
  includeFlaky: true,
  excludePrefixes: ['tests/ui/formFields', 'tests/rbac/formFields'],
  testDir: 'tests',
  isSerialFile: (f) => f === 'ui/quotations/quotations.spec.ts',
};

// ── pipeline: everything the CI does after the shards, through the real code ──────────────────────────────────
interface Pipeline {
  list: RerunList;
  summary: RerunSummary;
  combined: JsonReport;
  parsed: ParsedReport;
  subject: string;
  html: string;
  history: RunHistoryRecord;
}
interface PipelineOpts {
  select?: Partial<SelectOptions>;
  shard?: ShardCompleteness | null;
  previous?: RerunSummary | null;
  rerunOf?: { runId: string; runNumber?: string };
  noManifest?: boolean; // kill switch off: no list, no summary, report stays the first run
  attempt?: number;
}
let seq = 0;
function pipeline(firstDefs: Def[], rerunDefs: Def[] | null, o: PipelineOpts = {}): Pipeline {
  const first = mkReport(firstDefs);
  const list = selectRerun(first, { ...OPTS, ...o.select }, { retries: 0, runId: '100', runAttempt: o.attempt ?? 1 });
  const rerun = rerunDefs ? mkReport(rerunDefs, 90000) : null;
  const meta = { runId: '100', runAttempt: o.attempt ?? 1, previous: o.previous ?? null, ...(o.rerunOf ? { rerunOf: o.rerunOf } : {}) };
  const res = o.noManifest ? null : combineRerun(first, rerun, list, meta);
  const combined = res ? res.combined : first;
  // The summary goes through its file reader exactly like the email and history sync read it.
  const summary = res ? (parseRerunSummary(JSON.stringify(res.summary)) as RerunSummary) : (null as unknown as RerunSummary);

  const dir = path.join(SCRATCH, `p${(seq += 1)}`);
  fs.mkdirSync(path.join(dir, 'reports', 'staging'), { recursive: true });
  const jsonPath = path.join(dir, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(combined));
  if (summary) fs.writeFileSync(path.join(dir, 'reports', 'staging', 'rerun-summary.json'), JSON.stringify(summary));

  const parsed = new ReportParser().parse(jsonPath);
  const misc: MiscErrorReport = { capturedAt: '2026-11-03T06:02:00.000Z', totalErrors: 0, unexpectedErrors: 0, expectedRbacErrors: 0, expectedBackgroundNoiseErrors: 0, byType: {}, errors: [] };
  const enrichCtx: EnrichmentContext = { miscErrors: [], previousRunFailedTitles: [], recurringFailures: [], knownIssuesIndex: [], runSource: 'github-actions', buildUrl: 'https://example.invalid/run/100' };
  const used = new Set<string>();
  const clusters = enrichClusters(clusterFailures(parsed.failedTests, []), enrichCtx, used);
  const flaky = buildFlakyFailureDetails(parsed.flakyTests, enrichCtx, used);
  const health = computeHealthScore(parsed, null, misc, null, [], [], false);
  const verdict = computeOverallVerdict(parsed, health, null, o.shard ?? null);
  const ctx = {
    report: parsed, env: 'staging', branch: 'sandbox', buildNumber: '7', buildUrl: 'https://example.invalid/run/100', gitCommit: 'abc1234', triggeredBy: 't',
    runSource: 'github-actions', miscErrors: misc, health, verdict, clusters, flakyFailureDetails: flaky, shardCompleteness: o.shard ?? null,
    ...(summary ? { rerun: summary } : {}),
  } as EmailContext;
  const tpl = new EmailTemplate();
  const cwd = process.cwd();
  process.chdir(dir); // loadRerunSummary() reads reports/<env>/ under the current directory
  let history: RunHistoryRecord;
  try {
    history = buildCurrentRecord('staging', 'sandbox', '7', 'github-actions', jsonPath, 'abc1234', false, undefined, undefined);
  } finally {
    process.chdir(cwd);
  }
  return { list, summary, combined, parsed, subject: tpl.subject(ctx), html: tpl.html(ctx), history };
}

// ── reading the rendered email ────────────────────────────────────────────────────────────────────────────────
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&rarr;/g, '->').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
function rerunSection(html: string): string | null {
  const i = html.indexOf('id="section-rerun"');
  if (i < 0) return null;
  // Sections of the email start on a new line with `<tr><td`; the rows inside this one do not.
  const end = html.indexOf('\n<tr><td', i);
  return html.slice(i, end < 0 ? undefined : end);
}
const rowsOf = (section: string): string[][] =>
  [...section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1])));
type Cols = Record<string, [number, number]>;
/** The "First run | After rerun" table as {Passed:[first, after], ...}; cell text like "3 (3 recovered on rerun)" reads as 3. */
function summaryTable(html: string): Cols | null {
  const s = rerunSection(html);
  if (!s) return null;
  const cols: Cols = {};
  for (const r of rowsOf(s)) if (r.length === 3 && /^(Passed|Failed|Flaky|Skipped|Did not run|Total)$/.test(r[0])) cols[r[0]] = [parseInt(r[1], 10), parseInt(r[2], 10)];
  return cols;
}
/** Per-test table: title -> [first, rerun, final] as shown. */
function testTable(html: string): Record<string, string[]> {
  const s = rerunSection(html);
  const m: Record<string, string[]> = {};
  if (!s) return m;
  for (const r of rowsOf(s)) if (r.length === 4 && r[0] !== 'Test') m[r[0].replace(/\s+\S+\.spec\.ts.*$/, '')] = r.slice(1);
  return m;
}
const bannerOf = (html: string): { label: string; color: string } => {
  const m = html.match(/<tr><td style="background:(#[0-9A-Fa-f]{6});padding:12px 28px;text-align:center;">\s*<span[^>]*>([^<]*)<\/span>/);
  return { color: m?.[1] ?? '', label: m?.[2] ?? '' };
};
const colorOf = (tone: 'green' | 'amber' | 'red'): string => {
  // The same constants the template uses, read from the source so a palette change cannot make this check stale.
  const src = fs.readFileSync(path.join(ROOT, 'src/notifications/EmailTemplate.ts'), 'utf-8');
  const get = (n: string): string => src.match(new RegExp(`const ${n} = '(#[0-9A-Fa-f]{6})'`))?.[1] ?? '';
  return tone === 'green' ? get('SUCCESS') : tone === 'amber' ? get('WARN') : get('FAIL');
};

function expectStatus(p: Pipeline, tone: 'green' | 'amber' | 'red', labelPart: string, name: string): void {
  const b = bannerOf(p.html);
  check(b.color === colorOf(tone) && b.label.includes(labelPart), `${name}: banner is ${tone} "${labelPart}"`, `got ${b.color} "${b.label}"`);
  const icon = tone === 'green' ? '✅' : tone === 'red' ? '❌' : '⚠️';
  check(p.subject.includes(icon) && p.subject.toUpperCase().includes(labelPart.toUpperCase()), `${name}: subject has ${icon} and "${labelPart}"`, p.subject);
}

/** Rule 15, applied to every scenario that has a rerun table: both columns add up and agree with the parsed combined report. */
function expectCountsAddUp(p: Pipeline, name: string): void {
  const t = summaryTable(p.html);
  if (!t) return;
  for (const i of [0, 1] as const) {
    const col = i === 0 ? 'first run' : 'after rerun';
    const sum = t.Passed[i] + t.Failed[i] + t.Flaky[i] + t.Skipped[i] + t['Did not run'][i];
    check(sum === t.Total[i], `${name}: ${col} column adds up (${t.Passed[i]}+${t.Failed[i]}+${t.Flaky[i]}+${t.Skipped[i]}+${t['Did not run'][i]} = ${t.Total[i]})`, `sum ${sum}`);
  }
  check(t.Total[0] === t.Total[1] && t.Total[1] === p.parsed.total, `${name}: total is the same in both columns and equals the parsed total`, `${t.Total} vs ${p.parsed.total}`);
  check(t.Passed[1] === p.parsed.passed && t.Flaky[1] === p.parsed.flaky, `${name}: after-rerun Passed/Flaky equal the email's own KPI counts`, `${t.Passed[1]}/${t.Flaky[1]} vs ${p.parsed.passed}/${p.parsed.flaky}`);
  // The parser counts a test that never ran as skipped; the table splits those into Skipped (deliberate) and Did not run.
  check(t.Failed[1] === p.parsed.failed && t.Skipped[1] + t['Did not run'][1] === p.parsed.skipped, `${name}: after-rerun Failed equals the parsed failed; Skipped + Did not run equal the parsed skipped`, `${t.Failed[1]}/${t.Skipped[1] + t['Did not run'][1]} vs ${p.parsed.failed}/${p.parsed.skipped}`);
}
function expectHistory(p: Pipeline, want: { failed: number; flaky: number; passed?: number; firstFailed?: number; firstFlaky?: number; recovered?: string[]; flakyTitlesInclude?: string[] }, name: string): void {
  const h = p.history;
  check(h.failed === want.failed && h.flaky === want.flaky, `${name}: history final failed/flaky = ${want.failed}/${want.flaky}`, `${h.failed}/${h.flaky}`);
  if (want.passed !== undefined) check(h.passed === want.passed, `${name}: history passed = ${want.passed}`, String(h.passed));
  check(h.total === p.parsed.total && h.passed + h.failed + h.flaky + h.skipped === h.total, `${name}: history counts add up to total`, `${h.passed}+${h.failed}+${h.flaky}+${h.skipped} vs ${h.total}`);
  if (want.firstFailed !== undefined) check(h.firstRunFailed === want.firstFailed && h.firstRunFlaky === want.firstFlaky, `${name}: history keeps the first-run counts ${want.firstFailed}/${want.firstFlaky}`, `${h.firstRunFailed}/${h.firstRunFlaky}`);
  if (want.recovered) eq([...(h.recoveredOnRerunTitles ?? [])].sort(), [...want.recovered].sort(), `${name}: history recoveredOnRerunTitles`);
  for (const t of want.flakyTitlesInclude ?? want.recovered ?? []) check(h.flakyTestTitles.includes(t), `${name}: "${t}" is in history flakyTestTitles`);
}

const labels = { recovered: 'Flaky - recovered on rerun', ranOnly: 'Passed (did not run → passed on rerun)' };
const filler = (n = 5): Def[] => many(n, 'passed', 'filler', 'ui/ok/ok.spec.ts', 1);

function main(): void {
  // ── 1. all pass first try, nothing to rerun ──
  {
    const p = pipeline(filler(10), null);
    expectStatus(p, 'green', 'Passed', 'S1');
    check(p.summary.ran === false && p.summary.reason === 'none', 'S1: summary says no rerun, reason none');
    check(rerunSection(p.html) === null && !p.html.includes('After rerun'), 'S1: no rerun section in the email');
    check(p.history.rerun === undefined && p.history.firstRunFailed === undefined && p.history.recoveredOnRerunTitles === undefined, 'S1: history has no rerun fields');
    expectHistory(p, { failed: 0, flaky: 0, passed: 10 }, 'S1');
  }
  // ── 2. only flaky tests in the first run, all pass in the rerun: GREEN, still listed and counted as flaky ──
  {
    const f = many(5, 'flaky', 'flaky');
    const p = pipeline([...filler(5), ...f], many(5, 'passed', 'flaky'));
    check(p.list.decision === 'run' && p.list.candidates.length === 5, 'S2: no failed/timed-out/did-not-run test: the 5 flaky tests are rerun');
    expectStatus(p, 'green', 'Passed', 'S2');
    eq(summaryTable(p.html), { Passed: [5, 5], Failed: [0, 0], Flaky: [5, 5], Skipped: [0, 0], 'Did not run': [0, 0], Total: [10, 10] }, 'S2: table: 5 Flaky in both columns');
    const tt = testTable(p.html);
    check(Object.keys(tt).length === 5 && Object.values(tt).every((r) => r[0] === 'Flaky' && r[1] === 'Passed' && r[2] === 'Flaky - passed on rerun'), 'S2: every row Flaky -> Passed -> "Flaky - passed on rerun"', JSON.stringify(tt));
    check(p.parsed.flaky === 5 && p.parsed.flakyPassedOnRerun === 5 && p.parsed.status === 'passed' && p.parsed.flakyTests.length === 5, 'S2: the parser still lists 5 flaky tests, all resolved on rerun, run status passed');
    check((p.html.match(/final <strong[^>]*>Flaky - passed on rerun/g) ?? []).length >= 5 && p.html.includes('id="section-flaky-tests"'), 'S2: the flaky section lists each test with the tag "Flaky - passed on rerun"');
    check(!text(rerunSection(p.html) ?? '').includes('recovered on rerun)'), 'S2: nothing is "recovered on rerun" (they were flaky, not failed)');
    expectCountsAddUp(p, 'S2');
    expectHistory(p, { failed: 0, flaky: 5, passed: 5, firstFailed: 0, firstFlaky: 5, recovered: [], flakyTitlesInclude: ['flaky 1', 'flaky 2', 'flaky 3', 'flaky 4', 'flaky 5'] }, 'S2');
  }
  // ── 3. only flaky tests, 2 fail in the rerun: AMBER, still Flaky, rerun failures only evidence ──
  {
    const rr = [...many(3, 'passed', 'flaky'), def('ui/many/many.spec.ts', 'flaky 4', 103, 'failed'), def('ui/many/many.spec.ts', 'flaky 5', 104, 'failed')];
    const p = pipeline([...filler(5), ...many(5, 'flaky', 'flaky')], rr);
    expectStatus(p, 'amber', 'Unstable', 'S3');
    eq(summaryTable(p.html), { Passed: [5, 5], Failed: [0, 0], Flaky: [5, 5], Skipped: [0, 0], 'Did not run': [0, 0], Total: [10, 10] }, 'S3: table: still 5 Flaky, 0 Failed');
    const tt = testTable(p.html);
    eq(tt['flaky 4'], ['Flaky', 'Failed', 'Flaky'], 'S3: flaky 4 shows Flaky -> Failed -> Flaky');
    eq(tt['flaky 1'], ['Flaky', 'Passed', 'Flaky - passed on rerun'], 'S3: flaky 1 shows Flaky -> Passed -> Flaky - passed on rerun');
    check(p.parsed.flaky === 5 && p.parsed.flakyPassedOnRerun === 3 && p.parsed.status === 'unstable', 'S3: 3 of 5 resolved: the 2 that failed on rerun keep the run Unstable');
    check(p.summary.stillFailing === 0 && p.summary.recovered === 0, 'S3: summary counts no recovered and no still-failing');
    expectCountsAddUp(p, 'S3');
    expectHistory(p, { failed: 0, flaky: 5, firstFailed: 0, firstFlaky: 5, recovered: [] }, 'S3');
  }
  // ── 4. 3 failed, all pass in the rerun: amber, recovered ──
  {
    const p = pipeline([...filler(7), ...many(3, 'failed', 'broken')], many(3, 'passed', 'broken'));
    expectStatus(p, 'amber', 'Unstable', 'S4');
    eq(summaryTable(p.html), { Passed: [7, 7], Failed: [3, 0], Flaky: [0, 3], Skipped: [0, 0], 'Did not run': [0, 0], Total: [10, 10] }, 'S4: table: 3 failed -> 3 flaky, passed stays 7');
    check(text(rerunSection(p.html) ?? '').includes('3 recovered on rerun'), 'S4: table says "3 recovered on rerun"');
    const tt = testTable(p.html);
    check(Object.values(tt).length === 3 && Object.values(tt).every((r) => r[0] === 'Failed' && r[1] === 'Passed' && r[2] === labels.recovered), 'S4: rows Failed -> Passed -> Flaky - recovered on rerun', JSON.stringify(tt));
    check(p.html.includes('first run <strong>Failed</strong> &rarr; rerun <strong>Passed</strong>'), 'S4: the flaky card of a recovered test carries the first -> rerun -> final line');
    expectCountsAddUp(p, 'S4');
    expectHistory(p, { failed: 0, flaky: 3, passed: 7, firstFailed: 3, firstFlaky: 0, recovered: ['broken 1', 'broken 2', 'broken 3'] }, 'S4');
  }
  // ── 5. 3 failed, 1 recovers, 2 fail again: red ──
  {
    const p = pipeline([...filler(7), ...many(3, 'failed', 'broken')], [def('ui/many/many.spec.ts', 'broken 1', 100, 'passed'), def('ui/many/many.spec.ts', 'broken 2', 101, 'failed'), def('ui/many/many.spec.ts', 'broken 3', 102, 'timedOut')]);
    expectStatus(p, 'red', 'Failed', 'S5');
    eq(summaryTable(p.html), { Passed: [7, 7], Failed: [3, 2], Flaky: [0, 1], Skipped: [0, 0], 'Did not run': [0, 0], Total: [10, 10] }, 'S5: table: 2 failed, 1 flaky');
    const tt = testTable(p.html);
    eq(tt['broken 1'], ['Failed', 'Passed', labels.recovered], 'S5: broken 1 recovered');
    eq(tt['broken 2'], ['Failed', 'Failed', 'Failed'], 'S5: broken 2 failed again');
    expectCountsAddUp(p, 'S5');
    expectHistory(p, { failed: 2, flaky: 1, firstFailed: 3, firstFlaky: 0, recovered: ['broken 1'] }, 'S5');
    check(p.history.failedTestTitles.length === 2 && !p.history.failedTestTitles.includes('broken 1'), 'S5: history failedTestTitles = the 2 still failing');
  }
  // ── 6. mix: flaky + failed + timed out + did-not-run (serial) ──
  {
    const Q = 'ui/quotations/quotations.spec.ts';
    const L = 'ui/leads/leads.spec.ts';
    const firstDefs = [
      ...filler(4),
      def(L, 'flaky A', 10, 'flaky'), def(L, 'flaky B', 11, 'flaky'),
      def(L, 'failed A', 20, 'failed'), def(L, 'failed B', 21, 'failed'), def(L, 'timeout A', 22, 'timedOut'),
      def(Q, 'q1 fails', 5, 'failed'), def(Q, 'q2 dependent', 6, 'did-not-run'), def(Q, 'q3 dependent', 7, 'did-not-run'),
    ];
    const rerunDefs = [
      def(L, 'flaky A', 10, 'passed'), def(L, 'flaky B', 11, 'failed'),
      def(L, 'failed A', 20, 'passed'), def(L, 'failed B', 21, 'failed'), def(L, 'timeout A', 22, 'passed'),
      def(Q, 'q1 fails', 5, 'passed'), def(Q, 'q2 dependent', 6, 'passed'), def(Q, 'q3 dependent', 7, 'failed'),
    ];
    const p = pipeline(firstDefs, rerunDefs);
    expectStatus(p, 'red', 'Failed', 'S6');
    eq(summaryTable(p.html), { Passed: [4, 5], Failed: [4, 2], Flaky: [2, 5], Skipped: [0, 0], 'Did not run': [2, 0], Total: [12, 12] }, 'S6: first run: 4 failed, 2 did not run (not failed); after rerun: q2 is Passed, 2 failed, 5 flaky');
    const tt = testTable(p.html);
    eq(tt['timeout A'], ['Failed', 'Passed', labels.recovered], 'S6: timed out, passes on rerun = recovered');
    eq(tt['q2 dependent'], ['Did not run', 'Passed', labels.ranOnly], 'S6: did-not-run, passes on rerun = Passed ("did not run → passed on rerun"), not Flaky');
    check(text(rerunSection(p.html) ?? '').includes('1 ran only on rerun'), 'S6: Passed column says "1 ran only on rerun"');
    eq(tt['q3 dependent'], ['Did not run', 'Failed', 'Failed'], 'S6: did-not-run, fails on rerun = failed');
    check(!('flaky A' in tt) && !('flaky B' in tt), 'S6: the run has failed tests, so the flaky tests are NOT rerun (no rows)');
    check(p.parsed.flaky === 5 && p.parsed.flakyPassedOnRerun === 0, 'S6: the 2 untouched flaky tests keep the run at least amber');
    expectCountsAddUp(p, 'S6');
    expectHistory(p, { failed: 2, flaky: 5, passed: 5, firstFailed: 4, firstFlaky: 2, recovered: ['failed A', 'timeout A', 'q1 fails'] }, 'S6');
    check(p.history.rerun?.ranOnlyOnRerun === 1 && !p.history.flakyTestTitles.includes('q2 dependent'), 'S6: history: q2 ran only on rerun, is not flaky');
    check(p.parsed.skippedTests.length === 0, 'S6: no did-not-run placeholder is left as "skipped" in the combined report');
  }
  // ── 7. over the cap ──
  {
    const p = pipeline([...filler(5), ...many(61, 'failed', 'broken')], null);
    check(p.list.decision === 'cap' && p.summary.ran === false && p.summary.reason === 'cap', 'S7: 61 failures: decision cap, summary says why');
    const s = rerunSection(p.html);
    check(!!s && text(s).includes('61 failed/flaky tests is more than the limit of 60') && text(s).includes('nothing was rerun'), 'S7: email says the cap reason', text(s ?? ''));
    check(summaryTable(p.html) !== null && Object.keys(summaryTable(p.html) ?? {}).length === 0, 'S7: no first/after table (nothing changed)');
    expectStatus(p, 'red', 'Failed', 'S7');
    eq([p.parsed.passed, p.parsed.failed, p.parsed.flaky], [5, 61, 0], 'S7: statuses are the first-run statuses');
    check(p.summary.firstRun.failed === 61 && p.summary.afterRerun.failed === 61, 'S7: summary first run = after rerun');
    check(p.history.rerun === undefined && p.history.failed === 61, 'S7: history has no rerun fields and the first-run counts');
    const atCap = pipeline([...filler(5), ...many(60, 'failed', 'broken')], many(60, 'passed', 'broken'));
    check(atCap.list.decision === 'run' && atCap.summary.ran, 'S7: exactly 60 still reruns');
  }
  // ── 8. kill switch off / no manifest = exactly today ──
  {
    const firstDefs = [...filler(5), ...many(2, 'failed', 'broken'), ...many(1, 'flaky', 'flaky', 'ui/f/f.spec.ts', 5)];
    const off = pipeline(firstDefs, null, { noManifest: true });
    check(!off.html.includes('section-rerun') && !off.html.includes('After rerun') && !off.html.includes('recovered on rerun') && !off.html.includes('Rerun: first run'), 'S8: email has no rerun section, table or lines');
    check(!('rerun' in off.history) && !('firstRunFailed' in off.history) && !('firstFlaky' in off.history) && !('recoveredOnRerunTitles' in off.history), 'S8: history has none of the new fields');
    expectStatus(off, 'red', 'Failed', 'S8');
    // Identical to an email built from a context that never heard of reruns.
    const first = mkReport(firstDefs);
    const f = path.join(SCRATCH, 'plain.json');
    fs.writeFileSync(f, JSON.stringify(first));
    const parsed = new ReportParser().parse(f);
    eq([parsed.passed, parsed.failed, parsed.flaky, parsed.skipped, parsed.total], [off.parsed.passed, off.parsed.failed, off.parsed.flaky, off.parsed.skipped, off.parsed.total], 'S8: report counts are those of the plain first-run report');
    // a garbled or foreign summary file is "no information", not a crash
    check(parseRerunSummary('{ nope') === null && parseRerunSummary('{"version":2,"ran":true}') === null, 'S8: unreadable summary = ignored');
    // an old history record (no rerun fields) is still a valid record the readers accept
    const old = { ...off.history } as Record<string, unknown>;
    delete old.rerun; delete old.firstRunFailed; delete old.firstRunFlaky; delete old.recoveredOnRerunTitles;
    check(typeof old.total === 'number' && Array.isArray(old.flakyTestTitles), 'S8: a record without the new fields has everything the readers use');
  }
  // ── 9. stale manifest from an earlier attempt, and 10. attempt 2 (script level, real combine-rerun.ts) ──
  scriptScenarios();
  // ── 11. stacked: manual rerun of a finished run ──
  {
    const L = 'ui/leads/leads.spec.ts';
    // run 1: A failed, C flaky. Automatic rerun reruns A only (failed tests first); A recovers, so the run has no failed test left.
    const firstDefs = [...filler(5), def(L, 'A', 10, 'failed'), def(L, 'C', 12, 'flaky')];
    const auto = pipeline(firstDefs, [def(L, 'A', 10, 'passed')]);
    eq(auto.summary.rows.map((r) => [r.title, r.final]), [['A', 'recovered']], 'S11: automatic rerun: only A rerun, recovered; C (flaky) not rerun');
    // manual rerun of the combined report: nothing failed any more, so A (now flaky) and C are rerun; both fail this time
    const m = stacked(auto, true, [def(L, 'A', 10, 'failed'), def(L, 'C', 12, 'failed')]);
    eq(Object.fromEntries(m.summary.rows.map((r) => [r.title, r.final]).sort()), { A: 'recovered', C: 'flaky' }, 'S11: A recovered in rerun 1 stays Flaky though rerun 2 fails it; C stays Flaky');
    const arow = m.summary.rows.find((r) => r.title === 'A');
    check(arow?.first === 'failed' && arow.rerun === 'failed', 'S11: A row: first Failed, latest rerun Failed (evidence), final recovered');
    expectStatus(m, 'amber', 'Unstable', 'S11');
    eq(summaryTable(m.html), { Passed: [5, 5], Failed: [1, 0], Flaky: [1, 2], Skipped: [0, 0], 'Did not run': [0, 0], Total: [7, 7] }, 'S11: counts do not double: first run stays 1 failed / 1 flaky, after = 2 flaky');
    check(text(rerunSection(m.html) ?? '').includes('Manual rerun of run #12'), 'S11: email says Manual rerun of run #12');
    expectCountsAddUp(m, 'S11');
    expectHistory(m, { failed: 0, flaky: 2, firstFailed: 1, firstFlaky: 1, recovered: ['A'] }, 'S11');
    // the same manual rerun where both pass: C resolved, A stays recovered (amber), no failure
    const ok = stacked(auto, true, [def(L, 'A', 10, 'passed'), def(L, 'C', 12, 'passed')]);
    check(ok.parsed.flakyPassedOnRerun === 1 && ok.parsed.status === 'unstable', 'S11: A (recovered) keeps the run Unstable even when C resolves');
    // flaky off: nothing to select, the rows of rerun 1 stay
    const off = stacked(auto, false, []);
    eq(off.summary.rows.map((r) => r.title), ['A'], 'S11: a stacked rerun with nothing selected keeps the earlier rows');
    check(off.summary.ran === true, 'S11: and still says ran');
    // failed tests in rerun 1, one still failing: the manual rerun reruns only that one, the recovered one is carried
    const f2 = [...filler(5), def(L, 'A', 10, 'failed'), def(L, 'B', 11, 'failed')];
    const auto2 = pipeline(f2, [def(L, 'A', 10, 'passed'), def(L, 'B', 11, 'failed')]);
    const m2 = stacked(auto2, true, [def(L, 'B', 11, 'passed')]);
    eq(Object.fromEntries(m2.summary.rows.map((r) => [r.title, r.final]).sort()), { A: 'recovered', B: 'recovered' }, 'S11: B recovers on the manual rerun, A is carried over');
    eq(m2.summary.firstRun.failed, 2, 'S11: first-run counts stay those of the original run');
  }
  // ── 12. serial whole-file rerun, parameterised tests on one line, deliberate skips ──
  {
    const Q = 'ui/quotations/quotations.spec.ts';
    const P = 'ui/p/p.spec.ts';
    const D = 'ui/deals/deals.spec.ts';
    const firstDefs = [
      def(Q, 'q0 passed', 4, 'passed'), def(Q, 'q1 fails', 5, 'failed'), def(Q, 'q2 dependent', 6, 'did-not-run'),
      def(P, 'param A', 8, 'failed'), def(P, 'param B', 8, 'passed'), def(P, 'param C', 8, 'failed'),
      def(D, 'declared skip', 12, 'declared-skip'), def(D, 'annotated skip', 13, 'annotated-skip'), ...filler(3),
    ];
    const rerunDefs = [
      def(Q, 'q0 passed', 4, 'failed'), def(Q, 'q1 fails', 5, 'passed'), def(Q, 'q2 dependent', 6, 'passed'), // whole file ran again
      def(P, 'param A', 8, 'passed'), def(P, 'param B', 8, 'failed'), def(P, 'param C', 8, 'failed'),
      def(D, 'declared skip', 12, 'declared-skip'), def(D, 'annotated skip', 13, 'annotated-skip'),
    ];
    const p = pipeline(firstDefs, rerunDefs);
    check(p.list.targets.includes('tests/ui/quotations/quotations.spec.ts') && p.list.targets.filter((t) => t.includes('p.spec.ts')).length === 1 && p.list.targets.includes('tests/ui/p/p.spec.ts:8'), 'S12: serial file targeted whole, parameterised line targeted once');
    const tt = testTable(p.html);
    check(!('q0 passed' in tt) && !('param B' in tt) && !('declared skip' in tt) && !('annotated skip' in tt), 'S12: passed and deliberately skipped tests have no rerun row');
    eq(tt['param A'], ['Failed', 'Passed', labels.recovered], 'S12: param A recovered');
    eq(tt['param C'], ['Failed', 'Failed', 'Failed'], 'S12: param C failed again');
    eq(tt['q2 dependent'], ['Did not run', 'Passed', labels.ranOnly], 'S12: serial dependent passes on rerun = Passed');
    eq(p.parsed.skipped, 2, 'S12: the 2 deliberate skips stay skipped (a failure in the whole-file rerun of q0 and param B is ignored)');
    eq(summaryTable(p.html), { Passed: [5, 6], Failed: [3, 1], Flaky: [0, 2], Skipped: [2, 2], 'Did not run': [1, 0], Total: [11, 11] }, 'S12: table');
    expectCountsAddUp(p, 'S12');
    expectStatus(p, 'red', 'Failed', 'S12');
  }
  // ── 13. INCOMPLETE run stays INCOMPLETE ──
  {
    const shard: ShardCompleteness = { expected: 7, reported: 6 };
    const p = pipeline([...filler(7), ...many(2, 'failed', 'broken')], many(2, 'passed', 'broken'), { shard });
    check(p.parsed.status === 'unstable', 'S13: without the shard check the combined report would only be unstable');
    expectStatus(p, 'red', 'Incomplete Run', 'S13');
    check(p.html.includes('id="section-incomplete-run"') && text(p.html).includes('6 of 7'), 'S13: the incomplete-run banner is still there');
    check(summaryTable(p.html)?.Flaky?.[1] === 2, 'S13: the rerun table is still shown (it explains the counts, it does not hide the banner)');
    const cap = pipeline([...filler(7), ...many(61, 'failed', 'broken')], null, { shard });
    expectStatus(cap, 'red', 'Incomplete Run', 'S13 (cap)');
  }
  // ── 16. cut-off shard: tests that never ran (not failed) ──
  {
    const p = pipeline([...filler(6), ...many(2, 'cut-off', 'cut')], [def('ui/many/many.spec.ts', 'cut 1', 100, 'passed'), def('ui/many/many.spec.ts', 'cut 2', 101, 'failed')]);
    eq(summaryTable(p.html), { Passed: [6, 7], Failed: [0, 1], Flaky: [0, 0], Skipped: [0, 0], 'Did not run': [2, 0], Total: [8, 8] }, 'S16: first run 2 Did not run (0 failed); after: 1 Passed (ran only on rerun), 1 Failed');
    const tt = testTable(p.html);
    eq(tt['cut 1'], ['Did not run', 'Passed', labels.ranOnly], 'S16: cut 1 did not run -> passed on rerun');
    eq(tt['cut 2'], ['Did not run', 'Failed', 'Failed'], 'S16: cut 2 did not run -> failed on rerun');
    expectStatus(p, 'red', 'Failed', 'S16');
    expectCountsAddUp(p, 'S16');
    expectHistory(p, { failed: 1, flaky: 0, firstFailed: 0, firstFlaky: 0, recovered: [] }, 'S16');
    const ok = pipeline([...filler(6), ...many(2, 'cut-off', 'cut')], many(2, 'passed', 'cut'));
    check(ok.parsed.flaky === 0 && ok.parsed.failed === 0 && ok.parsed.passed === 8, 'S16: both cut-off tests pass on rerun: 8 passed, none flaky', `${ok.parsed.passed}/${ok.parsed.flaky}`);
    const notRerun = pipeline([...filler(6), ...many(2, 'cut-off', 'cut')], null, { select: { maxTests: 1 } });
    eq(summaryTable(notRerun.html), {}, 'S16: over the cap: no table');
  }
  // ── 17. did-not-run tests, no rerun: never green ──
  {
    const off = pipeline([...filler(6), ...many(2, 'cut-off', 'cut')], null, { noManifest: true });
    expectStatus(off, 'amber', 'Unstable', 'S17');
    check(off.parsed.status === 'unstable' && off.parsed.didNotRun === 2 && off.parsed.failed === 0, 'S17: 2 tests did not run, none failed: status unstable', `${off.parsed.status} ${off.parsed.didNotRun}`);
    check(bannerOf(off.html).label.includes('2 did not run') && text(off.html).includes('2 tests did not run'), 'S17: banner and a note say "2 tests did not run"');
    const serial = pipeline([...filler(4), def('ui/q/q.spec.ts', 'q2 dependent', 6, 'did-not-run')], null, { noManifest: true });
    expectStatus(serial, 'amber', 'Unstable', 'S17 (serial dependent)');
    const capped = pipeline([...filler(6), ...many(2, 'cut-off', 'cut')], null, { select: { maxTests: 1 } });
    expectStatus(capped, 'amber', 'Unstable', 'S17 (over the cap)');
    expectHistory(off, { failed: 0, flaky: 0, passed: 6 }, 'S17');
    // deliberate skips (skip annotation / declared skip) never change the colour
    const skips = pipeline([...filler(6), def('ui/d/d.spec.ts', 'declared', 1, 'declared-skip'), def('ui/d/d.spec.ts', 'annotated', 2, 'annotated-skip')], null, { noManifest: true });
    expectStatus(skips, 'green', 'Passed', 'S17 (deliberate skips)');
    check(skips.parsed.didNotRun === 0 && skips.parsed.skipped === 2 && !skips.html.includes('section-not-verified'), 'S17: deliberate skips are not "did not run" and get no note');
  }
  // ── 18. only issue: did-not-run tests that passed on the rerun ──
  {
    const p = pipeline([...filler(6), ...many(2, 'cut-off', 'cut')], many(2, 'passed', 'cut'));
    expectStatus(p, 'amber', 'Unstable', 'S18');
    check(p.parsed.failed === 0 && p.parsed.flaky === 0 && p.parsed.passed === 8 && p.parsed.ranOnlyOnRerun === 2 && p.parsed.status === 'unstable', 'S18: 8 passed, 0 failed, 0 flaky, 2 ran only on rerun: unstable, not passed', `${p.parsed.status}`);
    check(bannerOf(p.html).label.includes('2 ran only on rerun') && text(p.html).includes('2 tests ran only on the rerun'), 'S18: banner and note say "2 ran only on rerun"');
    eq(summaryTable(p.html), { Passed: [6, 8], Failed: [0, 0], Flaky: [0, 0], Skipped: [0, 0], 'Did not run': [2, 0], Total: [8, 8] }, 'S18: table');
    expectCountsAddUp(p, 'S18');
    const serial = pipeline([...filler(4), def('ui/q/q.spec.ts', 'q dependent', 6, 'did-not-run')], [def('ui/q/q.spec.ts', 'q dependent', 6, 'passed')]);
    expectStatus(serial, 'amber', 'Unstable', 'S18 (serial dependent)');
  }
  // ── 19. failed + flaky in one run: only the failed are rerun; the flaky ones keep the run at least amber ──
  {
    const first = [...filler(6), def('ui/f/f.spec.ts', 'flaky 1', 1, 'flaky'), def('ui/f/f.spec.ts', 'flaky 2', 2, 'flaky'), def('ui/f/f.spec.ts', 'broken', 3, 'failed')];
    const rec = pipeline(first, [def('ui/f/f.spec.ts', 'broken', 3, 'passed')]);
    check(rec.list.candidates.length === 1 && rec.list.candidates[0].title === 'broken', 'S19: only the failed test is a candidate');
    expectStatus(rec, 'amber', 'Unstable', 'S19 (recovered)');
    eq(summaryTable(rec.html), { Passed: [6, 6], Failed: [1, 0], Flaky: [2, 3], Skipped: [0, 0], 'Did not run': [0, 0], Total: [9, 9] }, 'S19: table: failed 1 -> 0, flaky 2 -> 3 (1 recovered on rerun)');
    expectHistory(rec, { failed: 0, flaky: 3, firstFailed: 1, firstFlaky: 2, recovered: ['broken'], flakyTitlesInclude: ['flaky 1', 'flaky 2', 'broken'] }, 'S19');
    const still = pipeline(first, [def('ui/f/f.spec.ts', 'broken', 3, 'failed')]);
    expectStatus(still, 'red', 'Failed', 'S19 (still failing)');
    check(text(still.html).includes('were not rerun'), 'S19: the email says the flaky tests were not rerun');
    // a failed formFields test (never rerun) still means the run has failed tests: the flaky ones are not rerun either
    const ff = pipeline([...filler(6), def('ui/f/f.spec.ts', 'flaky 1', 1, 'flaky'), def('ui/formFields/leadFieldLimits.spec.ts', 'ff fails', 3, 'failed')], null);
    check(ff.list.decision === 'none' && ff.list.candidates.length === 0 && ff.list.excluded.length === 2, 'S19: failed formFields test: nothing rerun, both listed as not rerun');
    expectStatus(ff, 'red', 'Failed', 'S19 (formFields failure)');
  }
  // ── 20. flaky only: green needs the rerun; without it (kill switch off / cap off) the run stays amber ──
  {
    const first = [...filler(6), ...many(2, 'flaky', 'flaky'), def('ui/d/d.spec.ts', 'annotated', 1, 'annotated-skip')];
    expectStatus(pipeline(first, null, { noManifest: true }), 'amber', 'Unstable', 'S20 (no rerun)');
    expectStatus(pipeline(first, many(2, 'passed', 'flaky')), 'green', 'Passed', 'S20 (all pass on rerun, deliberate skip ignored)');
    expectStatus(pipeline(first, [def('ui/many/many.spec.ts', 'flaky 1', 100, 'passed'), def('ui/many/many.spec.ts', 'flaky 2', 101, 'failed')]), 'amber', 'Unstable', 'S20 (one fails on rerun)');
    const off = pipeline(first, many(2, 'passed', 'flaky'), { select: { includeFlaky: false } });
    expectStatus(off, 'amber', 'Unstable', 'S20 (RERUN_INCLUDE_FLAKY off)');
    // stays visible for trends even though the email is green
    const g = pipeline(first, many(2, 'passed', 'flaky'));
    check(g.history.flakyTestTitles.length === 2 && g.history.flaky === 2, 'S20: green email, history still has 2 flaky tests');
  }
  // ── 21. tiles: Skipped excludes did-not-run, which has its own tile; totals add up ──
  {
    const p = pipeline([...filler(5), def('ui/d/d.spec.ts', 'annotated', 1, 'annotated-skip'), ...many(2, 'cut-off', 'cut'), def('ui/f/f.spec.ts', 'fl', 1, 'flaky')], null, { noManifest: true });
    const t = text(p.html);
    const tile = (label: string): number => Number((t.match(new RegExp(`(\\d+) ${label}\\b`)) ?? [])[1] ?? NaN);
    eq([tile('Total'), tile('Passed'), tile('Flaky'), tile('Failed'), tile('Skipped'), tile('Did not run')], [9, 5, 1, 0, 1, 2], 'S21: tiles Total/Passed/Flaky/Failed/Skipped/Did not run');
    check(tile('Passed') + tile('Flaky') + tile('Failed') + tile('Skipped') + tile('Did not run') === tile('Total'), 'S21: tiles add up to Total');
    check(p.html.includes('Skipped Tests (1)') && !p.html.includes('Skipped Tests (3)'), 'S21: the skipped list holds only the deliberate skip');
    const none = pipeline([...filler(5), def('ui/d/d.spec.ts', 'annotated', 1, 'annotated-skip')], null, { noManifest: true });
    check(!text(none.html).includes('Did not run'), 'S21: no "Did not run" tile when every test ran');
  }
  // ── 14. the attempt gate ──
  gateScenarios();
  // ── 15 is checked inside every scenario above (expectCountsAddUp / expectHistory) ──

  fs.rmSync(SCRATCH, { recursive: true, force: true });
  out(failures === 0 ? `\ncheck:rerun scenarios — all ${checks} checks passed` : `\ncheck:rerun scenarios — ${failures} of ${checks} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

/** Manual rerun of an already combined run: select from the combined report, combine on top of the earlier summary. */
function stacked(auto: Pipeline, includeFlaky: boolean, rerunDefs: Def[]): Pipeline {
  const list = selectRerun(auto.combined, { ...OPTS, includeFlaky }, { retries: 0, runId: '200', runAttempt: 1 });
  const res = combineRerun(auto.combined, mkReport(rerunDefs, 5000), list, { runId: '200', runAttempt: 1, previous: auto.summary, rerunOf: { runId: '99', runNumber: '12' } });
  return render(res.combined, parseRerunSummary(JSON.stringify(res.summary)) as RerunSummary, list);
}
function render(combined: JsonReport, summary: RerunSummary, list: RerunList): Pipeline {
  const dir = path.join(SCRATCH, `p${(seq += 1)}`);
  fs.mkdirSync(path.join(dir, 'reports', 'staging'), { recursive: true });
  const jsonPath = path.join(dir, 'results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(combined));
  fs.writeFileSync(path.join(dir, 'reports', 'staging', 'rerun-summary.json'), JSON.stringify(summary));
  const parsed = new ReportParser().parse(jsonPath);
  const misc: MiscErrorReport = { capturedAt: '2026-11-03T06:02:00.000Z', totalErrors: 0, unexpectedErrors: 0, expectedRbacErrors: 0, expectedBackgroundNoiseErrors: 0, byType: {}, errors: [] };
  const enrichCtx: EnrichmentContext = { miscErrors: [], previousRunFailedTitles: [], recurringFailures: [], knownIssuesIndex: [], runSource: 'github-actions', buildUrl: 'https://example.invalid/run/200' };
  const used = new Set<string>();
  const clusters = enrichClusters(clusterFailures(parsed.failedTests, []), enrichCtx, used);
  const flaky = buildFlakyFailureDetails(parsed.flakyTests, enrichCtx, used);
  const health = computeHealthScore(parsed, null, misc, null, [], [], false);
  const verdict = computeOverallVerdict(parsed, health, null, null);
  const ctx = { report: parsed, env: 'staging', branch: 'sandbox', buildNumber: '12', buildUrl: 'https://example.invalid/run/200', gitCommit: 'abc1234', triggeredBy: 't', runSource: 'github-actions', miscErrors: misc, health, verdict, clusters, flakyFailureDetails: flaky, rerun: summary } as EmailContext;
  const tpl = new EmailTemplate();
  const cwd = process.cwd();
  process.chdir(dir);
  let history: RunHistoryRecord;
  try {
    history = buildCurrentRecord('staging', 'sandbox', '12', 'github-actions', jsonPath, 'abc1234', false, undefined, undefined);
  } finally {
    process.chdir(cwd);
  }
  return { list, summary, combined, parsed, subject: tpl.subject(ctx), html: tpl.html(ctx), history };
}

// ── 9 + 10: the real scripts/combine-rerun.ts, run as CI runs it ──────────────────────────────────────────────
function runCombine(dir: string, env: Record<string, string>): { status: number | null; log: string } {
  const tsNode = require.resolve('ts-node/dist/bin.js');
  const r = spawnSync(process.execPath, [tsNode, '--project', path.join(ROOT, 'tsconfig.json'), path.join(ROOT, 'scripts/combine-rerun.ts'),
    '--first', path.join(dir, 'results.json'), '--rerun', path.join(dir, 'rerun-run.json'), '--list', path.join(dir, 'rerun-list.json'), '--summary', path.join(dir, 'out', 'rerun-summary.json')],
  { cwd: ROOT, env: { ...process.env, GITHUB_RUN_ID: '', GITHUB_RUN_ATTEMPT: '', RERUN_OF_RUN_ID: '', ...env }, encoding: 'utf-8' });
  return { status: r.status, log: `${r.stdout}${r.stderr}` };
}
function scriptScenarios(): void {
  const L = 'ui/leads/leads.spec.ts';
  const FF = 'ui/formFields/leadFieldLimits.spec.ts';
  // attempt 2 of run 100: core shard A re-run (one test still flaky, one still failing); shard B and the formFields results are from attempt 1
  const firstDefs = [...filler(4), def(L, 'still failing', 10, 'failed'), def(L, 'now flaky', 11, 'flaky'), def('ui/b/b.spec.ts', 'shard B ok', 1, 'passed'), def(FF, 'ff 1', 1, 'passed'), def(FF, 'ff 2', 2, 'passed')];
  const rerunDefs = [def(L, 'still failing', 10, 'passed'), def(L, 'now flaky', 11, 'passed')];
  const setup = (name: string, listAttempt: number, listRun = '100'): string => {
    const dir = path.join(SCRATCH, name);
    fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
    const first = mkReport(firstDefs);
    fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(first));
    fs.writeFileSync(path.join(dir, 'rerun-run.json'), JSON.stringify(mkReport(rerunDefs, 90000)));
    const list = selectRerun(first, OPTS, { retries: 0, runId: listRun, runAttempt: listAttempt });
    fs.writeFileSync(path.join(dir, 'rerun-list.json'), JSON.stringify(list));
    return dir;
  };
  // 10. attempt 2, list written by attempt 2: combined; the attempt-1 formFields results are in the totals
  {
    const dir = setup('s10', 2);
    const before = fs.readFileSync(path.join(dir, 'results.json'), 'utf-8');
    const r = runCombine(dir, { GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '2' });
    const sum = parseRerunSummary(fs.readFileSync(path.join(dir, 'out', 'rerun-summary.json'), 'utf-8'));
    check(r.status === 0 && !!sum && sum.ran, 'S10: combine-rerun runs for the current attempt\'s list', r.log);
    eq(sum?.rows.map((x) => x.title).sort(), ['still failing'], 'S10: only the failed test of the LATEST blobs is rerun (not an attempt-1 failure that now passes; the flaky one waits because the run has a failure)');
    check(sum?.afterRerun.total === 9 && sum.afterRerun.passed === 7 && sum.afterRerun.flaky === 2 && sum.afterRerun.failed === 0, 'S10: formFields results from attempt 1 are counted (9 tests: 7 passed incl. 2 formFields, 2 flaky)', JSON.stringify(sum?.afterRerun));
    check(fs.existsSync(path.join(dir, 'results.first-run.json')) && fs.readFileSync(path.join(dir, 'results.first-run.json'), 'utf-8') === before, 'S10: the first-run report is kept as results.first-run.json');
    check(!sum?.rows.some((x) => x.file.includes('formFields')), 'S10: formFields never in the rerun rows');
  }
  // 9. stale manifests: other attempt / other run -> ignored, nothing written, report byte-identical
  for (const [name, attempt, run, envRun, envAttempt] of [['s9-attempt', 1, '100', '100', '2'], ['s9-run', 2, '55', '100', '2']] as const) {
    const dir = setup(name, attempt, run);
    const before = fs.readFileSync(path.join(dir, 'results.json'), 'utf-8');
    const r = runCombine(dir, { GITHUB_RUN_ID: envRun, GITHUB_RUN_ATTEMPT: envAttempt });
    check(r.status === 0 && fs.readFileSync(path.join(dir, 'results.json'), 'utf-8') === before && !fs.existsSync(path.join(dir, 'out', 'rerun-summary.json')) && /ignored/.test(r.log), `S9: manifest from ${name === 's9-attempt' ? 'attempt 1' : 'another run'} is ignored (report unchanged, no summary written)`, r.log);
  }
  // 8 (script level): no manifest at all = untouched
  {
    const dir = setup('s8', 1);
    fs.rmSync(path.join(dir, 'rerun-list.json'));
    const before = fs.readFileSync(path.join(dir, 'results.json'), 'utf-8');
    const r = runCombine(dir, { GITHUB_RUN_ID: '100', GITHUB_RUN_ATTEMPT: '1' });
    check(r.status === 0 && fs.readFileSync(path.join(dir, 'results.json'), 'utf-8') === before && !fs.existsSync(path.join(dir, 'out', 'rerun-summary.json')), 'S8: no manifest (kill switch off): report and outputs untouched, exit 0', r.log);
  }
}

// ── 14: the formFields attempt gate script against a stub `gh` ─────────────────────────────────────────────────
function gateScenarios(): void {
  const root = path.join(SCRATCH, 'gate');
  const bin = path.join(root, 'bin');
  const fx = path.join(root, 'fx');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(fx, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/bash
path=""; jq_expr=""; while [ $# -gt 0 ]; do case "$1" in api|--paginate) ;; --jq) shift; jq_expr="$1";; *) path="$1";; esac; shift; done
[ -n "\${GH_FAIL:-}" ] && { echo "boom" >&2; exit 1; }
case "$path" in
 *attempts/*/jobs*) n=$(echo "$path" | sed -E 's#.*attempts/([0-9]+)/jobs.*#\\1#'); f="$FX/jobs-$n.json";;
 *artifacts*) f="$FX/artifacts.json";;
esac
[ -f "$f" ] || { echo '{"jobs":[],"artifacts":[]}' | jq -c "$jq_expr"; exit 0; }
jq -c "$jq_expr" "$f"
`, { mode: 0o755 });
  const JOB = 'playwright-formFields (lead)';
  const ffJob = (name: string, conclusion: string, attempt: number, testConclusion: string | null) => ({
    name, conclusion, run_attempt: attempt, steps: [{ name: 'Set up job', conclusion: 'success' }, ...(testConclusion ? [{ name: `Run formFields tests for ${name.replace(/.*\((.*)\)/, '$1')}`, conclusion: testConclusion }] : [])],
  });
  const detect = (attempt: number) => ({ name: 'detect target + shard plan', conclusion: 'success', run_attempt: attempt, steps: [] });
  const write = (n: number, jobs: unknown[]): void => fs.writeFileSync(path.join(fx, `jobs-${n}.json`), JSON.stringify({ jobs }));
  const artifacts = (expired: boolean): void => fs.writeFileSync(path.join(fx, 'artifacts.json'), JSON.stringify({ artifacts: [{ name: 'blob-report-sandbox-ff-lead', expired }] }));
  const runGate = (mode: string, attempt: number, extra: Record<string, string> = {}): { skip: string; log: string } => {
    const outFile = path.join(root, 'gh-output');
    fs.writeFileSync(outFile, '');
    const r = spawnSync('bash', [path.join(ROOT, '.github/scripts/formfields-attempt-gate.sh'), mode], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, FX: fx, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: String(attempt), GITHUB_OUTPUT: outFile, JOB_NAME: JOB, ARTIFACT_NAME: 'blob-report-sandbox-ff-lead', LABEL: 'lead', GH_FAIL: '', ...extra },
    });
    const skip = (fs.readFileSync(outFile, 'utf-8').match(/skip=(\w+)/) ?? [])[1] ?? 'none';
    check(r.status === 0, `S14 [${mode} attempt ${attempt}]: gate exits 0`, String(r.status));
    return { skip, log: `${r.stdout}${r.stderr}` };
  };
  for (const f of fs.readdirSync(fx)) fs.rmSync(path.join(fx, f));
  // attempt 1 passed the lead job; attempt 2 re-ran only a core shard (detect not re-run: its entry stays attempt 1)
  write(1, [detect(1), ffJob(JOB, 'success', 1, 'success')]);
  write(2, [detect(1), ffJob(JOB, 'success', 1, 'success')]);
  artifacts(false);
  let g = runGate('ff', 2);
  check(g.skip === 'true' && /already passed in attempt 1 — skipped/.test(g.log), 'S14: passed in an earlier attempt -> skip, with the log line', `${g.skip} ${g.log}`);
  // failed earlier
  write(1, [detect(1), ffJob(JOB, 'failure', 1, 'failure')]);
  g = runGate('ff', 2);
  check(g.skip === 'false', 'S14: failed in the earlier attempt -> run', g.skip);
  // job passed but its test step did not run (setup-only success)
  write(1, [detect(1), ffJob(JOB, 'success', 1, null)]);
  g = runGate('ff', 2);
  check(g.skip === 'false', 'S14: no passed test step in the earlier attempt -> run', g.skip);
  // artifact expired
  write(1, [detect(1), ffJob(JOB, 'success', 1, 'success')]);
  artifacts(true);
  g = runGate('ff', 2);
  check(g.skip === 'false', 'S14: artifact of the earlier attempt expired -> run', g.skip);
  artifacts(false);
  // API error
  g = runGate('ff', 2, { GH_FAIL: '1' });
  check(g.skip === 'false' && /running normally/.test(g.log), 'S14: API error -> run (fail open, warning logged)', `${g.skip} ${g.log}`);
  // Re-run all jobs: detect runs again in attempt 2
  write(2, [detect(2), ffJob(JOB, 'success', 2, 'success')]);
  g = runGate('ff', 2);
  check(g.skip === 'false' && /Re-run all jobs/.test(g.log), 'S14: "Re-run all jobs" (detect re-run) -> run', `${g.skip} ${g.log}`);
  // first attempt
  g = runGate('ff', 1);
  check(g.skip === 'false', 'S14: first attempt -> run', g.skip);
  // reset: all formFields jobs skipped in attempt 2 -> skip; one ran -> run; API error -> run
  write(2, [detect(1), ffJob('playwright-formFields (lead)', 'skipped', 2, null), ffJob('playwright-formFields (deal)', 'skipped', 2, null)]);
  g = runGate('reset', 2);
  check(g.skip === 'true', 'S14: reset skips when no formFields job ran tests in this attempt', g.skip);
  write(2, [detect(1), ffJob('playwright-formFields (lead)', 'success', 2, 'success'), ffJob('playwright-formFields (deal)', 'skipped', 2, null)]);
  g = runGate('reset', 2);
  check(g.skip === 'false', 'S14: reset runs when a formFields job ran tests', g.skip);
  g = runGate('reset', 2, { GH_FAIL: '1' });
  check(g.skip === 'false', 'S14: reset on API error -> run', g.skip);
}

main();
