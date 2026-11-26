/**
 * Scenario runner for the reporting matrix (2026-11-24, `npm run check:scenarios`): one function that takes a described run (first-run
 * tests, what the rerun does, completeness, a renew-session failure, background errors, environment and branch) and pushes it through the
 * REAL code: selectRerun, combineRerun, ReportParser, buildCurrentRecord, NotificationService.buildContext and EmailTemplate (or the
 * "report unavailable" message when the run has no results file). Nothing is sent and nothing touches the network; the pipeline runs
 * in a temporary working directory.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MiscErrorReport } from '../../src/error-collector/ErrorCollector';
import { RenewalFailure } from '../../src/auth/renewalFailure';
import { RunStartSource } from '../../src/notifications/RunTimes';
import { CapacitySnapshot, GATE_ERROR_FILE, POST_RUN_SNAPSHOT_FILE, PRE_RUN_SNAPSHOT_FILE } from '../../src/modules/billing/capacity';
import { EmailContext, EmailTemplate } from '../../src/notifications/EmailTemplate';
import { NotificationInput, NotificationService } from '../../src/notifications/NotificationService';
import { ParsedReport, ReportParser } from '../../src/notifications/ReportParser';
import { JsonReport, JsonResult, JsonTest, RerunList, combineRerun, selectRerun } from '../../src/notifications/RerunResults';
import { RerunSummary } from '../../src/notifications/RerunSummary';
import { RunHistoryRecord } from '../../src/notifications/RunHistory';
import { buildCurrentRecord } from '../../src/notifications/scripts/syncHistory';

const REPO_ROOT = path.resolve(__dirname, '../..');

export type Kind = 'passed' | 'flaky' | 'failed' | 'timedOut' | 'did-not-run' | 'cut-off' | 'skip-reason' | 'skip-no-reason' | 'known-bug';
export interface Def {
  file: string;
  title: string;
  line: number;
  kind: Kind;
}
export const def = (file: string, title: string, line: number, kind: Kind): Def => ({ file, title, line, kind });
export const many = (n: number, kind: Kind, prefix: string, file = 'ui/many/many.spec.ts', startLine = 100): Def[] =>
  Array.from({ length: n }, (_, i) => def(file, `${prefix} ${String(i + 1).padStart(2, '0')}`, startLine + i, kind));

export const SKIP_REASON_TEXT = 'Call Log custom fields are not validated by the backend yet; re-enable once it validates them';

const pass = (): JsonResult => ({ status: 'passed', duration: 4000 });
const fail = (title: string, status = 'failed'): JsonResult => ({
  status,
  duration: 6000,
  error: { message: `Error: "${title}" could not complete: element not found`, stack: `Error: "${title}" could not complete\n    at Page.step (src/modules/x/XPage.ts:10:5)` },
  errors: [{ message: `Error: "${title}" could not complete: element not found\n    at Page.step (src/modules/x/XPage.ts:10:5)` }],
});
const skipped = (): JsonResult => ({ status: 'skipped', duration: 0 });

function mkTest(d: Def): JsonTest {
  const b = { projectName: 'chromium', expectedStatus: 'passed', annotations: [] as { type: string; description?: string }[] };
  switch (d.kind) {
    case 'passed': return { ...b, status: 'expected', results: [pass()] };
    // test.fail(): Playwright reports `expected` although the attempt failed (the Leads RBAC known-bug tests)
    case 'known-bug': return { ...b, status: 'expected', expectedStatus: 'failed', annotations: [{ type: 'fail' }], results: [fail(d.title)] };
    case 'flaky': return { ...b, status: 'flaky', results: [fail(d.title), pass()] };
    case 'failed': return { ...b, status: 'unexpected', results: [fail(d.title), fail(d.title)] };
    case 'timedOut': return { ...b, status: 'unexpected', results: [fail(d.title, 'timedOut'), fail(d.title, 'timedOut')] };
    case 'did-not-run': return { ...b, status: 'skipped', results: [skipped(), skipped()] };
    case 'cut-off': return { ...b, status: 'skipped', results: [{ status: 'interrupted', duration: 50 }] };
    case 'skip-reason': return { ...b, status: 'skipped', expectedStatus: 'skipped', annotations: [{ type: 'skip' }, { type: 'skip-reason', description: SKIP_REASON_TEXT }], results: [skipped()] };
    case 'skip-no-reason': return { ...b, status: 'skipped', expectedStatus: 'skipped', annotations: [{ type: 'skip' }], results: [skipped()] };
  }
}

export function mkReport(defs: Def[], durationMs = 600_000): JsonReport {
  const byFile = new Map<string, Def[]>();
  for (const d of defs) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d]);
  return {
    config: { version: '1.60.0', workers: 4, projects: [{ name: 'chromium' }] },
    stats: { startTime: '2026-11-24T06:00:00.000Z', duration: durationMs },
    startTime: '2026-11-24T06:00:00.000Z',
    suites: [...byFile].map(([file, ds]) => ({
      title: file,
      file,
      specs: ds.map((d) => ({ title: `@regression ${d.title}`, file, line: d.line, ok: d.kind === 'passed' || d.kind === 'flaky' || d.kind === 'known-bug', tests: [mkTest(d)] })),
    })),
  } as JsonReport;
}

/** The account as one capacity reading sees it (defaults: QA after the 2026-11-26 upgrade, Elevate, annual). */
export interface CapacityScenarioAccount {
  plan: string;
  expectedPlan: string;
  recordsUsed: number;
  recordsTotal: number | null;
  customFieldsUsed: number;
  customFieldsTotal: number;
  storageUsedGb: number;
  storageTotalGb: number;
  /** Days from the email's generation time to the renewal (negative = passed). */
  renewalInDays: number | null;
  period: string | null;
  entityCounts: Record<string, number>;
  recordsWarnBelow: number;
}
export const DEFAULT_ACCOUNT: CapacityScenarioAccount = {
  plan: 'Elevate', expectedPlan: 'Elevate', recordsUsed: 78311, recordsTotal: 300000, customFieldsUsed: 96, customFieldsTotal: 125, storageUsedGb: 0.01, storageTotalGb: 1,
  renewalInDays: 176, period: 'ANNUAL', recordsWarnBelow: 10000,
  entityCounts: { LEAD: 15382, DEAL: 12496, CONTACT: 11365, COMPANY: 10026, TASK: 7811, CALL: 7590, QUOTATION: 7498, MEETING: 5582, NOTE: 561 },
};

export interface ScenarioSpec {
  name: string;
  title: string;
  /** What a reader should conclude; printed in the index. */
  expect: string;
  env?: string; // 'staging' | 'qa' | 'prod', or any other name to see the palette's fallback
  branch?: string;
  first: Def[];
  /** The rerun shard exists only on sandbox: false = no manifest at all (kill switch off, or another branch). */
  rerun?: boolean;
  includeFlaky?: boolean;
  maxTests?: number;
  /** What the rerun does to a selected test (default: passes). */
  rerunResult?: (title: string) => 'passed' | 'failed';
  completeness?: { expected: number; reported: number; cause?: string };
  renewalFailure?: RenewalFailure;
  unexpectedErrors?: number;
  /** No results.json at all (a job crashed, the browser install failed): the "report unavailable" message. */
  noResults?: boolean;
  unavailableReason?: string;
  /** Where the email is sent from (default github-actions). */
  runSource?: 'github-actions' | 'jenkins' | 'local';
  /**
   * The run's own start (RunTimes.ts), minutes before the first test: default 6 (github-run); `source` picks GitHub's run start, the
   * first-job fallback or Jenkins; `none` = no source answered.
   */
  runStart?: 'none' | { minutesBeforeTests: number; source?: RunStartSource };
  /** Minutes between the last test and the moment the email is generated (merge, reports, history): default 4. */
  generatedMinutesAfterTests?: number;
  /**
   * Capacity files the shards left (src/modules/billing/capacity.ts), written under reports/<env>/capacity/<shard>/ like the merge job's
   * download. `pre`/`post` are the account at the start and the end of the run; omit `post` for "no post-run reading"; `shards` writes
   * that many pre-run copies (the earliest wins). `error` is a gate error marker instead of a snapshot.
   */
  capacity?: {
    pre?: Partial<CapacityScenarioAccount>;
    post?: Partial<CapacityScenarioAccount> | null;
    shards?: number;
    error?: { message: string; readOnlyRun: boolean };
    readOnlyRun?: boolean;
  };
  /** The modules the run's results contain, written by hand (independent of the parser): used when the files alone do not say, e.g. formFields. */
  expectModules?: Array<{ name: string; type: 'UI' | 'RBAC'; total: number }>;
  /** Give every attempt its own start time, so the tests window comes from the attempts and differs from the stats window. */
  attemptTimes?: boolean;
}

export interface ScenarioResult {
  spec: ScenarioSpec;
  env: string;
  branch: string;
  /** Every style inline: what the invariants parse. */
  html: string;
  /** As sent: repeated inline styles moved into classes of the head <style> block (E7). */
  sent: string;
  subject: string;
  /** Present when a report existed. */
  report: ParsedReport | null;
  ctx: EmailContext | null;
  summary: RerunSummary | null;
  list: RerunList | null;
  record: RunHistoryRecord | null;
  kind: 'email' | 'unavailable';
}

function snapshotFor(env: string, a: CapacityScenarioAccount, capturedAt: string, nowMs: number, readOnly: boolean): CapacitySnapshot {
  const quota = (used: number, total: number | null): { used: number; total: number | null; remaining: number | null } => ({ used, total, remaining: total === null ? null : Math.max(0, total - used) });
  // the per-entity counts always add up to the pool's used count (as the real API's do): scale the defaults, the remainder goes to the first entity
  const entries = Object.entries(a.entityCounts);
  const baseSum = entries.reduce((n, [, v]) => n + v, 0);
  const scaled = entries.map(([k, v]) => [k, baseSum === a.recordsUsed ? v : Math.floor((v * a.recordsUsed) / baseSum)] as const);
  if (baseSum !== a.recordsUsed) scaled[0] = [scaled[0][0], scaled[0][1] + (a.recordsUsed - scaled.reduce((n, [, v]) => n + v, 0))];
  const entityCounts = Object.fromEntries(scaled);
  const records = quota(a.recordsUsed, a.recordsTotal);
  const customFields = quota(a.customFieldsUsed, a.customFieldsTotal);
  const left = records.remaining;
  const warnings: string[] = [];
  if (a.expectedPlan && a.plan !== a.expectedPlan) warnings.push(`PLAN: expected "${a.expectedPlan}", found "${a.plan}" (record limit ${a.recordsTotal?.toLocaleString('en-US')}) on ${env}: the account is not on its expected plan, so limits differ from what the suite was sized for`);
  if (left !== null && left > 0 && left < a.recordsWarnBelow) warnings.push(`RECORDS: only ${left.toLocaleString('en-US')} left of ${a.recordsTotal?.toLocaleString('en-US')} (warn under ${a.recordsWarnBelow.toLocaleString('en-US')}) on ${env}; ${a.recordsUsed.toLocaleString('en-US')} used`);
  if (left === 0 && readOnly) warnings.unshift('RECORDS: none left, but the run only reads (--grep @prodSafe selects only read-only tests), so it continues');
  if (customFields.remaining !== null && customFields.remaining < 10) warnings.push(`CUSTOM FIELDS: only ${customFields.remaining} left of ${a.customFieldsTotal} (warn under 10) on ${env}; this never stops a run`);
  const stop = left === 0;
  return {
    version: 1, env, capturedAt, planName: a.plan, planId: `${a.plan.toLowerCase()}-annual`,
    renewalAt: a.renewalInDays === null ? null : new Date(nowMs + a.renewalInDays * 86_400_000).toISOString(),
    records, customFields, storage: quota(a.storageUsedGb, a.storageTotalGb), entityCounts,
    thresholds: { recordsWarnBelow: a.recordsWarnBelow, customFieldsWarnBelow: 10, expectedPlan: a.expectedPlan },
    level: stop ? 'stop' : warnings.length ? 'warn' : 'ok', warnings,
    ...(readOnly ? { readOnlyRun: true } : {}), billing: { period: a.period, currency: a.period ? 'INR' : null },
  };
}

function writeCapacityFiles(reportsEnv: string, env: string, c: NonNullable<ScenarioSpec['capacity']>, startMs: number): void {
  const dir = path.join(reportsEnv, 'capacity');
  // the email is generated 4 minutes after the last test; the renewal dates are relative to that moment (the tests end ~10 minutes after the start)
  const generatedMs = startMs + 10 * 60_000 + 4 * 60_000;
  if (c.error) {
    fs.mkdirSync(path.join(dir, 'capacity-shard-1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'capacity-shard-1', GATE_ERROR_FILE), JSON.stringify({ version: 1, env, capturedAt: new Date(startMs).toISOString(), message: c.error.message, readOnlyRun: c.error.readOnlyRun }));
  }
  if (!c.pre) return;
  const pre = { ...DEFAULT_ACCOUNT, ...c.pre };
  const shards = c.shards ?? 1;
  for (let i = 0; i < shards; i++) {
    const shardDir = path.join(dir, `capacity-${env}-shard-${i + 1}`);
    fs.mkdirSync(shardDir, { recursive: true });
    // shard i starts i minutes after the first one: the EARLIEST (shard 1) must be the one the email uses
    fs.writeFileSync(path.join(shardDir, PRE_RUN_SNAPSHOT_FILE), JSON.stringify(snapshotFor(env, i === 0 ? pre : { ...pre, recordsUsed: pre.recordsUsed + 1000 * i }, new Date(startMs + i * 60_000).toISOString(), generatedMs, c.readOnlyRun === true)));
    if (c.post) {
      const post = { ...pre, ...c.post };
      fs.writeFileSync(path.join(shardDir, POST_RUN_SNAPSHOT_FILE), JSON.stringify(snapshotFor(env, i === shards - 1 ? post : { ...post, recordsUsed: post.recordsUsed - 500 }, new Date(startMs + 12 * 60_000 + i * 60_000).toISOString(), generatedMs, false)));
    }
  }
}

const SERIAL = (f: string): boolean => f === 'ui/quotations/quotations.spec.ts';
const SELECT_OPTS = { excludePrefixes: ['tests/ui/formFields', 'tests/rbac/formFields'], testDir: 'tests', isSerialFile: SERIAL };

export function runScenario(spec: ScenarioSpec): ScenarioResult {
  const env = spec.env ?? 'staging';
  const branch = spec.branch ?? 'sandbox';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `scenario-${spec.name}-`));
  const reportsEnv = path.join(dir, 'reports', env);
  fs.mkdirSync(reportsEnv, { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports', 'playwright-report'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'docs'), path.join(dir, 'docs'));
  const jsonPath = path.join(dir, 'reports', 'playwright-report', 'results.json');
  const input: NotificationInput = {
    jsonReportPath: jsonPath, env, branch, buildNumber: '100', buildUrl: 'https://example.invalid/run/100', gitCommit: 'abc1234', triggeredBy: 'ci', runSource: 'github-actions',
  };
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    if (spec.completeness) fs.writeFileSync(path.join(reportsEnv, 'shard-completeness.json'), JSON.stringify(spec.completeness));
    if (spec.renewalFailure) fs.writeFileSync(path.join(reportsEnv, 'renew-session-failed.json'), JSON.stringify(spec.renewalFailure));
    if (spec.unexpectedErrors) {
      const errors = Array.from({ length: spec.unexpectedErrors }, (_, i) => ({
        type: 'response-error' as const, message: `HTTP 500 [GET] https://api.example.test/v1/things/${i}`, url: `https://api.example.test/v1/things/${i}`, method: 'GET', statusCode: 500,
        testTitle: `some test ${i % 40}`, testFile: 'ui/x.spec.ts', timestamp: '2026-11-24T06:10:00.000Z',
      }));
      const misc: MiscErrorReport = { capturedAt: '2026-11-24T06:20:00.000Z', totalErrors: errors.length, unexpectedErrors: errors.length, expectedRbacErrors: 0, expectedBackgroundNoiseErrors: 0, byType: { 'response-error': errors.length }, errors };
      fs.writeFileSync(path.join(reportsEnv, 'misc-errors.json'), JSON.stringify(misc));
    }
    const svc = new NotificationService();
    if (spec.capacity) writeCapacityFiles(reportsEnv, env, spec.capacity, Date.parse('2026-11-24T06:00:00.000Z'));
    if (spec.noResults) {
      const msg = svc.buildReportUnavailableMessage(input, new Error(spec.unavailableReason ?? `Report not found: ${jsonPath}`));
      return { spec, env, branch, html: msg.html, sent: msg.html, subject: msg.subject, report: null, ctx: null, summary: null, list: null, record: null, kind: 'unavailable' };
    }
    const first = mkReport(spec.first);
    let combined = first;
    let summary: RerunSummary | null = null;
    let list: RerunList | null = null;
    if (spec.rerun) {
      list = selectRerun(first, { maxTests: spec.maxTests ?? 60, includeFlaky: spec.includeFlaky ?? true, ...SELECT_OPTS }, { retries: 0, runId: '100', runAttempt: 1 });
      const decide = spec.rerunResult ?? ((): 'passed' => 'passed');
      const candidateTitles = new Set(list.candidates.map((c) => c.title));
      const wholeFiles = new Set(list.targets.filter((t) => !/:\d+$/.test(t)).map((t) => t.replace(/^tests\//, '')));
      const rerunDefs: Def[] = spec.first
        .filter((d) => candidateTitles.has(d.title) || wholeFiles.has(d.file))
        .map((d) => ({ ...d, kind: candidateTitles.has(d.title) ? (decide(d.title) === 'passed' ? ('passed' as const) : ('failed' as const)) : ('passed' as const) }));
      const res = combineRerun(first, list.decision === 'run' ? mkReport(rerunDefs, 90_000) : null, list, { runId: '100', runAttempt: 1 });
      combined = res.combined;
      summary = res.summary;
      fs.writeFileSync(path.join(reportsEnv, 'rerun-summary.json'), JSON.stringify(summary));
    }
    if (spec.attemptTimes) {
      // the first attempt starts 45 s after the shard process (globalSetup, login) and the last one ends 30 s before it exits
      const attempts: Array<{ startTime?: string; duration?: number }> = [];
      const walk = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        const o = n as { results?: Array<{ startTime?: string; duration?: number }>; suites?: unknown[]; specs?: unknown[]; tests?: unknown[] };
        attempts.push(...(o.results ?? []));
        for (const c of [...(o.suites ?? []), ...(o.specs ?? []), ...(o.tests ?? [])]) walk(c);
      };
      walk(combined);
      const t0 = Date.parse(combined.stats?.startTime ?? '') + 45_000;
      const span = (combined.stats?.duration ?? 600_000) - 75_000;
      attempts.forEach((a, i) => {
        a.startTime = new Date(t0 + Math.floor((i * span) / Math.max(1, attempts.length))).toISOString();
        a.duration = Math.min(a.duration ?? 0, 5_000);
      });
    }
    fs.writeFileSync(jsonPath, JSON.stringify(combined));
    const report = new ReportParser().parse(jsonPath);
    input.runSource = spec.runSource ?? 'github-actions';
    if (spec.runStart !== 'none' && input.runSource !== 'local') {
      const before = (spec.runStart?.minutesBeforeTests ?? 6) * 60_000;
      input.runStartedAt = { iso: new Date(Date.parse(report.testsStart) - before).toISOString(), source: spec.runStart?.source ?? (input.runSource === 'jenkins' ? 'jenkins-build' : 'github-run') };
    }
    const record = buildCurrentRecord(env, branch, '100', 'github-actions', jsonPath, 'abc1234', false, undefined, undefined);
    const ctx = svc.buildContext(input, report, Date.parse(report.testsEnd) + (spec.generatedMinutesAfterTests ?? 4) * 60_000);
    const tpl = new EmailTemplate();
    // one render, so the footer's "Generated" time is the same in both (the sent email IS the readable one with its styles compacted)
    const readable = tpl.htmlReadable(ctx);
    return { spec, env, branch, html: readable, sent: EmailTemplate.compactStyles(readable), subject: tpl.subject(ctx), report, ctx, summary, list, record, kind: 'email' };
  } finally {
    process.chdir(cwd);
    fs.rmSync(path.join(dir, 'docs'), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
