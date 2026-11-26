/**
 * How much session life a run needs (ADR 0017). The full window (4 h) suits a whole-suite run; a local run of a few
 * tests only needs its own duration plus a margin. The selection is counted exactly with Playwright's own
 * `--list` (same file filters, --grep, --project, --repeat-each), then turned into a duration estimate. Never
 * smaller than the margin floor, never larger than the full window, and anything that cannot be counted (no
 * selection filter, list failed) keeps the full window: a wrong guess may only ever be too strict, never too lax.
 */
import { spawnSync } from 'child_process';

// Measured local staging runs (4 workers, 2026-11): Quotations 41 tests/34 min = 3.3 min of worker time per test, Call
// Logs 2.1, Deals 2.1, Leads 1.9, Contacts 1.5. The slowest observed value, rounded up.
export const WORKER_MS_PER_TEST = 3.5 * 60 * 1000;
// App refresh trigger (~10 min before expiry) + longest test (8 min) + setup and slack.
export const RUN_WINDOW_MARGIN_MS = 30 * 60 * 1000;
export const RUN_WINDOW_FLOOR_MS = 45 * 60 * 1000;

export interface RunWindow {
  windowMs: number;
  reason: string;
}

/** Window for `testCount` tests on `workers` workers, bounded by the floor and the full window. */
export function scaledRunWindowMs(testCount: number, workers: number, fullWindowMs: number): number {
  const parallel = Math.max(1, Math.min(workers, testCount));
  const estimate = Math.ceil((testCount * WORKER_MS_PER_TEST) / parallel) + RUN_WINDOW_MARGIN_MS;
  return Math.min(fullWindowMs, Math.max(RUN_WINDOW_FLOOR_MS, estimate));
}

// Flags that narrow what runs and are safe to hand to `--list`; each value is the next token unless written `--flag=value`.
const SELECTION_FLAGS_WITH_VALUE = new Set(['-g', '--grep', '--grep-invert', '--project', '--repeat-each', '-c', '--config', '--test-list', '--test-list-invert', '--tag']);
// Every other flag that takes a separate value token: skipped together with its value so the value is never read as a file filter.
const OTHER_FLAGS_WITH_VALUE = new Set(['-j', '--workers', '--retries', '--timeout', '--shard', '--output', '--max-failures', '--reporter', '--tsconfig', '--trace', '--global-timeout', '--ui-host', '--ui-port', '--update-snapshots', '--update-source-method']);

/** The part of a `playwright test ...` argv that selects tests: positional filters plus the narrowing flags. null = not a test run. */
export function selectionArgs(cliArgs: string[]): { args: string[]; hasFilter: boolean } | null {
  const testIdx = cliArgs.indexOf('test');
  if (testIdx === -1) return null;
  const args: string[] = [];
  let hasFilter = false;
  for (let i = testIdx + 1; i < cliArgs.length; i++) {
    const token = cliArgs[i];
    if (!token.startsWith('-')) {
      args.push(token);
      hasFilter = true;
      continue;
    }
    const [flag] = token.split('=');
    const inline = token.includes('=');
    if (SELECTION_FLAGS_WITH_VALUE.has(flag)) {
      args.push(token);
      if (!inline && i + 1 < cliArgs.length) args.push(cliArgs[++i]);
      if (flag === '-g' || flag === '--grep' || flag === '--grep-invert' || flag === '--tag' || flag === '--test-list') hasFilter = true;
    } else if (OTHER_FLAGS_WITH_VALUE.has(flag) && !inline) {
      i++;
    }
  }
  return { args, hasFilter };
}

interface ListSuite {
  specs?: Array<{ tests?: unknown[] }>;
  suites?: ListSuite[];
}

/** Number of tests in a `--list --reporter=json` output (tolerates banner lines, even one starting with `{`, before the JSON). */
export function countListedTests(raw: string): number {
  let report: { suites?: ListSuite[] } | null = null;
  for (const match of raw.matchAll(/(?:^|\n)\{/g)) {
    try {
      report = JSON.parse(raw.slice(match.index + match[0].length - 1)) as { suites?: ListSuite[] };
      break;
    } catch {
      /* a banner line, try the next candidate */
    }
  }
  if (!report) throw new Error('no JSON object in the --list output');
  let count = 0;
  const walk = (suite: ListSuite): void => {
    for (const spec of suite.specs ?? []) count += spec.tests?.length ?? 0;
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return count;
}

/**
 * Counts the selected tests with a real `--list`; null when it cannot be done. `--list` itself applies --repeat-each
 * (each repeat is a test) and --project (without it, every configured project counts, as the real run would).
 */
export function listSelectedTests(args: string[]): number | null {
  try {
    const cli = require.resolve('@playwright/test/cli');
    const result = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json', ...args], {
      encoding: 'utf-8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 90_000,
    });
    if (result.status !== 0 || !result.stdout) return null;
    return countListedTests(result.stdout);
  } catch {
    return null;
  }
}

/**
 * The run window for this invocation. `explicit` (SESSION_MIN_REMAINING_FOR_RUN_MS set) and CI keep the full window,
 * as does any invocation with no test filter (a whole-suite run) or one whose selection cannot be counted.
 */
export function effectiveRunWindow(opts: {
  cliArgs: string[];
  workers: number;
  fullWindowMs: number;
  explicit: boolean;
  isCI: boolean;
  count?: (args: string[]) => number | null;
}): RunWindow {
  const full = (reason: string): RunWindow => ({ windowMs: opts.fullWindowMs, reason });
  if (opts.explicit) return full('SESSION_MIN_REMAINING_FOR_RUN_MS is set');
  if (opts.isCI) return full('CI');
  const selection = selectionArgs(opts.cliArgs);
  if (!selection || !selection.hasFilter) return full('no file or --grep filter (whole-suite run)');
  const tests = (opts.count ?? listSelectedTests)(selection.args);
  if (tests === null || tests <= 0) return full('the selection could not be counted with --list');
  const windowMs = scaledRunWindowMs(tests, opts.workers, opts.fullWindowMs);
  return {
    windowMs,
    reason: `${tests} selected test(s) on ${opts.workers} worker(s): ${Math.round(windowMs / 60000)} min (floor ${RUN_WINDOW_FLOOR_MS / 60000}, full ${Math.round(opts.fullWindowMs / 60000)})`,
  };
}
