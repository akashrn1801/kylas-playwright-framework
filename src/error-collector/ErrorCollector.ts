import * as fs from 'fs';
import * as path from 'path';
import { isNoise, isExpectedRbacError, isExpectedBackgroundNoise } from './errorFilters';

export type MiscErrorType =
  | 'pageerror'
  | 'console-error'
  | 'requestfailed'
  | 'response-error'
  | 'node-exception'
  | 'node-rejection';

// WHY: Two distinct "this is fine" reasons, kept separate rather than a single
// boolean — RBAC-expected means "the app correctly denied access," background-
// noise means "a non-load-bearing side widget failed." Conflating them would
// mislabel a calendar-integration 400 as "Expected RBAC" in the report, which
// is actively misleading about what actually happened.
export type ExpectedReason = 'rbac' | 'background-noise';

export interface MiscError {
  type: MiscErrorType;
  message: string;
  url?: string;
  method?: string;
  statusCode?: number;
  responseBody?: string;
  apiErrorMessage?: string;
  apiErrorCode?: string;
  expectedReason?: ExpectedReason;
  testTitle?: string;
  testFile?: string;
  timestamp: string;
  env?: string;
}

// WHY (2026-10-06): measuring whether sequencing the CI tracks / skipping
// product fixtures actually reduced load-induced failures needs a COUNT of how
// often the app's known-bad pages and the globalSetup transient-retry fired —
// these are recovered-from events, not errors, so they never reach capture()
// (and must not inflate the unexpected-error counts). Deliberately a separate
// stream riding the SAME pipeline (worker file -> MiscErrorReporter ->
// merge-misc-errors -> NotificationService) rather than a second aggregator.
export type RecoveryEventKind =
  | 'rate-limit-page'
  | 'error-boundary-page'
  | 'globalsetup-transient-retry';

export interface RecoveryEvent {
  kind: RecoveryEventKind;
  // 'recovered' / 'failed' = the retried action after recovery succeeded /
  // threw again; 'retrying' = a globalSetup retry is about to happen (its
  // final outcome is the job's own pass/fail, not tracked per attempt).
  outcome: 'recovered' | 'failed' | 'retrying';
  timestamp: string;
  testTitle?: string;
  detail?: string;
}

// One shard's events, attributed by merge-misc-errors.ts from the shard's own
// artifact directory name (e.g. "qa-3", "qa-formfields-lead").
export interface ShardRecoveryEvents {
  shard: string;
  events: RecoveryEvent[];
}

export interface MiscErrorReport {
  capturedAt: string;
  totalErrors: number;
  unexpectedErrors: number;
  expectedRbacErrors: number;
  expectedBackgroundNoiseErrors: number;
  byType: Record<string, number>;
  errors: MiscError[];
  // Optional + additive: absent in reports written before 2026-10-06, so
  // every existing reader keeps working unchanged.
  recoveryEvents?: RecoveryEvent[];
  recoveryByShard?: ShardRecoveryEvents[];
}

// WHY: Each Playwright worker is a separate OS process running its own
// ErrorCollector singleton instance. Writing all workers to the same shared
// misc-errors.json means the last writer silently overwrites every other
// worker's captured history. Each worker instead writes its own file (keyed
// by Playwright's TEST_WORKER_INDEX env var), and MiscErrorReporter.onEnd()
// merges them into the final reports/misc-errors.json once the run completes.
// WHY: Confirmed live (2026-07-07) — TEST_WORKER_INDEX restarts at 0 for
// EVERY separate `npx playwright test` process, so two concurrent runs
// against different environments (e.g. QA + Staging run in parallel) would
// have both worker-0s write to the exact same reports/misc-errors-worker-0.json
// — and worse, MiscErrorReporter's onBegin() DELETES all worker files in this
// directory at start, so one environment's run-start could destroy the
// other's in-progress data mid-run. Namespace by env so concurrent
// cross-environment runs never share a path.
const REPORTS_DIR = path.resolve(process.cwd(), 'reports', process.env.ENV || 'qa');
const WORKER_ID = process.env.TEST_WORKER_INDEX ?? String(process.pid);
const OUTPUT_PATH = path.join(REPORTS_DIR, `misc-errors-worker-${WORKER_ID}.json`);
// WHY a separate file for the main process (globalSetup) — confirmed with a
// scratch Playwright config: globalSetup runs BEFORE reporter.onBegin(), and
// MiscErrorReporter.onBegin() deletes every `misc-errors-worker-*.json`, so
// events written to the pid-named worker file above would be wiped before
// onEnd() could merge them. This name deliberately does not match that
// cleanup pattern; globalSetup truncates it at its own start instead.
export const MAIN_PROCESS_EVENTS_PATH = path.join(REPORTS_DIR, 'recovery-events-main.json');

class ErrorCollectorSingleton {
  private errors: MiscError[] = [];
  private recentKeys = new Set<string>(); // WHY: dedup same error within 2s window
  private currentTestTitle = 'unknown';
  private currentTestFile = 'unknown';
  private nodeListenersAttached = false;
  private recoveryEvents: RecoveryEvent[] = [];

  setCurrentTest(title: string, file: string): void {
    this.currentTestTitle = title;
    this.currentTestFile = file;
  }

  clearCurrentTest(): void {
    this.currentTestTitle = 'unknown';
    this.currentTestFile = 'unknown';
  }

  capture(error: Omit<MiscError, 'timestamp' | 'testTitle' | 'testFile'>): void {
    try {
      if (isNoise(error.message, error.url)) return;
      // WHY: Filter ERR_ABORTED on non-CRM URLs — navigation aborts when page navigates away
      const isAbort = error.message && error.message.includes('ERR_ABORTED');
      const isCrmUrl =
        error.url && (error.url.includes('sling-dev.com') || error.url.includes('kylas.io'));
      if (isAbort && !isCrmUrl) return;
      // WHY: Deduplicate — same error from multiple page listeners within 2s window
      const dedupKey = `${error.type}:${error.url || error.message.substring(0, 50)}`;
      if (this.recentKeys.has(dedupKey)) return;
      this.recentKeys.add(dedupKey);
      setTimeout(() => this.recentKeys.delete(dedupKey), 2000);
      // WHY: Mark RBAC permission errors as expected — they are correct app behaviour.
      // Separately, mark completed (non-abort) HTTP errors on known non-load-bearing
      // background widgets as expected too — see errorFilters.ts's
      // BACKGROUND_WIDGET_NOISE_PATTERNS for the per-endpoint evidence bar this is
      // held to. Kept as a distinct reason (not folded into isNoise()'s silent drop)
      // so these still show up in the report, just correctly labeled and out of the
      // "unexpected — go investigate" bucket.
      let expectedReason: MiscError['expectedReason'];
      if (isExpectedRbacError(error.message, error.apiErrorMessage, error.statusCode, error.apiErrorCode)) {
        expectedReason = 'rbac';
      } else if (isExpectedBackgroundNoise(error.message, error.url, error.responseBody)) {
        expectedReason = 'background-noise';
      }

      const entry: MiscError = {
        ...error,
        expectedReason,
        testTitle: this.currentTestTitle,
        testFile: this.currentTestFile,
        timestamp: new Date().toISOString(),
        env: process.env.ENV || 'qa',
      };
      this.errors.push(entry);
      this.persist();
      console.log(`\n[MiscError] [${entry.type.toUpperCase()}] ${entry.message}`);
      if (entry.url) console.log(`            URL: ${entry.url}`);
      if (entry.statusCode) console.log(`            Status: ${entry.statusCode}`);
      console.log(`            Test: ${entry.testTitle}`);
      console.log(`            Time: ${entry.timestamp}\n`);
    } catch {}
  }

  attachNodeListeners(): void {
    if (this.nodeListenersAttached) return;
    this.nodeListenersAttached = true;
    process.on('uncaughtException', (err: Error) => {
      if (err.message?.includes('playwright') || err.message?.includes('expect(')) return;
      this.capture({ type: 'node-exception', message: err.message || String(err) });
    });
    process.on('unhandledRejection', (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (message?.includes('playwright') || message?.includes('Target page')) return;
      this.capture({ type: 'node-rejection', message });
    });
  }

  // WHY this can never throw or alter control flow: it is called from inside
  // shared recovery helpers (BasePage.withRateLimitRecovery, globalSetup's
  // withTransientRetry) whose "never fail the build / behave exactly as
  // before" contract this measurement must not touch.
  recordRecoveryEvent(event: Omit<RecoveryEvent, 'timestamp' | 'testTitle'>): void {
    try {
      const entry: RecoveryEvent = {
        ...event,
        timestamp: new Date().toISOString(),
        testTitle: this.currentTestTitle,
      };
      this.recoveryEvents.push(entry);
      // Workers have TEST_WORKER_INDEX; the main process (globalSetup) does not.
      if (process.env.TEST_WORKER_INDEX === undefined) {
        const dir = path.dirname(MAIN_PROCESS_EVENTS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          MAIN_PROCESS_EVENTS_PATH,
          JSON.stringify({ recoveryEvents: this.recoveryEvents }, null, 2),
          'utf-8'
        );
      } else {
        this.persist();
      }
      console.log(`[RecoveryEvent] ${entry.kind} → ${entry.outcome}${entry.detail ? ` (${entry.detail})` : ''}`);
    } catch {}
  }

  // Called once by globalSetup at its start: drops a stale file from a
  // crashed previous run in the same checkout.
  resetMainProcessRecoveryEvents(): void {
    try {
      this.recoveryEvents = [];
      fs.rmSync(MAIN_PROCESS_EVENTS_PATH, { force: true });
    } catch {}
  }

  getReport(): MiscErrorReport {
    const byType: Record<string, number> = {};
    for (const e of this.errors) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    // WHY: removed the redundant `expected` boolean (2026-07-14) — it was
    // always exactly `!!e.expectedReason`, confirmed via exhaustive grep to
    // have exactly 3 real consumers (this one, MiscErrorReporter.ts, and
    // EmailTemplate.ts's background-errors rendering), all now reading
    // expectedReason directly instead of a redundant derived field.
    const unexpectedErrors = this.errors.filter((e) => !e.expectedReason).length;
    const expectedRbacErrors = this.errors.filter((e) => e.expectedReason === 'rbac').length;
    const expectedBackgroundNoiseErrors = this.errors.filter(
      (e) => e.expectedReason === 'background-noise'
    ).length;
    return {
      capturedAt: new Date().toISOString(),
      totalErrors: this.errors.length,
      unexpectedErrors,
      expectedBackgroundNoiseErrors,
      expectedRbacErrors,
      byType,
      errors: this.errors,
      recoveryEvents: this.recoveryEvents,
    };
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  private persist(): void {
    try {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(this.getReport(), null, 2), 'utf-8');
    } catch {}
  }

  reset(): void {
    this.errors = [];
    try {
      const dir = path.dirname(OUTPUT_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(this.getReport(), null, 2), 'utf-8');
    } catch {}
  }
}

export const ErrorCollector = new ErrorCollectorSingleton();
