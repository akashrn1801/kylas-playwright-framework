/**
 * Failure classification and clustering (2026-07-14 reporting overhaul). Pure
 * logic, no fs/network dependency — same shape as RunHistory.ts, so it can be
 * unit-verified in isolation.
 *
 * WHY this exists as a separate file rather than living inside EmailTemplate:
 * classification/clustering is analysis of test-run data, not HTML rendering —
 * keeping it separate mirrors the existing RunHistory.ts precedent (pure
 * business logic, no rendering concerns) and keeps EmailTemplate focused on
 * turning already-computed data into markup.
 */
import { TestResult } from './ReportParser';
import { MiscError } from '../error-collector/ErrorCollector';

export type FailureCategory =
  | 'locator'
  | 'assertion'
  | 'timeout'
  | 'api'
  | 'auth'
  | 'network'
  | 'environment'
  | 'infra'
  | 'console'
  | 'js'
  | 'unknown';

/**
 * Classifies a single failure into one category. Order matters — checked most
 * specific/highest-confidence signal first. Where a stronger signal exists
 * (a real HTTP status code from misc-errors.json, cross-referenced by test
 * title) it's preferred over guessing from message text alone.
 */
export function classifyFailure(test: TestResult, miscErrors: MiscError[] | null = null): FailureCategory {
  const text = `${test.error || ''}\n${test.errorStack || ''}`;
  const related = (miscErrors ?? []).filter((e) => e.testTitle === test.title);

  if (/strict mode violation/i.test(text) || /locator\(.*\)\s*resolved to/i.test(text)) return 'locator';
  // WHY the second alternative added 2026-08-24: confirmed live via this
  // redesign's own real-data verification (a real flaky Quotations test,
  // prod report 2026-07-31) that Playwright's own OUTER test-level timeout
  // message — "Test timeout of 480000ms exceeded." — has a different shape
  // from an action-level timeout ("Timeout 60000ms exceeded", already
  // matched below) and fell through to 'unknown' despite being just as
  // unambiguously a timeout. Zero classification-ambiguity risk (this exact
  // string can only ever mean a Playwright test-level timeout) — a real bug
  // fix, not the kind of "band-aid without an evidence bar" widening
  // errorFilters.ts's own background-noise allowlist explicitly warns
  // against (that's about silently suppressing potentially-real errors;
  // this is a strictly-more-correct classification of an already-surfaced
  // failure).
  if (/Timeout \d+ms exceeded/i.test(text) || /Test timeout of \d+ms exceeded/i.test(text) || /waiting for (locator|selector|element)/i.test(text))
    return 'timeout';
  if (/expect\(.*\)\.(to|not)/i.test(text) || /Expected:.*\n.*Received:/i.test(text)) return 'assertion';

  const authHit = related.find((e) => e.statusCode === 401 || e.statusCode === 403);
  if (authHit || /HTTP (401|403)/.test(text)) return 'auth';

  const apiHit = related.find((e) => typeof e.statusCode === 'number');
  if (apiHit || /HTTP \d{3}/.test(text)) return 'api';

  if (/ECONNREFUSED|ETIMEDOUT|net::ERR_|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED/i.test(text)) return 'network';

  const infraHit = related.find((e) => (e.statusCode ?? 0) >= 500);
  if (infraHit || /score-rules/i.test(text)) return 'infra';

  if (/console[- ]error/i.test(text)) return 'console';

  if (
    /is not a function|is not iterable|Cannot read propert(y|ies) of (undefined|null)/i.test(text)
  )
    return 'js';

  if (/ENOENT|environment variable|process\.env|configuration (is )?(missing|invalid)/i.test(text))
    return 'environment';

  return 'unknown';
}

export type FailureSignalType = 'exact-message' | 'stack-location' | 'endpoint';

export interface FailureCluster {
  signal: string;
  signalType: FailureSignalType;
  category: FailureCategory;
  tests: TestResult[];
}

/**
 * Groups failures ONLY on a real matching signal, checked in priority order so
 * a test is claimed by exactly one signal type and never double-listed across
 * clusters:
 *   1. exact, full error-message match
 *   2. same errorLocation (file + line)
 *   3. same failing API endpoint + status, cross-referenced from miscErrors
 *      (already keyed by test title) by method+url+statusCode
 * A failure that shares no real signal with any other becomes its own single-
 * test cluster — every currently-failing test still appears with full detail,
 * nothing is hidden or summarized away. Two failures are NEVER merged on
 * superficial/partial similarity (e.g. matching category alone, or a
 * substring of the message) — false clustering would hide a genuinely
 * separate bug inside another one's summary, which is worse than no
 * clustering at all.
 */
export function clusterFailures(
  failedTests: TestResult[],
  miscErrors: MiscError[] | null
): FailureCluster[] {
  const miscByTitle = new Map<string, MiscError[]>();
  for (const e of miscErrors ?? []) {
    if (!e.testTitle) continue;
    if (!miscByTitle.has(e.testTitle)) miscByTitle.set(e.testTitle, []);
    miscByTitle.get(e.testTitle)!.push(e);
  }

  const byExactMessage = new Map<string, TestResult[]>();
  const byStackLocation = new Map<string, TestResult[]>();
  const byEndpoint = new Map<string, TestResult[]>();

  for (const t of failedTests) {
    if (t.error) {
      if (!byExactMessage.has(t.error)) byExactMessage.set(t.error, []);
      byExactMessage.get(t.error)!.push(t);
    }
    if (t.errorLocation) {
      const key = `${t.errorLocation.file}:${t.errorLocation.line}`;
      if (!byStackLocation.has(key)) byStackLocation.set(key, []);
      byStackLocation.get(key)!.push(t);
    }
    const err = (miscByTitle.get(t.title) ?? []).find((e) => typeof e.statusCode === 'number');
    if (err) {
      const key = `${err.method ?? 'GET'} ${err.url ?? ''} ${err.statusCode}`;
      if (!byEndpoint.has(key)) byEndpoint.set(key, []);
      byEndpoint.get(key)!.push(t);
    }
  }

  const used = new Set<TestResult>();
  const clusters: FailureCluster[] = [];

  const emit = (map: Map<string, TestResult[]>, signalType: FailureSignalType) => {
    for (const [signal, tests] of map.entries()) {
      const fresh = tests.filter((t) => !used.has(t));
      // WHY: require 2+ — a "cluster" of 1 is just a normal standalone
      // failure, handled in the fallback loop below so its rendering is
      // identical to today's single-test failure row.
      if (fresh.length < 2) continue;
      fresh.forEach((t) => used.add(t));
      clusters.push({
        signal,
        signalType,
        category: classifyFailure(fresh[0], miscErrors),
        tests: fresh,
      });
    }
  };

  emit(byExactMessage, 'exact-message');
  emit(byStackLocation, 'stack-location');
  emit(byEndpoint, 'endpoint');

  for (const t of failedTests) {
    if (used.has(t)) continue;
    clusters.push({
      signal: t.title,
      signalType: 'exact-message',
      category: classifyFailure(t, miscErrors),
      tests: [t],
    });
  }

  return clusters;
}
