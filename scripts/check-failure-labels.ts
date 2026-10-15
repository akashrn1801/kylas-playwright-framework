/**
 * Offline regression check for the suspected-cause labels (src/notifications/FailureClassifier.ts + the tracked
 * registry src/notifications/failureSignatures.json). No network, no email, no clock-dependent assertions.
 *
 *   npm run check:failure-labels            # assertions only (exit 1 on any failure)
 *   npm run check:failure-labels -- --table # also print the label table of the replayed sandbox run
 *   npm run check:failure-labels -- --html  # also print the new HTML fragments for three cases
 *   npm run check:failure-labels -- --replay specs.json  # label table for a fixture: [{file,title,status,error,snippet?,misc?[]}]
 *
 * Synthetic data goes through the REAL ReportParser, FailureAnalyzer, FailureDetailBuilder, AutomationHealth and
 * EmailTemplate (the same functions NotificationService calls). No real misc-errors.json is used.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportParser, ParsedReport } from '../src/notifications/ReportParser';
import { clusterFailures, normalizeTestTitle } from '../src/notifications/FailureAnalyzer';
import { enrichClusters, buildFlakyFailureDetails, EnrichmentContext, FailureDetail } from '../src/notifications/FailureDetailBuilder';
import { computeHealthScore, computeOverallVerdict } from '../src/notifications/AutomationHealth';
import { EmailTemplate, EmailContext } from '../src/notifications/EmailTemplate';
import { computeNotificationDedupKey, NotificationInput } from '../src/notifications/NotificationService';
import { assessCauses, summarizeCauses, parseSignatureRegistry, CauseAssessment, CauseSummary, SignatureRegistry } from '../src/notifications/FailureClassifier';
import { readSignatureRegistryStrict } from '../src/notifications/FailureSignatureLoader';
import { MiscError, MiscErrorReport } from '../src/error-collector/ErrorCollector';
import { KnownIssueMatch } from '../src/notifications/KnownIssuesIndex';

interface Spec {
  file: string;
  title: string;
  status: 'failed' | 'flaky';
  error: string;
  snippet?: string;
  misc?: Array<Partial<MiscError>>;
  knownIssue?: KnownIssueMatch;
}

const ROOT = path.resolve(__dirname, '..');
const out = (s: string): void => {
  process.stdout.write(`${s}\n`);
};
let failures = 0;
const check = (ok: boolean, what: string, detail = ''): void => {
  if (!ok) failures += 1;
  out(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `\n      ${detail}` : ''}`);
};

const registry: SignatureRegistry = readSignatureRegistryStrict();

// ── registry hygiene ─────────────────────────────────────────────────────────────────────────────────────────────
function checkRegistry(): void {
  for (const s of registry.signatures) {
    const file = path.join(ROOT, s.kiFile);
    const exists = fs.existsSync(file);
    check(exists, `registry ${s.id}: kiFile exists (${s.kiFile})`);
    if (!exists) continue;
    const doc = fs.readFileSync(file, 'utf-8');
    if (/^KI-\d+$/.test(s.kiRef)) check(doc.includes(s.kiRef), `registry ${s.id}: ${s.kiFile} mentions ${s.kiRef}`);
    if (s.misc?.apiErrorCode) check(doc.includes(s.misc.apiErrorCode), `registry ${s.id}: ${s.kiFile} documents error code ${s.misc.apiErrorCode}`);
    check(/^\d{4}-\d{2}-\d{2}$/.test(s.added), `registry ${s.id}: added is an ISO date`);
  }
  check(
    registry.ambiguousCodes.some((a) => a.code === '01503001') && registry.ambiguousCodes.some((a) => a.code === '029003'),
    'registry lists 01503001 and 029003 as ambiguous codes'
  );
}

// ── synthetic pipeline through the real code ─────────────────────────────────────────────────────────────────────
interface Run {
  report: ParsedReport;
  details: FailureDetail[];
  flaky: FailureDetail[];
  misc: MiscErrorReport;
  ctxFor: (withCauses: boolean) => EmailContext;
  assessed: Map<unknown, CauseAssessment>;
  summary: CauseSummary;
}

function build(specs: Spec[], reg: SignatureRegistry = registry, expectedReason?: MiscError['expectedReason']): Run {
  const jsonSpecs = specs.map((s) => {
    const failing = { status: 'failed', duration: 1000, error: { message: s.error, stack: s.error, snippet: s.snippet }, errors: [{ message: s.error }] };
    const results = s.status === 'flaky' ? [failing, { status: 'passed', duration: 900 }] : [failing, failing];
    return { file: s.file, specs: [{ title: s.title, tests: [{ status: s.status === 'flaky' ? 'flaky' : 'unexpected', results }] }] };
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-labels-'));
  const jsonPath = path.join(dir, 'results.json');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      config: { version: '1.60.0', workers: 1, projects: [{ name: 'chromium' }] },
      stats: { duration: 600000, startTime: '2026-10-15T06:00:00.000Z' },
      startTime: '2026-10-15T06:00:00.000Z',
      suites: [...jsonSpecs, { file: 'tests/ui/other/ok.spec.ts', specs: [{ title: 'a passing test', tests: [{ status: 'expected', results: [{ status: 'passed', duration: 500 }] }] }] }],
    })
  );
  const report = new ReportParser().parse(jsonPath);
  fs.rmSync(dir, { recursive: true, force: true });

  const errors: MiscError[] = [];
  for (const s of specs) {
    for (const m of s.misc ?? []) {
      errors.push({
        type: 'response-error',
        message: `HTTP ${m.statusCode} [${m.method ?? 'POST'}] ${m.url}`,
        method: 'POST',
        timestamp: '2026-10-15T06:01:00.000Z',
        env: 'staging',
        ...m,
        expectedReason: expectedReason ?? m.expectedReason,
        // Stored the way ErrorCollector stores it: testInfo.title with its tags.
        testTitle: `@regression ${s.title}`,
        testFile: s.file,
      } as MiscError);
    }
  }
  const misc: MiscErrorReport = {
    capturedAt: '2026-10-15T06:02:00.000Z',
    totalErrors: errors.length,
    unexpectedErrors: errors.filter((e) => !e.expectedReason).length,
    expectedRbacErrors: errors.filter((e) => e.expectedReason === 'rbac').length,
    expectedBackgroundNoiseErrors: errors.filter((e) => e.expectedReason === 'background-noise').length,
    byType: { 'response-error': errors.length },
    errors,
  };
  const enrichCtx: EnrichmentContext = {
    miscErrors: errors,
    previousRunFailedTitles: [specs[0]?.title ?? ''],
    recurringFailures: [],
    knownIssuesIndex: [],
    runSource: 'github-actions',
    buildUrl: 'https://example.invalid/run/1',
  };
  const used = new Set<string>();
  const clusters = enrichClusters(clusterFailures(report.failedTests, errors), enrichCtx, used);
  const flaky = buildFlakyFailureDetails(report.flakyTests, enrichCtx, used);
  const details = clusters.flatMap((c) => c.details);
  const all = [...details, ...flaky];
  const knownByTitle = new Map(specs.filter((s) => s.knownIssue).map((s) => [s.title, s.knownIssue!]));
  const assessed = assessCauses(
    all.map((d) => ({
      test: d.test,
      related: errors.filter((e) => e.testTitle !== undefined && normalizeTestTitle(e.testTitle) === normalizeTestTitle(d.test.title)),
      knownIssue: knownByTitle.get(d.test.title),
    })),
    reg,
    { previousRunFailedTitles: enrichCtx.previousRunFailedTitles, recurringFailures: [], shardCompleteness: null }
  );
  const summary = summarizeCauses(assessed.values(), reg, null);
  const health = computeHealthScore(report, null, misc, null, [], [], false);
  const verdict = computeOverallVerdict(report, health, null, null);
  const ctxFor = (withCauses: boolean): EmailContext => {
    for (const d of all) {
      if (withCauses) d.cause = assessed.get(d.test);
      else delete d.cause;
    }
    return {
      report, env: 'staging', branch: 'sandbox', buildNumber: '1', buildUrl: 'u', gitCommit: 'abc1234', triggeredBy: 't',
      runSource: 'github-actions', miscErrors: misc, health, verdict, clusters, flakyFailureDetails: flaky,
      causeSummary: withCauses ? summary : undefined,
    } as EmailContext;
  };
  return { report, details, flaky, misc, ctxFor, assessed: assessed as Map<unknown, CauseAssessment>, summary };
}

const labelOf = (run: Run, title: string): CauseAssessment => {
  for (const [t, a] of run.assessed) if ((t as { title: string }).title === title) return a;
  throw new Error(`no assessment for ${title}`);
};

// ── the replay of sandbox run 38690038228 (shapes only) ──────────────────────────────────────────────────────────
const LOOKUP_ERR = (name: string): string =>
  `TimeoutError: locator.waitFor: Timeout 10000ms exceeded.\nCall log:\n  - waiting for locator('.is-invalid__option').filter({ hasText: /^\\s*${name}\\s*$/ }).first() to be visible`;
const NO_OPTIONS = 'Error: No Deal options found in dropdown';
const FIND_SNIPPET = '> 1691 |     const found = await this.retryFindDeal(name);';
const MEETING_ERR = (e: string): string => `Error: Validation errors found in meeting create form:\nError messages: ErrorInvalid ${e} summary response.✕`;
const m422 = (e: string): Array<Partial<MiscError>> => [
  { statusCode: 422, apiErrorCode: '01503001', apiErrorMessage: `Invalid ${e} summary response.`, url: 'https://api.example.invalid/v1/meetings', expectedReason: e === 'contact' || e === 'company' ? 'rbac' : undefined },
];

function replay(): Spec[] {
  const s: Spec[] = [];
  const mods = ['deals', 'companies', 'leads', 'quotations', 'productsAndServices'];
  for (let i = 0; i < 25; i++) {
    const mod = mods[i % mods.length];
    s.push({ file: `tests/rbac/${mod}.rbac.spec.ts`, title: `lookup after create ${i}`, status: i < 20 ? 'failed' : 'flaky', error: LOOKUP_ERR(`Rec ${i}`) });
  }
  const findMods = ['deals', 'companies', 'contacts', 'leads'];
  for (let i = 0; i < 12; i++) {
    s.push({ file: `tests/ui/${findMods[i % 4]}/${findMods[i % 4]}.spec.ts`, title: `find in list ${i}`, status: 'failed', error: 'Error: expect(received).toBeTruthy()\n\nReceived: false', snippet: FIND_SNIPPET });
  }
  const meetEntities = ['contact', 'lead', 'company', 'deal'];
  for (let i = 0; i < 11; i++) {
    const e = meetEntities[i % 4];
    s.push({ file: `tests/ui/meetings/meetings.spec.ts`, title: `meeting from ${e} ${i}`, status: 'failed', error: MEETING_ERR(e), misc: m422(e) });
  }
  for (let i = 0; i < 8; i++) s.push({ file: 'tests/rbac/call-logs.rbac.spec.ts', title: `call log phone dropdown ${i}`, status: 'failed', error: LOOKUP_ERR(`Phone ${i}`).replace(/\.filter\(\{[^}]*\}\)/, '') });
  for (let i = 0; i < 2; i++) s.push({ file: 'tests/ui/call-logs/call-logs.spec.ts', title: `call log deal options ${i}`, status: 'failed', error: NO_OPTIONS });
  for (let i = 0; i < 2; i++) {
    s.push({
      file: 'tests/rbac/call-logs.rbac.spec.ts', title: `call log 403 ${i}`, status: 'failed',
      error: "Error: Validation errors found in call log create form:\nError messages: ErrorUhoh! You don't seem to have the necessary permission",
      misc: [{ statusCode: 403, apiErrorMessage: 'no permission', url: 'https://api.example.invalid/call-logs/' }],
    });
  }
  for (let i = 0; i < 13; i++) s.push({ file: 'tests/ui/call-logs/call-logs.spec.ts', title: `call log flaky ${i}`, status: 'flaky', error: NO_OPTIONS });
  for (let i = 0; i < 2; i++) s.push({ file: 'tests/rbac/reports.rbac.spec.ts', title: `reports count ${i}`, status: 'flaky', error: NO_OPTIONS });
  return s;
}

const HTML_STRIP: RegExp[] = [
  /\s*<tr><td id="section-suspected-environment"[\s\S]*?<\/td><\/tr>/g,
  /\s*<tr><td id="section-failure-causes"[\s\S]*?<\/td><\/tr>/g,
  /<span style="[^"]*margin-left:4px;">[^<]*<\/span>/g,
  /\s*<div style="[^"]*"><strong style="[^"]*">Suspected cause[\s\S]*?<\/div>/g,
];
const normHtml = (h: string): string => HTML_STRIP.reduce((a, r) => a.replace(r, ''), h).replace(/Generated [^<·]*·/g, 'Generated ·').replace(/\s+/g, ' ');
const fragments = (h: string): string[] => {
  const out: string[] = [];
  for (const r of HTML_STRIP) for (const m of h.match(r) ?? []) out.push(m.replace(/\s+/g, ' ').trim());
  return out;
};

function main(): void {
  const wantTable = process.argv.includes('--table');
  const wantHtml = process.argv.includes('--html');
  const tpl = new EmailTemplate();
  checkRegistry();

  // 1. replay of 38690038228
  const run = build(replay());
  const c = run.summary.counts;
  check(run.report.failed === 55 && run.report.flaky === 20, 'replay has 55 failed / 20 flaky', `${run.report.failed}/${run.report.flaky}`);
  check(c['environment-suspected'] === 42, 'replay: 42 failed tests environment-suspected (lookup 20 + find-in-list 12 + call-log 10)', String(c['environment-suspected']));
  check(c.flaky === 20, 'replay: 20 flaky stay flaky', String(c.flaky));
  check(c.unclassified === 13, 'replay: 13 unclassified (11 meeting 01503001 + 2 call-log 403)', String(c.unclassified));
  check(c['application-bug-suspected'] === 0 && c['test-or-code-suspected'] === 0, 'replay: no application or test/code labels');
  check(run.summary.dominant?.signatureId === 'search-lookup-miss' && run.summary.dominant.count === 62 && run.summary.dominant.total === 75,
    'replay: banner signature is search-lookup-miss, 62 of 75', JSON.stringify(run.summary.dominant));
  check(run.summary.dominant?.confirmed === true && !!run.summary.dominant?.askKylasTeam, 'replay: banner carries the confirmed ask-the-Kylas-team text');
  const meeting = labelOf(run, 'meeting from contact 0');
  check(meeting.label === 'unclassified' && meeting.evidence.some((e) => /01503001.*ambiguous/.test(e)), 'replay: a 01503001-only failure is unclassified with the ambiguity noted', JSON.stringify(meeting));

  // 2. computed fields identical with and without causes; html differs only by the new fragments
  const without = run.ctxFor(false);
  const subjectBefore = tpl.subject(without);
  const htmlBefore = tpl.html(without);
  const regBefore = [...run.details, ...run.flaky].map((d) => `${d.test.title}|${d.category}|${d.regressionStatus}`);
  const snapshot = (ctx: EmailContext): string => {
    const input: NotificationInput = { jsonReportPath: 'x', env: 'staging', branch: 'sandbox', buildNumber: '1', buildUrl: 'u', gitCommit: 'abc1234', triggeredBy: 't', runSource: 'github-actions' };
    return JSON.stringify({
      verdict: ctx.verdict, health: ctx.health, counts: [ctx.report.total, ctx.report.passed, ctx.report.failed, ctx.report.flaky, ctx.report.skipped],
      dedup: computeNotificationDedupKey(input, ctx.report), subject: tpl.subject(ctx), unexpected: ctx.miscErrors?.unexpectedErrors,
    });
  };
  const snapBefore = snapshot(without);
  const withC = run.ctxFor(true);
  const htmlAfter = tpl.html(withC);
  check(snapshot(withC) === snapBefore, 'verdict, health, counts, dedup key, subject, unexpectedErrors identical with and without labels');
  check(tpl.subject(withC) === subjectBefore, 'subject line identical');
  check(JSON.stringify([...run.details, ...run.flaky].map((d) => `${d.test.title}|${d.category}|${d.regressionStatus}`)) === JSON.stringify(regBefore), 'category and regression status per failure identical');
  check(normHtml(htmlAfter) === normHtml(htmlBefore), 'email HTML differs only by the banner, summary line, badges and evidence lines');
  check(htmlAfter.includes('Likely environment problem: 62 of 75 failures share the signature “search lookup returned no match for a record” (see KI-43)'), 'banner text names N of M and KI-43');
  check(/Failures by suspected cause \(hints, not verdicts\): 42 environment, 0 application, 0 test\/code, 20 flaky, 13 unclassified\./.test(htmlAfter), 'summary line counts');

  // 3. negative and boundary cases
  const one = build([{ file: 'tests/rbac/deals.rbac.spec.ts', title: 'lone lookup', status: 'failed', error: LOOKUP_ERR('X') }]);
  check(labelOf(one, 'lone lookup').label === 'unclassified' && labelOf(one, 'lone lookup').evidence.some((e) => /only 1 test/.test(e)), 'a single failing lookup test is unclassified', JSON.stringify(labelOf(one, 'lone lookup')));
  check(one.summary.dominant === undefined, 'no banner for a single failure');

  const mk = (n: number, mods: string[]): Spec[] =>
    Array.from({ length: n }, (_, i) => ({ file: `tests/rbac/${mods[i % mods.length]}.rbac.spec.ts`, title: `lk ${i}`, status: 'failed' as const, error: LOOKUP_ERR(`R${i}`) }));
  check(build(mk(7, ['deals', 'leads'])).summary.counts['environment-suspected'] === 0, '7 lookup misses in 2 modules (below N=8): none labelled');
  check(build(mk(8, ['deals', 'leads'])).summary.counts['environment-suspected'] === 8, '8 lookup misses in 2 modules: all environment-suspected');
  check(build(mk(12, ['deals'])).summary.counts['environment-suspected'] === 0, '12 lookup misses in ONE module: none labelled (needs 2 modules)');

  const loc = build([{ file: 'tests/ui/deals/deals.spec.ts', title: 'locator only', status: 'failed', error: "Error: strict mode violation: getByRole('button') resolved to 2 elements" }]);
  check(labelOf(loc, 'locator only').label === 'test-or-code-suspected', 'locator failure, no network error, no signature: test-or-code-suspected');
  const locNet = build([{ file: 'tests/ui/deals/deals.spec.ts', title: 'locator plus 422', status: 'failed', error: "Error: strict mode violation: getByRole('button') resolved to 2 elements", misc: [{ statusCode: 422, apiErrorCode: '01503001', url: 'https://api.example.invalid/v1/meetings' }] }]);
  check(labelOf(locNet, 'locator plus 422').label === 'unclassified', 'locator failure WITH a captured HTTP error: unclassified');
  const plain = build([{ file: 'tests/ui/deals/deals.spec.ts', title: 'odd timeout', status: 'failed', error: 'TimeoutError: page.goto: Timeout 30000ms exceeded.' }]);
  check(labelOf(plain, 'odd timeout').label === 'unclassified', 'a plain timeout with no signature: unclassified');

  const rep500 = (code: string): Spec => ({ file: 'tests/ui/reports/reports.spec.ts', title: `report ${code}`, status: 'failed', error: 'Error: report not saved', misc: [{ statusCode: 500, apiErrorCode: code, url: 'https://api.example.invalid/v3/reports' }] });
  check(labelOf(build([rep500('01403004')]), 'report 01403004').label === 'application-bug-suspected', 'HTTP 500 01403004 on POST /v3/reports: application-bug-suspected');
  check(labelOf(build([rep500('09999999')]), 'report 09999999').label === 'unclassified', 'HTTP 500 with an unknown code: unclassified');

  const gw = (n: number): Spec[] => Array.from({ length: n }, (_, i) => ({ file: `tests/ui/${['deals', 'leads', 'tasks'][i % 3]}/x.spec.ts`, title: `gw ${i}`, status: 'failed' as const, error: 'Error: Request failed', misc: [{ statusCode: 502, url: 'https://api.example.invalid/v1/leads' }] }));
  check(build(gw(4)).summary.counts['environment-suspected'] === 4, '502s across modules: environment-suspected');
  check(build(gw(1)).summary.counts['environment-suspected'] === 0, 'one stray 502: unclassified');
  check(labelOf(build([{ file: 'tests/ui/deals/x.spec.ts', title: 'refused', status: 'failed', error: 'Error: connect ECONNREFUSED 127.0.0.1:443' }]), 'refused').label === 'environment-suspected', 'ECONNREFUSED alone: environment-suspected');

  const js = (n: number, ki?: KnownIssueMatch): Spec[] => Array.from({ length: n }, (_, i) => ({ file: 'tests/ui/meetings/m.spec.ts', title: `js ${i}`, status: 'failed' as const, error: "TypeError: Cannot read properties of undefined (reading 'x')", knownIssue: ki }));
  check(build(js(1)).summary.counts['application-bug-suspected'] === 0, 'one JS crash, no known-issue match: unclassified');
  check(build(js(1, { file: 'docs/known-issues/locators-and-timing.md', line: 1, matchedPhrase: 'x', kind: 'quoted-substring' })).summary.counts['application-bug-suspected'] === 1, 'one JS crash WITH a known-issue match: application-bug-suspected');
  check(build(js(2)).summary.counts['application-bug-suspected'] === 2, 'the same JS crash in 2 tests: application-bug-suspected');

  const dominatedWithLocator = build([
    ...mk(10, ['deals', 'leads']),
    { file: 'tests/ui/deals/deals.spec.ts', title: 'locator in a bad run', status: 'failed', error: "Error: strict mode violation: getByRole('button') resolved to 2 elements" },
  ]);
  check(labelOf(dominatedWithLocator, 'locator in a bad run').label === 'unclassified' && labelOf(dominatedWithLocator, 'locator in a bad run').evidence[0].startsWith('not labelled test/code'),
    'in a run dominated by an environment signature a locator miss is NOT labelled test/code');

  // 4. expectedReason must never change a label
  const base = build(replay());
  for (const reason of ['rbac', 'background-noise', undefined] as const) {
    const r = build(replay(), registry, reason);
    const same = JSON.stringify([...base.assessed.values()].map((a) => a.label)) === JSON.stringify([...r.assessed.values()].map((a) => a.label));
    check(same, `expectedReason=${String(reason)} on every misc error changes no label`);
  }

  // 5. flaky is always flaky; a bad registry fails loudly; empty registry leaves everything unclassified
  check(c.flaky === 20 && [...run.assessed.values()].filter((a) => a.label === 'flaky' && a.signatureId === 'search-lookup-miss').length === 20, 'flaky tests keep the flaky label and still count toward the signature');
  const throws = (reg: unknown): boolean => {
    try { parseSignatureRegistry(reg); return false; } catch { return true; }
  };
  const good = registry.signatures[0];
  check(throws({ version: 1, ambiguousCodes: [], signatures: [{ ...good, errorPatterns: ['('] }] }), 'a registry entry with an invalid pattern is rejected');
  check(throws({ version: 1, ambiguousCodes: [], signatures: [{ ...good, label: 'flaky' }] }), 'a registry entry cannot carry the flaky/test-or-code label');
  check(throws({ version: 1, ambiguousCodes: [], signatures: [{ ...good, minTests: 0 }] }), 'a registry entry needs minTests >= 1');
  check(throws({ version: 1, ambiguousCodes: [], signatures: [good, good] }), 'duplicate registry ids are rejected');
  const emptyRun = build(replay(), { version: 1, ambiguousCodes: [], signatures: [] });
  check(emptyRun.summary.counts.unclassified + emptyRun.summary.counts['test-or-code-suspected'] === 55 && emptyRun.summary.dominant === undefined, 'empty registry: no environment/application label and no banner');

  // 6. output
  if (wantTable) {
    out('\nLabel table (replay of 38690038228 shapes)');
    const rows = new Map<string, number>();
    for (const [t, a] of run.assessed) {
      const test = t as { title: string; status: string };
      const key = `${test.title.replace(/ \d+$/, '')} | ${test.status} | ${a.label}${a.signatureId ? ` (${a.signatureId})` : ''}`;
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    for (const [k, n] of [...rows].sort()) out(`  ${String(n).padStart(3)}  ${k}`);
    out('\nCluster header category vs per-test label (the header is unchanged; shown to expose disagreements)');
    const catByTest = new Map<unknown, string>([...run.details, ...run.flaky].map((d) => [d.test, d.category]));
    const pairs = new Map<string, number>();
    for (const [t, a] of run.assessed) {
      const k = `header category ${catByTest.get(t)} | label ${a.label}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    for (const [k, n] of [...pairs].sort()) out(`  ${String(n).padStart(3)}  ${k}`);
  }
  if (wantHtml) {
    const cases: Array<[string, Spec[]]> = [
      ['NO FAILURES', []],
      ['MIXED', [
        { file: 'tests/ui/deals/deals.spec.ts', title: 'locator only', status: 'failed', error: "Error: strict mode violation: getByRole('button') resolved to 2 elements" },
        rep500('01403004'),
        { file: 'tests/ui/meetings/m.spec.ts', title: 'meeting from lead', status: 'failed', error: MEETING_ERR('lead'), misc: m422('lead') },
        { file: 'tests/ui/tasks/t.spec.ts', title: 'flaky one', status: 'flaky', error: 'Error: widget not saved' },
      ]],
      ['ENVIRONMENT-DOMINATED', replay()],
    ];
    for (const [name, specs] of cases) {
      const r = build(specs);
      const noCause = tpl.html(r.ctxFor(false));
      const withCause = tpl.html(r.ctxFor(true));
      out(`\n=== ${name}: ${normHtml(withCause) === normHtml(noCause) ? 'identical apart from new fragments' : 'DIFFERS'}; new fragments:`);
      const frags = fragments(withCause);
      if (frags.length === 0) out('  (none)');
      for (const f of frags.slice(0, name === 'ENVIRONMENT-DOMINATED' ? 6 : 12)) out(`  ${f.slice(0, 900)}`);
      if (frags.length > 6 && name === 'ENVIRONMENT-DOMINATED') out(`  … ${frags.length - 6} more (one badge and one evidence block per failure)`);
    }
  }

  const replayIdx = process.argv.indexOf('--replay');
  if (replayIdx > 0) {
    const specs = JSON.parse(fs.readFileSync(process.argv[replayIdx + 1], 'utf-8')) as Spec[];
    const r = build(specs);
    const tplR = new EmailTemplate();
    const snap = (withC: boolean): string => {
      const ctx = r.ctxFor(withC);
      const input: NotificationInput = { jsonReportPath: 'x', env: 'staging', branch: 'sandbox', buildNumber: '1', buildUrl: 'u', gitCommit: 'abc1234', triggeredBy: 't', runSource: 'github-actions' };
      return JSON.stringify({ verdict: ctx.verdict, health: ctx.health, counts: [ctx.report.total, ctx.report.passed, ctx.report.failed, ctx.report.flaky], dedup: computeNotificationDedupKey(input, ctx.report), subject: tplR.subject(ctx), unexpected: ctx.miscErrors?.unexpectedErrors });
    };
    const before = snap(false);
    const after = snap(true);
    out(`\nreplay computed fields (verdict, health, counts, dedup key, subject, unexpectedErrors) before/after: ${before === after ? 'IDENTICAL' : 'DIFFERENT'}`);
    out(`  ${tplR.subject(r.ctxFor(true))}`);
    const rows = new Map<string, number>();
    for (const [t, a] of r.assessed) {
      const test = t as { title: string; status: string };
      const key = `${test.status} | ${a.label}${a.signatureId ? ` (${a.signatureId})` : ''}`;
      rows.set(key, (rows.get(key) ?? 0) + 1);
    }
    out(`\nReplay of ${process.argv[replayIdx + 1]}: ${r.report.failed} failed / ${r.report.flaky} flaky`);
    for (const [k, n] of [...rows].sort()) out(`  ${String(n).padStart(3)}  ${k}`);
    out(`  banner: ${r.summary.dominant ? `${r.summary.dominant.count} of ${r.summary.dominant.total} share ${r.summary.dominant.title}` : 'none'}`);
    const unc = new Map<string, number>();
    for (const a of r.assessed.values()) if (a.label === 'unclassified') unc.set(a.evidence[0].slice(0, 110), (unc.get(a.evidence[0].slice(0, 110)) ?? 0) + 1);
    for (const [t, a] of r.assessed) {
      const x = t as { title: string; file: string };
      if (a.label === 'test-or-code-suspected' || (a.label === 'unclassified' && /timeout/.test(a.evidence[0]))) {
        out(`  ${a.label}: ${path.basename(x.file)} — ${x.title.trim().slice(0, 90)} [${a.evidence[0].slice(0, 60)}]`);
      }
    }
    out('  unclassified, first evidence line:');
    for (const [k, n] of [...unc].sort()) out(`    ${String(n).padStart(3)}  ${k}`);
  }

  out(failures === 0 ? '\ncheck:failure-labels — all checks passed' : `\ncheck:failure-labels — ${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
