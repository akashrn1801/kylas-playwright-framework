/**
 * Assembles one fully-enriched, render-ready object per failure (2026-08-24
 * redesign). Pure logic, no fs/network dependency — same testability
 * convention as RunHistory.ts/AutomationHealth.ts/FailureAnalyzer.ts.
 *
 * WHY this exists as its own file rather than folding into FailureAnalyzer.ts:
 * FailureAnalyzer's stated scope is classification/clustering; this module's
 * job is different — take an already-classified failure plus several other
 * independent data sources (history, known-issues index, CI context) and
 * assemble one object EmailTemplate can render without reaching back into 5
 * different raw fields per call. Matches this codebase's "every new piece of
 * logic does ONE thing" convention.
 */
import { TestResult } from './ReportParser';
import { FailureCategory, FailureCluster, classifyFailure } from './FailureAnalyzer';
import { MiscError } from '../error-collector/ErrorCollector';
import { RecurringIssue } from './RunHistory';
import { KnownIssueCandidate, KnownIssueMatch, matchKnownIssue, extractStackMethodName } from './KnownIssuesIndex';
import { redactSensitiveText } from './redact';

// WHY 8: a fixed, documented constant rather than a buried magic number —
// same convention as RunHistory.ts's SLOW_TEST_REGRESSION_THRESHOLD/
// MAX_RECORDS_PER_ENV. Line-count truncation (not a "relevance" heuristic
// like skipping node_modules frames) was chosen deliberately — simple,
// deterministic, and every real stack trace captured during the
// investigation was already short enough (all repo-internal frames, no
// framework noise) that a relevance heuristic isn't needed for THIS
// codebase's error shapes.
export const MAX_STACK_FRAMES = 8;

// WHY 2000, not the old 300-char display truncation: a safety cap against a
// pathological accidental full-page-text capture, not a display limit — every
// real assertion-diff message captured during the investigation was under
// 700 chars, and the old 300-char cap was confirmed (investigation §3
// finding 2) to actively cut off real diff content on a `toContain` DOM-text
// mismatch.
export const MAX_ERROR_TEXT_CHARS = 2000;

export type RegressionStatus = 'new-regression' | 'chronic' | 'recurring' | 'unclassified';

export interface ChronicRatio {
  count: number;
  of: number;
}

export interface ArtifactLinks {
  trace?: string;
  screenshots: string[];
  errorContext?: string;
}

export interface FailureDetail {
  test: TestResult;
  category: FailureCategory;
  primaryError: string;
  earlierErrors: string[];
  snippet?: string;
  stackFrames: string[];
  stackTruncatedCount: number;
  screenshotPaths: string[];
  errorContextPath?: string;
  tracePath?: string;
  anchorId: string;
  diagnosticHint: string;
  knownIssue?: KnownIssueMatch;
  artifactLinks: ArtifactLinks;
  // WHY optional, not required: only meaningful for a hard failure evaluated
  // against last-run/recurring-failure history — a flaky test's own detail
  // (built by buildFlakyFailureDetails) leaves these undefined rather than
  // forcing a meaningless value, since "is this a new regression" isn't a
  // coherent question for a test that already passed on retry this run.
  regressionStatus?: RegressionStatus;
  chronicRatio?: ChronicRatio;
}

export interface EnrichedCluster extends FailureCluster {
  details: FailureDetail[];
}

export interface EnrichmentContext {
  miscErrors: MiscError[] | null;
  // WHY null (not []) distinguishes "no prior run exists" from "a prior run
  // existed and had zero failures" — the two must degrade differently (see
  // RegressionStatus.unclassified vs. a confident 'new-regression'/'chronic'
  // read below).
  previousRunFailedTitles: string[] | null;
  recurringFailures: RecurringIssue[];
  knownIssuesIndex: KnownIssueCandidate[];
  runSource: 'local' | 'github-actions' | 'jenkins';
  buildUrl: string;
}

// WHY a Record with all 11 keys required, not a partial map with a runtime
// fallback: TypeScript enforces completeness here — adding a 12th
// FailureCategory to FailureAnalyzer.ts without also adding its hint here is
// a compile error, not a silently-missing hint discovered in production
// (directly satisfies addendum item 15's "extensible without restructuring"
// requirement while still catching an incomplete addition at build time).
const DIAGNOSTIC_HINTS: Record<FailureCategory, string> = {
  locator: 'A strict-mode violation or "resolved to N elements" error — the locator is no longer unique. Check for a newly-added sibling element (CLAUDE.md rule 17) before assuming the original locator is simply wrong.',
  timeout: 'Often a stale/slow locator or a genuine app-side slowdown, not necessarily a code bug — check the trace/screenshot for what the page actually looked like at the moment of timeout.',
  assertion: 'A real expect() mismatch — read the Expected/Received values above; this is either a genuine app regression or test data that no longer matches what the app now returns.',
  api: 'A completed HTTP error response — check the status code and response body above; this may be a real backend issue or an expected error the test should have handled.',
  auth: 'A 401/403 — check for session expiry (CLAUDE.md rule 3) or a genuine RBAC permission gap before assuming this is a code bug.',
  network: 'A DNS/connection-level failure — usually transient infrastructure, not a code or app defect; check if it recurred on retry.',
  environment: 'A missing/invalid environment variable or configuration value — check this environment\'s .env / CI secrets before assuming the code itself is wrong.',
  infra: 'A 5xx from a dependency — often transient; check if it recurred on retry before treating this as a real regression (see errorFilters.ts\'s background-noise allowlist for known-transient dependencies).',
  console: 'A captured browser console error — check whether it correlates with this specific test\'s own assertions or is unrelated background noise.',
  js: 'A client-side JS crash ("is not a function"/"Cannot read properties of undefined") — could be a genuine Kylas application bug (see APPLICATION_BUGS.md) rather than a test-code defect; classify before fixing (CLAUDE.md rule 10).',
  unknown: 'No specific signal matched any known category — read the message/stack directly; this is an honest "not enough signal to classify," not a guess.',
};

function slugify(title: string, used: Set<string>): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 50);
  let candidate = `test-${base}`;
  let suffix = 2;
  // WHY a collision loop, not just accepting a duplicate id: two tests with
  // near-identical titles (truncated to the same 50-char slug) would
  // otherwise silently share one HTML id, breaking anchor navigation for
  // whichever one isn't first — confirmed this is a real, if rare,
  // possibility given this codebase's per-module sequential test-labeling
  // convention (CLAUDE.md's Reference Patterns §13) rather than assumed safe.
  while (used.has(candidate)) {
    candidate = `test-${base}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function truncateStack(errorStack: string | undefined): { frames: string[]; truncatedCount: number } {
  if (!errorStack) return { frames: [], truncatedCount: 0 };
  const lines = errorStack.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= MAX_STACK_FRAMES) return { frames: lines, truncatedCount: 0 };
  return { frames: lines.slice(0, MAX_STACK_FRAMES), truncatedCount: lines.length - MAX_STACK_FRAMES };
}

function safetyCap(text: string): string {
  return text.length > MAX_ERROR_TEXT_CHARS ? `${text.slice(0, MAX_ERROR_TEXT_CHARS)}… [truncated, safety cap]` : text;
}

function buildArtifactLinks(detail: Pick<FailureDetail, 'tracePath' | 'screenshotPaths' | 'errorContextPath'>, ctx: EnrichmentContext): ArtifactLinks {
  // WHY Jenkins-only, not attempted for github-actions/local: investigated
  // and confirmed no reliable per-artifact URL exists for a GitHub Actions
  // run (actions/upload-artifact only exposes a whole-folder zip download,
  // no browsable single-file URL) — see the redesign proposal's item 9 for
  // the full investigation. Jenkins' archiveArtifacts + its long-documented
  // `${BUILD_URL}artifact/<path>` convention makes a real, precise link
  // constructible there. Never fabricate a link for a source where it can't
  // actually be confirmed to work.
  if (ctx.runSource !== 'jenkins' || !ctx.buildUrl) {
    return { screenshots: [] };
  }
  const base = ctx.buildUrl.endsWith('/') ? ctx.buildUrl : `${ctx.buildUrl}/`;
  const artifactUrl = (relPath: string): string => `${base}artifact/${relPath.split('/').map(encodeURIComponent).join('/')}`;
  return {
    trace: detail.tracePath ? artifactUrl(detail.tracePath) : undefined,
    screenshots: detail.screenshotPaths.map(artifactUrl),
    errorContext: detail.errorContextPath ? artifactUrl(detail.errorContextPath) : undefined,
  };
}

function computeRegressionStatus(
  test: TestResult,
  ctx: EnrichmentContext
): { regressionStatus: RegressionStatus; chronicRatio?: ChronicRatio } {
  // WHY 'unclassified' (not a guessed 'new-regression'): with no previous run
  // to compare against, there is no honest basis to call this either new or
  // chronic — degrading honestly per the standing instruction, never a
  // fabricated verdict.
  if (ctx.previousRunFailedTitles === null) return { regressionStatus: 'unclassified' };
  const chronic = ctx.recurringFailures.find((r) => r.title === test.title);
  if (chronic) {
    return {
      regressionStatus: 'chronic',
      chronicRatio: { count: chronic.countInLastNRuns, of: chronic.ofLastNRuns },
    };
  }
  if (!ctx.previousRunFailedTitles.includes(test.title)) {
    return { regressionStatus: 'new-regression' };
  }
  return { regressionStatus: 'recurring' };
}

function enrichSingleFailure(
  test: TestResult,
  category: FailureCategory,
  ctx: EnrichmentContext,
  usedAnchorIds: Set<string>,
  includeRegression: boolean
): FailureDetail {
  const allErrors = test.allErrors.map((e) => redactSensitiveText(safetyCap(e)));
  const primaryError = allErrors.length > 0 ? allErrors[allErrors.length - 1] : redactSensitiveText(safetyCap(test.error || 'Unknown error'));
  const earlierErrors = allErrors.length > 1 ? allErrors.slice(0, -1) : [];
  const snippet = test.errorSnippet ? redactSensitiveText(test.errorSnippet) : undefined;
  const { frames, truncatedCount } = truncateStack(test.errorStack ? redactSensitiveText(test.errorStack) : undefined);
  const stackMethodName = extractStackMethodName(test.errorStack);
  const knownIssue = matchKnownIssue(`${test.error || ''}\n${test.errorStack || ''}`, stackMethodName, ctx.knownIssuesIndex);
  const detail: FailureDetail = {
    test,
    category,
    primaryError,
    earlierErrors,
    snippet,
    stackFrames: frames,
    stackTruncatedCount: truncatedCount,
    screenshotPaths: test.screenshotPaths,
    errorContextPath: test.errorContextPath,
    tracePath: test.tracePath,
    anchorId: slugify(test.title, usedAnchorIds),
    diagnosticHint: DIAGNOSTIC_HINTS[category],
    knownIssue: knownIssue ?? undefined,
    artifactLinks: { screenshots: [] }, // replaced below once tracePath/screenshotPaths are known
  };
  detail.artifactLinks = buildArtifactLinks(detail, ctx);
  if (includeRegression) {
    Object.assign(detail, computeRegressionStatus(test, ctx));
  }
  return detail;
}

/**
 * Enriches every hard-failure cluster's tests with full render-ready detail.
 * Cluster grouping/category itself is untouched (FailureAnalyzer already
 * computed it correctly for every cluster, including single-test ones) —
 * this only adds the per-test detail EmailTemplate needs to actually render
 * that already-correct classification instead of hiding it.
 */
export function enrichClusters(
  clusters: FailureCluster[],
  ctx: EnrichmentContext,
  usedAnchorIds: Set<string> = new Set<string>()
): EnrichedCluster[] {
  return clusters.map((cluster) => ({
    ...cluster,
    details: cluster.tests.map((test) => enrichSingleFailure(test, cluster.category, ctx, usedAnchorIds, true)),
  }));
}

/**
 * Enriches flaky tests' FAILING attempt with the same detail depth as a hard
 * failure — including the exact real-world case this redesign was partly
 * motivated by (investigation §3 finding 3): a flaky test's generic "Test
 * timeout exceeded" first error next to the much more specific application
 * error that actually explains what happened, which only ever surfaces via
 * allErrors, not the singular `error` field. Deliberately excludes
 * regressionStatus/chronicRatio (computeRegressionStatus above) — those
 * concepts describe a test that's currently FAILING outright, not one that
 * passed on retry this run; RunHistory's own recurringFlaky mechanism
 * already answers the equivalent "is this test chronically flaky" question
 * (see EmailTemplate's existing risk/history columns).
 */
export function buildFlakyFailureDetails(
  flakyTests: TestResult[],
  ctx: EnrichmentContext,
  usedAnchorIds: Set<string>
): FailureDetail[] {
  // WHY classifyFailure(test, ...) is now correct here without a synthetic
  // override (fixed 2026-08-24 at the source instead): test.error/errorStack
  // now come from the FAILING attempt for a flaky test too (ReportParser's
  // own fix, same commit) — previously they were always empty here (sourced
  // from the passing retry), which made every flaky test's card classify as
  // 'unknown' regardless of its real failure. Confirmed live against this
  // investigation's own real flaky-test sample: 'unknown' before the
  // ReportParser fix, 'timeout' after it.
  return flakyTests.map((test) => enrichSingleFailure(test, classifyFailure(test, ctx.miscErrors), ctx, usedAnchorIds, false));
}
