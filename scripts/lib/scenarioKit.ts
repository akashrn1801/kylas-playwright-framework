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
import { EmailContext, EmailTemplate } from '../../src/notifications/EmailTemplate';
import { NotificationInput, NotificationService } from '../../src/notifications/NotificationService';
import { ParsedReport, ReportParser } from '../../src/notifications/ReportParser';
import { JsonReport, JsonResult, JsonTest, RerunList, combineRerun, selectRerun } from '../../src/notifications/RerunResults';
import { RerunSummary } from '../../src/notifications/RerunSummary';
import { RunHistoryRecord } from '../../src/notifications/RunHistory';
import { buildCurrentRecord } from '../../src/notifications/scripts/syncHistory';

const REPO_ROOT = path.resolve(__dirname, '../..');

export type Kind = 'passed' | 'flaky' | 'failed' | 'timedOut' | 'did-not-run' | 'cut-off' | 'skip-reason' | 'skip-no-reason';
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
      specs: ds.map((d) => ({ title: `@regression ${d.title}`, file, line: d.line, ok: d.kind === 'passed' || d.kind === 'flaky', tests: [mkTest(d)] })),
    })),
  } as JsonReport;
}

export interface ScenarioSpec {
  name: string;
  title: string;
  /** What a reader should conclude; printed in the index. */
  expect: string;
  env?: 'staging' | 'qa' | 'prod';
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
}

export interface ScenarioResult {
  spec: ScenarioSpec;
  env: string;
  branch: string;
  html: string;
  subject: string;
  /** Present when a report existed. */
  report: ParsedReport | null;
  ctx: EmailContext | null;
  summary: RerunSummary | null;
  list: RerunList | null;
  record: RunHistoryRecord | null;
  kind: 'email' | 'unavailable';
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
    if (spec.noResults) {
      const msg = svc.buildReportUnavailableMessage(input, new Error(spec.unavailableReason ?? `Report not found: ${jsonPath}`));
      return { spec, env, branch, html: msg.html, subject: msg.subject, report: null, ctx: null, summary: null, list: null, record: null, kind: 'unavailable' };
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
    fs.writeFileSync(jsonPath, JSON.stringify(combined));
    const report = new ReportParser().parse(jsonPath);
    const record = buildCurrentRecord(env, branch, '100', 'github-actions', jsonPath, 'abc1234', false, undefined, undefined);
    const ctx = svc.buildContext(input, report, Date.parse(report.endTime));
    const tpl = new EmailTemplate();
    return { spec, env, branch, html: tpl.html(ctx), subject: tpl.subject(ctx), report, ctx, summary, list, record, kind: 'email' };
  } finally {
    process.chdir(cwd);
    fs.rmSync(path.join(dir, 'docs'), { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
