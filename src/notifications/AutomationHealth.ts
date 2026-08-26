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
import { ParsedReport } from './ReportParser';
import { RunDelta, SuiteDrift, RecurringIssue } from './RunHistory';
import { MiscErrorReport } from '../error-collector/ErrorCollector';

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
  const passRatePenalty = Math.round((100 - report.passRate) * 0.6);
  if (passRatePenalty > 0) {
    score -= passRatePenalty;
    factors.push({ name: 'Pass rate', impact: -passRatePenalty, note: `${report.passRate}% pass rate` });
  }

  const failPenalty = Math.min(report.failed * 3, 25);
  if (failPenalty > 0) {
    score -= failPenalty;
    factors.push({ name: 'Failures', impact: -failPenalty, note: `${report.failed} failed test(s)` });
  }

  const flakyPenalty = Math.min(report.flaky * 1.5, 15);
  if (flakyPenalty > 0) {
    score -= flakyPenalty;
    factors.push({ name: 'Flakiness', impact: -flakyPenalty, note: `${report.flaky} flaky test(s)` });
  }

  const unexpectedMisc = miscErrors?.unexpectedErrors ?? 0;
  const miscPenalty = Math.min(unexpectedMisc * 2, 15);
  if (miscPenalty > 0) {
    score -= miscPenalty;
    factors.push({
      name: 'Background errors',
      impact: -miscPenalty,
      note: `${unexpectedMisc} unexpected background error(s)`,
    });
  }

  // WHY: suite drift (dropped tests) is penalized flatly and fairly heavily
  // regardless of pass rate, per the explicit reasoning that a shrunk-but-
  // 100%-passing suite must not read as healthy — see detectSuiteDrift's own
  // WHY comment in RunHistory.ts for the full reasoning this mirrors.
  if (suiteDrift?.occurred) {
    const driftPenalty = Math.min(10 + suiteDrift.decreaseBy * 2, 30);
    score -= driftPenalty;
    factors.push({
      name: 'Suite drift',
      impact: -driftPenalty,
      note: `${suiteDrift.decreaseBy} fewer test(s) ran than the previous run`,
    });
  }

  // WHY: failures weighted heavier than flaky here — a test that keeps
  // failing outright across recent runs is a stronger "known, unaddressed
  // problem" signal than one that keeps eventually passing on retry.
  const recurringFailurePenalty = Math.min(recurringFailures.length * 8, 24);
  if (recurringFailurePenalty > 0) {
    score -= recurringFailurePenalty;
    factors.push({
      name: 'Recurring failures',
      impact: -recurringFailurePenalty,
      note: `${recurringFailures.length} test(s) recurring failing across recent runs`,
    });
  }
  const recurringFlakyPenalty = Math.min(recurringFlaky.length * 4, 16);
  if (recurringFlakyPenalty > 0) {
    score -= recurringFlakyPenalty;
    factors.push({
      name: 'Recurring flakiness',
      impact: -recurringFlakyPenalty,
      note: `${recurringFlaky.length} test(s) recurring flaky across recent runs`,
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
  const label: HealthScore['label'] =
    score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Needs Attention' : 'Critical';

  return { score, label, factors };
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
export function computeOverallVerdict(
  report: ParsedReport,
  health: HealthScore,
  suiteDrift: SuiteDrift | null
): VerdictResult {
  if (report.failed > 0) {
    return { verdict: 'blocked', bannerLabel: '❌ Failed', bannerTone: 'danger', headline: 'Deployment not recommended' };
  }
  if (suiteDrift?.occurred) {
    return {
      verdict: 'blocked',
      bannerLabel: '⚠️ Suite Drift Detected',
      bannerTone: 'danger',
      headline: 'Deployment not recommended — suite drift detected',
    };
  }
  // WHY this branch is the actual fix: a clean run (0 failed) whose health
  // score is still Critical (background errors, staleness, recurring
  // history) must say so IN THE BANNER ITSELF, not show a plain "Passed"
  // that contradicts a "Critical"/"not recommended" verdict shown two
  // sections later.
  if (health.label === 'Critical') {
    return {
      verdict: 'blocked',
      bannerLabel: '⚠️ Passed — Health Critical',
      bannerTone: 'danger',
      headline: 'Deployment not recommended — automation health is Critical despite a clean run this time',
    };
  }
  if (report.flaky > 0) {
    return {
      verdict: 'caution',
      bannerLabel: '⚠️ Unstable',
      bannerTone: 'warning',
      headline: 'Deployment likely safe — review flaky tests',
    };
  }
  if (health.label === 'Needs Attention') {
    return {
      verdict: 'caution',
      bannerLabel: '⚠️ Passed — Needs Attention',
      bannerTone: 'warning',
      headline: 'Deployment likely safe — review automation health factors before proceeding',
    };
  }
  return { verdict: 'clear', bannerLabel: '✅ Passed', bannerTone: 'success', headline: 'Deployment recommended' };
}
