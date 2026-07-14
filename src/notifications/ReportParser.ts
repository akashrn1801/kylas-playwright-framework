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

export class ReportParser {
  parse(jsonReportPath: string): ParsedReport {
    if (!fs.existsSync(jsonReportPath)) {
      throw new Error(`Report not found: ${jsonReportPath}`);
    }
    const raw = JSON.parse(fs.readFileSync(jsonReportPath, 'utf-8'));
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
      const fp = r.file || '';
      const type: 'UI' | 'RBAC' | 'Other' = fp.includes('rbac')
        ? 'RBAC'
        : fp.includes('ui')
          ? 'UI'
          : 'Other';
      const match = fp.match(/(?:tests\/)?(ui|rbac)\/([^/]+)/);
      const rawName = match ? match[2].replace(/\.(rbac\.)?spec\.ts$/, '') : 'other';
      const name = rawName.charAt(0).toUpperCase() + rawName.slice(1);
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
      ? raw.config.projects.map((p: any) => p.name).filter(Boolean)
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

  private extractResults(raw: any): TestResult[] {
    const results: TestResult[] = [];
    const walkSuite = (suite: any, file = '') => {
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
            const rawMessage = lastResult?.error?.message || lastResult?.error?.value || undefined;
            const error = rawMessage ? stripAnsi(rawMessage) : undefined;
            const rawStack = lastResult?.error?.stack;
            const errorStack = rawStack ? stripAnsi(rawStack) : undefined;
            const loc = lastResult?.error?.location;
            const errorLocation: ErrorLocation | undefined = loc
              ? { file: loc.file, line: loc.line, column: loc.column }
              : undefined;
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
            results.push({
              title: spec.title.replace(/^@\w+\s*/g, ''),
              status,
              duration: lastResult?.duration || 0,
              error,
              errorStack,
              errorLocation,
              retries,
              file: currentFile,
              tracePath: this.extractTracePath(traceSourceResult),
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
  private extractTracePath(result: any): string | undefined {
    const attachments = result?.attachments as Array<{ name: string; path?: string }> | undefined;
    const trace = attachments?.find((a) => a.name === 'trace' && a.path);
    if (!trace?.path) return undefined;
    return path.relative(process.cwd(), trace.path).split(path.sep).join('/');
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
