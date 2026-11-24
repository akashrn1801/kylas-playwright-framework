/**
 * Build #235 (sandbox, run 45122485029) as an offline fixture, and the replay of its email through the REAL pipeline
 * (2026-11-24): fixture -> Playwright-format first-run and rerun reports -> selectRerun / combineRerun -> ReportParser ->
 * history record and trends -> NotificationService.buildContext -> EmailTemplate. Nothing here sends mail or reads
 * the network; the git calls inside the pipeline find no repository in the temporary working directory.
 *
 * Provenance and what is synthetic: scripts/fixtures/build-235/README.md. The counts are the run's own (943 tests;
 * first run 932 passed / 4 failed / 6 flaky / 1 skipped; the rerun recovered 2 of the 4 failures).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MiscErrorReport } from '../../src/error-collector/ErrorCollector';
import { computeJobStats, GitHubJobEntry } from '../../src/notifications/JobStats';
import { NotificationInput, NotificationService, checkReportFreshness } from '../../src/notifications/NotificationService';
import { EmailContext, EmailTemplate } from '../../src/notifications/EmailTemplate';
import { ParsedReport, ReportParser } from '../../src/notifications/ReportParser';
import { JsonReport, JsonResult, JsonSpec, JsonSuite, JsonTest, RerunList, combineRerun, selectRerun } from '../../src/notifications/RerunResults';
import { RerunSummary } from '../../src/notifications/RerunSummary';
import { RenewalFailure } from '../../src/auth/renewalFailure';
import { RunHistoryRecord, computeHistoryDeltaOutput, parseHistory } from '../../src/notifications/RunHistory';
import { buildCurrentRecord } from '../../src/notifications/scripts/syncHistory';

export const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/build-235');
const REPO_ROOT = path.resolve(__dirname, '../..');

export const BUILD_235 = {
  runId: '45122485029',
  buildNumber: '235',
  env: 'staging',
  branch: 'sandbox',
  commit: 'b22d6112',
  triggeredBy: 'akashrn1801',
  startTime: '2026-11-23T06:14:52.534Z',
  // "Duration 2h 40m 24s" in the email includes the rerun shard's 523,896.9 ms (RerunSummary.durationMs).
  totalDurationMs: 9_624_000,
  rerunDurationMs: 523_896.9140625,
  workers: 22,
  playwrightVersion: '1.60.0',
  generatedAt: '2026-11-23T08:52:10.083Z',
  runUrl: 'https://github.com/akashrn1801/kylas-playwright-framework/actions/runs/45122485029',
  history: { current: 235, tailExcludes: '236' },
} as const;

export const SKIP_REASON_AFTER =
  'Call Log custom fields are not validated by the backend yet (Meeting, Quotation and Task are); re-enable once backend validation exists (docs/known-issues/README.md, 2026-08-03)';

// ── fixture files ──────────────────────────────────────────────────────────────────────────────────────────────
type Kind = 'passed' | 'flaky' | 'recovered' | 'failed' | 'skipped';
export interface NamedTest {
  file: string;
  line: number;
  title: string; // as the email shows it (first tag stripped); the spec title gets "@regression "
  kind: Kind;
  module: string;
  type: 'UI' | 'RBAC';
  durationMs: number;
  error?: { primary: string; snippet: string; stack: string };
  attachments?: string[];
  // set by replayBuild235({ withSkipReason }) only
  skipReason?: string;
}
export interface FixtureModule {
  name: string;
  type: 'UI' | 'RBAC';
  file: string;
  total: number;
}
export interface Build235Fixture {
  modules: FixtureModule[];
  named: NamedTest[];
  misc: MiscErrorReport;
  history: RunHistoryRecord[];
  files: Record<'shard-completeness.json' | 'field-config-reset.json' | 'rerun-summary.original.json', string>;
}

export function loadFixture(): Build235Fixture {
  const read = (n: string): string => fs.readFileSync(path.join(FIXTURE_DIR, n), 'utf8');
  const tests = JSON.parse(read('tests.json')) as { modules: FixtureModule[]; named: NamedTest[] };
  return {
    modules: tests.modules,
    named: tests.named,
    misc: JSON.parse(read('misc-errors.json')) as MiscErrorReport,
    history: parseHistory(read('history-tail.jsonl')),
    files: {
      'shard-completeness.json': read('shard-completeness.json'),
      'field-config-reset.json': read('field-config-reset.json'),
      'rerun-summary.original.json': read('rerun-summary.original.json'),
    },
  };
}

// ── worst case, for the email size check ───────────────────────────────────────────────────────────────────────
/**
 * A bad day on the same suite: 60 tests fail, 80 are flaky (each with the 3 KB error of a real build #235 card), and 790
 * background errors, so a rerun is over its cap. Synthetic, deterministic; used to prove the email stays under Gmail's
 * clipping limit when many things go wrong at once, not only on build #235.
 */
export function buildWorstCaseFixture(): Build235Fixture {
  const fx = loadFixture();
  const cards = fx.named.filter((n) => n.error);
  const keep = fx.named.filter((n) => n.kind === 'passed' || n.kind === 'skipped');
  const byFile = new Map<string, number>(fx.modules.map((m) => [m.file, fx.named.filter((n) => n.file === m.file && (n.kind === 'passed' || n.kind === 'skipped')).length]));
  const added: NamedTest[] = [];
  let line = 2000;
  const add = (kind: 'failed' | 'flaky', n: number): void => {
    for (let i = 0; i < n; i++) {
      const m = fx.modules[(i * 7 + (kind === 'failed' ? 3 : 11)) % fx.modules.length];
      const used = (byFile.get(m.file) ?? 0) + 1;
      if (used > m.total) continue;
      byFile.set(m.file, used);
      const card = cards[(i + (kind === 'failed' ? 0 : 5)) % cards.length];
      line += 10;
      added.push({ file: m.file, line, title: `worst-case ${kind} ${String(i + 1).padStart(2, '0')} in ${m.name} ${m.type}`, kind, module: m.name, type: m.type, durationMs: 90_000, error: card.error, attachments: card.attachments });
    }
  };
  add('failed', 60);
  add('flaky', 80);
  const errors = Array.from({ length: 5 }, (_, k) => fx.misc.errors.map((e) => ({ ...e, url: e.url ? e.url.replace(/(\d+)/, (d) => String(Number(d) + k)) : e.url, timestamp: e.timestamp }))).flat();
  const unexpected = errors.filter((e) => !e.expectedReason).length;
  return {
    ...fx,
    named: [...keep, ...added],
    misc: { ...fx.misc, errors, totalErrors: errors.length, unexpectedErrors: unexpected, expectedRbacErrors: errors.filter((e) => e.expectedReason === 'rbac').length, expectedBackgroundNoiseErrors: errors.filter((e) => e.expectedReason === 'background-noise').length },
  };
}

// ── Playwright-format reports ──────────────────────────────────────────────────────────────────────────────────
const attachmentOf = (rel: string): { name: string; path: string; contentType: string } => {
  const name = rel.endsWith('.zip') ? 'trace' : rel.endsWith('.png') ? 'screenshot' : 'error-context';
  // ReportParser makes attachment paths repo-relative to process.cwd(): an absolute path under the current directory.
  return { name, path: path.join(process.cwd(), rel), contentType: 'application/octet-stream' };
};

function failingResult(t: NamedTest, retry: number, durationMs: number, withAttachments: boolean): JsonResult {
  const e = t.error ?? { primary: 'Error: synthetic failure', snippet: '', stack: '' };
  const plainEnd = e.primary.indexOf('\n at ../');
  const plain = plainEnd > 0 ? e.primary.slice(0, plainEnd) : e.primary;
  const loc = /at \.\.\/([^\s:]+):(\d+)/.exec(e.snippet);
  return {
    status: 'failed',
    duration: durationMs,
    retry,
    error: {
      message: plain,
      stack: e.stack,
      ...(loc ? { location: { file: `/repo/${loc[1]}`, line: Number(loc[2]), column: 13 } } : {}),
      ...(e.snippet ? { snippet: e.snippet } : {}),
    },
    errors: [{ message: e.primary }],
    attachments: withAttachments ? (t.attachments ?? []).map(attachmentOf) : [],
  };
}
const passingResult = (durationMs: number, retry: number): JsonResult => ({ status: 'passed', duration: durationMs, retry, attachments: [] });

function describeTitles(m: FixtureModule, t: NamedTest): string[] {
  if (t.file === 'rbac/reports.rbac.spec.ts') return ['Reports RBAC', 'restricted run-count verification per entity type'];
  if (t.file === 'ui/meetings/meetings.spec.ts') return ['Meetings'];
  return [`${m.name.replace(' — Field Limits', '')} ${m.type === 'RBAC' ? 'RBAC' : ''}`.trim()];
}

type Filler = { title: string; line: number; durationMs: number; kind: 'passed'; tag?: string };

function specOf(t: NamedTest | Filler, firstRun: boolean): JsonSpec {
  const named = t as NamedTest;
  const title = `${(t as Filler).tag ?? '@regression'} ${t.title}`;
  let test: JsonTest;
  switch (t.kind) {
    case 'flaky':
      test = { projectName: 'chromium', status: 'flaky', expectedStatus: 'passed', annotations: [], results: [failingResult(named, 0, 60_000, true), passingResult(t.durationMs, 1)] };
      break;
    case 'recovered':
    case 'failed':
      test = { projectName: 'chromium', status: 'unexpected', expectedStatus: 'passed', annotations: [], results: [failingResult(named, 0, 110_000, true), failingResult(named, 1, t.kind === 'failed' ? t.durationMs : 110_000, true)] };
      break;
    case 'skipped':
      test = { projectName: 'chromium', status: 'skipped', expectedStatus: 'skipped', annotations: [{ type: 'skip' }, ...(named.skipReason ? [{ type: 'skip-reason', description: named.skipReason }] : [])], results: [{ status: 'skipped', duration: 0, retry: 0, attachments: [] }] };
      break;
    default:
      test = { projectName: 'chromium', status: 'expected', expectedStatus: 'passed', annotations: [], results: [passingResult(t.durationMs, 0)] };
  }
  void firstRun;
  return { title, file: '', line: t.line, ok: t.kind === 'passed' || t.kind === 'skipped', tests: [test] };
}

export function buildFirstRunReport(fx: Build235Fixture): JsonReport {
  const suites: JsonSuite[] = [];
  for (const m of fx.modules) {
    const named = fx.named.filter((n) => n.file === m.file);
    const filler = m.total - named.length;
    const specsByDescribe = new Map<string, JsonSpec[]>();
    const add = (t: NamedTest | Filler, describe: string[]): void => {
      const spec = specOf(t, true);
      spec.file = m.file;
      const key = describe.join('\u0000');
      if (!specsByDescribe.has(key)) specsByDescribe.set(key, []);
      specsByDescribe.get(key)!.push(spec);
    };
    for (const n of named) add(n, describeTitles(m, n));
    const base = describeTitles(m, named[0] ?? ({ file: m.file } as NamedTest));
    for (let i = 1; i <= filler; i++) {
      // One @smoke-only test (the real suite has some), so no tag is common to every test and the scope is the module set,
      // as in the run's history records.
      const tag = m.name === 'Dashboard' && m.type === 'UI' && i === 1 ? '@smoke' : undefined;
      add({ title: `${m.name} ${m.type} check ${String(i).padStart(2, '0')}`, line: 1000 + i * 10, durationMs: 10_000, kind: 'passed', ...(tag ? { tag } : {}) }, base);
    }
    const children: JsonSuite[] = [];
    for (const [key, specs] of specsByDescribe) {
      const titles = key.split('\u0000');
      // nested describes: the last title holds the specs, the others wrap it
      let node: JsonSuite = { title: titles[titles.length - 1], file: m.file, specs };
      for (let i = titles.length - 2; i >= 0; i--) node = { title: titles[i], file: m.file, suites: [node] };
      children.push(node);
    }
    suites.push({ title: m.file, file: m.file, suites: children });
  }
  return {
    config: { version: BUILD_235.playwrightVersion, workers: BUILD_235.workers, projects: Array.from({ length: 11 }, () => ({ name: 'chromium' })) },
    suites,
    stats: { startTime: BUILD_235.startTime, duration: BUILD_235.totalDurationMs - BUILD_235.rerunDurationMs },
  } as JsonReport;
}

/** What the rerun shard ran: the 4 first-run failures once more; 2 passed, 2 failed again (as in the real run). */
export function buildRerunReport(fx: Build235Fixture): JsonReport {
  const suites: JsonSuite[] = [];
  for (const t of fx.named.filter((n) => n.kind === 'recovered' || n.kind === 'failed')) {
    const m = fx.modules.find((x) => x.file === t.file)!;
    const result = t.kind === 'recovered' ? passingResult(t.durationMs, 0) : failingResult(t, 0, t.durationMs, true);
    const spec: JsonSpec = {
      title: `@regression ${t.title}`,
      file: t.file,
      line: t.line,
      ok: t.kind === 'recovered',
      tests: [{ projectName: 'chromium', status: t.kind === 'recovered' ? 'expected' : 'unexpected', expectedStatus: 'passed', annotations: [], results: [result] }],
    };
    const titles = describeTitles(m, t);
    let node: JsonSuite = { title: titles[titles.length - 1], file: t.file, specs: [spec] };
    for (let i = titles.length - 2; i >= 0; i--) node = { title: titles[i], file: t.file, suites: [node] };
    suites.push({ title: t.file, file: t.file, suites: [node] });
  }
  return { suites, stats: { duration: BUILD_235.rerunDurationMs } } as JsonReport;
}

// ── jobs (windows to the minute, UTC, from the email's Load Signals table) ─────────────────────────────────────
export function buildJobs(): GitHubJobEntry[] {
  const d = '2026-11-23';
  const job = (name: string, from: string, to?: string): GitHubJobEntry =>
    ({ name, startedAt: `${d}T${from}Z`, ...(to ? { completedAt: `${d}T${to}Z` } : {}) }) as GitHubJobEntry;
  return [
    job('detect target + shard plan', '06:11:20', '06:12:30'),
    job('renew session if under the run window', '06:12:35', '06:13:20'),
    job('playwright-selective (shard 1/5)', '06:13:40', '07:41:10'),
    job('playwright-selective (shard 2/5)', '06:13:40', '07:35:20'),
    job('playwright-selective (shard 3/5)', '06:13:40', '07:44:10'),
    job('playwright-selective (shard 4/5)', '06:13:40', '07:30:30'),
    job('playwright-selective (shard 5/5)', '06:13:40', '06:39:30'),
    job('playwright-rerun (failed+flaky)', '07:44:20', '07:56:10'),
    job('playwright-formFields (contact)', '07:56:20', '08:36:50'),
    job('playwright-formFields (task)', '07:56:20', '08:41:30'),
    job('playwright-formFields (lead)', '07:56:20', '08:45:40'),
    job('playwright-formFields (company)', '07:56:20', '08:46:20'),
    job('playwright-formFields (productsAndServices)', '07:56:20', '08:37:10'),
    job('playwright-formFields (deal)', '07:56:20', '08:46:30'),
    job('reset dedicated form-field limits', '08:46:40', '08:50:50'),
    // merge-and-report itself: still running when the email is built, so it has no end (excluded from the total)
    job('merge report + notify', '08:51:00'),
  ];
}

// ── the replay ─────────────────────────────────────────────────────────────────────────────────────────────────
export interface Replay {
  dir: string;
  first: JsonReport;
  rerun: JsonReport;
  list: RerunList;
  combined: JsonReport;
  summary: RerunSummary;
  report: ParsedReport;
  record: RunHistoryRecord;
  ctx: EmailContext;
  html: string;
  subject: string;
}

export interface ReplayOptions {
  fixture?: Build235Fixture;
  keepDir?: boolean;
  // The skipped test of build #235 had no reason in its report; tests/ui/call-logs/call-logs.spec.ts now carries a
  // `skip-reason` annotation. true = replay with it, as the next run's report would have it.
  withSkipReason?: boolean;
  // Replay a run whose renew-session job failed (2026-11-24): the completeness file says no shard reported (with the job-result
  // cause the workflow writes) and, optionally, renew-session-failed.json is present.
  blockedBySession?: { renewalFailure?: RenewalFailure; cause?: string };
}

export function replayBuild235(opts: ReplayOptions = {}): Replay {
  const fx = opts.fixture ?? loadFixture();
  if (opts.withSkipReason) {
    for (const t of fx.named) if (t.kind === 'skipped') t.skipReason = SKIP_REASON_AFTER;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build235-'));
  const reportsEnv = path.join(dir, 'reports', BUILD_235.env);
  fs.mkdirSync(reportsEnv, { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports', 'playwright-report'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'docs'), path.join(dir, 'docs'));
  const cwd = process.cwd();
  process.chdir(dir); // attachment paths, loadRerunSummary() and the other loaders resolve under the current directory
  try {
    const first = buildFirstRunReport(fx);
    const rerun = buildRerunReport(fx);
    const list = selectRerun(
      first,
      { maxTests: 60, includeFlaky: true, excludePrefixes: ['tests/ui/formFields', 'tests/rbac/formFields'], testDir: 'tests', isSerialFile: () => false },
      { retries: 0, runId: BUILD_235.runId, runAttempt: 1 }
    );
    const { combined, summary } = combineRerun(first, rerun, list, { runId: BUILD_235.runId, runAttempt: 1 });
    const jsonPath = path.join(dir, 'reports', 'playwright-report', 'results.json');
    fs.writeFileSync(jsonPath, JSON.stringify(combined));
    fs.writeFileSync(path.join(reportsEnv, 'rerun-summary.json'), JSON.stringify(summary));
    fs.writeFileSync(path.join(reportsEnv, 'misc-errors.json'), JSON.stringify(fx.misc));
    fs.writeFileSync(
      path.join(reportsEnv, 'shard-completeness.json'),
      opts.blockedBySession ? JSON.stringify({ expected: 11, reported: 0, ...(opts.blockedBySession.cause ? { cause: opts.blockedBySession.cause } : {}) }) : fx.files['shard-completeness.json']
    );
    if (opts.blockedBySession?.renewalFailure) fs.writeFileSync(path.join(reportsEnv, 'renew-session-failed.json'), JSON.stringify(opts.blockedBySession.renewalFailure));
    fs.writeFileSync(path.join(reportsEnv, 'field-config-reset.json'), fx.files['field-config-reset.json']);
    fs.writeFileSync(
      path.join(reportsEnv, 'session-info.json'),
      JSON.stringify([
        { role: 'admin', endIso: '2026-11-23T17:09:49.000Z', minutesLeft: 656, belowRunWindow: false, recordedAt: BUILD_235.startTime },
        { role: 'restricted', endIso: '2026-11-23T17:10:00.000Z', minutesLeft: 656, belowRunWindow: false, recordedAt: BUILD_235.startTime },
      ])
    );
    // History before this run: the fixture tail without build 236 (it ran after) and without 235 itself.
    const before = fx.history.filter((r) => r.buildNumber !== BUILD_235.history.tailExcludes && r.buildNumber !== BUILD_235.buildNumber);
    const record = buildCurrentRecord(BUILD_235.env, BUILD_235.branch, BUILD_235.buildNumber, 'github-actions', jsonPath, BUILD_235.commit, false, BUILD_235.workers, undefined);
    fs.writeFileSync(path.join(reportsEnv, 'history-delta.json'), JSON.stringify(computeHistoryDeltaOutput(before, record)));

    const input: NotificationInput = {
      jsonReportPath: jsonPath,
      env: BUILD_235.env,
      branch: BUILD_235.branch,
      buildNumber: BUILD_235.buildNumber,
      buildUrl: BUILD_235.runUrl,
      gitCommit: BUILD_235.commit,
      triggeredBy: BUILD_235.triggeredBy,
      runSource: 'github-actions',
      jobStats: computeJobStats(buildJobs()),
    };
    const report = new ReportParser().parse(jsonPath);
    const now = Date.parse(BUILD_235.generatedAt);
    const ctx = new NotificationService().buildContext(input, report, now);
    // No git remote in the temporary directory: the two GitHub links come from the run's own repository.
    ctx.knownIssuesUrl = `https://github.com/akashrn1801/kylas-playwright-framework/blob/${BUILD_235.commit}`;
    ctx.historyBranchUrl = 'https://github.com/akashrn1801/kylas-playwright-framework/blob/ci/reporting-history/history/staging.jsonl';
    ctx.reportFreshness = checkReportFreshness(report.endTime, now);
    ctx.nodeVersion = 'v22.23.5';
    ctx.osInfo = 'linux 7.0.0-1017-azure';
    const tpl = new EmailTemplate();
    return { dir, first, rerun, list, combined, summary, report, record, ctx, html: tpl.html(ctx), subject: tpl.subject(ctx) };
  } finally {
    process.chdir(cwd);
    if (!opts.keepDir) {
      // the symlinked docs/ must not be followed by the removal
      fs.rmSync(path.join(dir, 'docs'), { force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
