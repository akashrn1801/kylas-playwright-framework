import { ParsedReport, TestResult } from './ReportParser';
import {
  RunDelta,
  RecurringIssue,
  ModuleTrend,
  SlowTestTrend,
  SuiteDrift,
  PassRatePoint,
} from './RunHistory';
import { HealthScore, VerdictResult, computeOverallVerdict } from './AutomationHealth';
import { FailureCategory } from './FailureAnalyzer';
import { EnrichedCluster, FailureDetail, RegressionStatus } from './FailureDetailBuilder';
import { MiscErrorReport, MiscError } from '../error-collector/ErrorCollector';
import { redactSensitiveText } from './redact';

// WHY: a dedicated version for the REPORT TEMPLATE specifically, not
// package.json's version — the template's structure changes independently of
// the rest of the test framework, so a shared version number would be
// meaningless for its actual debugging purpose (figuring out why an old
// email's layout/behavior doesn't match current code). Bump this whenever
// EmailTemplate's structure changes materially. Set to 2.0.0 to mark the
// 2026-07-14 restrained-enterprise-redesign overhaul (the 1.x line was the
// original 2026-07-07 P0-P5 reporting overhaul design).
export const REPORT_ENGINE_VERSION = '2.0.0';

// WHY: added 2026-07-14 — confirmed live via two real sends that this
// pipeline had no way to tell "fresh run" from "stale leftover artifact
// silently reused." Computed by NotificationService.checkReportFreshness()
// against report.endTime; lives here (not in NotificationService.ts) so
// EmailTemplate never needs to import from NotificationService — keeps the
// existing one-directional dependency (NotificationService imports from
// EmailTemplate, never the reverse).
export interface ReportFreshness {
  isStale: boolean;
  ageMs: number;
  thresholdHours: number;
}

export interface EmailContext {
  report: ParsedReport;
  env: string;
  branch: string;
  buildNumber: string;
  buildUrl: string;
  gitCommit: string;
  triggeredBy: string;
  runSource?: 'local' | 'github-actions' | 'jenkins';
  allureUrl?: string;
  miscErrors?: MiscErrorReport | null;
  // WHY: optional, same graceful-absence pattern as miscErrors — populated by
  // scripts/syncHistory.ts when the history-sync step ran and there was a
  // previous run to compare against.
  historyDelta?: RunDelta | null;
  recurringFlaky?: RecurringIssue[];
  recurringFailures?: RecurringIssue[];
  moduleTrend?: ModuleTrend[];
  slowTestTrend?: SlowTestTrend[];
  suiteDrift?: SuiteDrift | null;
  passRateSeries?: PassRatePoint[];
  // WHY: computed once by NotificationService from FailureAnalyzer/
  // AutomationHealth and threaded through here — EmailTemplate only renders,
  // it never re-derives analysis from raw data.
  health?: HealthScore;
  // WHY: the SINGLE source of truth for "is this run okay" — see
  // AutomationHealth.computeOverallVerdict()'s own WHY comment. Both the
  // status banner and the Executive Summary headline render from this one
  // object so they can never independently disagree.
  verdict?: VerdictResult;
  clusters?: EnrichedCluster[];
  // WHY a separate field, not folded into `clusters`: flaky tests are never
  // clustered (clusterFailures() only ever accepts report.failedTests) —
  // this is each flaky test's OWN failing-attempt detail (full error
  // sequence, snippet, stack, classification), rendered inside the existing
  // Flaky Tests section, not a new section.
  flakyFailureDetails?: FailureDetail[];
  // WHY: distinguishes "the history mechanism has never had a chance to
  // compare" (no prior run recorded at all) from "compared, and this
  // specific module/test had no prior entry" — see the Module Analytics
  // trend-column fix and RegressionStatus.unclassified for where this
  // matters. Undefined/false renders the same honest "no history yet" state.
  hasHistoryEverExisted?: boolean;
  // WHY: base GitHub blob URL (pinned to this run's exact commit SHA) for
  // the known-issues.md cross-reference — a specific failure's line number
  // (FailureDetail.knownIssue.line) is appended as #L<line> at render time.
  // Null when the remote isn't GitHub or couldn't be resolved.
  knownIssuesUrl?: string | null;
  reportFreshness?: ReportFreshness;
  // WHY: real data only — Node/OS of the process that generated this report
  // (captured at NotificationService runtime), distinct from
  // report.playwrightVersion/workers/projects, which describe what Playwright
  // itself tested (sourced from the JSON report's own raw.config).
  nodeVersion?: string;
  osInfo?: string;
  // WHY: repo-relative directory holding this run's html/json/allure output —
  // derived directly from the same jsonReportPath NotificationService already
  // received, not guessed.
  reportsDir?: string;
  // WHY: resolved from `git remote get-url origin` (same technique
  // scripts/syncHistory.ts already uses) — null/undefined when the remote
  // isn't GitHub or couldn't be resolved; never fabricated.
  historyBranchUrl?: string | null;
}

const INK = '#1B1F24';
const SLATE = '#57606A';
const MUTED = '#8C959F';
const BORDER = '#D0D7DE';
const CANVAS_TINT = '#F6F8FA';
const ACCENT = '#3654C7';
const SUCCESS = '#1A7F37';
const SUCCESS_BG = '#DAFBE1';
const SUCCESS_BORDER = '#B4E8BF';
const FAIL = '#CF222E';
const FAIL_BG = '#FFEBE9';
const FAIL_BORDER = '#F5C6C2';
const WARN = '#9A6700';
const WARN_BG = '#FFF8C5';
const WARN_BORDER = '#F2E29B';
// WHY: single-quoted multi-word font names, not double-quoted — a real bug
// caught during Phase 4 verification (2026-07-14): these strings get embedded
// inside double-quoted HTML style="..." attributes everywhere in this file
// (e.g. style="font-family:${MONO_FONT};"). Double-quoting "SF Mono" etc.
// inside that already-double-quoted attribute terminates the attribute value
// early at the first inner quote, corrupting every element that used it —
// confirmed by inspecting real rendered output, not just by reading the code.
const MONO_FONT = "ui-monospace,'SF Mono','Cascadia Code',Consolas,monospace";
const SANS_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export class EmailTemplate {
  subject(ctx: EmailContext): string {
    const icon =
      ctx.report.status === 'passed' ? '✅' : ctx.report.status === 'failed' ? '❌' : '⚠️';
    const status = ctx.report.status.toUpperCase();
    // WHY: a stale report must be unmissable even in an inbox list view,
    // where the banner below the fold won't be seen until the email is
    // opened — prefixed here so it's visible before that.
    const stalePrefix = ctx.reportFreshness?.isStale ? '⚠️ STALE REPORT — ' : '';
    return `${stalePrefix}${icon} [${ctx.env.toUpperCase()}] Kylas Automation — ${status} | Branch: ${ctx.branch} | Build #${ctx.buildNumber}`;
  }

  html(ctx: EmailContext): string {
    const health = ctx.health ?? this.fallbackHealth(ctx.report);
    const clusters = ctx.clusters ?? [];
    // WHY computed here (not left undefined) when a caller omits it: mirrors
    // fallbackHealth()'s own precedent — EmailTemplate must render something
    // correct even if a caller forgets to pass ctx.verdict, using the same
    // real computeOverallVerdict() logic rather than a second, drifting copy.
    const verdict = ctx.verdict ?? computeOverallVerdict(ctx.report, health, ctx.suiteDrift ?? null);
    // WHY built once, threaded through: lets the Trend section's "recurring
    // flaky/failing" test names and Action Required's items deep-link to a
    // specific test's own card in Failed/Flaky Tests when that test actually
    // appears in THIS run's output — see buildTestAnchorLookup()'s own WHY.
    const testAnchors = this.buildTestAnchorLookup(clusters, ctx.flakyFailureDetails ?? []);

    const body = [
      this.buildFreshnessWarning(ctx.reportFreshness),
      this.buildMasthead(ctx, health),
      this.buildStatusBanner(verdict),
      this.buildStatusBadgeRow(ctx),
      this.buildExecutiveSummary(ctx, health, clusters, verdict),
      this.buildHealthScoreBlock(health),
      this.buildRunMetadata(ctx),
      this.buildKpiDashboard(ctx),
      this.buildTrendSection(ctx, testAnchors),
      this.buildModuleAnalytics(ctx),
      this.buildSlowTestsSection(ctx),
      this.buildFlakyTestsSection(ctx),
      this.buildFailureClustersSection(clusters, ctx.knownIssuesUrl),
      this.buildBackgroundErrorsSection(ctx.miscErrors),
      this.buildActionRequiredSection(ctx, health, clusters),
      this.buildEnvironmentInfoBlock(ctx),
      this.buildCiCdInfoBlock(ctx),
      this.buildCtaButtons(ctx),
      this.buildFooter(ctx),
    ].join('');

    return `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  /* Progressive enhancement only — every visual below has a fully functional
     inline-style fallback for clients that strip <style> (e.g. Outlook
     desktop). Real email-client dark-mode support varies significantly and
     this has not been verified against live Outlook/Gmail dark rendering —
     treat this block as best-effort, not a tested guarantee. */
  @media (prefers-color-scheme: dark) {
    .email-bg { background:#0E1116 !important; }
    .email-card { background:#0E1116 !important; border-color:#2B3440 !important; }
    .email-text { color:#E6EDF3 !important; }
    .email-muted { color:#9BA5B1 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${SANS_FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center">
<!-- WHY: reverted to fully fluid, no width cap (2026-07-14) — matches the
     original (pre-overhaul) template's actual behavior exactly, per explicit
     confirmation that even a wide 750px cap still left visible white space
     in a wider reading pane. Any fixed cap will always leave a gap once the
     pane is wider than the cap — there is no fixed number that fills every
     pane. Removing the cap trades that gap for the old template's own
     (previously invisible) tradeoff: on a very wide monitor, line-length and
     tile spacing stretch out rather than staying at a comfortable reading
     width. Confirmed acceptable — this is what the old template already did,
     unconditionally, in every client including Outlook desktop. -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-bg" style="background:#ffffff;width:100%;">
${body}
</table>
</td></tr>
</table>
</body></html>`;
  }

  // ===================== Masthead + status =====================

  // WHY: rendered as the very first thing in the email, above the masthead —
  // a stale report undermines trust in every number below it, so it must be
  // seen before anything else, not buried after the Executive Summary.
  // Renders nothing when freshness data isn't available (e.g. a caller that
  // hasn't wired NotificationService.checkReportFreshness()) or isn't stale.
  private buildFreshnessWarning(freshness: ReportFreshness | undefined): string {
    if (!freshness?.isStale) return '';
    const hours = Math.round(freshness.ageMs / 3_600_000);
    const ageLabel = hours >= 24 ? `${Math.round(hours / 24)} day(s)` : `${hours} hour(s)`;
    return `
<tr><td style="background:${FAIL};padding:12px 28px;text-align:center;">
  <span style="font-size:13px;font-weight:700;color:#ffffff;">⚠ STALE REPORT — this data is ${ageLabel} old (threshold: ${freshness.thresholdHours}h), not from a fresh run. Investigate why fresh results weren't available before treating this as current.</span>
</td></tr>`;
  }

  private buildMasthead(ctx: EmailContext, health: HealthScore): string {
    return `
<tr><td style="background:${INK};padding:20px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:16px;font-weight:700;color:#ffffff;">Kylas <span style="font-weight:400;color:#9BA9FF;">${this.esc(ctx.env.toUpperCase())} Automation</span></td>
    <td align="right" style="font-size:11px;color:#9BA5B1;">Automation Health: <strong style="color:#ffffff;">${health.label}</strong></td>
  </tr></table>
  <div style="font-size:12px;color:#9BA5B1;margin-top:6px;">Test Execution Report — ${this.esc(this.formatReportDate(ctx.report.startTime))}</div>
</td></tr>`;
  }

  // WHY: brought back 2026-07-14 (Part A) — a full-width status banner
  // replaces the earlier compact masthead pill rather than sitting alongside
  // it, to avoid showing PASSED/FAILED/UNSTABLE twice in two adjacent blocks.
  // Uses the restrained design system's own semantic tokens (not the old
  // template's saturated colors) and a text-only label, no emoji, per the
  // approved direction.
  // WHY rewritten 2026-08-24 to render from VerdictResult, not report.status
  // directly: this is the actual fix for a confirmed-live contradiction
  // (a run reading "✅ Passed" here while Executive Summary said "Deployment
  // not recommended" / health "Critical" two sections later) — see
  // AutomationHealth.computeOverallVerdict()'s own WHY comment. Rendering
  // both the banner and the Executive Summary headline from the SAME
  // VerdictResult object makes that disagreement structurally impossible.
  private buildStatusBanner(verdict: VerdictResult): string {
    const bg = verdict.bannerTone === 'success' ? SUCCESS : verdict.bannerTone === 'warning' ? WARN : FAIL;
    return `
<tr><td style="background:${bg};padding:12px 28px;text-align:center;">
  <span style="font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;">${this.esc(verdict.bannerLabel)}</span>
</td></tr>`;
  }

  private buildStatusBadgeRow(ctx: EmailContext): string {
    // WHY: emoji reintroduced 2026-07-14, matching the old template's exact
    // choice (🐙 GitHub Actions / 🔧 Jenkins / 💻 Local) — same "contextual
    // header indicator" scope as the status banner above, not applied
    // broadly to every section header.
    const sourceLabel =
      ctx.runSource === 'github-actions'
        ? '🐙 GitHub Actions'
        : ctx.runSource === 'jenkins'
          ? '🔧 Jenkins'
          : '💻 Local';
    // WHY: checked the old (pre-overhaul) template's real badge implementation
    // (git show HEAD) — it didn't use one flat color per field. ENV and
    // SOURCE were color-coded by their actual VALUE (env: prod/staging/qa
    // each a different color; source: Jenkins/GitHub Actions/local each a
    // different color) — real, useful signal, not decoration. BRANCH/BUILD
    // were flat single colors. First reproduced with new muted hex values to
    // match this design system, then switched to the old template's EXACT
    // hex values verbatim per explicit confirmation (2026-07-14) that exact
    // match was wanted here, same as the width decision. Kept this template's
    // own shape (rectangle, border-radius:4px) rather than the old
    // template's fully-rounded pill (border-radius:20px) — the color request
    // was specifically about color, not reverting the shape/structure
    // established for the rest of the redesign. No border (old had none —
    // a border in a different color would contradict "exact old colors").
    // Solid (not rgba) — Outlook's Word engine (limited legacy CSS subset,
    // see the width fix's WHY comment) drops unsupported rgba() values
    // entirely rather than degrading them, which is why an earlier
    // rgba-based version of these chips could render with no visible color
    // at all. Chips are joined with a literal space (not just CSS margin) so
    // spacing survives in plain-text/no-CSS contexts too (screen readers,
    // copy-paste, stripped-down clients).
    const ENV_COLORS: Record<string, string> = {
      prod: '#7c3aed',
      staging: '#0891b2',
      qa: '#059669',
    };
    const SOURCE_COLORS: Record<string, string> = {
      jenkins: '#d33833',
      'github-actions': '#24292f',
      local: '#6b7280',
    };
    const NEUTRAL = '#374151';
    const BRANCH_COLOR = '#2563eb';
    const chip = (label: string, value: string, bg: string, monospace = false): string =>
      `<span style="display:inline-block;font-size:11px;color:#ffffff;background:${bg};border-radius:4px;padding:4px 9px;margin:3px 6px 0 0;">${label} <b style="color:#ffffff;font-weight:600;${monospace ? `font-family:${MONO_FONT};` : ''}">${value}</b></span>`;
    const chips = [
      chip('ENV', this.esc(ctx.env.toUpperCase()), ENV_COLORS[ctx.env] ?? ENV_COLORS.qa),
      chip('BRANCH', this.esc(ctx.branch), BRANCH_COLOR, true),
      chip('BUILD', `#${this.esc(ctx.buildNumber)}`, NEUTRAL, true),
      chip('SOURCE', this.esc(sourceLabel), SOURCE_COLORS[ctx.runSource ?? 'local'] ?? NEUTRAL),
    ].join(' ');
    return `
<tr><td style="background:${INK};padding:0 28px 18px;">
  ${chips}
</td></tr>`;
  }

  // ===================== Executive summary + health =====================

  private buildExecutiveSummary(
    ctx: EmailContext,
    health: HealthScore,
    clusters: EnrichedCluster[],
    verdict: VerdictResult
  ): string {
    const { report } = ctx;
    const drift = ctx.suiteDrift;
    const multiTestClusters = clusters.filter((c) => c.tests.length > 1);
    // WHY: multiTestClusters.length is a CLUSTER count, not a test count —
    // a real bug caught during Phase 4 verification (2026-07-14): the
    // original wording said "N of which share a common root cause" using the
    // cluster count directly, which misreads as "N tests share a cause" when
    // it's actually N *clusters* covering a larger number of tests (e.g. 2
    // clusters of 2 tests each = 4 tests, not 2). Report both numbers.
    const clusteredTestCount = multiTestClusters.reduce((sum, c) => sum + c.tests.length, 0);

    const sentences: string[] = [];
    if (report.failed > 0) {
      sentences.push(
        `${report.failed} test${report.failed === 1 ? '' : 's'} failed${
          multiTestClusters.length > 0
            ? `, ${clusteredTestCount} of them grouped into ${multiTestClusters.length} shared-cause cluster${multiTestClusters.length === 1 ? '' : 's'} (see Failed Tests)`
            : ''
        }.`
      );
    } else {
      sentences.push('No test failures this run.');
    }
    if (report.flaky > 0) sentences.push(`${report.flaky} flaky test${report.flaky === 1 ? '' : 's'} observed.`);
    if (drift?.occurred) {
      sentences.push(
        `Test count dropped by ${drift.decreaseBy} vs. the previous run — confirm this was intentional (see Action Required).`
      );
    }
    const unexpectedMisc = ctx.miscErrors?.unexpectedErrors ?? 0;
    if (unexpectedMisc > 0) {
      sentences.push(`${unexpectedMisc} unexpected background error${unexpectedMisc === 1 ? '' : 's'} captured.`);
    }
    // WHY health.label surfaced explicitly here (2026-08-24) when it's the
    // reason a clean run still isn't "clear": without this sentence, a
    // reader would see "No test failures this run." next to a "not
    // recommended" headline with no explanation connecting the two.
    if (report.failed === 0 && !drift?.occurred && verdict.verdict !== 'clear') {
      sentences.push(`Automation health is ${health.label} — see Health Score below for why.`);
    }

    // WHY headline/tone come from `verdict` (computeOverallVerdict()'s
    // single shared output), not independently recomputed here — this is
    // the other half of the item-1 fix; see buildStatusBanner()'s WHY.
    const isPositive = verdict.verdict === 'clear';
    const stripeColor: string = verdict.bannerTone === 'success' ? SUCCESS : verdict.bannerTone === 'warning' ? WARN : FAIL;
    const cardBg = isPositive ? '#F3FBF4' : verdict.bannerTone === 'warning' ? WARN_BG : FAIL_BG;
    const cardBorder = isPositive ? SUCCESS_BORDER : verdict.bannerTone === 'warning' ? WARN_BORDER : FAIL_BORDER;

    const actionLine =
      verdict.verdict !== 'clear'
        ? `<div style="margin-top:8px;font-size:11.5px;font-weight:700;color:${stripeColor};">${
            verdict.verdict === 'caution' ? 'Recommended — review before the next release' : 'Action required — see Action Required section below'
          }</div>`
        : '';

    return `
<tr><td style="padding:20px 28px 8px;">
  <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">Executive Summary</div>
  <div style="border:1px solid ${cardBorder};background:${cardBg};border-radius:6px;padding:14px 16px;display:table;width:100%;">
    <div style="display:table-cell;width:3px;background:${stripeColor};border-radius:2px;"></div>
    <div style="display:table-cell;padding-left:12px;">
      <div style="font-size:13.5px;font-weight:700;color:${INK};">${this.esc(verdict.headline)}</div>
      <div style="font-size:12.5px;color:#424A53;line-height:1.55;margin-top:4px;">${this.esc(sentences.join(' '))}</div>
      ${actionLine}
    </div>
  </div>
</td></tr>`;
  }

  private buildHealthScoreBlock(health: HealthScore): string {
    const color =
      health.label === 'Excellent'
        ? SUCCESS
        : health.label === 'Good'
          ? SUCCESS
          : health.label === 'Needs Attention'
            ? WARN
            : FAIL;
    const factorLines = health.factors
      .map(
        (f) =>
          `<span style="display:inline-block;margin:2px 8px 0 0;font-size:10.5px;color:${SLATE};">${this.esc(f.name)}: ${this.esc(f.note)}</span>`
      )
      .join('');
    return `
<tr><td style="padding:4px 28px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="width:110px;">
      <span style="display:inline-block;border:1px solid ${BORDER};background:${CANVAS_TINT};color:${color};border-radius:4px;padding:5px 10px;font-size:11.5px;font-weight:700;">${this.esc(health.label)}</span>
    </td>
    <td>
      <div style="height:6px;background:${CANVAS_TINT};border-radius:3px;overflow:hidden;">
        <div style="height:100%;background:${color};width:${health.score}%;"></div>
      </div>
    </td>
    <td style="width:60px;text-align:right;font-size:12px;color:${SLATE};font-family:${MONO_FONT};">${health.score}/100</td>
  </tr></table>
  ${factorLines ? `<div style="margin-top:6px;">${factorLines}</div>` : ''}
</td></tr>`;
  }

  // ===================== Run metadata =====================

  private buildRunMetadata(ctx: EmailContext): string {
    const { report } = ctx;
    // WHY timeZoneName: 'short' added 2026-08-24: confirmed live in this
    // Node v20.20.2/ICU build that `toLocaleString('en-IN', {timeZone:
    // 'Asia/Kolkata'})` alone rendered "24/8/2026, 12:47:17 pm" with NO
    // timezone marker — a reader unfamiliar with this convention had no way
    // to know it's IST specifically, not their own local time. Verified this
    // option renders "... IST" (not a "GMT+5:30" fallback, which some
    // Node/ICU builds render instead for this option) — re-confirm if the
    // CI runner's Node/ICU build ever differs materially from local.
    const dtOpts: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', timeZoneName: 'short' };
    const startTime = new Date(report.startTime).toLocaleString('en-IN', dtOpts);
    const endTime = new Date(report.endTime).toLocaleString('en-IN', dtOpts);
    const shortCommit = ctx.gitCommit.substring(0, 8);
    const row = (label: string, value: string): string => `
      <tr>
        <td style="padding:4px 0;font-size:11px;color:${SLATE};width:110px;vertical-align:top;">${label}</td>
        <td style="padding:4px 0;font-size:12px;color:${INK};">${value}</td>
      </tr>`;
    return `
<tr><td style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Run Details</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${row('Started', this.esc(startTime))}
      ${row('Ended', this.esc(endTime))}
      ${row('Triggered by', this.esc(ctx.triggeredBy))}
      ${row('Commit', this.mono(shortCommit))}
    </table>
  </div>
</td></tr>`;
  }

  // ===================== KPI dashboard =====================

  private buildKpiDashboard(ctx: EmailContext): string {
    const { report } = ctx;
    const previousRun = ctx.historyDelta?.previousRun ?? null;

    const totalSubtext = ctx.suiteDrift?.occurred
      ? `<span style="color:${FAIL};font-weight:700;">▼ ${ctx.suiteDrift.decreaseBy} vs last run</span>`
      : previousRun
        ? this.deltaSubtext(ctx.historyDelta!.totalDelta)
        : undefined;
    const passRateSubtext = previousRun
      ? this.deltaSubtext(report.passRate - this.passRateOf(previousRun), '%')
      : undefined;

    const primaryRow = this.kpiRow([
      { value: String(report.total), label: 'Total', variant: ctx.suiteDrift?.occurred ? 'fail' : 'neutral', subtext: totalSubtext },
      { value: String(report.passed), label: 'Passed', variant: 'success' },
      { value: String(report.flaky), label: 'Flaky', variant: report.flaky > 0 ? 'warn' : 'neutral', anchor: report.flaky > 0 ? '#section-flaky-tests' : undefined },
      { value: String(report.failed), label: 'Failed', variant: report.failed > 0 ? 'fail' : 'neutral', anchor: report.failed > 0 ? '#section-failed-tests' : undefined },
      { value: String(report.skipped), label: 'Skipped', variant: report.skipped > 0 ? 'warn' : 'neutral' },
    ]);

    const secondaryRow = this.kpiRow([
      {
        value: `${report.passRate}%`,
        label: 'Pass Rate',
        variant: report.passRate >= 90 ? 'success' : report.passRate >= 75 ? 'warn' : 'fail',
        subtext: passRateSubtext,
      },
      { value: this.formatDuration(report.duration), label: 'Duration' },
      { value: String(report.modules.length), label: 'Modules' },
      { value: String(report.totalRetries), label: 'Retries', variant: report.totalRetries > 0 ? 'warn' : 'neutral' },
    ]);

    // WHY: signal chips only render when nonzero — an empty run shouldn't be
    // cluttered with zero-value tiles for things that didn't happen.
    const unexpectedMisc = ctx.miscErrors?.unexpectedErrors ?? 0;
    const infraFailures = (ctx.clusters ?? []).reduce(
      (sum, c) => sum + (c.category === 'infra' ? c.tests.length : 0),
      0
    );
    const newFailures = previousRun
      ? report.failedTests.filter((t) => !previousRun.failedTestTitles.includes(t.title)).length
      : 0;
    const recurringFlakyCount = ctx.recurringFlaky?.length ?? 0;

    const signalChips = [
      unexpectedMisc > 0 ? this.signalChip(`${unexpectedMisc} background error${unexpectedMisc === 1 ? '' : 's'}`, 'fail', '#section-background-errors') : '',
      infraFailures > 0 ? this.signalChip(`${infraFailures} infra-classified failure${infraFailures === 1 ? '' : 's'}`, 'warn', '#section-failed-tests') : '',
      newFailures > 0 ? this.signalChip(`${newFailures} new failure${newFailures === 1 ? '' : 's'}`, 'fail', '#section-failed-tests') : '',
      recurringFlakyCount > 0 ? this.signalChip(`${recurringFlakyCount} recurring flaky test${recurringFlakyCount === 1 ? '' : 's'}`, 'warn', '#section-trend') : '',
    ]
      .filter(Boolean)
      .join('');

    return `
<tr><td style="padding:8px 28px;">
  <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Run Summary</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${primaryRow}</table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${secondaryRow}</table>
  ${signalChips ? `<div style="margin-top:10px;">${signalChips}</div>` : ''}
</td></tr>`;
  }

  private kpiRow(
    tiles: Array<{ value: string; label: string; variant?: 'neutral' | 'success' | 'fail' | 'warn'; subtext?: string; anchor?: string }>
  ): string {
    const widthPct = Math.floor(100 / tiles.length);
    return `<tr>${tiles.map((t) => this.kpiTile(t.value, t.label, t.variant ?? 'neutral', t.subtext, widthPct, t.anchor)).join('')}</tr>`;
  }

  // WHY anchor is a best-effort <a> wrapper, not the only way to find the
  // detail (2026-08-24): real email-client support for `href="#id"` same-page
  // navigation is ~50% (confirmed broken on iOS Gmail/Mail apps and Outlook
  // desktop/mobile — see the redesign proposal's item 3 research). On a
  // supporting client this becomes a real, working jump; on a non-supporting
  // one it's exactly as inert as the plain text was before — never worse.
  // The email's information is never reorganized around anchors working.
  private kpiTile(
    value: string,
    label: string,
    variant: 'neutral' | 'success' | 'fail' | 'warn',
    subtext: string | undefined,
    widthPct: number,
    anchor?: string
  ): string {
    const stripe = variant === 'success' ? SUCCESS : variant === 'fail' ? FAIL : variant === 'warn' ? WARN : BORDER;
    // WHY: brought back 2026-07-14 (Part A) — a subtle semantic-tinted
    // background (reusing the same light bg tokens already used for badges/
    // borders elsewhere, not a new saturated color) instead of flat white,
    // so status reads at a glance without needing to read the number color.
    const tileBg = variant === 'success' ? SUCCESS_BG : variant === 'fail' ? FAIL_BG : variant === 'warn' ? WARN_BG : '#ffffff';
    const tileBorder = variant === 'success' ? SUCCESS_BORDER : variant === 'fail' ? FAIL_BORDER : variant === 'warn' ? WARN_BORDER : BORDER;
    const valueHtml = anchor
      ? `<a href="${this.escAttr(anchor)}" style="color:${INK};text-decoration:none;">${this.mono(value)}</a>`
      : this.mono(value);
    return `
  <td style="width:${widthPct}%;padding:0 3px;">
    <div style="background:${tileBg};border:1px solid ${tileBorder};border-top:3px solid ${stripe};border-radius:6px;padding:10px 4px 8px;text-align:center;">
      <div style="font-size:19px;font-weight:700;color:${INK};line-height:1;">${valueHtml}</div>
      <div style="margin-top:4px;font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${MUTED};">${this.esc(label)}</div>
      ${subtext ? `<div style="margin-top:2px;font-size:9px;color:${SLATE};">${subtext}</div>` : ''}
    </div>
  </td>`;
  }

  private signalChip(text: string, variant: 'fail' | 'warn', anchor?: string): string {
    const bg = variant === 'fail' ? FAIL_BG : WARN_BG;
    const fg = variant === 'fail' ? FAIL : WARN;
    const border = variant === 'fail' ? FAIL_BORDER : WARN_BORDER;
    const style = `display:inline-block;font-size:10.5px;font-weight:700;background:${bg};color:${fg};border:1px solid ${border};border-radius:4px;padding:3px 8px;margin:0 6px 6px 0;text-decoration:none;`;
    return anchor
      ? `<a href="${this.escAttr(anchor)}" style="${style}">${this.esc(text)}</a>`
      : `<span style="${style}">${this.esc(text)}</span>`;
  }

  private deltaSubtext(delta: number, suffix = ''): string {
    if (delta === 0) return `<span style="color:${MUTED};">— vs last run</span>`;
    const color = delta > 0 ? SUCCESS : FAIL;
    const arrow = delta > 0 ? '▲' : '▼';
    return `<span style="color:${color};font-weight:700;">${arrow} ${Math.abs(delta)}${suffix} vs last run</span>`;
  }

  private passRateOf(record: { total: number; passed: number }): number {
    return record.total > 0 ? Math.round((record.passed / record.total) * 100) : 0;
  }

  // ===================== Trend section (incl. sparkline) =====================

  private buildTrendSection(ctx: EmailContext, testAnchors: Map<string, string>): string {
    const delta = ctx.historyDelta;
    const recurringFlaky = ctx.recurringFlaky ?? [];
    const recurringFailures = ctx.recurringFailures ?? [];
    const worseningModules = (ctx.moduleTrend ?? []).filter((m) => m.direction === 'worsening');
    const passRateSeries = ctx.passRateSeries ?? [];

    if (!delta && recurringFlaky.length === 0 && recurringFailures.length === 0 && worseningModules.length === 0 && passRateSeries.length < 2) {
      return '';
    }

    const deltaLine = delta
      ? delta.previousRun === null
        ? `<div style="font-size:12px;color:${SLATE};">No prior run to compare — this is the first recorded run for this environment.</div>`
        : `<div style="font-size:12.5px;color:${INK};">
             <strong>Δ vs previous run</strong> (build ${this.mono(`#${delta.previousRun.buildNumber}`)}):
             ${this.deltaSubtext(delta.passedDelta)} passed &nbsp;
             ${this.deltaSubtext(-delta.failedDelta)} failed &nbsp;
             ${this.deltaSubtext(-delta.flakyDelta)} flaky
           </div>`
      : '';

    const sparkline = this.buildSparkline(passRateSeries);

    // WHY testAnchors is looked up opportunistically, not required (2026-08-24):
    // a chronically-recurring test can legitimately be ABSENT from this run's
    // own failed/flaky lists (it happened to pass this time) — in that case
    // there's no anchor id to jump to (nothing to show this run), and the
    // title renders as plain text, which is still correct, just not a link.
    const recurringBlock = (title: string, issues: RecurringIssue[]): string =>
      issues.length === 0
        ? ''
        : `<div style="margin-top:10px;">
             <div style="font-size:11.5px;font-weight:700;color:${WARN};margin-bottom:4px;">${this.esc(title)}</div>
             ${issues
               .map((i) => {
                 const anchor = testAnchors.get(i.title);
                 const titleHtml = anchor
                   ? `<a href="${this.escAttr(`#${anchor}`)}" style="color:#6B5300;font-weight:600;">${this.esc(i.title)}</a>`
                   : this.esc(i.title);
                 return `<div style="font-size:11.5px;color:#6B5300;padding:2px 0;">${titleHtml} — ${i.countInLastNRuns} of last ${i.ofLastNRuns} runs</div>`;
               })
               .join('')}
           </div>`;

    const moduleTrendBlock =
      worseningModules.length === 0
        ? ''
        : `<div style="margin-top:10px;">
             <div style="font-size:11.5px;font-weight:700;color:${FAIL};margin-bottom:4px;">Modules trending worse</div>
             ${worseningModules
               .map(
                 (m) =>
                   `<div style="font-size:11.5px;color:${INK};padding:2px 0;">▼ ${this.esc(m.name)} (${this.esc(m.type)}) — ${m.failedDelta > 0 ? `+${m.failedDelta} failed` : ''}${m.failedDelta > 0 && m.flakyDelta > 0 ? ', ' : ''}${m.flakyDelta > 0 ? `+${m.flakyDelta} flaky` : ''}</div>`
               )
               .join('')}
           </div>`;

    return `
<tr><td id="section-trend" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};background:${WARN_BG};border-radius:6px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${WARN};margin-bottom:8px;">Trend</div>
    ${deltaLine}
    ${sparkline}
    ${recurringBlock('Recurring flaky tests', recurringFlaky)}
    ${recurringBlock('Recurring failing tests', recurringFailures)}
    ${moduleTrendBlock}
  </div>
</td></tr>`;
  }

  // WHY: a purely decorative, HTML/CSS-only (no JS) mini bar chart. Bars are
  // anchored via a fixed-height container; clients that ignore inline flex
  // properties still render the bar itself (top-aligned instead of bottom-
  // aligned) rather than breaking the layout — acceptable degradation for a
  // best-effort visual, not a load-bearing data source (the Δ line above it
  // carries the same information in text form).
  private buildSparkline(series: PassRatePoint[]): string {
    if (series.length < 2) return '';
    const barHeight = 32;
    const cells = series
      .map((p) => {
        const h = Math.max(2, Math.round((p.passRate / 100) * barHeight));
        const color = p.passRate >= 90 ? SUCCESS : p.passRate >= 75 ? WARN : FAIL;
        return `<td style="vertical-align:bottom;text-align:center;padding:0 2px;">
          <div style="height:${barHeight}px;display:flex;align-items:flex-end;justify-content:center;">
            <div style="width:16px;height:${h}px;background:${color};border-radius:2px;" title="${p.passRate}%"></div>
          </div>
          <div style="font-size:8px;color:${MUTED};margin-top:2px;">${this.mono(`#${p.buildNumber}`)}</div>
        </td>`;
      })
      .join('');
    return `
    <div style="margin-top:10px;">
      <div style="font-size:11px;color:${SLATE};margin-bottom:4px;">Pass rate — last ${series.length} runs</div>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
    </div>`;
  }

  // ===================== Module analytics (incl. Test Type Split caption) =====================

  private buildModuleAnalytics(ctx: EmailContext): string {
    const { report } = ctx;
    const trendByKey = new Map((ctx.moduleTrend ?? []).map((m) => [`${m.type}:${m.name}`, m]));

    const scored = report.modules
      .map((m) => ({
        ...m,
        score: (m.total > 0 ? (m.passed / m.total) * 100 : 0) - m.failed * 10 - m.flaky * 5,
      }))
      .sort((a, b) => b.score - a.score);

    const rows = scored
      .map((m) => {
        const passRate = m.total > 0 ? Math.round((m.passed / m.total) * 100) : 0;
        const barColor = m.failed > 0 ? FAIL : m.flaky > 0 ? WARN : SUCCESS;
        const typeStyle =
          m.type === 'UI'
            ? `background:#EFF3FE;color:${ACCENT};`
            : m.type === 'RBAC'
              ? `background:${SUCCESS_BG};color:${SUCCESS};`
              : `background:${CANVAS_TINT};color:${SLATE};`;
        const trend = trendByKey.get(`${m.type}:${m.name}`);
        // WHY rewritten 2026-08-24 (item 2 fix): a bare "–" used to render
        // identically whether the ledger simply has no history at all
        // (which was true on EVERY real run so far — the run-history branch
        // has never been successfully written to, see
        // .claude/ci-reporting-history-fix-proposal.md) or a real comparison
        // found no change. Those are different facts and must look
        // different — "–" is now reserved for an ACTUAL confirmed-stable
        // comparison; the no-data case says so honestly instead.
        const trendGlyph = !ctx.hasHistoryEverExisted
          ? `<span style="color:${MUTED};font-size:10px;">no history yet</span>`
          : !trend
            ? `<span style="color:${MUTED};font-size:10px;">new module</span>`
            : trend.direction === 'improving'
              ? `<span style="color:${SUCCESS};">▲</span>`
              : trend.direction === 'worsening'
                ? `<span style="color:${FAIL};">▼</span>`
                : `<span style="color:${MUTED};">–</span>`;
        const flakyCell = m.flaky > 0
          ? `<a href="#section-flaky-tests" style="color:${WARN};text-decoration:none;">${m.flaky}</a>`
          : String(m.flaky);
        const failedCell = m.failed > 0
          ? `<a href="#section-failed-tests" style="color:${FAIL};text-decoration:none;">${m.failed}</a>`
          : String(m.failed);
        return `<tr style="border-bottom:1px solid ${CANVAS_TINT};">
        <td style="padding:8px;font-size:12px;color:${INK};font-weight:500;">${this.esc(m.name)}</td>
        <td style="padding:8px;"><span style="${typeStyle}padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;">${m.type}</span></td>
        <td style="padding:8px;text-align:center;font-size:12px;color:${SUCCESS};font-weight:700;">${m.passed}</td>
        <td style="padding:8px;text-align:center;font-size:12px;color:${m.flaky > 0 ? WARN : MUTED};font-weight:${m.flaky > 0 ? '700' : '400'};">${flakyCell}</td>
        <td style="padding:8px;text-align:center;font-size:12px;color:${m.failed > 0 ? FAIL : MUTED};font-weight:${m.failed > 0 ? '700' : '400'};">${failedCell}</td>
        <td style="padding:8px;width:70px;"><div style="background:${CANVAS_TINT};border-radius:4px;height:6px;"><div style="background:${barColor};width:${passRate}%;height:6px;border-radius:4px;"></div></div></td>
        <td style="padding:8px;text-align:center;">${trendGlyph}</td>
      </tr>`;
      })
      .join('');

    return `
<tr><td id="section-module-analytics" style="padding:8px 28px;">
  <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">Module Analytics</div>
  <div style="font-size:11px;color:${SLATE};margin-bottom:8px;">${report.total} tests · ${report.uiCount} UI · ${report.rbacCount} RBAC — ranked by health (best first)</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr style="background:${CANVAS_TINT};">
      <th style="padding:6px 8px;text-align:left;font-size:11px;color:${SLATE};font-weight:600;">Module</th>
      <th style="padding:6px 8px;text-align:left;font-size:11px;color:${SLATE};font-weight:600;">Type</th>
      <th style="padding:6px 8px;text-align:center;font-size:11px;color:${SUCCESS};font-weight:600;">Pass</th>
      <th style="padding:6px 8px;text-align:center;font-size:11px;color:${WARN};font-weight:600;">Flaky</th>
      <th style="padding:6px 8px;text-align:center;font-size:11px;color:${FAIL};font-weight:600;">Fail</th>
      <th style="padding:6px 8px;text-align:left;font-size:11px;color:${SLATE};font-weight:600;">Progress</th>
      <th style="padding:6px 8px;text-align:center;font-size:11px;color:${SLATE};font-weight:600;">Trend</th>
    </tr>
    ${rows}
  </table>
</td></tr>`;
  }

  // ===================== Slowest tests =====================

  private buildSlowTestsSection(ctx: EmailContext): string {
    const { report } = ctx;
    if (report.slowestTests.length === 0) return '';
    const trendByTitle = new Map((ctx.slowTestTrend ?? []).map((t) => [t.title, t]));
    const rows = report.slowestTests
      .map((t: TestResult) => {
        const trend = trendByTitle.get(t.title);
        const trendCell =
          !trend || trend.previousDuration === null
            ? `<span style="color:${MUTED};">no prior data</span>`
            : trend.regression
              ? `<span style="color:${FAIL};font-weight:700;">▲ +${Math.round((trend.diffMs ?? 0) / 1000)}s (regression)</span>`
              : `<span style="color:${SLATE};">${(trend.diffMs ?? 0) >= 0 ? '+' : ''}${Math.round((trend.diffMs ?? 0) / 1000)}s vs last seen</span>`;
        return `
      <tr style="border-bottom:1px solid ${CANVAS_TINT};">
        <td style="padding:6px 0;font-size:12px;color:${INK};">${this.esc(t.title)}</td>
        <td style="padding:6px 0;text-align:right;font-size:12px;color:${SLATE};font-weight:600;white-space:nowrap;">${this.mono(`${Math.round(t.duration / 1000)}s`)}</td>
        <td style="padding:6px 0 6px 12px;font-size:11px;white-space:nowrap;">${trendCell}</td>
      </tr>`;
      })
      .join('');
    return `
<tr><td style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">Slowest Tests (Top 5)</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>
</td></tr>`;
  }

  // ===================== Flaky tests =====================

  // WHY category color reuses the same high/medium severity split already
  // established in buildActionRequiredSection (auth/infra = high) — a single
  // shared Set, not a duplicated inline ternary, so a future 12th category
  // only needs one line added here to affect both the badge color and the
  // Action Required item's priority consistently (addendum item 15).
  private static readonly HIGH_SEVERITY_CATEGORIES = new Set<FailureCategory>(['auth', 'infra']);

  private categoryBadge(category: FailureCategory): string {
    const isHigh = EmailTemplate.HIGH_SEVERITY_CATEGORIES.has(category);
    const bg = isHigh ? FAIL_BG : WARN_BG;
    const fg = isHigh ? FAIL : WARN;
    const border = isHigh ? FAIL_BORDER : WARN_BORDER;
    return `<span style="display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;background:${bg};color:${fg};border:1px solid ${border};border-radius:3px;padding:2px 6px;margin-right:6px;">${this.esc(category)}</span>`;
  }

  private regressionBadge(status: RegressionStatus | undefined, ratio: { count: number; of: number } | undefined): string {
    if (status === 'new-regression') {
      return `<span style="display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;background:${FAIL_BG};color:${FAIL};border:1px solid ${FAIL_BORDER};border-radius:3px;padding:2px 6px;margin-right:6px;">New regression</span>`;
    }
    if (status === 'chronic' && ratio) {
      return `<span style="display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;background:${WARN_BG};color:${WARN};border:1px solid ${WARN_BORDER};border-radius:3px;padding:2px 6px;margin-right:6px;">Known chronic (${ratio.count}/${ratio.of} runs)</span>`;
    }
    if (status === 'recurring') {
      return `<span style="display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;background:${CANVAS_TINT};color:${SLATE};border:1px solid ${BORDER};border-radius:3px;padding:2px 6px;margin-right:6px;">Failed last run too</span>`;
    }
    // WHY 'unclassified' renders NOTHING, not a guessed badge: no history
    // exists to classify against yet — an honest absence, not a fabricated
    // "new" or "chronic" label with no real basis (see the redesign
    // proposal's items 4/5 and .claude/ci-reporting-history-fix-proposal.md
    // for why history is empty today).
    return '';
  }

  // WHY one shared card renderer for both Failed Tests and Flaky Tests
  // (2026-08-24): both need the exact same rich detail — category badge,
  // full error sequence, snippet, truncated stack, artifacts, diagnostic
  // hint, known-issue cross-reference — the only real difference is whether
  // a regression/chronic badge applies (meaningless for a test that already
  // passed on retry this run). One function, one place to fix a rendering
  // bug, per this codebase's "every new piece of logic does ONE thing" rule.
  private buildFailureDetailCard(d: FailureDetail, knownIssuesUrl: string | null | undefined, accentColor: string): string {
    const earlierErrorsHtml =
      d.earlierErrors.length > 0
        ? `<div style="margin-top:6px;">
             <div style="font-size:10px;color:${MUTED};margin-bottom:2px;">Earlier error(s) in this attempt, before the one below:</div>
             ${d.earlierErrors
               .map((e) => `<div style="font-size:10.5px;color:${SLATE};font-family:${MONO_FONT};background:${CANVAS_TINT};border-radius:4px;padding:4px 6px;margin-bottom:3px;white-space:pre-wrap;word-break:break-word;">${this.esc(e)}</div>`)
               .join('')}
           </div>`
        : '';
    const snippetHtml = d.snippet
      ? `<pre style="margin:6px 0 0;font-size:10.5px;font-family:${MONO_FONT};background:${INK};color:#E6EDF3;border-radius:4px;padding:8px 10px;overflow-x:auto;white-space:pre;">${this.esc(d.snippet)}</pre>`
      : '';
    const stackHtml =
      d.stackFrames.length > 0
        ? `<div style="margin-top:6px;font-size:10px;color:${MUTED};font-family:${MONO_FONT};white-space:pre-wrap;word-break:break-word;">${d.stackFrames.map((f) => this.esc(f)).join('<br>')}${d.stackTruncatedCount > 0 ? `<br>… +${d.stackTruncatedCount} more frame${d.stackTruncatedCount === 1 ? '' : 's'} — open the trace for the full stack.` : ''}</div>`
        : '';
    const artifactLines: string[] = [];
    const traceHref = d.artifactLinks.trace;
    artifactLines.push(
      `Trace: ${d.tracePath ? (traceHref ? `<a href="${this.escAttr(traceHref)}" style="color:${ACCENT};">${this.esc(d.tracePath)}</a>` : this.esc(d.tracePath)) : 'not captured'}`
    );
    if (d.screenshotPaths.length > 0) {
      artifactLines.push(
        d.screenshotPaths
          .map((p, i) => {
            const href = d.artifactLinks.screenshots[i];
            return `Screenshot: ${href ? `<a href="${this.escAttr(href)}" style="color:${ACCENT};">${this.esc(p)}</a>` : this.esc(p)}`;
          })
          .join(' · ')
      );
    }
    if (d.errorContextPath) {
      const href = d.artifactLinks.errorContext;
      artifactLines.push(`Page snapshot: ${href ? `<a href="${this.escAttr(href)}" style="color:${ACCENT};">${this.esc(d.errorContextPath)}</a>` : this.esc(d.errorContextPath)}`);
    }
    // WHY the artifact links above only ever resolve on Jenkins runs (see
    // FailureDetailBuilder.buildArtifactLinks's own WHY) — GitHub Actions has
    // no browsable single-file URL for an archived artifact, confirmed
    // during the investigation, not assumed; the plain path still renders so
    // the information isn't lost, just not clickable there.
    const knownIssueHtml =
      d.knownIssue && knownIssuesUrl
        ? `<div style="margin-top:6px;font-size:10.5px;color:${INK};">Related history: <a href="${this.escAttr(`${knownIssuesUrl}#L${d.knownIssue.line}`)}" style="color:${ACCENT};">known-issues.md${d.knownIssue.kind === 'method-name' ? ` — this code (\`${this.esc(d.knownIssue.matchedPhrase)}\`) has documented history` : ' — a matching prior incident'}</a></div>`
        : '';

    return `
        <div id="${this.escAttr(d.anchorId)}" style="border-left:3px solid ${accentColor};background:#ffffff;padding:10px 12px;margin-bottom:10px;border-radius:0 4px 4px 0;border-top:1px solid ${CANVAS_TINT};border-right:1px solid ${CANVAS_TINT};border-bottom:1px solid ${CANVAS_TINT};">
          <div style="font-size:12.5px;font-weight:700;color:${INK};margin-bottom:4px;">${this.esc(d.test.title)}</div>
          <div style="margin-bottom:6px;">${this.categoryBadge(d.category)}${this.regressionBadge(d.regressionStatus, d.chronicRatio)}</div>
          <div style="font-size:10.5px;color:${SLATE};margin-bottom:4px;">${this.esc(d.test.file.split('/').pop() || '')}</div>
          <div style="font-size:11.5px;color:${accentColor};font-family:${MONO_FONT};white-space:pre-wrap;word-break:break-word;">${this.esc(d.primaryError)}</div>
          ${earlierErrorsHtml}
          ${snippetHtml}
          ${stackHtml}
          <div style="margin-top:6px;font-size:10.5px;color:${SLATE};font-style:italic;">${this.esc(d.diagnosticHint)}</div>
          ${knownIssueHtml}
          <div style="margin-top:6px;font-size:10px;color:${MUTED};font-family:${MONO_FONT};word-break:break-all;">${artifactLines.join('<br>')}</div>
        </div>`;
  }

  private buildFlakyTestsSection(ctx: EmailContext): string {
    const { report } = ctx;
    if (report.flakyTests.length === 0) return '';
    const recurringByTitle = new Map((ctx.recurringFlaky ?? []).map((r) => [r.title, r]));
    const detailByTitle = new Map((ctx.flakyFailureDetails ?? []).map((d) => [d.test.title, d]));
    const rows = report.flakyTests
      .map((t: TestResult) => {
        const recurring = recurringByTitle.get(t.title);
        const ratio = recurring ? recurring.countInLastNRuns / recurring.ofLastNRuns : 0;
        const risk = !recurring ? 'New' : ratio > 0.5 ? 'High' : ratio > 0.2 ? 'Medium' : 'Low';
        const riskColor = risk === 'High' ? FAIL : risk === 'Medium' ? WARN : risk === 'Low' ? SLATE : MUTED;
        const history = recurring
          ? `${recurring.countInLastNRuns} of last ${recurring.ofLastNRuns} runs`
          : 'not previously recurring';
        const detail = detailByTitle.get(t.title);
        // WHY the failing attempt's full detail is shown below the summary
        // row, not instead of it (2026-08-24): this is the exact real-world
        // case that motivated capturing results[].errors[] in the first
        // place (investigation §3 finding 3) — a flaky test's generic "Test
        // timeout exceeded" first error next to the actual specific cause,
        // which only ever surfaces via the full error sequence.
        const detailHtml = detail ? this.buildFailureDetailCard(detail, ctx.knownIssuesUrl, WARN) : '';
        return `
      <tr id="${detail ? this.escAttr(detail.anchorId) : ''}" style="border-bottom:1px solid ${WARN_BORDER};">
        <td style="padding:6px 0;font-size:12px;color:${INK};">${this.esc(t.title)}</td>
        <td style="padding:6px 0;text-align:right;font-size:11px;color:${WARN};font-weight:600;white-space:nowrap;">${t.retries} retry</td>
        <td style="padding:6px 0 6px 10px;font-size:11px;color:${riskColor};font-weight:700;white-space:nowrap;">${risk} risk</td>
        <td style="padding:6px 0 6px 10px;font-size:10.5px;color:${SLATE};">${this.esc(history)}</td>
        <td style="padding:6px 0 6px 10px;font-size:10px;color:${MUTED};font-family:${MONO_FONT};word-break:break-all;">${t.tracePath ? this.esc(t.tracePath) : 'no trace captured'}</td>
      </tr>
      ${detailHtml ? `<tr><td colspan="5" style="padding:0 0 8px;">${detailHtml}</td></tr>` : ''}`;
      })
      .join('');
    return `
<tr><td id="section-flaky-tests" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};background:${WARN_BG};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${WARN};margin-bottom:10px;">Flaky Tests (${report.flakyTests.length})</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>
</td></tr>`;
  }

  // ===================== Failed Tests (failure clusters, full detail) =====================

  private buildFailureClustersSection(clusters: EnrichedCluster[], knownIssuesUrl: string | null | undefined): string {
    if (clusters.length === 0) return '';
    const totalTests = clusters.reduce((sum, c) => sum + c.tests.length, 0);

    const clusterBlocks = clusters
      .map((c) => {
        // WHY the category badge/header is now unconditional (2026-08-24,
        // item 8/2 fix): it used to render ONLY for clusters with 2+ tests —
        // the common case (a handful of unrelated standalone failures) got
        // no classification shown at all, despite FailureAnalyzer already
        // computing it correctly for every cluster including single-test
        // ones (confirmed by reading clusterFailures()'s own fallback loop).
        const header = `<div style="background:${CANVAS_TINT};border-radius:4px 4px 0 0;padding:8px 10px;font-size:11.5px;font-weight:700;color:${INK};border:1px solid ${FAIL_BORDER};border-bottom:none;">
                 ${c.tests.length > 1 ? `${c.tests.length} tests affected — shared cause (${this.signalTypeLabel(c.signalType)}) · ` : ''}category: ${this.esc(c.category)}
               </div>`;
        const cards = c.details.map((d) => this.buildFailureDetailCard(d, knownIssuesUrl, FAIL)).join('');
        return `
        <div style="margin-bottom:12px;">
          ${header}
          <div style="border:1px solid ${FAIL_BORDER};border-top:none;background:${FAIL_BG};padding:10px;">
            ${cards}
          </div>
        </div>`;
      })
      .join('');

    return `
<tr><td id="section-failed-tests" style="padding:8px 28px;">
  <div style="border:1px solid ${FAIL_BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${FAIL};margin-bottom:4px;">Failed Tests (${totalTests})</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:10px;">${clusters.filter((c) => c.tests.length > 1).length} cluster(s) sharing a real signal, ${clusters.filter((c) => c.tests.length === 1).length} standalone</div>
    ${clusterBlocks}
  </div>
</td></tr>`;
  }

  private signalTypeLabel(t: EnrichedCluster['signalType']): string {
    return t === 'exact-message' ? 'identical error message' : t === 'stack-location' ? 'same source location' : 'same failing API endpoint';
  }

  // ===================== Background errors =====================

  private buildBackgroundErrorsSection(miscErrors: MiscErrorReport | null | undefined): string {
    if (!miscErrors || miscErrors.totalErrors === 0) {
      return `
<tr><td id="section-background-errors" style="padding:8px 28px;">
  <div style="border:1px solid ${SUCCESS_BORDER};background:${SUCCESS_BG};border-radius:6px;padding:16px;">
    <div style="font-size:13px;font-weight:700;color:${SUCCESS};">No Background Errors Detected</div>
    <div style="font-size:12px;color:${SLATE};margin-top:4px;">No browser console errors, network failures, or uncaught exceptions were captured during this run.</div>
  </div>
</td></tr>`;
    }

    const byTypeRows = Object.entries(miscErrors.byType as Record<string, number>)
      .map(
        ([type, count]) =>
          `<tr><td style="padding:4px 8px;font-size:12px;color:${INK};">${this.esc(type)}</td><td style="padding:4px 8px;font-size:12px;font-weight:700;color:${INK};text-align:right;">${count}</td></tr>`
      )
      .join('');

    const byTest = new Map<string, MiscError[]>();
    for (const e of miscErrors.errors) {
      const key = e.testTitle || 'unknown';
      if (!byTest.has(key)) byTest.set(key, []);
      byTest.get(key)!.push(e);
    }
    const errorRows = Array.from(byTest.entries())
      .map(([testTitle, errors]) => {
        const details = errors
          .map((e) => {
            const expectedBadge =
              e.expectedReason === 'rbac'
                ? ` <span style="font-size:10px;background:${WARN_BG};padding:1px 4px;border-radius:3px;margin-left:4px;">Expected RBAC</span>`
                : e.expectedReason === 'background-noise'
                  ? ` <span style="font-size:10px;background:#EFF3FE;padding:1px 4px;border-radius:3px;margin-left:4px;">Known Background Noise</span>`
                  : '';
            // WHY redactSensitiveText() applied here (2026-08-24, item 13):
            // e.message/e.apiErrorMessage are raw captured browser/API text
            // — never previously redacted anywhere in this pipeline (see
            // redact.ts's own WHY comment for why BasePage's existing
            // redaction doesn't cover this data path at all).
            return `<div style="background:#FFF8F3;border-left:3px solid ${WARN};padding:6px 8px;margin:4px 0;border-radius:0 4px 4px 0;">
        <div style="font-size:11px;font-weight:700;color:${e.expectedReason ? WARN : FAIL};">[${this.esc(e.type)}]${expectedBadge}</div>
        ${e.method ? `<div style="font-size:10px;color:${INK};margin-top:2px;"><strong>Method:</strong> ${this.esc(e.method)}</div>` : ''}
        <div style="font-size:11px;color:${INK};margin-top:2px;"><strong>Error:</strong> ${this.esc(this.truncate(redactSensitiveText(e.message || ''), 150))}</div>
        ${e.url ? `<div style="font-size:10px;color:${SLATE};margin-top:2px;word-break:break-all;"><strong>URL:</strong> ${this.esc(e.url)}</div>` : ''}
        ${e.statusCode ? `<div style="font-size:10px;color:${FAIL};font-weight:700;margin-top:2px;">HTTP Status: ${e.statusCode}</div>` : ''}
        ${e.apiErrorMessage ? `<div style="font-size:11px;color:${FAIL};margin-top:3px;font-weight:600;background:${FAIL_BG};padding:4px 6px;border-radius:4px;">Server Error: ${this.esc(redactSensitiveText(e.apiErrorMessage))}</div>` : ''}
        <div style="font-size:10px;color:${MUTED};margin-top:2px;">${e.timestamp}</div>
      </div>`;
          })
          .join('');
        return `<tr style="border-bottom:1px solid ${BORDER};"><td style="padding:8px;">
      <div style="font-size:12px;font-weight:600;color:${INK};margin-bottom:4px;">${this.esc(testTitle)}</div>
      ${details}
    </td></tr>`;
      })
      .join('');

    const unexpectedInfra = miscErrors.errors.filter(
      (e) => !e.expectedReason && (e.statusCode ?? 0) >= 500
    ).length;
    const unexpectedApp = Math.max(0, miscErrors.unexpectedErrors - unexpectedInfra);

    return `
<tr><td id="section-background-errors" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};background:#FFFAF3;border-radius:6px;padding:16px;">
    <div style="font-size:13px;font-weight:700;color:${INK};margin-bottom:4px;">Background Errors Captured — ${miscErrors.totalErrors} total</div>
    <div style="margin-bottom:8px;">
      ${miscErrors.unexpectedErrors > 0 ? this.signalChip(`${miscErrors.unexpectedErrors} unexpected`, 'fail') : ''}
      ${unexpectedApp > 0 ? this.signalChip(`${unexpectedApp} app-level`, 'fail') : ''}
      ${unexpectedInfra > 0 ? this.signalChip(`${unexpectedInfra} infra-level (5xx)`, 'warn') : ''}
      ${miscErrors.expectedRbacErrors > 0 ? this.signalChip(`${miscErrors.expectedRbacErrors} expected RBAC`, 'warn') : ''}
    </div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:12px;">Unexpected = review and raise bugs (app-level = likely a real app bug; infra-level = a 5xx from a dependency, often transient). Expected RBAC = correct app security behaviour.</div>
    <div style="margin-bottom:12px;">
      <div style="font-size:12px;font-weight:600;color:${INK};margin-bottom:6px;">By Error Type</div>
      <table role="presentation" width="220" cellpadding="0" cellspacing="0">${byTypeRows}</table>
    </div>
    <div>
      <div style="font-size:12px;font-weight:600;color:${INK};margin-bottom:6px;">Error Details</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${errorRows}</table>
    </div>
  </div>
</td></tr>`;
  }

  // ===================== Action required =====================

  private buildActionRequiredSection(ctx: EmailContext, health: HealthScore, clusters: EnrichedCluster[]): string {
    const items: Array<{ text: string; priority: 'high' | 'medium' | 'low'; anchor?: string }> = [];

    if (ctx.suiteDrift?.occurred) {
      items.push({
        text: `Investigate suite drift — ${ctx.suiteDrift.decreaseBy} fewer test(s) ran than the previous run.`,
        priority: 'high',
        anchor: '#section-module-analytics',
      });
    }
    const multiClusters = clusters.filter((c) => c.tests.length > 1);
    for (const c of multiClusters) {
      const severity: 'high' | 'medium' = EmailTemplate.HIGH_SEVERITY_CATEGORIES.has(c.category) ? 'high' : 'medium';
      // WHY link to the FIRST test's own anchor, not just the section: a
      // reader clicking "investigate this cluster" lands directly on one of
      // the actual affected tests, which is itself inside the same visual
      // cluster block as the others — one concrete jump beats a generic one.
      const anchor = c.details[0] ? `#${c.details[0].anchorId}` : '#section-failed-tests';
      items.push({
        text: `Investigate ${c.category} failure cluster affecting ${c.tests.length} tests (${this.signalTypeLabel(c.signalType)}).`,
        priority: severity,
        anchor,
      });
    }
    const singleFailureClusters = clusters.filter((c) => c.tests.length === 1);
    if (singleFailureClusters.length > 0) {
      items.push({
        text: `Investigate ${singleFailureClusters.length} standalone failure(s) — see Failed Tests section.`,
        priority: 'medium',
        anchor: '#section-failed-tests',
      });
    }
    if (ctx.report.flaky > 0) {
      items.push({ text: `Review ${ctx.report.flaky} flaky test(s) — see Flaky Tests section.`, priority: 'medium', anchor: '#section-flaky-tests' });
    }
    const unexpectedMisc = ctx.miscErrors?.unexpectedErrors ?? 0;
    if (unexpectedMisc > 0) {
      items.push({
        text: `Review ${unexpectedMisc} unexpected background error(s) — see Background Errors section.`,
        priority: 'medium',
        anchor: '#section-background-errors',
      });
    }
    const regressions = (ctx.slowTestTrend ?? []).filter((t) => t.regression);
    if (regressions.length > 0) {
      items.push({ text: `Review ${regressions.length} test(s) with a performance regression — see Slowest Tests section.`, priority: 'low' });
    }

    if (items.length === 0) {
      return `
<tr><td id="section-action-required" style="padding:8px 28px;">
  <div style="border:1px solid ${SUCCESS_BORDER};background:${SUCCESS_BG};border-radius:6px;padding:14px 16px;">
    <div style="font-size:12.5px;font-weight:700;color:${SUCCESS};">No action required — this run is clean.</div>
  </div>
</td></tr>`;
    }

    const order = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => order[a.priority] - order[b.priority]);
    const rows = items
      .map((i) => {
        const color = i.priority === 'high' ? FAIL : i.priority === 'medium' ? WARN : SLATE;
        const textHtml = i.anchor ? `<a href="${this.escAttr(i.anchor)}" style="color:${INK};">${this.esc(i.text)}</a>` : this.esc(i.text);
        return `<div style="padding:5px 0;border-bottom:1px solid ${CANVAS_TINT};font-size:12px;color:${INK};">
          <span style="display:inline-block;width:56px;font-size:9.5px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${color};">${i.priority}</span>
          ${textHtml}
        </div>`;
      })
      .join('');

    return `
<tr><td id="section-action-required" style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Action Required (Automation Health: ${this.esc(health.label)})</div>
    ${rows}
  </div>
</td></tr>`;
  }

  // WHY built once and reused (2026-08-24): recurring flaky/failing test
  // titles in the Trend section can only link to a specific test's card when
  // that exact test actually has a FailureDetail THIS run (i.e. it's in
  // report.failedTests or report.flakyTests right now) — a chronically
  // recurring test that happened to pass cleanly this run has no card to
  // point at, and correctly renders as plain text instead (see
  // buildTrendSection's recurringBlock).
  private buildTestAnchorLookup(clusters: EnrichedCluster[], flakyDetails: FailureDetail[]): Map<string, string> {
    const lookup = new Map<string, string>();
    for (const c of clusters) {
      for (const d of c.details) lookup.set(d.test.title, d.anchorId);
    }
    for (const d of flakyDetails) lookup.set(d.test.title, d.anchorId);
    return lookup;
  }

  // ===================== Environment info =====================

  private buildEnvironmentInfoBlock(ctx: EmailContext): string {
    const { report } = ctx;
    const lines: Array<[string, string]> = [];
    lines.push(['Environment', ctx.env.toUpperCase()]);
    if (report.playwrightVersion) lines.push(['Playwright', report.playwrightVersion]);
    if (typeof report.workers === 'number') lines.push(['Workers', String(report.workers)]);
    if (report.projects.length > 0) lines.push(['Browsers tested', report.projects.join(', ')]);
    if (ctx.nodeVersion) lines.push(['Node (reporting process)', ctx.nodeVersion]);
    if (ctx.osInfo) lines.push(['OS (reporting process)', ctx.osInfo]);

    const rows = lines
      .map(
        ([label, value]) => `
      <tr>
        <td style="padding:4px 0;font-size:11px;color:${SLATE};width:170px;">${this.esc(label)}</td>
        <td style="padding:4px 0;font-size:12px;color:${INK};font-family:${MONO_FONT};">${this.esc(value)}</td>
      </tr>`
      )
      .join('');

    return `
<tr><td style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Environment</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>
</td></tr>`;
  }

  // ===================== CI/CD info (re-run + full-history links) =====================

  private buildCiCdInfoBlock(ctx: EmailContext): string {
    const hasRealBuildUrl = !!ctx.buildUrl;
    const lines: string[] = [];

    if (ctx.reportsDir) {
      lines.push(`<div style="font-size:11.5px;color:${INK};padding:3px 0;">Artifacts: <span style="font-family:${MONO_FONT};">${this.esc(ctx.reportsDir)}</span></div>`);
    }
    if (hasRealBuildUrl) {
      lines.push(
        `<div style="font-size:11.5px;color:${INK};padding:3px 0;">View run: <a href="${this.escAttr(ctx.buildUrl)}" style="color:${ACCENT};">${this.esc(ctx.buildUrl)}</a></div>`
      );
      if (ctx.runSource === 'jenkins') {
        const rerunUrl = ctx.buildUrl.replace(/\/\d+\/?$/, '/build');
        if (rerunUrl !== ctx.buildUrl) {
          lines.push(
            `<div style="font-size:11.5px;color:${INK};padding:3px 0;">Trigger re-run: <a href="${this.escAttr(rerunUrl)}" style="color:${ACCENT};">${this.esc(rerunUrl)}</a></div>`
          );
        }
      } else if (ctx.runSource === 'github-actions') {
        // WHY: GitHub only exposes re-run via that run page's own button (or an
        // authenticated API call) — there is no plain URL that re-triggers on
        // click. Labeled honestly rather than implying a one-click re-run,
        // same standard as the fixed localhost-fallback CTA bug.
        lines.push(
          `<div style="font-size:11.5px;color:${SLATE};padding:3px 0;">Re-run available from the run page above (GitHub's own "Re-run" button).</div>`
        );
      }
    } else {
      lines.push(`<div style="font-size:11.5px;color:${MUTED};padding:3px 0;">No build URL available for this run (local execution).</div>`);
    }
    if (ctx.historyBranchUrl) {
      lines.push(
        `<div style="font-size:11.5px;color:${INK};padding:3px 0;">Full run history: <a href="${this.escAttr(ctx.historyBranchUrl)}" style="color:${ACCENT};">${this.esc(ctx.historyBranchUrl)}</a></div>`
      );
    }
    if (ctx.allureUrl) {
      lines.push(
        `<div style="font-size:11.5px;color:${INK};padding:3px 0;">Allure report: <a href="${this.escAttr(ctx.allureUrl)}" style="color:${ACCENT};">${this.esc(ctx.allureUrl)}</a></div>`
      );
    }

    return `
<tr><td style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">CI/CD &amp; Artifacts</div>
    ${lines.join('')}
  </div>
</td></tr>`;
  }

  // ===================== CTA buttons =====================

  private buildCtaButtons(ctx: EmailContext): string {
    const buttons: string[] = [];
    // WHY: only render when a REAL buildUrl exists — previously fell back to
    // a guessed `localhost:8080` URL, which would show a broken/misleading
    // link if buildUrl was ever empty in a real CI misconfiguration. Omitting
    // the button is the correct graceful behavior, not fabricating a link.
    if (ctx.buildUrl && (ctx.runSource === 'jenkins' || ctx.runSource === 'github-actions')) {
      const label = ctx.runSource === 'jenkins' ? 'Jenkins Build' : 'GitHub Actions Run';
      buttons.push(
        `<a href="${this.escAttr(ctx.buildUrl)}" style="display:inline-block;background:${ACCENT};color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;margin-right:8px;">${this.esc(label)} →</a>`
      );
    }
    if (ctx.allureUrl) {
      buttons.push(
        `<a href="${this.escAttr(ctx.allureUrl)}" style="display:inline-block;background:${INK};color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Allure Report →</a>`
      );
    }
    if (buttons.length === 0) return '';
    return `
<tr><td style="padding:16px 28px;text-align:center;">
  ${buttons.join('')}
</td></tr>`;
  }

  // ===================== Footer =====================

  private buildFooter(ctx: EmailContext): string {
    const generatedAt = new Date().toISOString();
    return `
<tr><td style="padding:16px 28px;text-align:center;border-top:1px solid ${CANVAS_TINT};">
  <div style="font-size:11px;color:${MUTED};">Sent by Kylas ${this.esc(ctx.env.toUpperCase())} Automation System &nbsp;·&nbsp; akash.rn1908@gmail.com</div>
  <div style="font-size:10px;color:${MUTED};margin-top:4px;">Generated ${generatedAt} · Report engine v${REPORT_ENGINE_VERSION}</div>
</td></tr>`;
  }

  // ===================== Shared helpers =====================

  private fallbackHealth(report: ParsedReport): HealthScore {
    // WHY: EmailTemplate must render something sane even if a caller forgets
    // to pass ctx.health — mirrors AutomationHealth's own scoring so the
    // fallback isn't a magic number, just the same computation done inline
    // without the optional signals (history/misc errors/drift) a real caller
    // would normally supply.
    const passRatePenalty = Math.round((100 - report.passRate) * 0.6);
    const failPenalty = Math.min(report.failed * 3, 25);
    const flakyPenalty = Math.min(report.flaky * 1.5, 15);
    const score = Math.max(0, Math.min(100, Math.round(100 - passRatePenalty - failPenalty - flakyPenalty)));
    const label: HealthScore['label'] =
      score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Needs Attention' : 'Critical';
    return { score, label, factors: [] };
  }

  // WHY: takes the report's own startTime, not new Date() (now) — a real bug
  // caught during Phase 4 verification (2026-07-14): using "now" made the
  // masthead date drift from the Run Details' Started/Ended timestamps
  // whenever the email is rendered/sent some time after the actual test run
  // (e.g. queued in a mail relay). The masthead date must describe the run
  // being reported on, not the moment someone happens to render this method.
  private formatReportDate(startTime: string): string {
    return new Date(startTime).toLocaleDateString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  private mono(text: string): string {
    return `<span style="font-family:${MONO_FONT};">${this.esc(text)}</span>`;
  }

  private truncate(text: string, max: number): string {
    return text.length > max ? `${text.substring(0, max)}…` : text;
  }

  private esc(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escAttr(str: string): string {
    return this.esc(str).replace(/'/g, '&#39;');
  }
}
