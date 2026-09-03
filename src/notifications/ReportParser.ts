import * as fs from 'fs';
import * as path from 'path';

// WHY: Confirmed live (2026-07-14, isolated no-login test run against a
// throwaway config) — Playwright's JSON reporter does NOT strip terminal
// ANSI color escape codes from error.message/error.stack (e.g. the raw
// "[2mexpect([22m..." sequences a terminal renders as dim/colored
// text). Left in, these render as garbage characters in an HTML email and can
// break exact-string clustering in FailureAnalyzer (two failures with the
// same real message would only match if both retain identical escape codes,
// which isn't guaranteed). Strip once, here, before anything downstream sees
// the text — not a cosmetic-only concern.
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

// WHY extracted as its own exported function (2026-09-03): this was
// previously inlined directly inside parse()'s moduleMap-building loop —
// the ONLY place a test's module name/type ever got derived. The new
// skipped-tests email section (EmailTemplate.ts's buildSkippedTestsSection())
// needs the identical derivation to label each skipped test the same way
// Module Analytics already labels every other test — reusing this function
// keeps both in agreement by construction instead of risking two
// independently-maintained copies of the same regex drifting apart.
export function deriveModuleFromFile(file: string): { name: string; type: 'UI' | 'RBAC' | 'Other' } {
  const fp = file || '';
  const type: 'UI' | 'RBAC' | 'Other' = fp.includes('rbac') ? 'RBAC' : fp.includes('ui') ? 'UI' : 'Other';
  const match = fp.match(/(?:tests\/)?(ui|rbac)\/([^/]+)/);
  const rawName = match ? match[2].replace(/\.(rbac\.)?spec\.ts$/, '') : 'other';
  const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
  return { name, type };
}

export interface ErrorLocation {
  file: string;
  line: number;
  column: number;
}

export interface TestResult {
  title: string;
  status: 'passed' | 'failed' | 'skipped' | 'flaky';
  duration: number;
  // WHY: full, untruncated, ANSI-stripped error message. Truncation for
  // display now happens at render time in EmailTemplate, not here — an
  // earlier version truncated to 300 chars at parse time, which is fine for
  // display but throws away exactly the detail FailureAnalyzer needs to tell
  // two genuinely different failures apart when their first 300 chars match
  // (e.g. two "toBeVisible" timeouts on different locators past char 300).
  error?: string;
  // WHY: Confirmed live in the same schema check — Playwright's raw JSON
  // includes error.stack and error.location (file/line/column) alongside
  // error.message; ReportParser previously discarded both. FailureAnalyzer
  // uses these for same-stack-location clustering, a real signal distinct
  // from message-text matching.
  errorStack?: string;
  errorLocation?: ErrorLocation;
  retries: number;
  file: string;
  // WHY: repo-relative path to the failure's trace.zip, e.g.
  // "test-results/qa/rbac-deals.rbac-.../trace.zip" — sourced from Playwright's
  // own JSON report attachments array (already absolute paths on disk), not
  // reconstructed from the test title. A relative path is what actually matches
  // what a reader finds after downloading/extracting the CI artifact zip; an
  // absolute path from the CI runner's filesystem would be meaningless to them.
  // Undefined when no trace was captured (e.g. a test that failed before any
  // browser context existed) — callers must handle that, not assume presence.
  tracePath?: string;
  // WHY added 2026-08-24: confirmed live against a real failed test's raw JSON
  // (prod run, 2026-07-31) that Playwright generates a ready-made, ANSI-colored
  // code-context block around the failing line (a few lines either side, with a
  // `^` pointer at the exact column) as error.snippet — this was never captured
  // before. ANSI-stripped the same way error.message/stack already are.
  errorSnippet?: string;
  // WHY added 2026-08-24: confirmed live that results[].errors[] (PLURAL, an
  // array) can contain a more specific, more useful message than
  // results[].error (singular — the FIRST entry) — a real example (a flaky
  // quotations test) had error.message = the generic "Test timeout of
  // 480000ms exceeded," while errors[1].message was the actual, specific,
  // actionable cause thrown by application code moments before the timeout.
  // error/errorStack/errorLocation above are deliberately left untouched
  // (still sourced from lastResult only) to avoid changing any existing
  // consumer's behavior (FailureAnalyzer's classification/clustering) — this
  // is a new, additive field for FailureDetailBuilder to read the full
  // sequence from, never a replacement of the existing ones.
  allErrors: string[];
  // WHY added 2026-08-24: confirmed live that Playwright attaches 1+
  // screenshots (sometimes several per failing attempt) beyond the trace —
  // never read before this. Sourced from the same traceSourceResult used for
  // tracePath (the failing attempt for a flaky test, not the passing retry).
  screenshotPaths: string[];
  // WHY added 2026-08-24: confirmed live that Playwright attaches a text/YAML
  // accessibility-tree snapshot of page state at the moment of failure
  // (attachment name "error-context") — a genuinely different, often more
  // useful artifact than a screenshot for a locator/timeout failure. Never
  // read before this.
  errorContextPath?: string;
  // WHY added 2026-09-03 — confirmed live against two real skipped tests
  // (one conditional `test.skip(condition, reason)`, one unconditional
  // `test.skip('title', fn)`) that Playwright's raw JSON already carries the
  // real reason string via test.annotations[] (type 'skip'), never read
  // before this. Only ever populated for status === 'skipped'; undefined
  // for every other status, and undefined (not a fabricated placeholder)
  // when a skip genuinely has no reason — confirmed live that an
  // unconditional test.skip('title', fn) produces an annotation with no
  // `description` field at all, unlike the conditional form.
  skipReason?: string;
}

export interface ModuleStats {
  name: string;
  type: 'UI' | 'RBAC' | 'Other';
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  // WHY: previously always 0 (see syncHistory.ts's old WHY comment) — "Report
  // Parser doesn't track per-module duration today." Fixed here by summing
  // each result's own duration into its module bucket, which was already
  // computed per-test and simply never accumulated. Needed for per-module
  // health/trend and for the Module Analytics "time" column on the target
  // feature list.
  duration: number;
}

export interface ParsedReport {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  duration: number;
  startTime: string;
  endTime: string;
  status: 'passed' | 'failed' | 'unstable';
  failedTests: TestResult[];
  flakyTests: TestResult[];
  // WHY added 2026-09-03: the count was always derived (`skipped` above),
  // but the underlying filtered TestResult[] — same shape already kept for
  // failedTests/flakyTests — was computed just to be counted, then
  // discarded. Without this, the email could say "2 Skipped" with no way
  // for a reader to tell whether that's an expected, documented skip or
  // something worth investigating.
  skippedTests: TestResult[];
  passRate: number;
  modules: ModuleStats[];
  slowestTests: TestResult[];
  // WHY: top-20, not top-5 — feeds RunHistory's per-test slow-test-regression
  // tracking (needs more depth than the email's own top-5 display), computed
  // from the same sort as slowestTests so the work isn't done twice.
  slowestTestsTop20: TestResult[];
  uiCount: number;
  rbacCount: number;
  totalRetries: number;
  // WHY: sourced from Playwright's own raw.config — real, not guessed. Feeds
  // the new Environment Info block (browsers actually exercised, worker
  // count Playwright itself resolved, and the Playwright version that
  // produced this exact report — useful when an old report's shape doesn't
  // match current code).
  playwrightVersion?: string;
  workers?: number;
  projects: string[];
}

// WHY: Playwright exports types for its live Reporter API (@playwright/test/reporter's
// Suite/TestCase/TestResult), but NOT for the on-disk JSON reporter file format this
// class actually parses — that's a separate serialization with its own shape. These
// interfaces capture exactly the fields this file reads (confirmed against real report
// output), so `any` isn't needed to walk the tree.
interface PlaywrightJsonProject {
  name?: string;
}

interface PlaywrightJsonReportConfig {
  projects?: PlaywrightJsonProject[];
  version?: string;
  workers?: number;
}

interface PlaywrightJsonReportStats {
  duration?: number;
  startTime?: string;
}

interface PlaywrightJsonErrorLocation {
  file: string;
  line: number;
  column: number;
}

interface PlaywrightJsonError {
  message?: string;
  value?: string;
  stack?: string;
  location?: PlaywrightJsonErrorLocation;
  // WHY added 2026-08-24: see TestResult.errorSnippet's WHY comment — this is
  // real, confirmed-present raw JSON shape, not a guess.
  snippet?: string;
}

interface PlaywrightJsonAttachment {
  name: string;
  path?: string;
}

interface PlaywrightJsonTestResult {
  status?: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration?: number;
  error?: PlaywrightJsonError;
  // WHY added 2026-08-24: see TestResult.allErrors's WHY comment — this is a
  // real, separate array sibling to the singular `error` field above,
  // confirmed present in real raw JSON output.
  errors?: PlaywrightJsonError[];
  attachments?: PlaywrightJsonAttachment[];
}

interface PlaywrightJsonAnnotation {
  type: string;
  description?: string;
}

interface PlaywrightJsonTest {
  // WHY: required, not optional — Playwright's JSON reporter always emits a status
  // for every test entry; the pre-existing call site (mapStatus below) never
  // defensively handled an absent value, confirming this was always assumed present.
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  results?: PlaywrightJsonTestResult[];
  // WHY added 2026-09-03: see TestResult.skipReason's own WHY comment —
  // confirmed live present at this (test) level, not just per-result.
  annotations?: PlaywrightJsonAnnotation[];
}

interface PlaywrightJsonSpec {
  title: string;
  tests?: PlaywrightJsonTest[];
}

interface PlaywrightJsonSuite {
  file?: string;
  specs?: PlaywrightJsonSpec[];
  suites?: PlaywrightJsonSuite[];
}

interface PlaywrightJsonReport {
  config?: PlaywrightJsonReportConfig;
  stats?: PlaywrightJsonReportStats;
  startTime?: string;
  suites?: PlaywrightJsonSuite[];
}

export class ReportParser {
  parse(jsonReportPath: string): ParsedReport {
    if (!fs.existsSync(jsonReportPath)) {
      throw new Error(`Report not found: ${jsonReportPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(jsonReportPath, 'utf-8')) as PlaywrightJsonReport;
    const results = this.extractResults(raw);
    const total = results.length;
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const flaky = results.filter((r) => r.status === 'flaky').length;
    // WHY: Confirmed live (2026-07-07 sandbox Build, commit c82d9d2) — summing
    // every test's own duration double-counts time whenever workers run tests
    // concurrently (each overlapping test's time gets added, not overlapped).
    // raw.stats.duration is Playwright's own measured wall-clock duration —
    // verified against a live run: matched Playwright's own "Total time"
    // output to within a second, while the summed value was ~2x too high
    // (reported email showed 4h35m for a run that actually took 2h31m).
    const duration = raw.stats?.duration ?? results.reduce((sum, r) => sum + r.duration, 0);
    const failedTests = results.filter((r) => r.status === 'failed');
    const flakyTests = results.filter((r) => r.status === 'flaky');
    const skippedTests = results.filter((r) => r.status === 'skipped');
    const status: ParsedReport['status'] =
      failed > 0 ? 'failed' : flaky > 0 ? 'unstable' : 'passed';
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    // WHY: Confirmed live (same incident) — raw.startTime does not exist at
    // the top level of Playwright's JSON report, only raw.stats.startTime.
    // The old fallback to "now" silently produced the run's real END time
    // labeled as "start" (confirmed: matched exactly, to the second, against
    // a real run's reported email times — "start" was actually the real end,
    // and "end" was that mislabeled time plus the inflated summed duration).
    const startTime = raw.stats?.startTime || raw.startTime || new Date().toISOString();
    const endTime = new Date(new Date(startTime).getTime() + duration).toISOString();
    const moduleMap = new Map<string, ModuleStats>();
    for (const r of results) {
      const { name, type } = deriveModuleFromFile(r.file);
      const key = `${type}:${name}`;
      if (!moduleMap.has(key))
        moduleMap.set(key, {
          name,
          type,
          total: 0,
          passed: 0,
          failed: 0,
          flaky: 0,
          skipped: 0,
          duration: 0,
        });
      const mod = moduleMap.get(key)!;
      mod.total++;
      mod.duration += r.duration;
      if (r.status === 'passed') mod.passed++;
      if (r.status === 'failed') mod.failed++;
      if (r.status === 'flaky') mod.flaky++;
      if (r.status === 'skipped') mod.skipped++;
    }
    const modules = Array.from(moduleMap.values()).sort(
      (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)
    );
    const sortedByDuration = [...results].sort((a, b) => b.duration - a.duration);
    const slowestTests = sortedByDuration.slice(0, 5);
    const slowestTestsTop20 = sortedByDuration.slice(0, 20);
    const uiCount = results.filter((r) => r.file?.includes('ui')).length;
    const rbacCount = results.filter((r) => r.file?.includes('rbac')).length;
    const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);
    const projects: string[] = Array.isArray(raw.config?.projects)
      ? raw.config.projects.map((p) => p.name).filter((name): name is string => Boolean(name))
      : [];
    return {
      total,
      passed,
      failed,
      skipped,
      flaky,
      duration,
      startTime,
      endTime,
      status,
      failedTests,
      flakyTests,
      skippedTests,
      passRate,
      modules,
      slowestTests,
      slowestTestsTop20,
      uiCount,
      rbacCount,
      totalRetries,
      playwrightVersion: raw.config?.version,
      workers: raw.config?.workers,
      projects,
    };
  }

  private extractResults(raw: PlaywrightJsonReport): TestResult[] {
    const results: TestResult[] = [];
    const walkSuite = (suite: PlaywrightJsonSuite, file = '') => {
      const currentFile = suite.file || file;
      if (suite.specs) {
        for (const spec of suite.specs) {
          for (const test of spec.tests || []) {
            const allResults = test.results || [];
            const retries = allResults.length - 1;
            const lastResult = allResults[allResults.length - 1];
            // WHY: Derive status from the overall test outcome and last result:
            // - Playwright sets test.status = 'flaky' when it passed on retry
            // - Playwright sets test.status = 'unexpected' when it failed on all attempts
            // - Playwright sets test.status = 'expected' when it passed first time
            // - Using retries > 0 alone is wrong: a test that fails twice has retries=1
            //   but should be 'failed', not 'flaky'
            const status = this.mapStatus(test.status, lastResult?.status);
            // WHY: Confirmed live (2026-07-07 sandbox Build, commit c82d9d2) —
            // for a flaky test, lastResult is the PASSING retry, which has no
            // trace attachment (trace: 'retain-on-failure' only keeps traces
            // for failed attempts). That made trace links silently absent for
            // exactly the tests where they're most valuable — debugging why
            // something flaked, not just confirming a permanent failure.
            // Verified against real data: all 4 flaky tests in that run had a
            // trace on their failing attempt(s), none on the passing one.
            const traceSourceResult =
              status === 'flaky'
                ? [...allResults].reverse().find((r) => r.status !== 'passed')
                : lastResult;
            // WHY error/errorStack/errorLocation source from traceSourceResult,
            // NOT lastResult (changed 2026-08-24 — a real bug caught during
            // this redesign's own verification against real flaky-test data,
            // not theoretical): these three used to come from lastResult only,
            // which for a flaky test is the PASSING retry — meaning they were
            // always empty/undefined for every flaky test, exactly the same
            // "wrong attempt" mistake trace capture already had and was fixed
            // for above. Confirmed safe for existing consumers: FailureAnalyzer's
            // classifyFailure()/clusterFailures() only ever runs on
            // report.failedTests (hard failures, where traceSourceResult ===
            // lastResult already — zero behavior change there); the only
            // behavior change is exactly the intended one, giving flaky tests'
            // OWN failing-attempt detail for the first time.
            const rawMessage = traceSourceResult?.error?.message || traceSourceResult?.error?.value || undefined;
            const error = rawMessage ? stripAnsi(rawMessage) : undefined;
            const rawStack = traceSourceResult?.error?.stack;
            const errorStack = rawStack ? stripAnsi(rawStack) : undefined;
            const loc = traceSourceResult?.error?.location;
            const errorLocation: ErrorLocation | undefined = loc
              ? { file: loc.file, line: loc.line, column: loc.column }
              : undefined;
            const rawSnippet = traceSourceResult?.error?.snippet;
            const errorSnippet = rawSnippet ? stripAnsi(rawSnippet) : undefined;
            const allErrors = (traceSourceResult?.errors ?? [])
              .map((e) => e.message || e.value)
              .filter((m): m is string => Boolean(m))
              .map(stripAnsi);
            const skipReason =
              status === 'skipped'
                ? test.annotations?.find((a) => a.type === 'skip')?.description
                : undefined;
            results.push({
              title: spec.title.replace(/^@\w+\s*/g, ''),
              status,
              duration: lastResult?.duration || 0,
              error,
              errorStack,
              errorLocation,
              errorSnippet,
              allErrors,
              retries,
              file: currentFile,
              tracePath: this.extractAttachmentPaths(traceSourceResult, 'trace')[0],
              screenshotPaths: this.extractAttachmentPaths(traceSourceResult, 'screenshot'),
              errorContextPath: this.extractAttachmentPaths(traceSourceResult, 'error-context')[0],
              skipReason,
            });
          }
        }
      }
      for (const child of suite.suites || []) walkSuite(child, currentFile);
    };
    for (const suite of raw.suites || []) walkSuite(suite);
    return results;
  }

  // WHY: Confirmed live (2026-07-07 reporting overhaul, P3) — Playwright's own
  // JSON reporter already embeds each result's real attachment paths (absolute,
  // as written on the CI runner's disk). Convert to repo-relative so the path
  // shown in a report/email still means something after the CI runner is gone —
  // it should match what a reader finds inside the downloaded/extracted
  // test-results artifact zip, not a path that only ever existed on a machine
  // nobody can access anymore.
  // WHY generalized 2026-08-24 (was extractTracePath, trace-only): screenshot
  // and error-context attachments need the exact same absolute-to-repo-
  // relative conversion as trace did — one shared implementation instead of
  // three near-identical copies. Returns an array (not a single path) since a
  // failing attempt can carry more than one screenshot (confirmed live);
  // callers needing a single value (trace, error-context) take index [0].
  private extractAttachmentPaths(result: PlaywrightJsonTestResult | undefined, name: string): string[] {
    const matches = result?.attachments?.filter((a) => a.name === name && a.path) ?? [];
    return matches.map((a) => path.relative(process.cwd(), a.path!).split(path.sep).join('/'));
  }

  private mapStatus(
    testStatus: string,
    lastResultStatus?: string
  ): 'passed' | 'failed' | 'skipped' | 'flaky' {
    // WHY: Use Playwright's own test.status field as primary source of truth:
    // 'expected'   = passed first time → passed
    // 'flaky'      = failed then passed on retry → flaky
    // 'unexpected' = failed on ALL attempts → failed
    // 'skipped'    = skipped
    // lastResultStatus is used as a safety check for edge cases
    if (testStatus === 'expected') return 'passed';
    if (testStatus === 'flaky') return 'flaky';
    if (testStatus === 'skipped') return 'skipped';
    if (testStatus === 'unexpected') {
      // Double-check: if last result was 'passed', Playwright should have set flaky
      // but handle edge case where it didn't
      if (lastResultStatus === 'passed') return 'flaky';
      return 'failed';
    }
    return 'failed';
  }
}
