/**
 * Automation health scoring (2026-07-14 reporting overhaul). Pure logic, no
 * fs/network dependency — same shape as RunHistory.ts/FailureAnalyzer.ts.
 *
 * Weights and score→label thresholds below are proposed starting points,
 * documented as such rather than presented as precision-tuned constants — the
 * same "revisit once real data accumulates" convention already used for
 * SLOW_TEST_REGRESSION_THRESHOLD in RunHistory.ts. Nothing here is a build
 * gate; it's a single at-a-glance signal for the email.
 */
import { FLAKY_BUDGET, ParsedReport } from './ReportParser';
import { RunDelta, SuiteDrift, RecurringIssue } from './RunHistory';
import { ShardCompleteness, isIncompleteRun } from './ShardCompleteness';
import { RenewalFailure, describeRenewalFailure, renewalFailureLabel } from '../auth/renewalFailure';
import { MiscErrorReport } from '../error-collector/ErrorCollector';

// WHY these constants (2026-10-06, sandbox Build #186: 0 failed, 906 passed,
// 9 flaky, 361 unexpected background errors, 49 recurring failures, 42
// recurring flaky scored 31/100 "Critical" and the subject read "❌ ...
// PASSED — HEALTH CRITICAL"): every input except this run's own failures
// could stack to a Critical band on a run with ZERO failures, and the single
// verdict icon was derived from that band. Principles now:
//  1. THIS run's results (pass rate, failures, flaky, drift, staleness) carry
//     full weight; context inputs (unexpected background errors + recurring
//     history) are weighted lower and share ONE combined cap.
//  2. A run with 0 failed tests cannot be Critical (health floors at the
//     bottom of 'Needs Attention', shown as an explicit factor — never hidden).
//     History-only evidence is not accepted as proof of a sustained, real
//     problem: the history inputs are exactly the ones that were inflated
//     (cross-scope mixing, one record per manual re-run), so a Critical band
//     requires real failures in this run.
//  3. The verdict (PASSED/FAILED + icon) comes only from this run's failed
//     count; health is shown as its own labeled value, not the headline.
// These are proposed starting points like every constant in this file, not
// precision-tuned numbers.
export { FLAKY_BUDGET };
export const BACKGROUND_ERROR_WEIGHT = 0.5;
export const BACKGROUND_ERROR_CAP = 8;
export const RECURRING_FAILURE_WEIGHT = 2;
export const RECURRING_FAILURE_CAP = 8;
export const RECURRING_FLAKY_WEIGHT = 1;
export const RECURRING_FLAKY_CAP = 5;
// Combined ceiling for background errors + recurring failures + recurring flaky.
export const CONTEXT_PENALTY_CAP = 15;
// Lowest score a run with 0 failed tests can show (bottom of 'Needs Attention').
export const ZERO_FAILURE_SCORE_FLOOR = 50;
// Highest score (and label) a run with failures can show: any failure -> Good; 3 failures or 5% of the run -> Needs Attention.
export const FAILURE_CAP_ANY = 89;
export const FAILURE_CAP_SEVERE = 74;

export type OverallVerdict = 'clear' | 'caution' | 'blocked';
export type VerdictTone = 'success' | 'warning' | 'danger';

export interface VerdictResult {
  verdict: OverallVerdict;
  bannerLabel: string;
  bannerTone: VerdictTone;
  headline: string;
}

export interface HealthFactor {
  name: string;
  impact: number; // negative = penalty
  note: string;
}

export interface HealthScore {
  /** Set when the run verified nothing (blocked, incomplete, empty): the score is not shown, this says why. */
  notApplicable?: string;
  score: number; // 0-100
  label: 'Excellent' | 'Good' | 'Needs Attention' | 'Critical';
  factors: HealthFactor[];
}

export function computeHealthScore(
  report: ParsedReport,
  _historyDelta: RunDelta | null,
  miscErrors: MiscErrorReport | null,
  suiteDrift: SuiteDrift | null,
  // WHY: added 2026-07-14 during Phase 4 verification — a real gap found by
  // actually running this against 4 sequential runs: a run with a test that
  // had failed (or flaked) in 3 of the last 4 recorded runs still scored
  // Excellent, because this function previously only weighed THIS run's raw
  // counts, never the recurring-issue history that the SAME email's Trend
  // section already surfaces prominently. A known, persistent problem must
  // be able to pull the headline score down — it must never be possible for
  // "Excellent" to sit beside a "failing in 3 of the last 4 runs" callout two
  // sections later without the score reflecting it. Defaults to [] so a
  // caller that doesn't yet have this data (e.g. EmailTemplate's own
  // fallbackHealth, which has no history access) degrades to today's
  // behavior rather than erroring.
  recurringFailures: RecurringIssue[] = [],
  recurringFlaky: RecurringIssue[] = [],
  // WHY: added 2026-07-14 — confirmed live via two real sends that the
  // pipeline had no way to distinguish "fresh run" from "stale leftover
  // artifact silently reused." A stale report undermines trust in every
  // other number in the email, so it gets one of the largest flat penalties
  // here rather than a soft nudge — see checkReportFreshness() in
  // NotificationService.ts for how staleness itself is determined.
  isStaleReport = false
): HealthScore {
  let score = 100;
  const factors: HealthFactor[] = [];

  // WHY: 0.6 weight — a pass-rate shortfall is the single strongest signal of
  // "is this suite healthy," but shouldn't alone be able to zero the score
  // out (a 0% pass rate would otherwise swamp every other factor).
  // WHY computed over EXECUTED tests with flaky counted as passing (2026-10-06):
  // a flaky test passed on retry and is penalized separately below, and a
  // skipped test is not a failure — using report.passRate (passed/total)
  // charged each flaky/skipped test twice (Build #186: 9 flaky + 1 skipped).
  // A run where nothing executed still scores 0% here.
  const executed = report.total - report.skipped;
  const effectivePassRate =
    executed > 0 ? Math.round((report.finalPassed / executed) * 100) : 0;
  const passRatePenalty = Math.round((100 - effectivePassRate) * 0.6);
  if (passRatePenalty > 0) {
    score -= passRatePenalty;
    factors.push({ name: 'Passed incl. flaky', impact: -passRatePenalty, note: `${effectivePassRate}% of executed tests passed, flaky counted as passed (skipped excluded; flaky is scored separately below)` });
  }

  const failPenalty = Math.min(report.failed * 3, 25);
  if (failPenalty > 0) {
    score -= failPenalty;
    factors.push({ name: 'Failures', impact: -failPenalty, note: `${report.failed} failed test(s)` });
  }

  // WHY recoveredOnRerun is added (ADR 0015 amendment, 2026-11-24): a test that failed every first attempt and passed
  // only on the rerun is Passed in the counts, but it is the least stable kind of test there is, so it keeps weighing here
  // (it did before the amendment, as a flaky test). A flaky test that passed again on the rerun is resolved and does not.
  const recovered = report.recoveredOnRerun ?? 0;
  const unstable = report.flaky + recovered;
  const flakyPenalty = Math.min(unstable * 1.5, 15);
  if (flakyPenalty > 0) {
    score -= flakyPenalty;
    const parts = [report.flaky > 0 ? `${report.flaky} flaky` : '', recovered > 0 ? `${recovered} passed only on the rerun` : ''].filter(Boolean);
    factors.push({
      name: 'Flakiness',
      impact: -flakyPenalty,
      note: `${parts.join(', ')} test(s)${unstable > FLAKY_BUDGET ? ` — above the budget of ${FLAKY_BUDGET}` : ''}`,
    });
  }

  // Context inputs (background errors, recurring history) — see the constants
  // block at the top of this file; each keeps its own line in the breakdown
  // and the shared CONTEXT_PENALTY_CAP adjustment is applied after them.
  let contextPenaltyRaw = 0;
  const unexpectedMisc = miscErrors?.unexpectedErrors ?? 0;
  const miscPenalty = Math.min(unexpectedMisc * BACKGROUND_ERROR_WEIGHT, BACKGROUND_ERROR_CAP);
  if (miscPenalty > 0) {
    score -= miscPenalty;
    contextPenaltyRaw += miscPenalty;
    factors.push({
      name: 'Background errors',
      impact: -miscPenalty,
      note: `${unexpectedMisc} unexpected background error(s) (capped at ${BACKGROUND_ERROR_CAP} points)`,
    });
  }

  // WHY: suite drift (dropped tests) is penalized flatly and fairly heavily
  // regardless of pass rate, per the explicit reasoning that a shrunk-but-
  // 100%-passing suite must not read as healthy — see detectSuiteDrift's own
  // WHY comment in RunHistory.ts for the full reasoning this mirrors.
  if (suiteDrift?.occurred) {
    const driftPenalty = Math.min(10 + suiteDrift.decreaseBy * 2, 30);
    score -= driftPenalty;
    // WHY basis-aware note text (2026-09-03): a dev-equivalent (reset) run
    // that STILL drifted was compared against the last reset run specifically
    // (see SuiteDrift's own WHY comment) — a genuine baseline-vs-baseline
    // finding, worth citing which run that was so the reader isn't left
    // wondering whether this is the same false-alarm-prone "vs. whatever ran
    // last" comparison this fix exists to stop producing.
    const note =
      suiteDrift.basis === 'previous-reset-run'
        ? `${suiteDrift.decreaseBy} fewer test(s) ran than the last reset-to-dev run (#${suiteDrift.baselineBuildNumber}, ${suiteDrift.baselineTotal} tests)`
        : `${suiteDrift.decreaseBy} fewer test(s) ran than the previous run`;
    factors.push({ name: 'Suite drift', impact: -driftPenalty, note });
  }

  // WHY: failures weighted heavier than flaky here — a test that keeps
  // failing outright across recent runs is a stronger "known, unaddressed
  // problem" signal than one that keeps eventually passing on retry. Both
  // are weighted BELOW this run's own results (2026-10-06): they are history
  // about other runs, computed from same-branch/same-scope, one-per-build
  // history (RunHistory.ts), and this run's own failed count already carries
  // the full "is it broken now" signal.
  const recurringFailurePenalty = Math.min(
    recurringFailures.length * RECURRING_FAILURE_WEIGHT,
    RECURRING_FAILURE_CAP
  );
  if (recurringFailurePenalty > 0) {
    score -= recurringFailurePenalty;
    contextPenaltyRaw += recurringFailurePenalty;
    factors.push({
      name: 'Recurring failures',
      impact: -recurringFailurePenalty,
      note: `${recurringFailures.length} test(s) recurring failing across recent runs (capped at ${RECURRING_FAILURE_CAP} points)`,
    });
  }
  const recurringFlakyPenalty = Math.min(
    recurringFlaky.length * RECURRING_FLAKY_WEIGHT,
    RECURRING_FLAKY_CAP
  );
  if (recurringFlakyPenalty > 0) {
    score -= recurringFlakyPenalty;
    contextPenaltyRaw += recurringFlakyPenalty;
    factors.push({
      name: 'Recurring flakiness',
      impact: -recurringFlakyPenalty,
      note: `${recurringFlaky.length} test(s) recurring flaky across recent runs (capped at ${RECURRING_FLAKY_CAP} points)`,
    });
  }
  if (contextPenaltyRaw > CONTEXT_PENALTY_CAP) {
    const give = contextPenaltyRaw - CONTEXT_PENALTY_CAP;
    score += give;
    factors.push({
      name: 'Context cap',
      impact: give,
      note: `background errors + recurring history together can cost at most ${CONTEXT_PENALTY_CAP} points (they summed to ${contextPenaltyRaw})`,
    });
  }

  if (isStaleReport) {
    const stalePenalty = 30;
    score -= stalePenalty;
    factors.push({
      name: 'Data freshness',
      impact: -stalePenalty,
      note: 'report data is suspiciously old — see the freshness warning above',
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  // A run with 0 failed tests cannot be Critical — see the constants block at
  // the top. The raw score stays visible as its own factor line.
  if (report.failed === 0 && report.status !== 'no-tests-executed' && score < ZERO_FAILURE_SCORE_FLOOR) {
    const lift = ZERO_FAILURE_SCORE_FLOOR - score;
    factors.push({
      name: 'Zero-failure floor',
      impact: lift,
      note: `0 failed tests this run, so health cannot fall below ${ZERO_FAILURE_SCORE_FLOOR}/100 (raw score ${score})`,
    });
    score = ZERO_FAILURE_SCORE_FLOOR;
  }
  // WHY (2026-11-25, scenario matrix finding: "Health: Excellent" beside a red FAILED run): any failed test caps the label at
  // 'Good', and 3 failures or 5% of the executed tests cap it at 'Needs Attention'. The score is capped with it and the cap is its own
  // factor line, so the number, the label and the verdict never contradict each other.
  if (report.failed > 0) {
    const cap = report.failed >= 3 || report.failed >= executed * 0.05 ? FAILURE_CAP_SEVERE : FAILURE_CAP_ANY;
    if (score > cap) {
      factors.push({ name: 'Failure cap', impact: cap - score, note: `${report.failed} failed test(s) keep health at or below ${cap}/100 (${cap === FAILURE_CAP_SEVERE ? 'Needs Attention' : 'Good'}); raw score ${score}` });
      score = cap;
    }
  }
  const label: HealthScore['label'] =
    score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Needs Attention' : 'Critical';

  return { score, label, factors };
}

/**
 * Why a run's health score does not apply, or null when it does. A run where no test ran (renew-session blocked, report missing),
 * only some shards reported, or nothing was selected verified nothing, so a score computed from the surviving numbers would read
 * "Excellent" for a run that proved nothing (scenario matrix, 2026-11-25).
 */
export function healthNotApplicableReason(
  report: ParsedReport,
  shardCompleteness?: ShardCompleteness | null,
  renewalFailure?: RenewalFailure | null
): string | null {
  if (renewalFailure || (isIncompleteRun(shardCompleteness) && shardCompleteness.cause?.startsWith('renew-session'))) return 'no test ran (the admin session was not renewed)';
  if (isIncompleteRun(shardCompleteness)) return `only ${shardCompleteness.reported} of ${shardCompleteness.expected} shards reported`;
  if (report.total === 0) return 'no tests were selected';
  if (report.status === 'no-tests-executed') return 'no test actually ran';
  return null;
}

/**
 * The SINGLE source of truth for "is this run okay," consumed identically by
 * EmailTemplate's status banner AND its Executive Summary headline (2026-08-24
 * fix for a real, confirmed-live contradiction: a run with 0 failures/0 flaky
 * this run — banner: "✅ Passed" — could still independently compute
 * health.label === 'Critical' via background errors/staleness/suite drift,
 * producing Executive Summary's own separately-derived "Deployment not
 * recommended" right next to a green "Passed" banner. That was possible
 * because the banner and the summary each computed their own verdict from
 * different inputs. Making both render from this ONE function's output
 * makes disagreement structurally impossible — not just less likely — since
 * there is only one verdict, not two independently-derived ones.
 */
/**
 * The recommendation wording per branch (item 16, 2026-11-25): sandbox, dev and feature branches answer "is this ready for a PR to dev?";
 * qa, stage, prod and main keep the deployment wording (the run is the gate for a promotion or a release).
 */
export function branchAdvice(branch?: string): { ready: string; likely: string; notReady: string; review: string; prLike: boolean } {
  const prLike = !!branch && (['sandbox', 'dev'].includes(branch) || branch.startsWith('feature/'));
  return prLike
    ? { ready: 'Ready for a PR to dev', likely: 'Likely ready for a PR to dev', notReady: 'Not ready for a PR to dev', review: 'Recommended — review before opening the PR', prLike }
    : { ready: 'Deployment recommended', likely: 'Deployment likely safe', notReady: 'Deployment not recommended', review: 'Recommended — review before the next release', prLike };
}

export function computeOverallVerdict(
  report: ParsedReport,
  health: HealthScore,
  suiteDrift: SuiteDrift | null,
  shardCompleteness?: ShardCompleteness | null,
  renewalFailure?: RenewalFailure | null,
  branch?: string
): VerdictResult {
  const advice = branchAdvice(branch);
  // WHY first of all (2026-11-24, sandbox run 45420781016): when the renew-session job fails every test job is skipped, no shard
  // reports, and the run used to read "Incomplete run — 0 of N shards", which says a job crashed. No test ran, and the cause is
  // known (renew-session-failed.json, or the job result recorded in shard-completeness.json): the verdict names it.
  if (renewalFailure) {
    return {
      verdict: 'blocked',
      bannerLabel: `🚫 ${renewalFailureLabel(renewalFailure)}`,
      bannerTone: 'danger',
      headline: `No test ran — ${describeRenewalFailure(renewalFailure)}`,
    };
  }
  if (isIncompleteRun(shardCompleteness) && shardCompleteness.cause?.startsWith('renew-session')) {
    return {
      verdict: 'blocked',
      bannerLabel: '🚫 BLOCKED — renew-session job failed',
      bannerTone: 'danger',
      headline: `No test ran — the renew-session job did not succeed (${shardCompleteness.cause.replace(/^renew-session:\s*/, '')}), so every test job was skipped; see that job's summary`,
    };
  }
  // WHY checked before everything else (2026-10-08, sandbox build #189, run
  // 37669596623): 2 of 6 formFields jobs hung in the browser install and were
  // cancelled, yet the 4 that finished produced "277 passed, 0 failed" and a
  // green "PASSED / Excellent" email. A run missing shard reports verified
  // only part of the suite, so it can never be 'clear' or 'caution'; the
  // verdict is 'blocked' with a danger tone whatever the surviving counts say.
  if (isIncompleteRun(shardCompleteness)) {
    const failedNote = report.failed > 0 ? ` (${report.failed} failure(s) in the shards that did report)` : '';
    return {
      verdict: 'blocked',
      bannerLabel: `🚫 Incomplete Run — ${shardCompleteness.reported} of ${shardCompleteness.expected} shards reported`,
      bannerTone: 'danger',
      headline: `${advice.notReady} — only ${shardCompleteness.reported} of ${shardCompleteness.expected} shard reports were merged, so totals understate the run${failedNote}`,
    };
  }
  // WHY checked first, before anything else (confirmed live, sandbox Build
  // #167, 2026-09-08): a report where 0 tests actually executed (all
  // skipped — see ReportParser.ts's own WHY comment on 'no-tests-executed')
  // has failed===0 and flaky===0 by construction, so it would otherwise fall
  // all the way through to the final 'clear'/'✅ Passed' branch below — a
  // literal false positive, not just an unhelpful one. This must never be
  // described as a "clean run" (the health.label==='Critical' branch further
  // down does that) because nothing ran, clean or otherwise.
  if (report.total === 0) {
    return { verdict: 'caution', bannerLabel: '⚠️ No Tests Selected', bannerTone: 'warning', headline: 'No tests were selected, so nothing was verified — check the test filter or the shard plan' };
  }
  if (report.status === 'no-tests-executed') {
    return {
      verdict: 'blocked',
      bannerLabel: '🚫 No Tests Executed',
      bannerTone: 'danger',
      headline: `${advice.notReady} — 0 of ${report.total} tests actually ran (all reported skipped) — this run verified nothing`,
    };
  }
  if (report.failed > 0) {
    return { verdict: 'blocked', bannerLabel: '❌ Failed', bannerTone: 'danger', headline: advice.notReady };
  }
  if (suiteDrift?.occurred) {
    // WHY verdict stays 'blocked' even though report.failed === 0 here,
    // BY DESIGN (2026-09-09) — this is deliberate, not a leftover bug to
    // "fix" later: a genuine suite drift (fewer tests ran than a real,
    // comparable prior run — same branch, same normalized scope, per
    // computeSuiteDrift()'s now-scope-aware comparison) means tests
    // silently vanished, which is frequently a broken test file or an
    // accidentally-skipped describe block, not an intentional cleanup —
    // see detectSuiteDrift()'s own WHY comment on why a false positive
    // here is a far cheaper cost than a false negative. A 100%-passing
    // run tells you nothing about tests that never ran at all, so
    // 'blocked' here is intentionally as strong a gate as an actual test
    // failure.
    // WHY bannerTone is 'warning', not 'danger', THOUGH (2026-09-09 fix):
    // before this, a clean, 0-failed run with drift rendered with the
    // exact same ❌/red failure iconography as a genuinely broken run
    // (EmailTemplate.ts derives its icon/colors purely from bannerTone,
    // confirmed by reading it) — indistinguishable from "tests failed" at
    // a glance, even though bannerLabel already said "Suite Drift
    // Detected," not "Failed". 'warning' keeps the SAME blocking verdict
    // but renders with the amber/⚠️ treatment this genuinely is: an
    // anomaly worth investigating before deploying, not proof that
    // anything actually broke this run.
    return {
      verdict: 'blocked',
      bannerLabel: '⚠️ Suite Drift Detected',
      bannerTone: 'warning',
      headline: `${advice.notReady} — suite drift detected`,
    };
  }
  // WHY there is no `health.label === 'Critical'` branch any more (2026-10-06):
  // it produced "⚠️ Passed — Health Critical" with a danger tone — i.e. a red
  // ❌ subject — for a run with 0 failed tests (sandbox Build #186). The
  // verdict and icon now come only from THIS run's results; health is
  // rendered as its own labeled value (subject segment, masthead, Health
  // Score block). computeHealthScore() also guarantees a 0-failure run never
  // reaches Critical, so nothing here depends on that label.
  // WHY (2026-11-03, rule "green only when every test passed on its first try"): a test that never ran (serial
  // dependent after a failure, cut-off shard; no skip annotation) or that ran only on the rerun was not verified by
  // the first run. It never failed, so the run is not red, but it is never a clean Passed either.
  // A flaky test that passed again on the rerun shard is resolved (Passed after the rerun): when it is the only issue the
  // run is green. A test that failed every first attempt and passed only on the rerun is Passed in the counts but is NOT
  // resolved for the verdict (ADR 0015 amendment, 2026-11-24): the run stays amber, never a clean green.
  // WHY the colour rule is by results only (2026-11-25, approved after the scenario matrix: the same results were green with a rerun and
  // amber without one). Green when everything passed in the end, flaky tests (passed on an in-job retry, whether or not the rerun
  // confirmed them) are within FLAKY_BUDGET and no test failed every attempt. Amber when flaky is above the budget, a test passed only
  // on the rerun after failing every first attempt (D2), or tests did not run / ran only on the rerun. The flaky count is always in the subject.
  const recoveredOnRerun = report.recoveredOnRerun ?? 0;
  const flakyTotal = report.firstRun.flaky;
  const notVerified = (report.didNotRun ?? 0) + (report.ranOnlyOnRerun ?? 0);
  const aboveBudget = flakyTotal > FLAKY_BUDGET;
  if (aboveBudget || recoveredOnRerun > 0 || notVerified > 0) {
    const notConfirmed = report.flaky > 0 && report.flaky < flakyTotal ? ` (${report.flaky} not confirmed by the rerun)` : '';
    const parts = [
      flakyTotal > 0 ? `${flakyTotal} flaky${notConfirmed}` : '',
      recoveredOnRerun > 0 ? `${recoveredOnRerun} passed only on rerun` : '',
      report.didNotRun > 0 ? `${report.didNotRun} did not run` : '',
      report.ranOnlyOnRerun > 0 ? `${report.ranOnlyOnRerun} ran only on rerun` : '',
    ].filter(Boolean);
    const reasons = [
      aboveBudget ? `${flakyTotal} flaky tests is above the budget of ${FLAKY_BUDGET}` : '',
      recoveredOnRerun > 0 ? `${recoveredOnRerun} test(s) failed every attempt and passed only on the rerun` : '',
      notVerified > 0 ? `${notVerified} test(s) did not run in the first run` : '',
    ].filter(Boolean);
    return {
      verdict: 'caution',
      bannerLabel: `⚠️ Unstable — ${parts.join(', ')}`,
      bannerTone: 'warning',
      headline: `${advice.likely} — but ${reasons.join('; ')}; review them`,
    };
  }
  if (health.label === 'Needs Attention') {
    return {
      verdict: 'caution',
      bannerLabel: '⚠️ Passed',
      bannerTone: 'warning',
      headline: `${advice.likely} — automation health needs attention; review the health factors before proceeding`,
    };
  }
  return { verdict: 'clear', bannerLabel: '✅ Passed', bannerTone: 'success', headline: advice.ready };
}
