import { CapacityRow, CapacityView, buildCapacityView } from './AccountCapacity';
import type { CapacityData } from '../modules/billing/capacity';
import { RunTimes } from './RunTimes';
import { ModuleStats, ParsedReport, TestResult, deriveModuleFromFile } from './ReportParser';
import { SessionInfoEntry } from '../auth/sessionInfo';
import {
  RunDelta,
  RecurringIssue,
  ModuleTrend,
  ModuleStabilityTrend,
  SlowTestTrend,
  SuiteDrift,
  PassRatePoint,
  passRatePercent,
} from './RunHistory';
import { HealthScore, VerdictResult, branchAdvice, computeOverallVerdict, computeHealthScore } from './AutomationHealth';
import { FailureCategory, normalizeTestTitle } from './FailureAnalyzer';
import { EnrichedCluster, FailureDetail, RegressionStatus } from './FailureDetailBuilder';
import { MiscErrorReport } from '../error-collector/ErrorCollector';
import { redactSensitiveText } from './redact';
import { groupBackgroundErrors } from './BackgroundErrors';
import { JobStats, detectJobOverlaps, buildJobRecoveryRows } from './JobStats';
import { FieldConfigResetReport } from './FieldConfigReset';
import { ShardCompleteness, isIncompleteRun, isScopedRun } from './ShardCompleteness';
import { RerunSummary, RerunTestRow, FIRST_LABEL, RERUN_LABEL, FINAL_LABEL, rerunRowKey } from './RerunSummary';
import { CauseSummary, SuspectedCause, splitText } from './FailureClassifier';
import { nounFor, plural as pluralize } from './wording';
import { DonutSegment, renderDonutPng } from './DonutChart';
import { RETRY, infoSwatch } from './EmailPalette';
import { logger } from '../utils/logger';

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
  // ADR 0017: when each role's session ended/ends (written by globalSetup); optional, absent = not shown
  sessionInfo?: SessionInfoEntry[];
  runSource?: 'local' | 'github-actions' | 'jenkins';
  allureUrl?: string;
  miscErrors?: MiscErrorReport | null;
  // WHY: optional, same graceful-absence pattern as miscErrors — populated by
  // scripts/syncHistory.ts when the history-sync step ran and there was a
  // previous run to compare against.
  historyDelta?: RunDelta | null;
  recurringFlaky?: RecurringIssue[];
  flakiestTests?: RecurringIssue[];
  recurringFailures?: RecurringIssue[];
  moduleTrend?: ModuleTrend[];
  // WHY a separate field, not folded into moduleTrend (2026-09-29, Phase 3
  // reporting enhancement item 5): moduleTrend answers "better/worse than
  // the single most recent run"; this answers "trending toward instability
  // over the last N runs" — a genuinely different question, computed by a
  // genuinely different function (computeModuleStabilityTrend()) — see that
  // function's own WHY comment in RunHistory.ts for why it isn't folded into
  // the existing one.
  moduleStabilityTrend?: ModuleStabilityTrend[];
  slowTestTrend?: SlowTestTrend[];
  suiteDrift?: SuiteDrift | null;
  passRateSeries?: PassRatePoint[];
  // WHY optional, GitHub-Actions-only (2026-09-29, Phase 3 items #1/#6) —
  // see JobStats.ts's own WHY comment for why Jenkins has no equivalent and
  // why this degrades to undefined rather than throwing on any fetch
  // failure. Rendered by buildJobStatsSection() only when both `jobs.length
  // > 0` (item #1 — per-job timing) — `totalJobMinutes` (item #6) is shown
  // alongside it, not as a separate section, since both come from the same
  // single API call and answer closely related questions.
  jobStats?: JobStats;
  // What the shards left about the account's capacity (loadCapacityData): the earliest pre-run snapshot and the latest post-run reading. Absent/empty = "capacity data unavailable".
  capacity?: CapacityData | null;
  // The run's own clock (RunTimes.ts): the workflow or build start and the time this email was generated. Absent = only the tests line shows.
  runTimes?: RunTimes;
  // WHY optional, same graceful-absence pattern as miscErrors/jobStats (ADR 0009):
  // the post-run dedicated form-field reset's outcome, read from
  // reports/<env>/field-config-reset.json. Informational only — it never feeds
  // the verdict, health score or any count.
  fieldConfigReset?: FieldConfigResetReport | null;
  // WHY optional, same graceful-absence pattern (2026-10-08, sandbox build
  // #189): expected vs merged shard reports, from reports/<env>/
  // shard-completeness.json. When reported < expected the verdict is forced
  // to 'blocked' (computeOverallVerdict) and a banner opens the email.
  shardCompleteness?: ShardCompleteness | null;
  // WHY optional, same graceful-absence pattern (ADR 0015): the rerun shard's result, from reports/<env>/
  // rerun-summary.json. Absent = the run had no rerun (kill switch off, old run) and the email is exactly as before.
  // Only the counts shown here change with it; verdict, health and subject read the combined report as usual.
  rerun?: RerunSummary | null;
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
  // Tests that passed on the rerun shard (Passed after the rerun; their first-run failure is the evidence). ADR 0015 amendment.
  rerunPassedDetails?: FailureDetail[];
  // WHY optional: suspected-cause hints (FailureClassifier.ts). Rendered only; nothing here feeds the verdict, health
  // score, counts, dedup key, subject or history.
  causeSummary?: CauseSummary;
  // Tests per module in the whole suite (SuiteBaseline.ts), for the "N not selected" note on a module that ran fewer; null or absent = no note.
  suiteBaseline?: Record<string, number> | null;
  // WHY: distinguishes "the history mechanism has never had a chance to
  // compare" (no prior run recorded at all) from "compared, and this
  // specific module/test had no prior entry" — see the Module Analytics
  // trend-column fix and RegressionStatus.unclassified for where this
  // matters. Undefined/false renders the same honest "no history yet" state.
  hasHistoryEverExisted?: boolean;
  // WHY: base GitHub blob URL (pinned to this run's exact commit SHA) for
  // the known-issues cross-reference — a specific failure's own doc path
  // (FailureDetail.knownIssue.file) and line number are appended as
  // /<file>#L<line> at render time.
  // Null when the remote isn't GitHub or couldn't be resolved.
  knownIssuesUrl?: string | null;
  // The tested commit: link, subject line and author (any of them null when unknown). Item 18.
  commit?: { sha: string; url: string | null; message: string | null; author: string | null; merge?: { sha: string; url: string | null; into: string | null } };
  // Where each KI number is documented (doc + heading line), so "see KI-43" can be a link (item 22).
  kiLocations?: Record<string, { file: string; line: number }>;
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

// Size rules (2026-11-25, corrected): NO content is capped for size. Every failed and flaky test keeps its full card, every list is complete, and a very
// bad run may go past Gmail's clip (about 102 KB, "View entire message"). What keeps the essentials above the cut is the ORDER of the sections (verdict,
// tiles, How the run ended, Needs attention, Module Analytics come first; the cards and the long lists come after), and E7's style compaction keeps
// normal runs under EMAIL_SIZE_TARGET. check:email-size asserts the normal runs stay under it and only reports the worst case.
export const EMAIL_SIZE_TARGET = 100 * 1024; // Gmail clips the HTML part at about 102 KB; 100 KiB leaves room for headers and encoding. Used by the checks only.
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

/** Content-ID of the donut PNG the notify step attaches inline (nodemailer `cid`). */
export const DONUT_CID = 'run-outcome@kylas-report';

export const CAPACITY_GREEN_LABEL = 'Account warning (does not change the test result)';
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
const MONO_FONT = "ui-monospace,Consolas,monospace"; // short on purpose: it is repeated about 90 times in a message that must stay under Gmail's clipping limit
const SANS_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export class EmailTemplate {
  // The donut PNG is made once per context (the HTML and the attachment must agree) and never lets a failure reach the send: see chartPng().
  private readonly chartCache = new WeakMap<EmailContext, Buffer | null>();
  // the environment of the email being rendered: the info tiles and the ENV badge take its colour (EmailPalette.ts)
  private env = '';

  // ── Style compaction (E7, 2026-11-25) ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  // 56% of a run email's bytes were repeated inline styles. Every inline style value that occurs at least twice (and saves bytes) becomes a short class
  // (`x0`, `x1`, ...) with its rule at the end of the head <style> block; nothing is removed, only moved. Inline styles stay where a client or a rule
  // needs them: tile cells, bar cells and swatches (their colour must stand without the block: check:email-safety), images, anything with a title, the
  // top-level section cells (the phone rule matches their 28px padding). Order matters: the generated rules come last, so they win over the older class
  // rules exactly as the inline style did.
  static compactStyles(html: string): string {
    const bodyAt = html.indexOf('<body');
    if (bodyAt < 0) return html;
    const head = html.slice(0, bodyAt);
    const body = html.slice(bodyAt);
    const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*>/g;
    const eligible = (tag: string, attrs: string, style: string): boolean =>
      tag !== 'img' && tag !== 'body' && !/\stitle="/.test(attrs) && !/class="[^"]*\b(kpi|sw|donut)\b/.test(attrs) && !/28px/.test(style) && !/\bbgcolor=/.test(attrs);
    const counts = new Map<string, number>();
    for (const m of body.matchAll(tagRe)) {
      const style = /\sstyle="([^"]*)"/.exec(m[2])?.[1];
      if (style && eligible(m[1], m[2], style)) counts.set(style, (counts.get(style) ?? 0) + 1);
    }
    const chosen = [...counts.entries()]
      .filter(([style, n]) => n >= 2 && n * (style.length + 9 - 12) - (style.length + 5) > 0)
      .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length);
    const names = new Map<string, string>(chosen.map(([style], i) => [style, `x${i.toString(36)}`]));
    const zebra: string[] = [];
    const out = body.replace(tagRe, (whole, tag: string, attrs: string) => {
      const style = /\sstyle="([^"]*)"/.exec(attrs)?.[1];
      const cls = style && eligible(tag, attrs, style) ? names.get(style) : undefined;
      if (!style || !cls) return whole;
      if (tag === 'tr' && /border-bottom:1px solid #F6F8FA/.test(style) && !zebra.includes(cls)) zebra.push(cls);
      const withoutStyle = attrs.replace(/\sstyle="[^"]*"/, '');
      const merged = /\sclass="([^"]*)"/.test(withoutStyle) ? withoutStyle.replace(/\sclass="([^"]*)"/, (_m, c: string) => ` class="${c} ${cls}"`) : `${withoutStyle} class="${cls}"`;
      return `<${tag}${merged}>`;
    });
    if (names.size === 0) return html;
    const rules = [...names].map(([style, cls]) => `.${cls}{${style.replace(/;\s*$/, '')}}`).join('') + zebra.map((c) => `tr.${c}:nth-child(even) td{background:#FAFBFC}`).join('');
    return `${head.replace(/<\/style>/, `${rules}</style>`)}${out}`;
  }

  /** The inverse of compactStyles, for tests: every generated class back to its inline style (attribute order may differ from the original). */
  static expandStyles(html: string): string {
    const rules = new Map<string, string>();
    for (const m of html.matchAll(/\.(x[0-9a-z]+)\{([^}]*)\}/g)) rules.set(m[1], m[2]);
    const bodyAt = html.indexOf('<body');
    if (bodyAt < 0 || rules.size === 0) return html;
    const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*>/g;
    const body = html.slice(bodyAt).replace(tagRe, (whole, tag: string, attrs: string) => {
      const cm = /\sclass="([^"]*)"/.exec(attrs);
      if (!cm) return whole;
      const tokens = cm[1].split(/\s+/);
      const gen = tokens.find((t) => rules.has(t));
      if (!gen) return whole;
      const rest = tokens.filter((t) => t !== gen).join(' ');
      const noClass = attrs.replace(/\sclass="[^"]*"/, rest ? ` class="${rest}"` : '');
      return `<${tag}${noClass} style="${rules.get(gen)}">`;
    });
    return html.slice(0, bodyAt).replace(/\.x[0-9a-z]+\{[^}]*\}/g, '').replace(/tr\.x[0-9a-z]+:nth-child\(even\) td\{[^}]*\}/g, '') + body;
  }

  /** `donut` is injectable so a test can make the image fail (the email must still be sent, without the image). */
  constructor(private readonly donut: (segments: DonutSegment[]) => Buffer = (segments) => renderDonutPng(segments)) {}

  // Set at the start of each render (rendering is synchronous): what kiLinked() needs to turn a KI number into a link.
  private kiLocations: Record<string, { file: string; line: number }> = {};
  private kiBase: string | null = null;

  /** Turns every `KI-nn` in already-escaped text into a link to its entry (and names the topic file) when the doc location is known. */
  private kiLinked(escapedText: string): string {
    if (!this.kiBase) return escapedText;
    return escapedText.replace(/KI-\d+/g, (id) => {
      const loc = this.kiLocations[id];
      return loc ? `<a href="${this.escAttr(`${this.kiBase}/${loc.file}#L${loc.line}`)}" style="color:${ACCENT};">${id}</a> (${this.esc(loc.file.split('/').pop() ?? loc.file)})` : id;
    });
  }

  subject(ctx: EmailContext): string {
    // WHY routed through computeOverallVerdict() (fixed 2026-09-09, sandbox
    // Build #167 incident) rather than deriving icon/status from
    // ctx.report.status directly: that was the exact same
    // banner-vs-Executive-Summary disagreement the 2026-08-24 fix
    // (buildStatusBanner()'s own WHY comment) was built to make structurally
    // impossible — it just never got applied to the SUBJECT LINE, which kept
    // its own separate, unfixed derivation. Confirmed live: a run where 0 of
    // 499 tests executed (all skipped) showed "✅ ... PASSED" in the subject
    // while the body correctly said "Deployment not recommended". Reusing
    // the identical ctx.health/ctx.verdict fallback pattern html() already
    // uses (see below) guarantees the subject and body can never disagree
    // again, by construction — not just less likely to.
    const health = ctx.health ?? this.fallbackHealth(ctx.report);
    const verdict =
      ctx.verdict ?? computeOverallVerdict(ctx.report, health, ctx.suiteDrift ?? null, ctx.shardCompleteness, null, ctx.branch);
    const icon =
      verdict.bannerTone === 'success' ? '✅' : verdict.bannerTone === 'danger' ? '❌' : '⚠️';
    const status = verdict.bannerLabel.replace(/^[^\w]+/, '').toUpperCase();
    // WHY: a stale report must be unmissable even in an inbox list view,
    // where the banner below the fold won't be seen until the email is
    // opened — prefixed here so it's visible before that.
    const stalePrefix = ctx.reportFreshness?.isStale ? '⚠️ STALE REPORT — ' : '';
    // WHY: a scoped Jenkins test run (SHARDED_TEST) is not a full-suite result and
    // must say so in the inbox list, before the banner inside the email is seen.
    const scopedPrefix = isScopedRun(ctx.shardCompleteness) ? '🔎 PARTIAL (scoped run) — ' : '';
    // WHY a separate "Health:" segment (2026-10-06, sandbox Build #186): the
    // verdict word and icon above come only from this run's own results;
    // health is its own labeled value, never folded into the headline status.
    // WHY a factual subject (2026-11-24, build #235 review, items 15 and the second amendment of ADR 0015): the counts first, in the same
    // terms as the email (Passed = final outcome, with the instability named inside it), and no health score (it is in the body).
    // A run that is not a count-based result says what it is instead: BLOCKED, INCOMPLETE RUN, NO TESTS EXECUTED, SUITE DRIFT.
    const report = ctx.report;
    const counts = this.countsLine(report);
    const summary = verdict.bannerLabel.startsWith('🚫') || verdict.bannerLabel.includes('Suite Drift') || verdict.bannerLabel.includes('No Tests Selected') ? status : `${counts} of ${report.total}`;
    return `${scopedPrefix}${stalePrefix}${icon} ${ctx.env.toUpperCase()} ${ctx.branch} #${ctx.buildNumber}: ${summary}`;
  }

  /** "2 failed, 940 passed (6 flaky, 2 on rerun), 1 skipped": the counts, in the same terms in the subject, the top summary and the text part. */
  private countsLine(report: ParsedReport): string {
    const marks = [report.firstRun.flaky > 0 ? `${report.firstRun.flaky} flaky` : '', report.recoveredOnRerun > 0 ? `${report.recoveredOnRerun} on rerun` : '', report.ranOnlyOnRerun > 0 ? `${report.ranOnlyOnRerun} ran only on rerun` : ''].filter(Boolean);
    return [
      report.failed > 0 ? `${report.failed} failed` : '',
      `${report.finalPassed} passed${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`,
      report.didNotRun > 0 ? `${report.didNotRun} did not run` : '',
      // deliberate skips are named so that failed + passed + skipped adds up to the total (2026-11-25, scenario matrix)
      report.skipped - report.didNotRun > 0 ? `${report.skipped - report.didNotRun} skipped` : '',
    ]
      .filter(Boolean)
      .join(', ');
  }

  /** Three lines a reader gets before anything else (item 14): the result, what needs action, and the run link. */
  private topSummaryLines(ctx: EmailContext, verdict: VerdictResult): { result: string; action: string; link: string | null } {
    const r = ctx.report;
    const nothingRan = verdict.verdict === 'blocked' && (r.total === 0 || r.status === 'no-tests-executed' || (ctx.health?.notApplicable ?? '') !== '');
    const result = nothingRan ? verdict.bannerLabel.replace(/^[^\w]+/, '') : `${verdict.bannerLabel.replace(/^[^\w]+/, '')}: ${this.countsLine(r)} of ${r.total}`;
    let action: string;
    if (r.failed > 0) {
      const names = (ctx.clusters ?? []).flatMap((c) => c.details.map((d) => normalizeTestTitle(d.test.title))).slice(0, 2).map((t) => this.truncate(t, 80));
      action = `Fix ${r.failed} failing test${r.failed === 1 ? '' : 's'}${names.length > 0 ? `: ${names.join('; ')}${r.failed > names.length ? '; …' : ''}` : ''}`;
    } else if (verdict.verdict === 'blocked') {
      action = verdict.headline;
    } else if (verdict.verdict === 'caution') {
      action = verdict.headline.replace(/^[^—]*— /, '').replace(/^but /, '');
      action = action.charAt(0).toUpperCase() + action.slice(1);
    } else {
      action = 'None.';
    }
    return { result, action, link: ctx.buildUrl || null };
  }

  private buildTopSummary(ctx: EmailContext, verdict: VerdictResult): string {
    const t = this.topSummaryLines(ctx, verdict);
    const row = (label: string, value: string): string => `<div style="font-size:12.5px;color:${INK};padding:2px 0;"><strong style="color:${SLATE};display:inline-block;width:64px;">${label}</strong>${value}</div>`;
    return `
<tr><td style="padding:12px 28px 0;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:10px 14px;background:${CANVAS_TINT};">
    ${row('Result', this.esc(t.result))}
    ${row('Action', this.esc(t.action))}
    ${row('Run', t.link ? `<a href="${this.escAttr(t.link)}" style="color:${ACCENT};">${this.esc(t.link)}</a>` : 'no run link (local execution)')}
  </div>
</td></tr>`;
  }

  /** The plain-text alternative part (item 24): the same facts without layout, for clients that cannot or will not show the HTML. */
  // the plain-text part stays small (about 12 KiB) whatever the HTML shows
  text(ctx: EmailContext): string {
    const health = ctx.health ?? this.fallbackHealth(ctx.report);
    const verdict = ctx.verdict ?? computeOverallVerdict(ctx.report, health, ctx.suiteDrift ?? null, ctx.shardCompleteness, null, ctx.branch);
    const t = this.topSummaryLines(ctx, verdict);
    const r = ctx.report;
    const lines: string[] = [this.subject(ctx), '', `Result: ${t.result}`, `Action: ${t.action}`, `Run: ${t.link ?? 'no run link (local execution)'}`, ''];
    lines.push(`Health: ${health.notApplicable ? `n/a (${health.notApplicable})` : `${health.label} ${health.score}/100`}`);
    lines.push(`Passed first time: ${health.notApplicable ? 'n/a' : `${r.passRate}%`}; duration ${this.formatDuration(r.duration)}; ${new Set(r.modules.map((m) => m.name)).size} modules`);
    const failed = (ctx.clusters ?? []).flatMap((c) => c.details);
    if (failed.length > 0) {
      lines.push('', `FAILED (${r.failed})`);
      for (const d of failed) {
        lines.push(`- ${normalizeTestTitle(d.test.title)} (${d.test.file.split('/').pop()}): ${this.truncate(d.primaryError.replace(/\s+/g, ' '), 200)}`);
        const cmd = this.rerunCommand(ctx.env, d.test);
        if (cmd) lines.push(`    ${cmd}`);
      }
    }
    const unstable = [...r.flakyTests, ...r.passedOnRerunTests];
    if (unstable.length > 0) {
      lines.push('', `FLAKY / PASSED ON RERUN (${unstable.length})`);
      for (const x of unstable) lines.push(`- ${normalizeTestTitle(x.title)}`);
    }
    if (ctx.miscErrors && ctx.miscErrors.totalErrors > 0) lines.push('', `Background errors: ${ctx.miscErrors.unexpectedErrors} unexpected + ${ctx.miscErrors.expectedRbacErrors} expected RBAC + known noise = ${ctx.miscErrors.totalErrors} (details: background-errors.html in the report artifact)`);
    lines.push('', 'Traces, screenshots, page snapshots and the full lists are in the report artifact on the run page.');
    return lines.join('\n');
  }

  html(ctx: EmailContext): string {
    return EmailTemplate.compactStyles(this.renderHtml(ctx));
  }

  /**
   * The same email with every style inline, as the template writes it: what the checks parse. `html()` is this with the repeated inline styles moved
   * into short classes of the head `<style>` block (E7, 2026-11-25), which is what is sent; `expandStyles(html())` is this (check:build240 proves it).
   */
  htmlReadable(ctx: EmailContext): string {
    return this.renderHtml(ctx);
  }

  /** The email, every card in full. `totalCards` is for tests that want to force fewer cards; the sent email never does. */
  renderHtml(ctx: EmailContext, totalCards: number = NO_LIMIT): string {
    this.env = ctx.env;
    this.kiLocations = ctx.kiLocations ?? {};
    this.kiBase = ctx.knownIssuesUrl ?? null;
    const health = ctx.health ?? this.fallbackHealth(ctx.report);
    const clusters = ctx.clusters ?? [];
    // WHY computed here (not left undefined) when a caller omits it: mirrors
    // fallbackHealth()'s own precedent — EmailTemplate must render something
    // correct even if a caller forgets to pass ctx.verdict, using the same
    // real computeOverallVerdict() logic rather than a second, drifting copy.
    const verdict =
      ctx.verdict ?? computeOverallVerdict(ctx.report, health, ctx.suiteDrift ?? null, ctx.shardCompleteness, null, ctx.branch);
    // WHY built once, threaded through: lets the Trend section's "recurring
    // flaky/failing" test names and Action Required's items deep-link to a
    // specific test's own card in Failed/Flaky Tests when that test actually
    // appears in THIS run's output — see buildTestAnchorLookup()'s own WHY.
    const testAnchors = this.buildTestAnchorLookup(clusters, [...(ctx.flakyFailureDetails ?? []), ...(ctx.rerunPassedDetails ?? [])]);
    // Shared card budget (size): failed tests first, flaky and passed-on-rerun keep at least 4 cards between them when there are any.
    const unstableCount = ctx.report.flakyTests.length + ctx.report.passedOnRerunTests.length;
    const failedCards = Math.max(0, Math.min(ctx.report.failed, totalCards - Math.min(unstableCount, 4)));
    const unstableCards = totalCards - Math.min(failedCards, totalCards);
    const flakyCards = Math.min(ctx.report.flakyTests.length, unstableCards);
    const rerunCards = Math.max(0, Math.min(ctx.report.passedOnRerunTests.length, unstableCards - flakyCards));

    // Account capacity (2026-11-26, ADR 0019): computed once; the warnings go near the top, the full section after Module Analytics
    const capacityView = buildCapacityView(ctx.capacity, ctx.runTimes?.runEnd ?? Date.now());
    const body = [
      this.buildIncompleteRunBanner(ctx.shardCompleteness),
      this.buildScopedRunBanner(ctx.shardCompleteness),
      this.buildFreshnessWarning(ctx.reportFreshness),
      this.buildMasthead(ctx, health),
      this.buildStatusBanner(verdict),
      this.buildTopSummary(ctx, verdict),
      // a failed run keeps the cause directly under the verdict; when nothing failed in the end it is a quiet note below the summary (build #242)
      ctx.report.failed > 0 ? this.buildCauseBanner(ctx.causeSummary, false) : '',
      this.buildCapacityWarnings(capacityView, verdict.verdict === 'clear'),
      this.buildStatusBadgeRow(ctx),
      this.buildExecutiveSummary(ctx, health, clusters, verdict),
      ctx.report.failed > 0 ? '' : this.buildCauseBanner(ctx.causeSummary, true),
      this.buildCauseSummaryLine(ctx.causeSummary),
      this.buildHealthScoreBlock(health),
      this.buildRunMetadata(ctx),
      this.buildKpiDashboard(ctx),
      this.buildNotVerifiedNote(ctx.report),
      // Essentials first (2026-11-25): nothing is capped for size, so a very bad run can pass Gmail's clip; what must always be above it is the verdict,
      // the tiles, How the run ended, what needs attention (Action Required) and Module Analytics. Cards and the long lists come after.
      this.buildActionRequiredSection(ctx, health, clusters, verdict),
      this.buildModuleAnalytics(ctx),
      this.buildAccountCapacitySection(capacityView),
      this.buildRerunSummarySection(ctx.rerun),
      this.buildTrendSection(ctx, testAnchors),
      this.buildFlakiestTestsSection(ctx, testAnchors),
      this.buildSlowTestsSection(ctx),
      this.buildModuleSlowestTestsSection(ctx),
      this.buildJobStatsSection(ctx),
      this.buildFlakyTestsSection(ctx, flakyCards),
      this.buildPassedOnRerunSection(ctx, rerunCards),
      this.buildSkippedTestsSection(ctx),
      this.buildFailureClustersSection(clusters, ctx.knownIssuesUrl, ctx.rerun, ctx.buildUrl, failedCards, ctx.env),
      this.buildBackgroundErrorsSection(ctx.miscErrors),
      this.buildFieldConfigResetSection(ctx.fieldConfigReset, ctx.env),
      this.buildEnvironmentInfoBlock(ctx),
      this.buildCiCdInfoBlock(ctx),
      this.buildCtaButtons(ctx),
      this.buildFooter(ctx),
    ].join('');

    // Styles (2026-11-25): progressive enhancement only; every visual has an inline fallback for clients that strip <style>. Dark mode: the email is
    // designed light and keeps its own light surfaces (the older rules painted the page dark while the text stayed dark-on-dark); clients that
    // invert colours themselves (Gmail app, Outlook mobile) start from a readable light design. Mobile: tiles go two per row, side padding
    // shrinks, code blocks scroll inside themselves.
    const page = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>
  @media only screen and (max-width: 480px) {
    .kpi { display: inline-block !important; width: 44% !important; box-sizing: border-box; vertical-align: top; min-height: 98px; }
    td[style*="28px"] { padding-left: 16px !important; padding-right: 16px !important; }
    table { width: 100% !important; max-width: 100% !important; }
    table.lt { width: auto !important; }
    .donut { width: 110px !important; height: 110px !important; }
    .col { display: block !important; width: 100% !important; padding: 0 0 12px !important; box-sizing: border-box; }
    .mh { display: none !important; }
    table.am th, table.am td { padding: 3px 1px !important; font-size: 9px !important; }
    table.am th { font-size: 8px !important; letter-spacing: -0.2px; }
    table.am .nm { font-size: 10px !important; padding-right: 3px !important; }
    .wr { white-space: normal !important; }
    td, div, a { overflow-wrap: break-word; }
    a { overflow-wrap: anywhere; }
  }
  pre { width: 0; min-width: 100%; box-sizing: border-box; overflow-x: auto; }
  .sw { border-radius: 2px; }
  code { font-size: inherit; }
  .tv { line-height: 1; }
  .tl { margin-top: 6px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
  .ts { margin-top: 3px; line-height: 1.3; color: #F0F3F6; }
  .h { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; padding-bottom: 6px; border-bottom: 1px solid #D0D7DE; }
  .cmd { padding: 3px 8px; background: #F6F8FA; border: 1px solid #D0D7DE; border-radius: 6px; }
  tr[style*="border-bottom"]:nth-child(even) td { background: #FAFBFC; }
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${SANS_FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;table-layout:fixed;">
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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-bg" style="background:#ffffff;width:100%;table-layout:fixed;">
${body}
</table>
</td></tr>
</table>
</body></html>`;
    // Size (item 13): the template's indentation and line breaks between tags are about 15% of the message. Only whitespace that sits between
    // a '>' and a '<' is collapsed to one space (text inside <pre> and pre-wrap blocks has no tags between its characters).
    // The newline in front of a top-level section row (`\n<tr><td`) stays: tests and tooling split the email on it.
    const polished = this.polish(page);
    return polished.replace(/>(\s+)</g, (m, ws: string, off: number) => (ws === '\n' && polished.startsWith('tr><td', off + m.length) ? '>\n<' : '> <'));
  }

  /**
   * Visual polish applied to the finished page (2026-11-25), so every section gets the same treatment without touching its builder: section
   * headings get a small icon and a thin divider. Pure styling: no
   * text, number or id changes (the icon is its own span before the heading text).
   */
  private polish(page: string): string {
    const ICONS: Array<[RegExp, string]> = [
      [/^Executive Summary/, '📝'], [/^How the run ended/, '🏁'], [/^Run Details/, '🗂️'], [/^Rerun Summary/, '🔁'], [/^Run Summary/, '📊'], [/^Rerun of/, '🔁'], [/^Trend/, '📈'], [/^Flakiest/, '🔥'],
      [/^Module Analytics/, '🧩'], [/^Account capacity/, '🏦'], [/^Slowest/, '🐢'], [/^CI Job Stats/, '⚙️'], [/^Load Signals/, '📡'], [/^Flaky Tests/, '🧪'], [/^Passed on rerun/, '✅'],
      [/^Skipped/, '⏭️'], [/^Action Required/, '🎯'], [/^Environment/, '🖥️'], [/^CI\/CD/, '🚀'], [/^Background/, '⚠️'], [/^Failed/, '❌'],
    ];
    const heading = /<div style="(font-size:10\.5px;font-weight:700;letter-spacing:0\.08em;text-transform:uppercase;color:#[0-9A-Fa-f]{6};margin(?:-bottom)?:[^;"]+;)">([^<]+)<\/div>/g;
    const withHeadings = page.replace(heading, (_m, style: string, text: string) => {
      const icon = ICONS.find(([re]) => re.test(text))?.[1];
      // the shared type and divider live in the .h class; only the colour and spacing stay inline
      return `<div class="h" style="${style.replace('font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;', '')}">${icon ? `${icon} ` : ''}${text}</div>`;
    });
    return withHeadings;
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
    const ageLabel = hours >= 24 ? `${Math.round(hours / 24)} ${nounFor(Math.round(hours / 24), 'day')}` : `${hours} ${nounFor(hours, 'hour')}`;
    return `
<tr><td style="background:${FAIL};padding:12px 28px;text-align:center;">
  <span style="font-size:13px;font-weight:700;color:#ffffff;">⚠ STALE REPORT — this data is ${ageLabel} old (threshold: ${freshness.thresholdHours}h), not from a fresh run. Investigate why fresh results weren't available before treating this as current.</span>
</td></tr>`;
  }

  // WHY first in the email, above even the stale-report warning (2026-10-08):
  // every count below understates the run, so this must be read before them.
  // Renders nothing unless fewer shard reports than expected were merged.
  private buildIncompleteRunBanner(completeness: ShardCompleteness | null | undefined): string {
    if (!isIncompleteRun(completeness)) return '';
    const missing = completeness.expected - completeness.reported;
    // WHY (2026-11-24, sandbox 45420781016): when the renew-session job failed, every test job was SKIPPED (nothing crashed or hung);
    // the cause comes from shard-completeness.json / renew-session-failed.json via NotificationService.
    if (completeness.cause?.startsWith('renew-session')) {
      const why = completeness.cause.replace(/^renew-session:\s*/, 'The renew-session job did not succeed: ');
      return `
<tr><td id="section-incomplete-run" style="background:${FAIL};padding:14px 28px;text-align:center;">
  <div style="font-size:14px;font-weight:700;color:#ffffff;">Incomplete run: ${completeness.reported} of ${completeness.expected} shards reported — no test job started</div>
  <div style="font-size:12px;color:#ffffff;margin-top:4px;">${this.esc(why)} The test jobs need that job, so all ${missing} were skipped, not crashed. Nothing below is a pass.</div>
</td></tr>`;
    }
    return `
<tr><td id="section-incomplete-run" style="background:${FAIL};padding:14px 28px;text-align:center;">
  <div style="font-size:14px;font-weight:700;color:#ffffff;">Incomplete run: ${completeness.reported} of ${completeness.expected} shards reported</div>
  <div style="font-size:12px;color:#ffffff;margin-top:4px;">${missing} ${nounFor(missing, 'shard')} never uploaded a report (job crashed, hung or was cancelled). Totals, pass rate and health below cover only the shards that reported — this is not a pass. Check the run's job list.</div>
</td></tr>`;
  }

  // Renders nothing unless Jenkins marked the run scoped (SHARDED_TEST with TEST_GREP /
  // FF_ENTITIES): every count below covers only the selected part of the suite.
  private buildScopedRunBanner(completeness: ShardCompleteness | null | undefined): string {
    if (!isScopedRun(completeness)) return '';
    return `
<tr><td id="section-scoped-run" style="background:${WARN};padding:12px 28px;text-align:center;">
  <div style="font-size:13px;font-weight:700;color:#ffffff;">Partial run — scoped test build: ${this.esc(completeness.scoped)}</div>
  <div style="font-size:12px;color:#ffffff;margin-top:4px;">Only the selected part of the suite ran. These totals are not a full-suite result.</div>
</td></tr>`;
  }

  private buildMasthead(ctx: EmailContext, health: HealthScore): string {
    return `
<tr><td style="background:${INK};padding:20px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="font-size:16px;font-weight:700;color:#ffffff;">Kylas <span style="font-weight:400;color:#9BA9FF;">${this.esc(ctx.env.toUpperCase())} Automation</span></td>
    <td align="right" style="font-size:11px;color:#9BA5B1;">Automation Health: <strong style="color:#ffffff;">${health.notApplicable ? 'n/a' : health.label}</strong></td>
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
  <span style="font-size:16px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffffff;">${this.esc(verdict.bannerLabel)}</span>
</td></tr>`;
  }

  // ===================== Suspected-cause hints =====================

  private static readonly CAUSE_LABEL_TEXT: Record<SuspectedCause, string> = {
    'environment-suspected': 'environment',
    'application-bug-suspected': 'application',
    'test-or-code-suspected': 'test/code',
    'known-bug-fixed': 'known bug fixed: remove test.fail()',
    flaky: 'flaky',
    unclassified: 'unclassified',
  };

  // WHY a blue/slate informational style, never the FAIL/WARN/SUCCESS tokens: these are hints about WHERE to look, not
  // a second verdict — the status banner above stays the only red/amber/green element about the run's outcome.
  private causeBadge(cause: FailureDetail['cause']): string {
    if (!cause) return '';
    const suspected = cause.label !== 'unclassified' && cause.label !== 'flaky' && cause.label !== 'known-bug-fixed';
    const text = `${suspected ? 'suspected: ' : ''}${EmailTemplate.CAUSE_LABEL_TEXT[cause.label]}`;
    const color = suspected ? ACCENT : SLATE;
    return `<span style="display:inline-block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;background:#ffffff;color:${color};border:1px solid ${suspected ? '#C9D2F5' : BORDER};border-radius:3px;padding:1px 6px;margin-left:4px;">${this.esc(text)}</span>`;
  }

  private causeEvidence(cause: FailureDetail['cause']): string {
    if (!cause) return '';
    const lines = cause.evidence.map((e) => `<br>&bull; ${this.kiLinked(this.esc(this.truncate(e, 300)))}`).join('');
    return `<div style="margin-top:6px;font-size:10.5px;color:${SLATE};"><strong style="color:${INK};">Suspected cause — a hint, not a verdict:</strong> ${this.esc(EmailTemplate.CAUSE_LABEL_TEXT[cause.label])}${lines}</div>`;
  }

  // Returns '' when there is nothing to show (same convention as buildIncompleteRunBanner()). Sits directly under the
  // status banner and does not touch it: the verdict above is unchanged by anything here.
  private buildCauseBanner(summary: CauseSummary | undefined, quiet: boolean): string {
    const d = summary?.dominant;
    if (!d) return '';
    // WHY dated and labelled: the observation is a one-off manual probe stored in the registry, not something this
    // run measured, so a reader must not take it for a fresh result.
    const ask = d.askKylasTeam
      ? `<div style="font-size:12px;color:${INK};margin-top:6px;"><strong>To ask the Kylas dev team:</strong> ${this.esc(d.askKylasTeam.question)}</div>
  <div style="font-size:12px;color:${SLATE};margin-top:2px;">Observed on ${this.esc(d.askKylasTeam.observed)} (a one-off manual check, not measured by this run): ${this.esc(d.askKylasTeam.observation)}</div>`
      : '';
    const split = splitText(d.failedCount, d.retryCount, d.rerunCount);

    const title = `Likely environment problem: ${d.count} of ${d.total} failed or flaky tests share the signature “${this.esc(d.title)}” (${this.esc(split)}) — see ${this.kiLinked(this.esc(d.kiRef))}`;
    const detail = `A suspected cause only — the run status above is unchanged and every failure is still listed below. Of the ${d.total}: ${this.esc(splitText(d.failedTotal, d.retryTotal, d.rerunTotal))}. A flaky test (${d.rerunTotal > 0 ? 'passed on retry or recovered on rerun' : 'passed on retry'}) counts here because its failing attempt matched. Signature registered ${this.esc(d.added)}.`;
    if (quiet) {
      return `
<tr><td id="section-suspected-environment" style="padding:6px 28px 0;">
  <div style="font-size:11px;color:${SLATE};"><strong style="color:${INK};">Note:</strong> ${title}. Nothing failed in the end, so this does not change the verdict. ${detail}</div>
  ${ask}
</td></tr>`;
    }
    return `
<tr><td id="section-suspected-environment" style="background:#EEF1FF;padding:12px 28px;border-bottom:1px solid #C9D2F5;">
  <div style="font-size:13px;font-weight:700;color:${INK};">${title}</div>
  <div style="font-size:12px;color:${SLATE};margin-top:4px;">${detail}</div>
  ${ask}
</td></tr>`;
  }

  private buildCauseSummaryLine(summary: CauseSummary | undefined): string {
    if (!summary || summary.total === 0) return '';
    const c = summary.counts;
    const note = summary.incompleteRun ? ' Run incomplete: counts cover only the shards that reported.' : '';
    // WHY worded by the first-run outcome (2026-11-25, build #239: "none failed outright" while leads.spec.ts:904 failed both attempts and passed
    // only on the rerun): a test that failed every attempt and passed only on the rerun is labelled flaky by the classifier (it ended
    // Passed), so counting "failed" by the final result hid it. Three groups, each said as what happened: still failing, failed every attempt
    // and passed on the rerun, passed on a retry.
    const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    const retryOnly = summary.retryTotal - summary.rerunTotal;
    const groups = [
      summary.rerunTotal > 0 ? `${summary.rerunTotal} failed every attempt and passed on the rerun` : '',
      retryOnly > 0 ? `${retryOnly} passed on a retry` : '',
    ].filter(Boolean);
    const heading = plural(summary.total, 'test') + ' that did not pass first time';
    const failedPart =
      summary.failedTotal > 0
        ? `of the ${summary.failedTotal} still failing, ${c['environment-suspected']} environment, ${c['application-bug-suspected']} application, ${c['test-or-code-suspected']} test/code, ${c.unclassified} unclassified${c['known-bug-fixed'] > 0 ? `, ${c['known-bug-fixed']} known bug fixed (remove test.fail())` : ''}`
        : 'none is still failing';
    const retryPart = groups.length > 0 ? `; ${groups.join(', ')}` : '';
    return `
<tr><td id="section-failure-causes" style="padding:4px 28px 8px;">
  <div style="font-size:12px;color:${SLATE};">Suspected cause of the ${heading} (hints, not verdicts): ${failedPart}${retryPart}.${this.esc(note)}</div>
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
    const SOURCE_COLORS: Record<string, string> = {
      jenkins: '#d33833',
      'github-actions': '#24292f',
      local: '#6b7280',
    };
    const NEUTRAL = '#374151';
    const BRANCH_COLOR = '#2563eb';
    const chip = (label: string, value: string, bg: string, monospace = false, fg = '#ffffff'): string =>
      `<span style="display:inline-block;font-size:11px;color:${fg};background:${bg};border-radius:4px;padding:4px 9px;margin:3px 6px 0 0;">${label} <b style="color:${fg};font-weight:600;${monospace ? `font-family:${MONO_FONT};` : ''}">${value}</b></span>`;
    const chips = [
      chip('ENV', this.esc(ctx.env.toUpperCase()), infoSwatch(ctx.env).bg, false, infoSwatch(ctx.env).text),
      chip('BRANCH', this.esc(ctx.branch), BRANCH_COLOR, true),
      chip('BUILD', `#${this.esc(ctx.buildNumber)}`, NEUTRAL, true),
      chip('SOURCE', this.esc(sourceLabel), SOURCE_COLORS[ctx.runSource ?? 'local'] ?? NEUTRAL),
    ].join(' ');
    return `
<tr><td style="padding:12px 28px 4px;">
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
    } else if (health.notApplicable) {
      // WHY (2026-11-25, scenario matrix): "No test failures this run." for a run where nothing ran or shards are missing read as good news.
      sentences.push(`Nothing was verified: ${health.notApplicable}.`);
    } else if (report.recoveredOnRerun > 0 || report.ranOnlyOnRerun > 0 || report.didNotRun > 0) {
      // tests did fail (or never ran) in the first run: the true statement is about the end result
      sentences.push('No test failed in the end.');
    } else {
      sentences.push('No test failures this run.');
    }
    // WHY (second amendment of ADR 0015, 2026-11-24): the table's "Final result" and the Passed tile count every test that
    // ultimately passed, so the instability is stated INSIDE that number, not as a second count that contradicts it.
    // Disjoint buckets (the matrix check:scenarios found the same tests counted twice): clean + after an in-job retry (flaky, whether or not the
    // rerun confirmed it) + after the rerun (failed every first attempt) + ran only on the rerun = Passed.
    const afterRetry = report.firstRun.flaky;
    const afterRerun = report.recoveredOnRerun;
    const ranOnly = report.ranOnlyOnRerun;
    if (afterRetry + afterRerun + ranOnly > 0) {
      // plain words (2026-11-25): "1 passed on its retry and 1 only on the rerun", not "1 after an in-job retry (flaky) and 1 after the rerun"
      const parts = [afterRetry > 0 ? `${afterRetry} passed on ${afterRetry === 1 ? 'its' : 'their'} retry` : '', afterRerun > 0 ? `${afterRerun} ${afterRetry > 0 ? '' : 'passed '}only on the rerun` : '', ranOnly > 0 ? `${ranOnly} that did not run in the first run, only on the rerun` : ''].filter(Boolean);
      sentences.push(`${report.finalPassed} of ${report.total} ${nounFor(report.total, 'test')} passed in the end: ${parts.join(' and ')} — not clean the first time.`);
    }
    if (drift?.occurred) {
      sentences.push(
        `Test count dropped by ${drift.decreaseBy} vs. ${this.driftComparisonLabel(drift)} — confirm this was intentional (see Action Required).`
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
    // Only when health itself is the reason (Needs Attention or worse): for every other amber run the headline and the sentences above state the real reason.
    if (report.failed === 0 && !drift?.occurred && verdict.verdict !== 'clear' && !health.notApplicable && (health.label === 'Needs Attention' || health.label === 'Critical')) {
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
            verdict.verdict === 'caution' ? branchAdvice(ctx.branch).review : 'Action required — see Action Required section below'
          }</div>`
        : '';

    return `
<tr><td style="padding:20px 28px 8px;">
  <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">Executive Summary</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${cardBorder};background:${cardBg};border-radius:6px;"><tr>
    <td width="4" style="background:${stripeColor};border-radius:6px 0 0 6px;font-size:0;">&nbsp;</td>
    <td style="padding:14px 16px;">
      <div style="font-size:13.5px;font-weight:700;color:${INK};">${this.esc(verdict.headline)}</div>
      <div style="font-size:12.5px;color:#424A53;line-height:1.55;margin-top:4px;">${this.esc(sentences.join(' '))}</div>
      ${actionLine}
    </td>
  </tr></table>
</td></tr>`;
  }

  private buildHealthScoreBlock(health: HealthScore): string {
    if (health.notApplicable) {
      return `
<tr><td style="padding:4px 28px 8px;">
  <span style="display:inline-block;border:1px solid ${BORDER};background:${CANVAS_TINT};color:${SLATE};border-radius:4px;padding:5px 10px;font-size:11.5px;font-weight:700;">Health: n/a</span>
  <span style="font-size:11.5px;color:${SLATE};margin-left:8px;">Not scored: ${this.esc(health.notApplicable)}.</span>
</td></tr>`;
    }
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

  /** The commit as a link with its subject and author (item 18); the bare short hash when nothing more is known. */
  private commitHtml(ctx: EmailContext, shortCommit: string): string {
    const c = ctx.commit;
    const link = (sha: string, url: string | null | undefined): string => (url ? `<a href="${this.escAttr(url)}" style="color:${ACCENT};">${this.mono(sha.substring(0, 8))}</a>` : this.mono(sha.substring(0, 8)));
    const hash = c ? link(c.sha, c.url) : this.mono(shortCommit);
    const detail = [c?.message ? this.esc(this.truncate(c.message, 100)) : '', c?.author ? `by ${this.esc(c.author)}` : ''].filter(Boolean).join(' ');
    // The pushed commit is a merge: the line above is the feature branch's own head commit.
    const merged = c?.merge ? ` <span style="color:${MUTED};">(merged into ${this.esc(c.merge.into ?? 'the run branch')} as ${link(c.merge.sha, c.merge.url)})</span>` : '';
    return (detail ? `${hash} — ${detail}` : hash) + merged;
  }

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
    const at = (iso: string): string => new Date(iso).toLocaleString('en-IN', dtOpts);
    // Two clocks, both labelled (2026-11-26, build #240): "Run" is the workflow (or Jenkins build) from its own start to the moment this
    // email was generated (the merge job that builds it is still running); "Tests" is the first attempt start to the last attempt end.
    const testsLine = `${at(report.testsStart)} to ${at(report.testsEnd)} (${this.formatDuration(Date.parse(report.testsEnd) - Date.parse(report.testsStart))})`;
    const rt = ctx.runTimes;
    let runLine: string | null = null;
    if (rt?.runStart) {
      const how = rt.runStart.source === 'github-first-job' ? "; the start is the first job's, the run's own start was unavailable" : '';
      runLine = `${at(rt.runStart.iso)} to ${at(rt.runEnd)} (${this.formatDuration(Date.parse(rt.runEnd) - Date.parse(rt.runStart.iso))}; the end is when this email was generated, the merge job is still running${how})`;
    } else if (ctx.runSource && ctx.runSource !== 'local') {
      runLine = `start unavailable (the ${ctx.runSource === 'jenkins' ? "Jenkins build's" : "GitHub run's"} own start time could not be read); email generated ${at(rt?.runEnd ?? new Date().toISOString())}`;
    }
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
      ${runLine ? row('Run', this.esc(runLine)) : ''}
      ${row('Tests', this.esc(testsLine))}
      ${row('Triggered by', this.esc(ctx.triggeredBy))}
      ${row('Commit', this.commitHtml(ctx, shortCommit))}
      ${this.sessionRows(ctx, row)}
    </table>
  </div>
</td></tr>`;
  }

  // ADR 0017: a failure close to a session end is probably the app's token-refresh cascade, not a product problem.
  private sessionRows(ctx: EmailContext, row: (label: string, value: string) => string): string {
    return (ctx.sessionInfo ?? [])
      .map((entry) => {
        const end = new Date(entry.endIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeZoneName: 'short' });
        const note = entry.belowRunWindow ? ' (less than the run window left at start: failures near the end may be the session refresh)' : '';
        if (entry.renewedAt) {
          const at = new Date(entry.renewedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeZoneName: 'short' });
          return row(`${entry.role} session`, this.esc(`renewed at ${at}, ends ${end}`));
        }
        return row(`${entry.role} session`, this.esc(`ends ${end}, ${entry.minutesLeft} min left at start${note}`));
      })
      .join('');
  }


  // ===================== Account capacity =====================

  private static readonly ENTITY_LABELS: Record<string, string> = { LEAD: 'Leads', DEAL: 'Deals', CONTACT: 'Contacts', COMPANY: 'Companies', TASK: 'Tasks', CALL: 'Call logs', QUOTATION: 'Quotations', MEETING: 'Meetings', NOTE: 'Notes' };

  /** The warnings of the account's capacity, near the top: yellow rows for a warning, red for none left or an unexpected plan or a passed renewal. Nothing when there is none. */
  /** On a green run the warning sits under a verdict that says Passed: one line says it is about the account, not the tests (2026-11-26, scenario matrix). */
  private buildCapacityWarnings(view: CapacityView, greenRun: boolean): string {
    if (view.warnings.length === 0) return '';
    const red = view.warnings.some((w) => w.colour === 'red');
    const lines = view.warnings
      .map((w) => `<div style="font-size:12px;color:${w.colour === 'red' ? FAIL : WARN};margin-top:2px;">${w.colour === 'red' ? '🚫' : '⚠️'} ${this.esc(w.text)}</div>`)
      .join('');
    return `
<tr><td id="section-capacity-warnings" style="background:${red ? FAIL_BG : WARN_BG};padding:10px 28px;border-bottom:1px solid ${red ? FAIL_BORDER : WARN_BORDER};">
  ${greenRun ? `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${SLATE};margin-bottom:3px;">${CAPACITY_GREEN_LABEL}</div>` : ''}<div style="font-size:13px;font-weight:700;color:${red ? FAIL : WARN};">Account capacity ${red ? 'needs action' : 'warning'}</div>
  ${lines}
</td></tr>`;
  }

  private capacityColours(c: 'green' | 'yellow' | 'red'): { bar: string; text: string; bg: string } {
    return c === 'red' ? { bar: FAIL, text: FAIL, bg: FAIL_BG } : c === 'yellow' ? { bar: RETRY.bg, text: WARN, bg: WARN_BG } : { bar: SUCCESS, text: SUCCESS, bg: SUCCESS_BG };
  }

  private capacityBar(row: CapacityRow): string {
    const c = this.capacityColours(row.colour);
    const filled = row.usedPct;
    const cell = (width: number, bg: string): string => (width > 0 ? `<td style="width:${width}%;background:${bg};height:10px;font-size:1px;line-height:1px;">&nbsp;</td>` : '');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>${cell(filled, c.bar)}${cell(100 - filled, '#EAEEF2')}</tr></table>`;
  }

  private buildAccountCapacitySection(view: CapacityView): string {
    if (!view.available) {
      return `
<tr><td id="section-account-capacity" style="padding:8px 28px;">
  <div style="font-size:12px;color:${SLATE};">Account capacity: data unavailable — ${this.esc(view.unavailableReason)}.</div>
</td></tr>`;
    }
    const plan = view.plan!;
    const ist: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' };
    const pc = this.capacityColours(plan.colour);
    const days =
      plan.daysLeft === null ? '' : plan.daysLeft < 0 ? ` (passed ${-plan.daysLeft} ${-plan.daysLeft === 1 ? 'day' : 'days'} ago)` : plan.daysLeft === 0 ? ' (today)' : ` (${plan.daysLeft} ${plan.daysLeft === 1 ? 'day' : 'days'} left)`;
    const period = [plan.period ? plan.period.charAt(0) + plan.period.slice(1).toLowerCase() : null, plan.currency].filter(Boolean).join(', ');
    const meta = (label: string, value: string): string => `<tr><td style="padding:3px 0;font-size:11px;color:${SLATE};width:110px;vertical-align:top;">${label}</td><td style="padding:3px 0;font-size:12px;color:${INK};">${value}</td></tr>`;
    const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${meta('Plan', `<span style="background:${pc.bg};color:${pc.text};padding:1px 8px;border-radius:10px;font-weight:700;">${this.esc(plan.name)}</span>${plan.note ? ` <span style="color:${pc.text};">${this.esc(plan.note)}</span>` : ''}`)}
      ${meta('Billing period', this.esc(period || 'not available'))}
      ${meta('Renewal', plan.renewalAt ? `${this.esc(new Date(plan.renewalAt).toLocaleDateString('en-IN', ist))}${this.esc(days)}` : 'none (no renewal on this plan)')}
    </table>`;
    const num = (n: number | null, unit: string): string => (n === null ? 'unlimited' : `${n.toLocaleString('en-US')}${unit}`);
    const bars = view.rows
      .map((r) => {
        const c = this.capacityColours(r.colour);
        return `<tr>
        <td style="padding:6px 8px 2px 0;font-size:12px;color:${INK};width:150px;vertical-align:top;">${this.esc(r.label)}</td>
        <td style="padding:6px 0 2px 0;vertical-align:middle;">${this.capacityBar(r)}</td>
        <td style="padding:6px 0 2px 8px;font-size:12px;color:${c.text};width:240px;vertical-align:top;"><strong>${this.esc(num(r.remaining, r.unit))} left</strong> (${this.esc(r.state)})</td>
        <td style="padding:6px 0 2px 8px;font-size:11px;color:${SLATE};width:170px;vertical-align:top;">${this.esc(num(r.used, r.unit))} used of ${this.esc(num(r.total, r.unit))}</td>
      </tr>`;
      })
      .join('');
    const created = (n: number | null): string => (n === null ? 'n/a' : `${n > 0 ? '+' : ''}${n.toLocaleString('en-US')}`);
    const entities = view.entities
      .map(
        (e) =>
          `<tr><td style="padding:2px 12px 2px 0;font-size:12px;color:${INK};">${this.esc(EmailTemplate.ENTITY_LABELS[e.entity] ?? e.entity)}</td><td style="padding:2px 12px;font-size:12px;color:${INK};text-align:right;">${e.used.toLocaleString('en-US')}</td><td style="padding:2px 0 2px 12px;font-size:12px;color:${SLATE};text-align:right;">${this.esc(created(e.created))}</td></tr>`
      )
      .join('');
    const cr = view.created;
    const createdLine =
      cr.total === null
        ? `Created during this run: not available (${cr.reason || 'no live counts'}).`
        : `Created during this run: ${cr.total.toLocaleString('en-US')} (the live per-entity totals after the run minus before it${cr.reason ? `; ${cr.reason}` : ''}). The account is shared and the search index can lag, so this can include other activity or miss records still being indexed.`;
    const expectedColour = cr.expectedColour ? this.capacityColours(cr.expectedColour).text : SLATE;
    const expectedLine =
      cr.expectedLeft === null
        ? ''
        : `<div style="font-size:12px;color:${expectedColour};margin-top:4px;"><strong>Expected after the next refresh: ${cr.partial ? 'at most ' : ''}about ${this.esc(cr.expectedLeft <= 0 ? `none left (over by ${(-cr.expectedLeft).toLocaleString('en-US')})` : cr.expectedLeft.toLocaleString('en-US') + ' records left')}</strong> (records left now minus the ${cr.total!.toLocaleString('en-US')} created${cr.partial ? ', a lower bound: some entities were not read' : ''}).</div>`;
    return `
<tr><td id="section-account-capacity" style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Account capacity</div>
    ${header}
    <div style="font-size:11px;color:${SLATE};margin-top:8px;">Billing figures below are ${this.esc(view.refreshLabel)}: Kylas counts a delete at once but a create only at its nightly refresh.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;">${bars}</table>
    <div style="font-size:11px;font-weight:700;color:${SLATE};margin-top:10px;">Records by entity</div>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:4px;"><tr><td style="font-size:11px;color:${SLATE};padding:2px 12px 2px 0;">Entity</td><td style="font-size:11px;color:${SLATE};padding:2px 12px;text-align:right;">Used (billing)</td><td style="font-size:11px;color:${SLATE};padding:2px 0 2px 12px;text-align:right;">Created this run (live)</td></tr>${entities}</table>
    <div style="font-size:11px;color:${SLATE};margin-top:8px;">${this.esc(createdLine)}</div>
    ${expectedLine}
  </div>
</td></tr>`;
  }

  // ===================== KPI dashboard =====================

  private buildKpiDashboard(ctx: EmailContext): string {
    const { report } = ctx;
    const previousRun = ctx.historyDelta?.previousRun ?? null;

    const totalSubtext = ctx.suiteDrift?.occurred
      ? `<span style="color:${FAIL};font-weight:700;">▼ ${ctx.suiteDrift.decreaseBy} fewer tests than ${this.driftComparisonLabel(ctx.suiteDrift)} (worse)</span>`
      : previousRun
        ? this.deltaSubtext(ctx.historyDelta!.totalDelta, '', 'tests')
        : undefined;
    const passRateSubtext = previousRun
      ? this.deltaSubtext(report.passRate - this.passRateOf(previousRun), ' points')
      : undefined;
    // WHY this subtext (2026-09-29, real reader confusion: "222 retries
    // recorded, but only 8 failed + 30 flaky — that doesn't reconcile"):
    // totalRetries sums every test's own retry count, including tests that
    // passed on every attempt they were ever recorded for but still got
    // re-run because a DIFFERENT test's failure forced a whole
    // `.serial`-mode block to retry from the top (see
    // ReportParser.ts's retriesFromCleanSweeps WHY comment for the full
    // mechanism). Only rendered when sweeps actually contributed anything,
    // matching this file's existing "signal chips only render when
    // nonzero" convention.
    // Rerun shard attempts are counted in the tile too (each rerun result is one more result of its test), so the
    // tile and the rerun section's "(N in-job retries)" (the rerun shard's own retry budget) are told apart here.
    // Said in tests, plainly (2026-11-26, build #242: "1 genuine, 3 swept" and "from failed/flaky tests" were unexplained).
    const retriesSubtext = [
      report.testsNeedingRetry > 0 ? `${report.testsNeedingRetry} ${report.testsNeedingRetry === 1 ? 'test needed a retry' : 'tests needed a retry'}` : '',
      report.testsSweptByRetry > 0 ? `${report.testsSweptByRetry} ${report.testsSweptByRetry === 1 ? 'other re-ran only because it shares' : 'others re-ran only because they share'} a serial block with a test that did` : '',
      report.retriesFromRerun > 0 ? `the rerun added ${report.retriesFromRerun} ${report.retriesFromRerun === 1 ? 'attempt' : 'attempts'}` : '',
    ]
      .filter(Boolean)
      .join('; ') || undefined;

    const primaryRow = this.kpiRow([
      { value: String(report.total), label: 'Total', variant: ctx.suiteDrift?.occurred ? 'fail' : 'neutral', subtext: totalSubtext },
      // Passed = the FINAL outcome (second amendment of ADR 0015, 2026-11-24): clean + after an in-job retry + after the rerun.
      { value: String(report.finalPassed), label: 'Passed', variant: 'success', subtext: report.firstRun.flaky + report.recoveredOnRerun + report.ranOnlyOnRerun > 0 ? [report.firstRun.flaky > 0 ? `${report.firstRun.flaky} after a retry` : '', report.recoveredOnRerun > 0 ? `${report.recoveredOnRerun} after the rerun` : '', report.ranOnlyOnRerun > 0 ? `${report.ranOnlyOnRerun} ran only on rerun` : ''].filter(Boolean).join(', ') : undefined },
      { value: String(report.failed), label: 'Failed', variant: report.failed > 0 ? 'fail' : 'neutral', anchor: report.failed > 0 ? '#section-failed-tests' : undefined },
      // Skipped = deliberate skips only; tests that never ran have their own tile (same split as the rerun table), so
      // Passed + Failed + Skipped + Did not run = Total. Flaky is a signal inside Passed and sits in the second row.
      { value: String(report.skipped - report.didNotRun), label: 'Skipped', variant: 'muted' },
      ...(report.didNotRun > 0 ? [{ value: String(report.didNotRun), label: 'Did not run', variant: 'warn' as const }] : []),
    ]);

    const secondaryRow = this.kpiRow([
      {
        value: ctx.health?.notApplicable ? 'n/a' : `${report.passRate}%`,
        // WHY labelled by what it measures (2026-11-03 email review): this is passed / ALL tests, a test that needed a
        // retry or a rerun is not in it; the Health block's "Passed incl. flaky" is a different number on purpose.
        label: 'Passed first time',
        variant: ctx.health?.notApplicable ? 'neutral' : report.passRate >= 90 ? 'success' : report.passRate >= 75 ? 'warn' : 'fail',
        subtext: ctx.health?.notApplicable ? undefined : passRateSubtext,
      },
      {
        // A signal INSIDE Passed, not an outcome (it is not in the sum above): tests that passed only on an in-job retry.
        value: String(report.firstRun.flaky),
        label: 'Flaky',
        variant: report.firstRun.flaky > 0 ? 'warn' : 'neutral',
        anchor: report.flaky > 0 ? '#section-flaky-tests' : report.passedOnRerunTests.length > 0 ? '#section-passed-on-rerun' : undefined,
        subtext: report.firstRun.flaky > 0 || report.recoveredOnRerun > 0 ? `passed on a retry (inside Passed)${report.recoveredOnRerun > 0 ? `; +${report.recoveredOnRerun} passed only on the rerun` : ''}` : undefined,
      },
      { value: this.formatDuration(report.duration), label: 'Duration' },
      // one per module name, UI and RBAC together: the same count as the rows of the Module Analytics table (build #242 said 36 here and showed 18 rows)
      { value: String(new Set(report.modules.map((m) => m.name)).size), label: 'Modules', subtext: 'UI and RBAC together' },
      {
        value: String(report.totalRetries),
        label: 'Retries',
        variant: report.totalRetries > 0 ? 'warn' : 'neutral',
        subtext: retriesSubtext,
      },
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
  ${this.buildOutcomeChart(ctx)}
  ${signalChips ? `<div style="margin-top:10px;">${signalChips}</div>` : ''}
</td></tr>`;
  }

  // ===================== Outcome donut + segmented bar (2026-11-25) =====================

  /** The five outcomes the chart shows; they partition the total and are the tiles' numbers (Passed = first + retry + rerun, Flaky = retry, Failed, Skipped + Did not run). */
  outcomeShares(report: ParsedReport): { first: number; retry: number; rerun: number; failed: number; skipped: number; total: number; passRate: number } {
    return { first: report.firstRun.passed, retry: report.firstRun.flaky, rerun: report.recoveredOnRerun + report.ranOnlyOnRerun, failed: report.failed, skipped: report.skipped, total: report.total, passRate: report.passRate };
  }

  private chartSegments(o: ReturnType<EmailTemplate['outcomeShares']>): Array<{ key: string; label: string; value: number; color: string }> {
    return [
      { key: 'first', label: 'Passed first time', value: o.first, color: SUCCESS },
      { key: 'retry', label: 'Passed on retry', value: o.retry, color: RETRY.bg },
      { key: 'rerun', label: 'Passed on rerun', value: o.rerun, color: '#57AB5A' },
      { key: 'failed', label: 'Failed', value: o.failed, color: FAIL },
      { key: 'skipped', label: 'Skipped', value: o.skipped, color: '#8C959F' },
    ];
  }

  /** The alt text states the same numbers the tiles show; a check reads it back (invariant donut-matches-tiles). */
  private chartAlt(o: ReturnType<EmailTemplate['outcomeShares']>): string {
    return `Outcome of ${o.total} tests: ${o.first} passed first time, ${o.retry} passed on retry, ${o.rerun} passed on rerun, ${o.failed} failed, ${o.skipped} skipped. ${o.passRate}% passed first time.`;
  }

  private chartShown(ctx: EmailContext): boolean {
    return ctx.report.total > 0 && !(ctx.health ?? this.fallbackHealth(ctx.report)).notApplicable;
  }

  /**
   * The donut PNG, or null when the email shows no chart or the image could not be made. A failure here (any error) is logged as a warning and
   * the email is sent without the image: the legend and the segmented bar stay, so nothing about the numbers is lost.
   */
  private chartPng(ctx: EmailContext): Buffer | null {
    if (!this.chartShown(ctx)) return null;
    if (this.chartCache.has(ctx)) return this.chartCache.get(ctx) ?? null;
    let png: Buffer | null = null;
    try {
      png = this.donut(this.chartSegments(this.outcomeShares(ctx.report)).map((x) => ({ value: x.value, color: x.color })));
    } catch (err) {
      logger.warn(`[Email] The outcome donut could not be made (${err instanceof Error ? err.message : String(err)}): sending the email without the image, the bar and the legend stay`);
    }
    this.chartCache.set(ctx, png);
    return png;
  }

  /** The donut as the message's inline (CID) attachment; null when there is none (nothing to chart, or the image failed). */
  chartAttachment(ctx: EmailContext): { filename: string; cid: string; contentType: string; content: Buffer } | null {
    const png = this.chartPng(ctx);
    return png ? { filename: 'run-outcome.png', cid: DONUT_CID, contentType: 'image/png', content: png } : null;
  }

  /** A thin bar of coloured table cells (email-safe, shown even when images are blocked); every non-zero part gets at least 1%. */
  private segmentedBar(parts: Array<{ label: string; value: number; color: string }>, total: number): string {
    const live = parts.filter((x) => x.value > 0);
    if (total <= 0 || live.length === 0) return '';
    const pct = live.map((x) => Math.max(1, Math.round((x.value / total) * 100)));
    const big = pct.indexOf(Math.max(...pct));
    pct[big] -= pct.reduce((n, v) => n + v, 0) - 100;
    const cells = live.map((x, i) => `<td width="${pct[i]}%" title="${this.escAttr(`${x.label}: ${x.value}`)}" style="background:${x.color};height:8px;line-height:8px;font-size:0;">&nbsp;</td>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border-radius:4px;"><tr>${cells}</tr></table>`;
  }

  /**
   * "How the run ended" (2026-11-25): one card with two halves. Left (about 40%): the donut, "99.7% first time" under it and a compact legend with each
   * count right next to its label. Right (about 60%): the Rerun Summary tiles, a grid of 3 per row (only when a rerun ran; without one the donut and
   * the legend are centred and fill the card). The segmented bar runs under both. A two-column table (no flex or grid); on phones the halves stack, donut first (`.col`).
   */
  private buildOutcomeChart(ctx: EmailContext): string {
    // nothing verified (blocked, incomplete, empty run): no chart, but a rerun that ran still shows its tiles
    if (!this.chartShown(ctx)) return ctx.rerun?.ran ? `\n  <div style="margin-top:14px;">${this.buildRerunSummaryTiles(ctx)}</div>` : '';
    const o = this.outcomeShares(ctx.report);
    const segs = this.chartSegments(o);
    const png = this.chartPng(ctx);
    const tiles = this.buildRerunSummaryTiles(ctx);
    const legend = segs
      .map((x) => `<tr style="font-size:12px;${x.value === 0 ? `color:${MUTED};` : ''}"><td style="padding:3px 0;"><span class="sw" style="display:inline-block;width:10px;height:10px;background:${x.color};"></span>&nbsp; ${x.label}</td><td style="padding:3px 0 3px 10px;font-weight:700;">${x.value}</td></tr>`)
      .join('');
    // "99.7% first time" is text, not part of the image: readable, selectable, and still there when images are blocked
    const figureColor = o.passRate >= 90 ? SUCCESS : o.passRate >= 75 ? WARN : FAIL;
    const image = png
      ? `<img src="cid:${DONUT_CID}" width="170" height="170" alt="${this.escAttr(this.chartAlt(o))}" class="donut" style="display:block;border:0;width:170px;height:170px;margin:0 auto;">`
      : '';
    // Left half: a nested two-column table, the donut with "99.7% first time" under it, then the legend beside it. Both halves are vertically centred.
    // On phones the donut shrinks (`.donut`) so the pair still fits side by side at 375 px; the outer halves stack (`.col`).
    const donutCell = `<td class="dn" valign="middle" style="padding:0 14px 0 0;text-align:center;">${image}<div style="font-size:30px;font-weight:700;line-height:1;color:${figureColor};margin-top:${png ? '8px' : '0px'};">${o.passRate}%</div><div style="font-size:11px;color:${SLATE};margin:2px 0 0;">first time</div></td>`;
    const legendCell = `<td class="dn" valign="middle"><table class="lt" role="presentation" cellpadding="0" cellspacing="0">${legend}</table></td>`;
    return `
  <div style="margin-top:14px;border:1px solid ${BORDER};border-radius:8px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">How the run ended</div>
    <table id="section-outcome-chart" role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="col" width="${tiles ? '40%' : '100%'}" valign="middle" style="padding:0 ${tiles ? '12px' : '0'} 0 0;"><table class="lt" role="presentation" ${tiles ? '' : 'align="center" style="margin:0 auto;" '}cellpadding="0" cellspacing="0"><tr>${donutCell}${legendCell}</tr></table></td>${tiles ? `
      <td class="col" width="60%" valign="middle" style="padding:0 0 0 12px;">${tiles}</td>` : ''}
    </tr></table>
    ${this.segmentedBar(segs, o.total)}
  </div>`;
  }

  /**
   * "Rerun Summary" tiles, same tile design (2026-11-25), as a grid of 3 per row inside the right half of the "How the run ended" card: Rerun (tests
   * rerun), Passed on rerun, Still failing, Not rerun (the reason as subtext: a flaky test passed on its retry and is not rerun, a failed test of a
   * shared-config suite is never rerun), Rerun duration. Only when a rerun ran; nothing otherwise. The numbers are the rerun summary's own rows, the same
   * ones the Rerun section's list shows.
   */
  private buildRerunSummaryTiles(ctx: EmailContext): string {
    const rr = ctx.rerun;
    if (!rr || !rr.ran) return '';
    // from the rows themselves, so they agree with the Rerun section's list (a test that did not run first and passed on the rerun is a pass too)
    const passedOnRerun = rr.rows.filter((x) => x.rerun === 'passed').length;
    const stillFailing = rr.rows.filter((x) => x.rerun === 'failed').length;
    const flakyTitles = new Set(ctx.report.flakyTests.map((t) => t.title));
    const reasons = [...new Set(rr.excluded.map((e) => (flakyTitles.has(e.title) ? 'passed on retry' : e.reason)))].join('; ');
    return `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Rerun Summary</div>
      <table id="section-rerun-summary" role="presentation" width="100%" cellpadding="0" cellspacing="0">${this.kpiRow(
        [
          { value: String(rr.rows.length), label: 'Rerun' },
          { value: String(passedOnRerun), label: 'Passed on rerun', variant: passedOnRerun > 0 ? 'success' : 'neutral' },
          { value: String(stillFailing), label: 'Still failing', variant: stillFailing > 0 ? 'fail' : 'neutral' },
        ],
        3
      )}${this.kpiRow(
        [
          { value: String(rr.excluded.length), label: 'Not rerun', subtext: rr.excluded.length > 0 ? this.esc(this.truncate(reasons, 60)) : undefined },
          { value: this.formatDuration(rr.durationMs ?? 0), label: 'Rerun duration' },
        ],
        3
      )}</table>`;
  }

  private kpiRow(
    tiles: Array<{ value: string; label: string; variant?: 'neutral' | 'success' | 'fail' | 'warn' | 'muted'; subtext?: string; anchor?: string }>,
    columns = tiles.length
  ): string {
    const widthPct = Math.floor(100 / columns);
    // a short last row keeps the grid's column width: the missing tiles are empty cells
    const filler = '<td style="padding:0;"></td>'.repeat(Math.max(0, columns - tiles.length));
    return `<tr>${tiles.map((t) => this.kpiTile(t.value, t.label, t.variant ?? 'neutral', t.subtext, widthPct, t.anchor)).join('')}${filler}</tr>`;
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
    tileVariant: 'neutral' | 'success' | 'fail' | 'warn' | 'muted',
    subtext: string | undefined,
    widthPct: number,
    anchor?: string
  ): string {
    // Solid colour-filled tiles (2026-11-25): big white number, small label, one line of subtext. One semantic system: green passed, amber
    // retry / rerun / flaky / skipped, red failed, blue information (totals, durations, counts), grey = zero or not applicable (a problem tile
    // with nothing in it must not shout). White text on each fill is at least 4.5:1.
    const grey = value === '0' || value === 'n/a';
    const info = infoSwatch(this.env);
    // fill + text: status tiles are solid with white text; information tiles take the environment's colour and "needs a look" tiles (flaky, retries, did
    // not run) the retry yellow, both light with dark text (EmailPalette.ts)
    let fill = info.bg;
    let text = info.text;
    if (grey || tileVariant === 'muted') [fill, text] = ['#6E7781', '#ffffff'];
    else if (tileVariant === 'success') [fill, text] = [SUCCESS, '#ffffff'];
    else if (tileVariant === 'fail') [fill, text] = [FAIL, '#ffffff'];
    else if (tileVariant === 'warn') [fill, text] = [RETRY.bg, RETRY.text];
    const dark = text.toLowerCase() === '#ffffff'; // white text: the subtext keeps the light tone of the .ts class
    const valueHtml = anchor ? `<a href="${this.escAttr(anchor)}" style="color:${text};text-decoration:none;">${this.esc(value)}</a>` : this.esc(value);
    return `
  <td style="width:${widthPct}%;background:${fill};border:3px solid #ffffff;border-radius:10px;padding:12px 4px 10px;height:62px;text-align:center;color:${text};" class="kpi">
    <div class="tv" style="font-size:22px;font-weight:700;">${valueHtml}</div>
    <div class="tl" style="font-size:9px;">${this.esc(label)}</div>
    ${subtext ? `<div class="ts" style="font-size:10px;${dark ? '' : `color:${text};`}">${subtext.replace(/color:#[0-9A-Fa-f]{6};?/g, '')}</div>` : ''}
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

  // WHY one shared helper for this phrase, used at all 4 suite-drift call
  // sites (Executive Summary, KPI dashboard, Module Analytics/
  // AutomationHealth's own factor note, Action Required) (2026-09-03): each
  // previously hardcoded "vs. the previous run" unconditionally — accurate
  // for a normal run, but misleading for a dev-equivalent (reset) run
  // compared against the last reset run instead (see SuiteDrift's own WHY
  // comment in RunHistory.ts). One shared label keeps all 4 spots honest and
  // in agreement, rather than 3 of them saying "vs. last reset run (#159,
  // 33 tests)" while a 4th still says the generic, now-inaccurate phrase.
  private driftComparisonLabel(drift: SuiteDrift): string {
    return drift.basis === 'previous-reset-run'
      ? `the last reset-to-dev run (#${drift.baselineBuildNumber}, ${drift.baselineTotal} tests)`
      : 'the previous run';
  }

  // WHY this renders even when suiteDrift.occurred is false (2026-09-03):
  // a confirmed dev-equivalent run with NO prior reset-run baseline yet
  // (basis 'no-reset-baseline-yet') never produces an alarm — occurred is
  // always false by construction — but rendering nothing at all would be
  // indistinguishable from "not a reset run, nothing to say," the same
  // "silence is ambiguous" concern already fixed once for Module Analytics'
  // own trend glyph (see that code's own comment). A calm, explicit, non-
  // alarming note replaces the drift alarm this run would otherwise have
  // risked showing for the wrong reason — never rendered for a normal run.
  private buildDevEquivalentRunNote(drift: SuiteDrift | null | undefined): string {
    if (!drift || drift.basis === 'previous-run') return '';
    const text =
      drift.basis === 'no-reset-baseline-yet'
        ? "This run's commit matches dev's HEAD (a reset run) — count comparison not meaningful for a reset run; no prior reset-run baseline yet to compare against."
        : `This run's commit matches dev's HEAD (a reset run) — suite-size comparison uses ${this.driftComparisonLabel(drift)}, not whatever ran immediately before it.`;
    return `<div style="font-size:11px;color:${SLATE};background:${CANVAS_TINT};border-radius:4px;padding:6px 8px;margin-bottom:8px;">ℹ️ ${text}</div>`;
  }

  /**
   * A change against the last run, in words so the meaning never depends on the arrow or the colour (item 21): "7 fewer than last run",
   * "2 more failed than last run (worse)". `change` is the real change in the figure; `goodWhenUp` says which direction is good.
   */
  private deltaSubtext(change: number, suffix = '', noun = '', goodWhenUp = true): string {
    if (change === 0) return `<span style="color:${MUTED};">same${noun ? ` ${noun}` : ''} as last run</span>`;
    const up = change > 0;
    const good = up === goodWhenUp;
    const amount = Math.round(Math.abs(change) * 10) / 10;
    const more = suffix === ' points' ? (up ? 'higher' : 'lower') : up ? 'more' : 'fewer';
    return `<span style="color:${good ? SUCCESS : FAIL};font-weight:700;">${up ? '▲' : '▼'} ${amount}${suffix} ${more}${noun ? ` ${noun}` : ''} than last run (${good ? 'better' : 'worse'})</span>`;
  }

  private passRateOf(record: { total: number; passed: number }): number {
    return passRatePercent(record.passed, record.total);
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
        ? `<div style="font-size:12px;color:${SLATE};">No earlier run with the same branch and test selection to compare with, so no change is shown.</div>`
        : `<div style="font-size:12.5px;color:${INK};">
             <strong>Δ vs previous run</strong> (build ${this.mono(`#${delta.previousRun.buildNumber}`)}):
             <div style="padding:2px 0;">${this.deltaSubtext(delta.passedDelta, '', 'passed')}</div>
             <div style="padding:2px 0;">${this.deltaSubtext(delta.failedDelta, '', 'failed', false)}</div>
             <div style="padding:2px 0;">${this.deltaSubtext(delta.flakyDelta, '', 'flaky', false)}</div>
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
                   ? `<a href="${this.escAttr(`#${anchor}`)}" style="color:#6B5300;font-weight:600;">${this.esc(normalizeTestTitle(i.title))}</a>`
                   : this.esc(normalizeTestTitle(i.title));
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
                   `<div style="font-size:11.5px;color:${INK};padding:2px 0;">▼ ${this.esc(m.name)} (${this.esc(m.type)}) is worse than last run: ${m.failedDelta > 0 ? `+${m.failedDelta} failed` : ''}${m.failedDelta > 0 && m.flakyDelta > 0 ? ', ' : ''}${m.flakyDelta > 0 ? `+${m.flakyDelta} flaky` : ''}</div>`
               )
               .join('')}
           </div>`;

    return `
<tr><td id="section-trend" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};background:${WARN_BG};border-radius:6px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${WARN};margin-bottom:8px;">Trend</div>
    ${deltaLine}
    ${sparkline}
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
          <div style="width:16px;height:${h}px;margin:${barHeight - h}px auto 0;background:${color};border-radius:2px;" title="${p.passRate}%"></div>
          <div style="font-size:8px;color:${MUTED};margin-top:2px;">${this.mono(`#${p.buildNumber}`)}</div>
        </td>`;
      })
      .join('');
    return `
    <div style="margin-top:10px;">
      <div style="font-size:11px;color:${SLATE};margin-bottom:4px;">Passed first time — last ${series.length} runs</div>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table>
    </div>`;
  }

  // ===================== Flakiest tests (item 23) =====================

  /** The tests that keep flaking across the last runs (at least 3 of the last 10 here), with counts; replaces the old "Recurring flaky tests" list in Trend. */
  private buildFlakiestTestsSection(ctx: EmailContext, testAnchors: Map<string, string>): string {
    const flaky = ctx.flakiestTests ?? ctx.recurringFlaky ?? [];
    if (flaky.length === 0) return '';
    const inThisRun = new Set([...ctx.report.flakyTests, ...ctx.report.passedOnRerunTests].map((t) => t.title));
    const rows = flaky
      .map((i) => {
        const anchor = testAnchors.get(i.title);
        const title = anchor ? `<a href="${this.escAttr(`#${anchor}`)}" style="color:${INK};">${this.esc(this.truncate(normalizeTestTitle(i.title), 90))}</a>` : this.esc(this.truncate(normalizeTestTitle(i.title), 90));
        const ratio = i.countInLastNRuns / i.ofLastNRuns;
        const level = ratio > 0.5 ? ['high risk', FAIL] : ratio > 0.2 ? ['medium risk', WARN] : ['low risk', SLATE];
        return `<tr style="border-bottom:1px solid ${CANVAS_TINT};"><td style="padding:4px 0;font-size:11.5px;color:${INK};">${title}</td><td style="padding:4px 8px;font-size:11.5px;font-weight:700;color:${INK};white-space:nowrap;">${i.countInLastNRuns} of ${i.ofLastNRuns} runs</td><td style="padding:4px 8px;font-size:10.5px;font-weight:700;color:${level[1]};white-space:nowrap;">${level[0]}</td><td style="padding:4px 0 4px 8px;font-size:10.5px;color:${SLATE};white-space:nowrap;">${inThisRun.has(i.title) ? 'flaky in this run too' : 'passed clean in this run'}</td></tr>`;
      })
      .join('');
    return `
<tr><td id="section-flakiest-tests" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};border-radius:6px;padding:14px 16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${WARN};margin-bottom:4px;">Flakiest tests, last ${flaky[0].ofLastNRuns} runs</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:6px;">Flaky in at least 2 of the last ${flaky[0].ofLastNRuns} comparable runs, most often first.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>
</td></tr>`;
  }

  // ===================== Module analytics (incl. Test Type Split caption) =====================

  /**
   * ONE table of every module (2026-11-26, build #242: a 3-row "problem modules" table above "All 36 modules" made readers think modules were
   * missing). One row per entity (Leads, Deals, "Leads — Field Limits", ...) with UI and RBAC side by side, each side
   * Tests | First | Retry | Rerun | Failed | Skip | Unstable (last runs). A row with a problem is tinted and carries short badges under its name
   * ("1 retry", "1 failed", "worse than last run"); problem rows come first, the others alphabetically. A cell with something in it is
   * highlighted: retry and rerun yellow, failed red, skipped slate; a zero is grey. Per side the five outcomes add up to Tests (check:scenarios).
   * Tests and Skip are never hidden on phones: with them hidden a module with 6 tests and 2 skipped read "4" (build #242, Billing).
   */
  private buildModuleAnalytics(ctx: EmailContext): string {
    const { report } = ctx;
    const trendByKey = new Map((ctx.moduleTrend ?? []).map((m) => [`${m.type}:${m.name}`, m]));
    const stabilityByKey = new Map((ctx.moduleStabilityTrend ?? []).map((m) => [`${m.type}:${m.name}`, m]));
    return `
<tr><td id="section-module-analytics" style="padding:8px 28px;">
  <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">Module Analytics</div>
  <div style="font-size:11px;color:${SLATE};margin-bottom:8px;">${report.total} tests · ${report.uiCount} UI · ${report.rbacCount} RBAC. Modules with a problem come first, tinted, with a short note under the name.</div>
  ${this.buildDevEquivalentRunNote(ctx.suiteDrift)}
  ${this.buildAllModulesTable(report, stabilityByKey, trendByKey, isIncompleteRun(ctx.shardCompleteness) || isScopedRun(ctx.shardCompleteness) ? null : ctx.suiteBaseline ?? null)}
</td></tr>`;
  }

  private buildAllModulesTable(
    report: ParsedReport,
    stabilityByKey: Map<string, { direction: string; runsConsidered: number; failRate: number; flakyRate: number }>,
    trendByKey: Map<string, { direction: string }>,
    baseline: Record<string, number> | null
  ): string {
    type Side = { total: number; first: number; retry: number; rerun: number; failed: number; skipped: number; swept: number; trend: string | undefined; notSelected: number };
    const side = (m: ModuleStats): Side => ({
      total: m.total, first: m.firstRun.passed, retry: m.firstRun.flaky, rerun: m.passedOnlyOnRerun, failed: m.failed, skipped: m.skipped,
      swept: m.testsSweptByRetry, trend: trendByKey.get(`${m.type}:${m.name}`)?.direction,
      notSelected: Math.max(0, (baseline?.[`${m.type}:${m.name}`] ?? 0) - m.total),
    });
    const byName = new Map<string, { UI?: Side; RBAC?: Side }>();
    for (const m of report.modules) {
      const e = byName.get(m.name) ?? {};
      if (m.type === 'UI') e.UI = side(m);
      else if (m.type === 'RBAC') e.RBAC = side(m);
      byName.set(m.name, e);
    }
    const sides = (e: { UI?: Side; RBAC?: Side }): Array<[string, Side]> => (['UI', 'RBAC'] as const).flatMap((k) => (e[k] ? [[k, e[k]!] as [string, Side]] : []));
    const problem = (e: { UI?: Side; RBAC?: Side }): number => sides(e).reduce((n, [, x]) => n + x.failed * 1000 + x.retry + x.rerun, 0);
    const names = [...byName.keys()].sort((a, b) => problem(byName.get(b)!) - problem(byName.get(a)!) || a.localeCompare(b));
    // The row's tint: red when anything failed, yellow when anything needed a retry or a rerun. A tinted row keeps its own text colours (dark on light), so it reads the same in light and dark clients.
    const ROW_FAIL = '#FFF5F4';
    const ROW_RETRY = '#FFFCE8';
    const td = (n: number, kind: 'tests' | 'first' | 'retry' | 'rerun' | 'failed' | 'skipped', tint: string): string => {
      const base = 'padding:3px 4px;text-align:center;font-size:11px;';
      const rowBg = tint ? `background:${tint};` : '';
      let style = `${base}${rowBg}color:${MUTED};`;
      if (n > 0) {
        style =
          kind === 'retry' || kind === 'rerun' ? `${base}font-weight:700;background:${RETRY.bg};color:${RETRY.text};`
          : kind === 'failed' ? `${base}font-weight:700;background:${FAIL_BG};color:${FAIL};`
          : kind === 'skipped' ? `${base}font-weight:700;background:${CANVAS_TINT};color:${SLATE};`
          : `${base}${rowBg}color:${INK};`;
      }
      return `<td style="${style}">${n}</td>`;
    };
    const stab = (type: 'UI' | 'RBAC', name: string, tint: string): string => {
      const st = stabilityByKey.get(`${type}:${name}`);
      const bg = tint ? `background:${tint};` : '';
      if (!st || st.direction === 'insufficient-data') return `<td style="padding:3px 4px;text-align:center;font-size:10px;${bg}color:${MUTED};" class="mh">–</td>`;
      const rate = st.failRate + st.flakyRate;
      const word = st.direction === 'worsening' ? ' worse' : st.direction === 'improving' ? ' better' : '';
      const color = st.direction === 'worsening' ? FAIL : st.direction === 'improving' ? SUCCESS : MUTED;
      return `<td style="padding:3px 4px;text-align:center;font-size:10px;${bg}color:${color};" class="mh">${rate}%${word}</td>`;
    };
    const cells = (x: Side | undefined, type: 'UI' | 'RBAC', name: string, tint: string): string =>
      x
        ? td(x.total, 'tests', tint) + td(x.first, 'first', tint) + td(x.retry, 'retry', tint) + td(x.rerun, 'rerun', tint) + td(x.failed, 'failed', tint) + td(x.skipped, 'skipped', tint) + stab(type, name, tint)
        : `<td colspan="7" style="padding:3px 4px;text-align:center;font-size:11px;${tint ? `background:${tint};` : ''}color:${MUTED};">–</td>`;
    const th = (t: string, hide = false): string => `<th style="padding:2px 4px;text-align:center;font-size:9.5px;color:${SLATE};font-weight:600;"${hide ? ' class="mh"' : ''}>${t}</th>`;
    const group = `${th('Tests')}${th('First')}${th('Retry')}${th('Rerun')}${th('Fail')}${th('Skip')}${th('Unstable, last runs', true)}`;
    const badge = (text: string, fg: string, bg: string): string => `<span style="display:inline-block;margin:2px 3px 0 0;padding:1px 5px;border-radius:8px;font-size:9px;font-weight:700;background:${bg};color:${fg};">${text}</span>`;
    const anyNotSelected = [...byName.values()].some((e) => sides(e).some(([, x]) => x.notSelected > 0));
    const rows = names
      .map((n) => {
        const e = byName.get(n)!;
        const all = sides(e).map(([, x]) => x);
        const failed = all.reduce((s, x) => s + x.failed, 0);
        const retry = all.reduce((s, x) => s + x.retry, 0);
        const rerun = all.reduce((s, x) => s + x.rerun, 0);
        const worse = all.some((x) => x.trend === 'worsening');
        const better = !worse && all.some((x) => x.trend === 'improving');
        const tint = failed > 0 ? ROW_FAIL : retry + rerun > 0 ? ROW_RETRY : '';
        // per side, so "2 retries" says where ("UI 2 retries"); the side is left out when the module has only one
        const lead = (k: string): string => (all.length > 1 ? `${k} ` : '');
        const badges = [
          ...sides(e).flatMap(([k, x]) => [
            x.failed > 0 ? badge(`${lead(k)}${x.failed} failed`, FAIL, FAIL_BG) : '',
            x.retry > 0 ? badge(`${lead(k)}${pluralize(x.retry, 'retry', 'retries')}`, RETRY.text, RETRY.bg) : '',
            x.rerun > 0 ? badge(`${lead(k)}${x.rerun} on rerun`, RETRY.text, RETRY.bg) : '',
            x.swept > 0 ? badge(`${lead(k)}${x.swept} re-ran with a serial block`, SLATE, CANVAS_TINT) : '',
            x.notSelected > 0 ? badge(`${lead(k)}${x.notSelected} of ${x.total + x.notSelected} not selected`, SLATE, CANVAS_TINT) : '',
          ]),
          worse ? badge('▼ worse than last run', FAIL, FAIL_BG) : better ? badge('▲ better than last run', SUCCESS, SUCCESS_BG) : '',
        ].join('');
        // a border colour of its own keeps these rows out of the zebra rule of compactStyles(), which would paint over the row tints
        return `<tr style="border-bottom:1px solid #EAEEF2;"><td class="nm" style="padding:3px 4px;font-size:11.5px;color:${INK};${tint ? `background:${tint};` : ''}">${this.esc(n)}${badges ? `<div>${badges}</div>` : ''}</td>${cells(e.UI, 'UI', n, tint)}${cells(e.RBAC, 'RBAC', n, tint)}</tr>`;
      })
      .join('');
    if (byName.size === 0) return '';
    return `<div id="all-modules" style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin:6px 0 4px;">All ${byName.size} ${byName.size === 1 ? 'module' : 'modules'}, UI and RBAC side by side</div>
 <table class="am" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <tr><th rowspan="2" style="padding:2px 4px;text-align:left;font-size:10px;color:${SLATE};font-weight:600;">Module</th><th colspan="7" style="padding:2px 4px;text-align:center;font-size:10px;color:${ACCENT};font-weight:700;border-bottom:2px solid ${ACCENT};">UI</th><th colspan="7" style="padding:2px 4px;text-align:center;font-size:10px;color:${SUCCESS};font-weight:700;border-bottom:2px solid ${SUCCESS};">RBAC</th></tr>
    <tr>${group}${group}</tr>${rows}
  </table>
  <div style="font-size:10px;color:${MUTED};margin-top:4px;">First = passed first time. Retry = passed on a retry in the same run. Rerun = passed only on the rerun. Skip = skipped or did not run.${anyNotSelected ? ' "Not selected" = tests of that module this run did not pick: CI selects by tag, so tests tagged only @smoke are not part of a @regression run.' : ''}</div>`;
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
              ? `<span style="color:${FAIL};font-weight:700;">▲ ${this.formatDurationDelta(trend.diffMs ?? 0)} slower than last seen (regression)</span>`
              : `<span style="color:${SLATE};">${this.formatDurationDelta(trend.diffMs ?? 0)} vs last seen</span>`;
        return `
      <tr style="border-bottom:1px solid ${CANVAS_TINT};">
        <td style="padding:6px 0;font-size:12px;color:${INK};">${this.esc(normalizeTestTitle(t.title))}</td>
        <td style="padding:6px 0;width:70px;text-align:right;font-size:12px;color:${SLATE};font-weight:600;white-space:nowrap;">${this.mono(this.formatDuration(t.duration))}</td>
        <td style="padding:6px 0 6px 12px;width:270px;font-size:11px;white-space:nowrap;" class="wr">${trendCell}</td>
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

  // ===================== Slowest tests by module =====================

  // WHY this section exists, separate from buildSlowTestsSection() above
  // (2026-09-29, Phase 3 reporting enhancement item 3): the whole-run top-5
  // can be dominated by one or two modules, hiding that a DIFFERENT module
  // also has its own real drag — a module's own slowestTests (ReportParser's
  // per-module top 3) surfaces that regardless of how the whole-run top-5
  // happens to be distributed. Modules are ordered by their OWN worst test's
  // duration, descending — the module most worth investigating first, not
  // report.modules' own health-score order (buildModuleAnalytics' ordering
  // answers a different question: "which module is least healthy," not
  // "which module's runtime is worst").
  private buildModuleSlowestTestsSection(ctx: EmailContext): string {
    const { report } = ctx;
    const modulesWithTests = report.modules.filter((m) => m.slowestTests.length > 0);
    if (modulesWithTests.length === 0) return '';
    const sortedModules = [...modulesWithTests]
      .sort((a, b) => (b.slowestTests[0]?.duration ?? 0) - (a.slowestTests[0]?.duration ?? 0)); // every module (main's email lists them all; the 5-module cap is gone, E7)
    const moduleBlocks = sortedModules
      .map((m) => {
        const typeStyle =
          m.type === 'UI'
            ? `background:#EFF3FE;color:${ACCENT};`
            : m.type === 'RBAC'
              ? `background:${SUCCESS_BG};color:${SUCCESS};`
              : `background:${CANVAS_TINT};color:${SLATE};`;
        const rows = m.slowestTests
          .map((t: TestResult) => `<tr><td style="padding:3px 0 3px 12px;">${this.esc(this.truncate(normalizeTestTitle(t.title), 60))}</td><td style="text-align:right;color:${SLATE};font-weight:600;white-space:nowrap;font-family:${MONO_FONT};">${this.formatDuration(t.duration)}</td></tr>`)
          .join('');
        return `
      <tr>
        <td style="padding:10px 0 4px;" colspan="2">
          <span style="font-size:12px;font-weight:700;color:${INK};">${this.esc(m.name)}</span>
          <span style="${typeStyle}padding:1px 5px;border-radius:4px;font-size:9px;font-weight:700;margin-left:6px;">${m.type}</span>
        </td>
      </tr>
      ${rows}`;
      })
      .join('');
    return `
<tr><td style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:2px;">Slowest Tests by Module (every module, top 3 each)</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:8px;">Each module's own worst; full lists in the HTML report</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;color:${INK};">${moduleBlocks}</table>
  </div>
</td></tr>`;
  }

  // ===================== CI job stats =====================

  // WHY this section exists (2026-09-29, Phase 3 items #1 + #6, sharing one
  // GitHub Jobs API call per JobStats.ts's own WHY comment): item #6 (total
  // CI job-minutes) answers "what did this run cost in summed compute,"
  // genuinely different from wall-clock duration once a run is sharded
  // across N parallel jobs — a 5-shard run finishing in ~90 min of
  // wall-clock time can easily represent 400+ minutes of summed job-minutes.
  // Item #1 (per-job timestamps) is the breakdown backing that total —
  // shown as one table rather than two sections since both come from the
  // exact same `ctx.jobStats` payload. GitHub-Actions-only: `ctx.jobStats`
  // is undefined for every Jenkins/local run (graceful omission, matching
  // buildModuleSlowestTestsSection()'s own "return '' when nothing to show"
  // convention above) or whenever the live API call itself failed for any
  // reason — never a broken-looking empty section.
  private buildJobStatsSection(ctx: EmailContext): string {
    const stats = ctx.jobStats;
    if (!stats || stats.jobs.length === 0) return '';
    const sortedJobs = [...stats.jobs].sort((a, b) => b.durationMs - a.durationMs);
    const rows = sortedJobs
      
      .map(
        (j) => `
      <tr style="border-bottom:1px solid ${CANVAS_TINT};">
        <td style="padding:6px 0;font-size:12px;color:${INK};">${this.esc(j.name)}</td>
        <td style="padding:6px 0;text-align:right;font-size:12px;color:${SLATE};font-weight:600;white-space:nowrap;">${this.mono(this.formatDuration(j.durationMs))}</td>
      </tr>`
      )
      .join('');
    // WHY a plural-safe note only when incompleteJobCount > 0, not always:
    // most runs have zero incomplete jobs by the time this section renders
    // (this merge+notify job itself is the one common exception — it's
    // still `in_progress` at query time, with no `completed_at` yet, so
    // JobStats.computeJobStats() correctly excludes it) — an always-present
    // "0 jobs excluded" line would be noise on the common case.
    const incompleteNote =
      stats.incompleteJobCount > 0
        ? `<div style="font-size:11px;color:${MUTED};margin-top:8px;">${stats.incompleteJobCount} job${stats.incompleteJobCount === 1 ? '' : 's'} still in progress at query time (excluded from the total above) — typically this merge+notify job itself.</div>`
        : '';
    // WHY computed here, inline, rather than a separate EmailContext field
    // (2026-09-29, Phase 3 item 2 v1): detectJobOverlaps() is a pure
    // function fully derivable from ctx.jobStats.jobs, which is already on
    // the context — threading a second, redundant field for the exact same
    // underlying data would duplicate a single source of truth for no
    // benefit. See JobStats.ts's own WHY comment on this section for the
    // real, honest scope limit: module-tag attribution (the `sameModuleTag`
    // flag) only exists for formFields-track jobs; every other overlap is
    // still reported, just without a module tag, never silently dropped.
    // Only the real anomaly is listed (item 9): a pair of jobs that overlapped AND share a module. Every other overlap is how sharding works.
    const overlaps = detectJobOverlaps(stats.jobs).filter((o) => o.sameModuleTag !== undefined);
    const overlapsSection =
      overlaps.length === 0
        ? `
    <div style="font-size:11px;color:${SLATE};margin-top:12px;"><strong style="color:${INK};">Job time overlaps:</strong> none that matter (no two jobs ran the same module at the same time).</div>`
        : (() => {
            const overlapRows = [...overlaps]
              .sort((x, y) => y.overlapDurationMs - x.overlapDurationMs)
              .map(
                (o) => `
      <tr style="border-bottom:1px solid ${CANVAS_TINT};">
        <td style="padding:6px 0;font-size:11.5px;color:${FAIL};font-weight:700;">⚠ ${this.esc(o.jobA)} ↔ ${this.esc(o.jobB)} <span style="font-size:10px;">(same module: ${this.esc(o.sameModuleTag!)})</span></td>
        <td style="padding:6px 0;text-align:right;font-size:11.5px;color:${SLATE};white-space:nowrap;">${this.mono(this.formatDuration(o.overlapDurationMs))}</td>
      </tr>`
              )
              .join('');
            return `
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin:14px 0 2px;">Job Time Overlaps</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:8px;">Two jobs that ran the SAME module at the same time: a structural anomaly the shard design should prevent. Investigate.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${overlapRows}</table>`;
          })();
    // WHY computed inline from ctx.jobStats.jobs + ctx.miscErrors.recoveryByShard
    // (2026-10-06), no new EmailContext field: both are already on the context;
    // see JobStats.buildJobRecoveryRows()'s own WHY comment for what it measures.
    const recoveryRows = buildJobRecoveryRows(stats.jobs, ctx.miscErrors?.recoveryByShard);
    const hasAnyRecovery = recoveryRows.some(
      (r) => r.rateLimitPages + r.rateLimitApi + r.rateLimitThirdParty + r.errorBoundaryPages + r.setupRetries > 0
    );
    const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
    const hotRows = recoveryRows.filter((r) => r.rateLimitPages + r.rateLimitApi + r.rateLimitThirdParty + r.errorBoundaryPages + r.setupRetries + r.failedAfterRecovery > 0);
    const quietCount = recoveryRows.length - hotRows.length;
    const recoverySection =
      recoveryRows.length === 0
        ? ''
        : !hasAnyRecovery
          ? `
    <div style="font-size:11px;color:${SLATE};margin-top:12px;"><strong style="color:${INK};">Load signals:</strong> no 429 pages, HTTP 429 API answers, error-boundary screens or login (setup) retries were recorded in any of the ${recoveryRows.length} test jobs.</div>`
          : `
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin:14px 0 2px;">Load Signals by Job</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:8px;">${
      hasAnyRecovery
        ? 'Times the app showed its 429 page / "Something is broken" error screen, answered a Kylas API call with HTTP 429 (real throttling; third-party 429s, such as Sentry telemetry sent by the app, are counted apart as noise, not rate limiting of our tests), and globalSetup transient retries, per test job — lined up against how many test jobs were running at once (times in IST). "Failed" = the retried action threw again after recovery.'
        : 'No 429 pages, HTTP 429 API answers, error-boundary screens or login (setup) retries were recorded in any shard this run (counted: the 429 and error pages a wait ran into, every API response with status 429, and login (setup) retries).'
    }</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr style="border-bottom:1px solid ${BORDER};">
        <th align="left" style="padding:4px 0;font-size:10px;color:${MUTED};">Job</th>
        <th align="right" style="padding:4px 4px;font-size:10px;color:${MUTED};">Start–End (IST)</th>
        <th align="right" style="padding:4px 4px;font-size:10px;color:${MUTED};">429 page</th>
        <th align="right" style="padding:4px 4px;font-size:10px;color:${MUTED};">429 Kylas API</th>
        <th align="right" style="padding:4px 4px;font-size:10px;color:${MUTED};" class="mh">429 third-party</th>
        <th align="right" style="padding:4px 4px;font-size:10px;color:${MUTED};" class="mh">Boundary</th>
        <th align="right" style="padding:4px 4px;font-size:10px;color:${MUTED};" class="mh">Setup retry</th>
        <th align="right" style="padding:4px 4px;font-size:10px;color:${MUTED};">Failed</th>
        <th align="right" style="padding:4px 0 4px 4px;font-size:10px;color:${MUTED};" class="mh">Jobs running (window / at events)</th>
      </tr>${hotRows
        .map((r) => {
          const hot = r.rateLimitPages + r.rateLimitApi + r.errorBoundaryPages + r.setupRetries > 0;
          return `
      <tr style="border-bottom:1px solid ${CANVAS_TINT};">
        <td style="padding:5px 0;font-size:11.5px;color:${INK};">${this.esc(r.jobName)}${r.attributed ? '' : ` <span style="color:${MUTED};">(no shard data)</span>`}</td>
        <td style="padding:5px 4px;text-align:right;font-size:11.5px;color:${SLATE};white-space:nowrap;">${this.mono(`${hhmm(r.startedAt)}–${hhmm(r.completedAt)}`)}</td>
        <td style="padding:5px 4px;text-align:right;font-size:11.5px;color:${r.rateLimitPages > 0 ? FAIL : SLATE};">${r.rateLimitPages}</td>
        <td style="padding:5px 4px;text-align:right;font-size:11.5px;color:${r.rateLimitApi > 0 ? FAIL : SLATE};">${r.rateLimitApi}</td>
        <td style="padding:5px 4px;text-align:right;font-size:11.5px;color:${MUTED};" class="mh">${r.rateLimitThirdParty}</td>
        <td style="padding:5px 4px;text-align:right;font-size:11.5px;color:${r.errorBoundaryPages > 0 ? FAIL : SLATE};" class="mh">${r.errorBoundaryPages}</td>
        <td style="padding:5px 4px;text-align:right;font-size:11.5px;color:${r.setupRetries > 0 ? FAIL : SLATE};" class="mh">${r.setupRetries}</td>
        <td style="padding:5px 4px;text-align:right;font-size:11.5px;color:${r.failedAfterRecovery > 0 ? FAIL : SLATE};font-weight:${hot ? '700' : '400'};">${r.failedAfterRecovery}</td>
        <td style="padding:5px 0 5px 4px;text-align:right;font-size:11.5px;color:${SLATE};white-space:nowrap;" class="mh">${r.peakConcurrentInWindow} / ${r.maxConcurrentAtEvents ?? '—'}</td>
      </tr>`;
        })
        .join('')}
    </table>${quietCount > 0 ? `<div style="font-size:11px;color:${MUTED};margin-top:4px;">${quietCount} other test job${quietCount === 1 ? '' : 's'} recorded none of these.</div>` : ''}`;
    return `
<tr><td style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:2px;">CI Job Stats</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:8px;">Total summed compute across every completed job in this run: <strong style="color:${INK};">${this.mono(this.formatDuration(stats.totalJobMinutes * 60000))}</strong> (genuinely different from wall-clock duration once sharded)</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    ${incompleteNote}
    ${overlapsSection}
    ${recoverySection}
  </div>
</td></tr>`;
  }

  // ===================== Skipped tests =====================

  // WHY this section exists at all (2026-09-03): the KPI dashboard already
  // shows a bare "N Skipped" count — this makes WHICH tests, and WHY,
  // visible without opening CI logs, so a reader can tell an expected,
  // documented skip apart from one worth investigating. Styled like
  // buildSlowTestsSection() above (a bordered card, not Module Analytics'
  // plain table) — there's no error/failure detail to show, just a title,
  // module, and reason, which doesn't need the rich failure-card treatment
  // buildFlakyTestsSection()/buildFailureClustersSection() use below.
  // Module label reuses deriveModuleFromFile() — the exact same derivation
  // Module Analytics itself uses (ReportParser.ts), so a skipped test's
  // module tag here always agrees with its own row there.
  private buildSkippedTestsSection(ctx: EmailContext): string {
    const { report } = ctx;
    const deliberate = report.skippedTests.filter((t) => !t.didNotRun);
    if (deliberate.length === 0) return '';
    const rows = deliberate
      .map((t: TestResult) => {
        const { name, type } = deriveModuleFromFile(t.file);
        // Skipped is deliberate, not a problem: its pills are slate grey (amber is for retry, rerun and flaky, "needs a look").
        void type;
        const typeStyle = `background:${CANVAS_TINT};color:${SLATE};border:1px solid ${BORDER};`;
        const reason = t.skipReason
          ? `<span style="color:${SLATE};">${this.esc(t.skipReason)}</span>`
          : `<span style="color:${MUTED};font-style:italic;">No reason given</span>`;
        return `
      <tr style="border-bottom:1px solid ${CANVAS_TINT};">
        <td style="padding:8px 0;">
          <div style="font-size:12px;color:${INK};margin-bottom:2px;">
            <span style="${typeStyle}padding:1px 5px;border-radius:3px;font-size:9.5px;font-weight:700;margin-right:6px;">${name}</span>
            ${this.esc(normalizeTestTitle(t.title))}
          </div>
          <div style="font-size:11px;padding-left:2px;">${reason}</div>
        </td>
      </tr>`;
      })
      .join('');
    return `
<tr><td id="section-skipped-tests" style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:10px;">Skipped Tests (${deliberate.length})</div>
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
  /** The error's message without its code frame and stack: the card shows ONE short code frame below it (item 7), not the frame twice. */
  private errorMessageOnly(primary: string): string {
    const lines = primary.split('\n');
    const cut = lines.findIndex((l) => /^\s*at\s/.test(l) || /^\s*>?\s*\d+\s*\|/.test(l));
    const head = (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').replace(/\n{2,}/g, '\n').trim();
    return head.split('\n').slice(0, 8).join('\n');
  }

  /** `ENV=staging npx playwright test tests/ui/x/x.spec.ts:42 --project=chromium --retries=0` for one test, or '' when its line is unknown (item 17). */
  private rerunCommand(env: string | undefined, test: { file: string; line?: number }): string {
    if (!env || !test.file || !test.line) return '';
    return `ENV=${env} npx playwright test tests/${test.file}:${test.line} --project=chromium --retries=0`;
  }

  private rerunCommandHtml(env: string | undefined, test: { file: string; line?: number }): string {
    const cmd = this.rerunCommand(env, test);
    return cmd ? `<div style="margin-top:8px;"><span class="cmd" style="display:inline-block;font-size:10.5px;color:${INK};font-family:${MONO_FONT};word-break:break-all;">${this.esc(cmd)}</span></div>` : '';
  }

  private buildFailureDetailCard(
    d: FailureDetail,
    knownIssuesUrl: string | null | undefined,
    accentColor: string,
    rerunRows?: Map<string, RerunTestRow>,
    env?: string,
    showTitle = true
  ): string {
    // Each error once (item 7, build #235 printed it 2-3 times): the primary message and ONE short code frame. The earlier errors of the
    // attempt are only counted, and the stack frames are not repeated (the code frame names the line).
    const earlierErrorsHtml =
      d.earlierErrors.length > 0
        ? `<div style="margin-top:4px;font-size:10px;color:${MUTED};">${d.earlierErrors.length} earlier error${d.earlierErrors.length === 1 ? '' : 's'} in this attempt (see the HTML report)</div>`
        : '';
    const snippetHtml = d.snippet
      ? `<pre style="margin:6px 0 0;font-size:10.5px;font-family:${MONO_FONT};background:${INK};color:#E6EDF3;border-radius:4px;padding:8px 10px;overflow-x:auto;white-space:pre;">${this.esc(d.snippet.split('\n').slice(0, 6).join('\n'))}</pre>`
      : '';
    const stackHtml = '';
    // Trace, screenshot and page-snapshot paths were relative paths inside a CI runner (item 8): they open nothing from an email. The card
    // links a file only where a real link exists (Jenkins); on GitHub Actions the section header points to the run's report artifact.
    const artifactLines: string[] = [];
    const linkWord = (word: string, href: string | undefined): void => {
      if (href) artifactLines.push(`<a href="${this.escAttr(href)}" style="color:${ACCENT};">${word}</a>`);
    };
    if (!d.tracePath) artifactLines.push('Trace: not captured'); // main shows this too: a reader knows there is no trace to open for this test
    linkWord('Trace', d.artifactLinks.trace);
    d.artifactLinks.screenshots.forEach((h) => linkWord('Screenshot', h));
    linkWord('Page snapshot', d.artifactLinks.errorContext);
    // WHY the artifact links above only ever resolve on Jenkins runs (see
    // FailureDetailBuilder.buildArtifactLinks's own WHY) — GitHub Actions has
    // no browsable single-file URL for an archived artifact, confirmed
    // during the investigation, not assumed; the plain path still renders so
    // the information isn't lost, just not clickable there.
    const knownIssueHtml =
      d.knownIssue && knownIssuesUrl
        ? `<div style="margin-top:6px;font-size:10.5px;color:${INK};">Related history: <a href="${this.escAttr(`${knownIssuesUrl}/${d.knownIssue.file ?? 'docs/KNOWN_ISSUES_ACTIVE.md'}#L${d.knownIssue.line}`)}" style="color:${ACCENT};">${d.knownIssue.kiId ? `${this.esc(d.knownIssue.kiId)} in ` : ''}${this.esc(d.knownIssue.file ? (d.knownIssue.file.split('/').pop() ?? d.knownIssue.file) : 'known-issues')}${d.knownIssue.kind === 'method-name' ? ` — this code (\`${this.esc(d.knownIssue.matchedPhrase)}\`) has documented history` : ' — a matching prior incident'}</a></div>`
        : '';

    return `
        <div id="${this.escAttr(d.anchorId)}" style="border-left:3px solid ${accentColor};background:#ffffff;padding:10px 12px;margin-bottom:10px;border-radius:0 4px 4px 0;border-top:1px solid ${CANVAS_TINT};border-right:1px solid ${CANVAS_TINT};border-bottom:1px solid ${CANVAS_TINT};">
          ${showTitle ? `<div style="font-size:12.5px;font-weight:700;color:${INK};margin-bottom:4px;">${this.esc(normalizeTestTitle(d.test.title))}</div>` : ''}
          <div style="margin-bottom:6px;">${this.categoryBadge(d.category)}${this.regressionBadge(d.regressionStatus, d.chronicRatio)}${this.causeBadge(d.cause)}</div>
          ${this.rerunCommand(env, d.test) ? '' : `<div style="font-size:10.5px;color:${SLATE};margin-bottom:4px;">${this.esc(d.test.file.split('/').pop() || '')}</div>`}
          <div style="font-size:12.5px;font-weight:600;line-height:1.45;color:${accentColor};font-family:${MONO_FONT};white-space:pre-wrap;word-break:break-word;">${this.esc(this.errorMessageOnly(d.primaryError))}</div>
          ${earlierErrorsHtml}
          ${snippetHtml}
          ${stackHtml}
          <div style="margin-top:6px;font-size:10.5px;color:${SLATE};font-style:italic;">${this.esc(d.diagnosticHint)}</div>
          ${this.causeEvidence(d.cause)}
          ${this.rerunTestLine(rerunRows?.get(rerunRowKey(d.test.file, d.test.title)))}
          ${knownIssueHtml}
          ${this.rerunCommandHtml(env, d.test)}
          ${artifactLines.length > 0 ? `<div style="margin-top:6px;font-size:10.5px;color:${MUTED};">${artifactLines.join(' · ')}</div>` : ''}
        </div>`;
  }

  // ===================== Rerun (ADR 0015) =====================

  private rerunRowMap(rerun: RerunSummary | null | undefined): Map<string, RerunTestRow> | undefined {
    if (!rerun || !rerun.ran) return undefined;
    return new Map(rerun.rows.map((r) => [rerunRowKey(r.file, r.title), r]));
  }

  // A test that did not run first and passed on the rerun never failed: it is Passed, labelled by how it got there.
  private finalLabel(row: RerunTestRow): string {
    if (row.first === 'not-run' && row.final === 'passed') return 'Passed (did not run → passed on rerun)';
    return FINAL_LABEL[row.final];
  }

  /** A status pill: soft tint of the colour with the colour as text (green passed, amber retry/rerun, red failed). */
  private pill(text: string, color: string): string {
    // retry / rerun (amber in the old palette) is the yellow pill; the status pills keep their own tints
    const [bg, fg] = color === WARN ? [RETRY.bg, RETRY.text] : [color === SUCCESS ? SUCCESS_BG : color === FAIL ? FAIL_BG : CANVAS_TINT, color];
    return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${bg};color:${fg};font-size:10.5px;font-weight:700;">${this.esc(text)}</span>`;
  }

  private rerunColor(final: RerunTestRow['final']): string {
    return final === 'passed' ? SUCCESS : final === 'failed' ? FAIL : WARN;
  }

  // One line under a failed/flaky test: first run -> rerun -> final. Nothing for a test that was not rerun.
  private rerunTestLine(row: RerunTestRow | undefined): string {
    if (!row) return '';
    return `<div style="margin-top:6px;font-size:10.5px;color:${SLATE};">Rerun: first run <strong>${this.esc(FIRST_LABEL[row.first])}</strong> &rarr; rerun <strong>${this.esc(RERUN_LABEL[row.rerun])}</strong> &rarr; final <strong style="color:${this.rerunColor(row.final)};">${this.esc(this.finalLabel(row))}</strong></div>`;
  }

  // ONE email at the end of the run: the first run next to the result after the rerun shard (a rerun pass is
  // never a clean pass: a recovered test counts as Flaky), then every rerun test with first -> rerun -> final.
  /** The First run -> Final result counts; '' when no rerun ran. They stay in the Rerun section (next to its per-test list). */
  private rerunCountsTable(rerun: RerunSummary | null | undefined): string {
    if (!rerun || !rerun.ran) return '';
    const f = rerun.firstRun;
    const a = rerun.afterRerun;
    const ranOnly = rerun.rows.filter((r) => r.first === 'not-run' && r.final === 'passed').length;
    // failed on every first attempt, passed on the rerun (the flaky ones that also passed on the rerun are inside f.flaky)
    const passedOnRerun = rerun.rows.filter((r) => r.first === 'failed' && r.final === 'passed').length;
    const th = (t: string, align = 'center'): string => `<th style="padding:5px 8px;text-align:${align};font-size:11px;color:${SLATE};font-weight:600;border-bottom:1px solid ${BORDER};">${t}</th>`;
    const cell = (v: string, color = INK): string => `<td style="padding:5px 8px;text-align:center;font-size:12.5px;font-weight:700;color:${color};">${v}</td>`;
    const label = (t: string, color: string): string => `<td style="padding:5px 8px;font-size:12px;color:${color};font-weight:600;">${t}</td>`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${th('', 'left')}${th('First run')}${th('Final result')}</tr>
      <tr>${label('Passed', SUCCESS)}${cell(String(f.passed))}${cell(`${a.passed}${f.flaky + passedOnRerun + ranOnly > 0 ? ` <div style="font-weight:400;font-size:10.5px;color:${SLATE};">(${[f.flaky > 0 ? `${f.flaky} after a retry` : '', passedOnRerun > 0 ? `${passedOnRerun} after the rerun` : '', ranOnly > 0 ? `${ranOnly} ran only on rerun` : ''].filter(Boolean).join(', ')})</div>` : ''}`)}</tr>
      <tr>${label('Failed', FAIL)}${cell(String(f.failed))}${cell(String(a.failed), a.failed > 0 ? FAIL : INK)}</tr>
      <tr>${label('Flaky', WARN)}${cell(String(f.flaky))}${cell(`${a.flaky}${f.flaky > 0 ? ` <div style="font-weight:400;font-size:10.5px;color:${SLATE};">(the ${f.flaky} ended Passed)</div>` : ''}`, a.flaky > 0 ? WARN : INK)}</tr>
      ${f.total !== undefined && a.total !== undefined ? `<tr>${label('Skipped', MUTED)}${cell(String(f.skipped ?? 0), MUTED)}${cell(String(a.skipped ?? 0), MUTED)}</tr>
      <tr>${label('Did not run', MUTED)}${cell(String(f.didNotRun ?? 0), MUTED)}${cell(String(a.didNotRun ?? 0), MUTED)}</tr>
      <tr>${label('Total', INK)}${cell(String(f.total))}${cell(String(a.total))}</tr>` : ''}
    </table>`;
  }

  /** One plain sentence per reason with the tests named (item 11, 2026-11-25 wording): which tests were not rerun, and why. '' when none. */
  private notRerunHtml(rerun: RerunSummary, marginTop = 8): string {
    if (rerun.excluded.length === 0) return '';
    const byReason = new Map<string, string[]>();
    for (const e of rerun.excluded) byReason.set(e.reason, [...(byReason.get(e.reason) ?? []), e.title]);
    return `<div style="font-size:11.5px;color:${SLATE};margin-top:${marginTop}px;">${[...byReason]
      .map(([reason, titles]) => {
        const why = this.notRerunWhy(reason, titles.length);
        if (titles.length === 1) return `<div style="margin-top:3px;">${this.esc(this.truncate(normalizeTestTitle(titles[0]), 90))} was not rerun: ${this.esc(why)}.</div>`;
        const shown = titles.slice(0, 5).map((t) => this.esc(this.truncate(normalizeTestTitle(t), 90))).join('; ');
        return `<div style="margin-top:3px;">${titles.length} tests were not rerun: ${this.esc(why)} (${shown}${titles.length > 5 ? ` and ${titles.length - 5} more` : ''}).</div>`;
      })
      .join('')}</div>`;
  }

  /** Why a failed or flaky test was not rerun, in plain words (the selector's own reason is a technical phrase). */
  private notRerunWhy(reason: string, n: number): string {
    if (/flaky tests are not/i.test(reason)) return n === 1 ? 'it had already passed on its retry' : 'they had already passed on a retry';
    if (/shared-config|formfields|never rerun/i.test(reason)) return n === 1 ? 'its suite changes shared account settings, so it is never rerun' : 'their suites change shared account settings, so they are never rerun';
    return reason;
  }

  // The Rerun section in plain words (2026-11-25): what was rerun and how it ended, the First run -> Final result counts, the list (test, first run ->
  // rerun -> final), and which tests were not rerun and why. The Rerun Summary tiles are in the "How the run ended" card.
  private buildRerunSummarySection(rerun: RerunSummary | null | undefined): string {
    if (!rerun) return '';
    // Nothing failed or was flaky: no rerun was needed and there is nothing to explain, so the email has no rerun section.
    if (!rerun.ran && rerun.reason === 'none' && rerun.excluded.length === 0) return '';
    const origin = rerun.rerunOf
      ? ` Manual rerun of run${rerun.rerunOf.runNumber ? ` #${this.esc(rerun.rerunOf.runNumber)}` : ` ${this.esc(rerun.rerunOf.runId)}`}.`
      : '';
    const heading = `<div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${INK};margin-bottom:8px;">Rerun of failed and flaky tests</div>`;
    if (!rerun.ran) {
      // WHY (2026-11-24, scenario matrix): "no test failed or was flaky" was printed for a run whose only failures were in suites that are
      // never rerun (formFields); the excluded list says what happened to them.
      if (rerun.reason === 'none' && rerun.excluded.length > 0) {
        return `
<tr><td id="section-rerun" style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:14px 16px;background:${CANVAS_TINT};">
    ${heading}
    <div style="font-size:12px;color:${SLATE};">Nothing was rerun.${origin}</div>
    ${this.notRerunHtml(rerun, 4)}
  </div>
</td></tr>`;
      }
      const why =
        rerun.reason === 'none'
          ? 'no test failed or was flaky, so no rerun was needed'
          : rerun.reason === 'cap'
            ? `${rerun.candidates} failed/flaky ${nounFor(rerun.candidates, 'test')} ${rerun.candidates === 1 ? 'is' : 'are'} more than the limit of ${rerun.maxTests}: that points at the environment, so nothing was rerun`
            : `no rerun result was produced (${this.esc(rerun.reason ?? 'unknown')})`;
      return `
<tr><td id="section-rerun" style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:14px 16px;background:${CANVAS_TINT};">
    ${heading}
    <div style="font-size:12px;color:${SLATE};">Not rerun: ${why}.${origin}</div>
  </div>
</td></tr>`;
    }
    const th = (t: string, align = 'center'): string => `<th style="padding:5px 8px;text-align:${align};font-size:11px;color:${SLATE};font-weight:600;border-bottom:1px solid ${BORDER};">${t}</th>`;
    // Still-failing tests first, then the others; every row is shown.
    const rank = (r: RerunTestRow): number => (r.final === 'failed' ? 0 : r.final === 'passed' ? 1 : 2);
    const orderedRows = [...rerun.rows].sort((x, y) => rank(x) - rank(y));
    const rows = orderedRows
      .map(
        (r) => `
      <tr style="border-bottom:1px solid ${BORDER};">
        <td style="padding:5px 8px 5px 0;font-size:11.5px;color:${INK};">${this.esc(normalizeTestTitle(r.title))}<div style="font-size:10px;color:${MUTED};">${this.esc(r.file.split('/').pop() ?? r.file)}${r.reason ? ` &middot; ${this.esc(r.reason)}` : ''}</div></td>
        <td class="mh" style="padding:5px 8px;font-size:11.5px;color:${SLATE};white-space:nowrap;">${this.esc(FIRST_LABEL[r.first])}</td>
        <td class="mh" style="padding:5px 8px;font-size:11.5px;color:${SLATE};white-space:nowrap;">${this.esc(RERUN_LABEL[r.rerun])}</td>
        <td style="padding:5px 0 5px 8px;font-size:11.5px;white-space:nowrap;">${this.pill(this.finalLabel(r), this.rerunColor(r.final))}</td>
      </tr>`
      )
      .join('');
    const testTable =
      rerun.rows.length > 0
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${th('Test', 'left')}${th('First run', 'left').replace('<th ', '<th class="mh" ')}${th('Rerun', 'left').replace('<th ', '<th class="mh" ')}${th('Final', 'left')}</tr>${rows}
    </table>`
        : '';
    const excluded = this.notRerunHtml(rerun);
    const n = rerun.rows.length;
    const passed = rerun.rows.filter((r) => r.rerun === 'passed').length;
    const failedAgain = rerun.rows.filter((r) => r.rerun === 'failed').length;
    const took = rerun.durationMs !== undefined ? ` (${this.formatDuration(rerun.durationMs)})` : '';
    const outcome = [passed > 0 ? `${passed} passed` : '', failedAgain > 0 ? `${failedAgain} failed again` : ''].filter(Boolean).join(', ');
    const sentence =
      n === 1
        ? `1 test was rerun after the main run${took}, and it ${passed === 1 ? 'passed' : failedAgain === 1 ? 'failed again' : 'did not finish'}.`
        : `${n} tests were rerun after the main run${took}: ${outcome || 'none finished'}.`;
    return `
<tr><td id="section-rerun" style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:14px 16px;background:${CANVAS_TINT};">
    ${heading}
    <div style="font-size:12px;color:${INK};margin-bottom:8px;">${sentence}${origin}</div>
    <div style="margin-bottom:10px;">${this.rerunCountsTable(rerun)}</div>
    ${testTable}
    ${excluded}
  </div>
</td></tr>`;
  }

  // "N tests did not run" / "N tests ran only on rerun": why a run with no failure is Unstable and not Passed.
  private buildNotVerifiedNote(report: ParsedReport): string {
    const lines = [
      report.didNotRun > 0
        ? `${report.didNotRun} test${report.didNotRun === 1 ? '' : 's'} did not run (a serial test after a failure, or a cut-off shard; not skipped on purpose). The run is not a clean pass.`
        : '',
      report.ranOnlyOnRerun > 0
        ? `${report.ranOnlyOnRerun} test${report.ranOnlyOnRerun === 1 ? '' : 's'} ran only on the rerun (they did not run in the first run, then passed). The run is not a clean pass.`
        : '',
    ].filter(Boolean);
    if (lines.length === 0) return '';
    return `
<tr><td id="section-not-verified" style="padding:4px 28px 8px;">
  <div style="border-left:3px solid ${WARN};padding:6px 12px;font-size:12px;color:${INK};background:${CANVAS_TINT};">${lines.map((l) => this.esc(l)).join('<br>')}</div>
</td></tr>`;
  }

  // One line instead of a path under every card (item 8): where the traces, screenshots and page snapshots are.
  private artifactNote(buildUrl: string | undefined): string {
    return buildUrl
      ? `<div style="font-size:11px;color:${SLATE};margin-bottom:8px;">Traces, screenshots and page snapshots: the report artifact on <a href="${this.escAttr(buildUrl)}" style="color:${ACCENT};">the run page</a> (for every card in this email).</div>`
      : '';
  }

  private buildFlakyTestsSection(ctx: EmailContext, cards: number): string {
    return this.buildUnstableTestsSection(ctx, {
      cards,
      id: 'section-flaky-tests',
      heading: 'Flaky Tests',
      tests: ctx.report.flakyTests,
      details: ctx.flakyFailureDetails ?? [],
    });
  }

  // Tests that failed every first attempt (or passed only on an in-job retry) and passed on the rerun shard: Passed in the
  // counts (ADR 0015, amended 2026-11-24), listed here with their first-run failure so the evidence is not lost.
  private buildPassedOnRerunSection(ctx: EmailContext, cards: number): string {
    return this.buildUnstableTestsSection(ctx, {
      cards,
      id: 'section-passed-on-rerun',
      heading: 'Passed on rerun',
      tests: ctx.report.passedOnRerunTests,
      details: ctx.rerunPassedDetails ?? [],
      note: 'Counted as Passed after the rerun; each failed on every first attempt or passed only on a retry, so the run is not a clean pass.',
    });
  }

  private buildUnstableTestsSection(ctx: EmailContext, opts: { id: string; heading: string; tests: TestResult[]; details: FailureDetail[]; note?: string; cards: number }): string {
    if (opts.tests.length === 0) return '';
    const recurringByTitle = new Map((ctx.recurringFlaky ?? []).map((r) => [r.title, r]));
    const detailByTitle = new Map(opts.details.map((d) => [d.test.title, d]));
    const rerunRows = this.rerunRowMap(ctx.rerun);
    const rows = opts.tests
      .slice(0, Math.max(opts.cards, 0))
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
        const detailHtml = detail ? this.buildFailureDetailCard(detail, ctx.knownIssuesUrl, WARN, rerunRows, ctx.env, false) : '';
        return `
      <tr${detail ? ` id="${this.escAttr(detail.anchorId)}"` : ''} style="border-bottom:1px solid ${WARN_BORDER};">
        <td style="padding:6px 0;font-size:12px;color:${INK};">${this.esc(normalizeTestTitle(t.title))}${this.rerunTestLine(rerunRows?.get(rerunRowKey(t.file, t.title)))}</td>
        <td style="padding:6px 0;width:70px;text-align:right;font-size:11px;color:${WARN};font-weight:600;white-space:nowrap;">${t.retries} ${t.retries === 1 ? 'retry' : 'retries'}</td>
        <td style="padding:6px 0 6px 10px;width:70px;font-size:11px;color:${riskColor};font-weight:700;white-space:nowrap;">${risk} risk</td>
        <td class="mh" style="padding:6px 0 6px 10px;width:130px;font-size:10.5px;color:${SLATE};">${this.esc(history)}</td>
        <td class="mh" style="padding:6px 0 6px 10px;font-size:10px;color:${MUTED};">${t.tracePath ? '' : 'no trace captured'}</td>
      </tr>
      ${detailHtml ? `<tr><td colspan="5" style="padding:0 0 8px;">${detailHtml}</td></tr>` : ''}`;
      })
      .join('');
    return `
<tr><td id="${opts.id}" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};background:${WARN_BG};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${WARN};margin-bottom:${opts.note ? '4' : '10'}px;">${opts.heading} (${opts.tests.length})</div>${opts.note ? `
    <div style="font-size:11px;color:${SLATE};margin-bottom:8px;">${this.esc(opts.note)}</div>` : ''}
    ${opts.id === 'section-flaky-tests' && ctx.report.failed === 0 || opts.id === 'section-passed-on-rerun' && ctx.report.failed === 0 && ctx.report.flakyTests.length === 0 ? this.artifactNote(ctx.buildUrl) : ''}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
  </div>
</td></tr>`;
  }

  // ===================== Failed Tests (failure clusters, full detail) =====================

  private buildFailureClustersSection(
    clusters: EnrichedCluster[],
    knownIssuesUrl: string | null | undefined,
    rerun?: RerunSummary | null,
    buildUrl?: string,
    cardLimit: number = NO_LIMIT,
    env?: string
  ): string {
    if (clusters.length === 0) return '';
    const rerunRows = this.rerunRowMap(rerun);
    const totalTests = clusters.reduce((sum, c) => sum + c.tests.length, 0);

    let cardsLeft = cardLimit;
    const clusterBlocks = clusters
      .map((c) => {
        // A cluster shares one cause (same message, location or endpoint): its first test gets the full card, the others are one line
        // each ("same cause"), so a 20-test cluster costs one card, not twenty.
        const fullCards = c.tests.length > 1 ? 1 : c.details.length;
        const shown = c.details.slice(0, Math.min(fullCards, cardsLeft));
        cardsLeft -= shown.length;
        const sameCause = c.details.slice(shown.length);
        const sameCauseHtml =
          sameCause.length > 0
            ? `<div style="font-size:11px;color:${SLATE};margin-top:2px;">Same cause, ${sameCause.length} more test${sameCause.length === 1 ? '' : 's'}:${sameCause.map((d) => `<div style="padding:2px 0;">${this.esc(this.truncate(normalizeTestTitle(d.test.title), 80))}${this.rerunTestLine(rerunRows?.get(rerunRowKey(d.test.file, d.test.title)))}${this.rerunCommandHtml(env, d.test)}</div>`).join('')}${sameCause.length > 20 ? `<div>and ${sameCause.length - 20} more</div>` : ''}</div>`
            : '';
        // WHY the category badge/header is now unconditional (2026-08-24,
        // item 8/2 fix): it used to render ONLY for clusters with 2+ tests —
        // the common case (a handful of unrelated standalone failures) got
        // no classification shown at all, despite FailureAnalyzer already
        // computing it correctly for every cluster including single-test
        // ones (confirmed by reading clusterFailures()'s own fallback loop).
        const header = `<div style="background:${CANVAS_TINT};border-radius:4px 4px 0 0;padding:8px 10px;font-size:11.5px;font-weight:700;color:${INK};border:1px solid ${FAIL_BORDER};border-bottom:none;">
                 ${c.tests.length > 1 ? `${c.tests.length} tests affected — shared cause (${this.signalTypeLabel(c.signalType)}) · ` : ''}category: ${this.esc(c.category)}
               </div>`;
        const cards = shown.map((d) => this.buildFailureDetailCard(d, knownIssuesUrl, FAIL, rerunRows, env)).join('');
        return `
        <div style="margin-bottom:12px;">
          ${header}
          <div style="border:1px solid ${FAIL_BORDER};border-top:none;background:${FAIL_BG};padding:10px;">
            ${cards}${sameCauseHtml}
          </div>
        </div>`;
      })
      .join('');

    return `
<tr><td id="section-failed-tests" style="padding:8px 28px;">
  <div style="border:1px solid ${FAIL_BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${FAIL};margin-bottom:4px;">Failed Tests (${totalTests})</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:10px;">${clusters.filter((c) => c.tests.length > 1).length} ${nounFor(clusters.filter((c) => c.tests.length > 1).length, 'cluster')} sharing a real signal, ${clusters.filter((c) => c.tests.length === 1).length} standalone</div>
    ${this.artifactNote(buildUrl)}${clusterBlocks}
  </div>
</td></tr>`;
  }

  private signalTypeLabel(t: EnrichedCluster['signalType']): string {
    return t === 'exact-message' ? 'identical error message' : t === 'stack-location' ? 'same source location' : 'same failing API endpoint';
  }

  // ===================== Background errors =====================

  // WHY a one-line row when everything is clean and a warning box otherwise
  // (ADR 0009): a failed or partial reset of the dedicated form-field limits
  // leaves stale config that poisons the NEXT formFields run, so it must be
  // visible in the email — but it is a post-run housekeeping result, so it is
  // rendered as its own section and never touches the verdict, health score or
  // any test count. Returns '' when no report exists (job skipped / artifact
  // absent), matching buildJobStatsSection()'s graceful-omission convention.
  private buildFieldConfigResetSection(
    reset: FieldConfigResetReport | null | undefined,
    env: string
  ): string {
    if (!reset || reset.mode !== 'reset') return '';
    const failed = reset.records.filter((r) => r.status === 'failed');
    const cleared = reset.records.filter((r) => r.status === 'cleared').length;
    const clean = reset.complete && failed.length === 0 && reset.records.length === reset.totalFields;
    if (clean) {
      return `
<tr><td id="section-field-config-reset" style="padding:8px 28px;">
  <div style="font-size:12px;color:${SLATE};">Dedicated form-field limits: all ${reset.totalFields} fields blank after this run${cleared > 0 ? ` (${cleared} had to be cleared)` : ''}.</div>
</td></tr>`;
    }
    const headline = reset.complete
      ? `${failed.length} of ${reset.totalFields} dedicated form-field ${nounFor(reset.totalFields, 'limit')} could not be reset or verified`
      : `The dedicated form-field reset did not finish (${reset.records.length} of ${reset.totalFields} fields reached — job timed out or was cancelled)`;
    const rows = failed
      .map(
        (r) =>
          `<tr><td style="padding:3px 8px;font-size:12px;color:${INK};">${this.esc(r.entity)} / ${this.mono(r.field)}</td><td style="padding:3px 8px;font-size:12px;color:${SLATE};">${this.esc(r.before)} &rarr; ${this.esc(r.after)}</td><td style="padding:3px 8px;font-size:12px;color:${FAIL};">${this.esc(this.truncate(redactSensitiveText(r.error ?? 'failed'), 160))}</td></tr>`
      )
      .join('');
    return `
<tr><td id="section-field-config-reset" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};background:${WARN_BG};border-radius:6px;padding:16px;">
    <div style="font-size:13px;font-weight:700;color:${WARN};">${this.esc(headline)}</div>
    <div style="font-size:12px;color:${SLATE};margin-top:4px;">Test results above are unaffected. Stale limits can break the next formFields run: run ${this.mono(`npm run reset:field-config -- --env ${env} --dry-run`)}, then the same command without --dry-run (docs/RUNBOOK.md).</div>
    ${rows ? `<table style="margin-top:8px;border-collapse:collapse;width:100%;">${rows}</table>` : ''}
  </div>
</td></tr>`;
  }

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

    const groups = groupBackgroundErrors(miscErrors.errors);
    const klassLabel = { unexpected: ['Unexpected', FAIL], rbac: ['Expected RBAC', WARN], noise: ['Known noise', MUTED] } as const;
    const groupRows = groups
      .map((g) => {
        const [label, color] = klassLabel[g.klass];
        const what = g.endpoint ? `${g.method ? `${g.method} ` : ''}${g.endpoint}${g.status ? ` → ${g.status}` : ''}` : `[${g.type}] ${g.sample}`;
        const tests = `${g.tests.slice(0, 3).map((t) => this.esc(this.truncate(t, 60))).join('; ')}${g.tests.length > 3 ? `; +${g.tests.length - 3} more` : ''}`;
        return `<tr style="border-bottom:1px solid ${CANVAS_TINT};vertical-align:top;"><td align="right" style="padding:4px 8px;font-size:12px;font-weight:700;color:${INK};">${g.count}</td><td style="padding:4px 8px;font-size:10.5px;font-weight:700;color:${color};white-space:nowrap;">${label}</td><td style="padding:4px 8px;font-size:11px;color:${INK};word-break:break-all;">${this.esc(this.truncate(what, 110))}${g.serverMessage ? `<div style="font-size:10.5px;color:${SLATE};">${this.esc(this.truncate(g.serverMessage, 110))}</div>` : ''}</td><td style="padding:4px 8px;font-size:10.5px;color:${SLATE};">${tests}</td></tr>`;
      })
      .join('');
    const unexpectedInfra = miscErrors.errors.filter(
      (e) => !e.expectedReason && (e.statusCode ?? 0) >= 500
    ).length;
    const unexpectedApp = Math.max(0, miscErrors.unexpectedErrors - unexpectedInfra);
    const noiseCount = miscErrors.errors.filter((e) => e.expectedReason === 'background-noise').length;

    return `
<tr><td id="section-background-errors" style="padding:8px 28px;">
  <div style="border:1px solid ${WARN_BORDER};background:#FFFAF3;border-radius:6px;padding:16px;">
    <div style="font-size:13px;font-weight:700;color:${INK};margin-bottom:4px;">Background Errors Captured — ${miscErrors.totalErrors} total</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:6px;">${this.kpiRow([
      { value: String(miscErrors.unexpectedErrors), label: 'Unexpected', variant: 'fail', subtext: [unexpectedApp > 0 ? `${unexpectedApp} app-level` : '', unexpectedInfra > 0 ? `${unexpectedInfra} infra-level (5xx)` : ''].filter(Boolean).join(', ') || undefined },
      { value: String(miscErrors.expectedRbacErrors), label: 'Expected RBAC', variant: 'neutral' },
      { value: String(noiseCount), label: 'Known noise', variant: 'muted', subtext: noiseCount > 0 ? 'known background noise' : undefined },
    ])}</table>
    ${this.segmentedBar(
      [
        { label: 'Unexpected', value: miscErrors.unexpectedErrors, color: FAIL },
        { label: 'Expected RBAC', value: miscErrors.expectedRbacErrors, color: infoSwatch(this.env).bg },
        { label: 'Known noise', value: noiseCount, color: '#6E7781' },
      ],
      miscErrors.totalErrors
    )}
    <div style="font-size:11px;color:${SLATE};margin-bottom:4px;">${miscErrors.unexpectedErrors} unexpected + ${miscErrors.expectedRbacErrors} expected RBAC + ${noiseCount} known background noise = ${miscErrors.totalErrors} total. Only the unexpected ones count towards the health score and the "background errors" figures above; the other two are shown for completeness.</div>
    <div style="font-size:11px;color:${SLATE};margin-bottom:10px;">By type: ${Object.entries(miscErrors.byType as Record<string, number>).map(([type, count]) => `${this.esc(type)} ${count}`).join(', ')}. Unexpected = review (infra-level = a 5xx, often transient); expected RBAC and known noise are normal.</div>
    <div>
      <div style="font-size:12px;font-weight:600;color:${INK};margin-bottom:6px;">Top errors, grouped by request</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr style="background:${CANVAS_TINT};"><th align="right" style="padding:4px 8px;font-size:10px;color:${MUTED};">Times</th><th align="left" style="padding:4px 8px;font-size:10px;color:${MUTED};">Kind</th><th align="left" style="padding:4px 8px;font-size:10px;color:${MUTED};">Request / error</th><th align="left" style="padding:4px 8px;font-size:10px;color:${MUTED};">Tests that hit it</th></tr>${groupRows}
      </table>
      <div style="font-size:11px;color:${SLATE};margin-top:6px;">Every error, with its message and time, is in <code>background-errors.html</code> in the report artifact (the run page, Artifacts, <em>playwright-report-…</em>).</div>
    </div>
  </div>
</td></tr>`;
  }

  // ===================== Action required =====================

  private buildActionRequiredSection(ctx: EmailContext, health: HealthScore, clusters: EnrichedCluster[], verdict: VerdictResult): string {
    const items: Array<{ text: string; priority: 'high' | 'medium' | 'low'; anchor?: string }> = [];

    if (ctx.suiteDrift?.occurred) {
      items.push({
        text: `Investigate suite drift — ${ctx.suiteDrift.decreaseBy} fewer ${nounFor(ctx.suiteDrift.decreaseBy, 'test')} ran than ${this.driftComparisonLabel(ctx.suiteDrift)}.`,
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
        text: `Investigate ${singleFailureClusters.length} standalone ${nounFor(singleFailureClusters.length, 'failure')} — see Failed Tests section.`,
        priority: 'medium',
        anchor: '#section-failed-tests',
      });
    }
    if (ctx.report.flaky > 0) {
      items.push({ text: `Review ${ctx.report.flaky} flaky ${nounFor(ctx.report.flaky, 'test')} — see Flaky Tests section.`, priority: 'medium', anchor: '#section-flaky-tests' });
    }
    const unexpectedMisc = ctx.miscErrors?.unexpectedErrors ?? 0;
    if (unexpectedMisc > 0) {
      items.push({
        text: `Review ${unexpectedMisc} unexpected background ${nounFor(unexpectedMisc, 'error')} — see Background Errors section.`,
        priority: 'medium',
        anchor: '#section-background-errors',
      });
    }
    const regressions = (ctx.slowTestTrend ?? []).filter((t) => t.regression);
    if (regressions.length > 0) {
      items.push({ text: `Review ${regressions.length} ${nounFor(regressions.length, 'test')} with a performance regression — see Slowest Tests section.`, priority: 'low' });
    }

    // a blocked or empty run is never "clean" (scenario matrix, 2026-11-26: the verdict said BLOCKED and this box said "this run is clean")
    if (items.length === 0 && verdict.verdict !== 'clear') {
      return `
<tr><td id="section-action-required" style="padding:8px 28px;">
  <div style="border:1px solid ${verdict.bannerTone === 'warning' ? WARN_BORDER : FAIL_BORDER};background:${verdict.bannerTone === 'warning' ? WARN_BG : FAIL_BG};border-radius:6px;padding:14px 16px;">
    <div style="font-size:12.5px;font-weight:700;color:${verdict.bannerTone === 'warning' ? WARN : FAIL};">Action required — ${this.esc(verdict.headline)}</div>
  </div>
</td></tr>`;
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
      .join('') + (items.length > 6 ? `<div style="padding:5px 0;font-size:11.5px;color:${SLATE};">+${items.length - 6} more action items (the failing and flaky tests above).</div>` : '');

    return `
<tr><td id="section-action-required" style="padding:8px 28px;">
  <div style="border:1px solid ${BORDER};border-radius:6px;padding:16px;">
    <div style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Action Required (Automation Health: ${health.notApplicable ? 'n/a' : this.esc(health.label)})</div>
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
    const generatedAt = `${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeZoneName: 'short' })}`;
    return `
<tr><td style="padding:20px 28px;text-align:center;border-top:1px solid ${BORDER};">
  <div style="font-size:10.5px;color:${MUTED};">Sent by Kylas ${this.esc(ctx.env.toUpperCase())} Automation System</div>
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
    return computeHealthScore(report, null, null, null);
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

  /** "6m 10s", "2h 40m 24s", "45s": never "370s" or "154m" (item 20). Rounded to whole seconds. */
  private formatDuration(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  /** A signed duration change: "+1m 5s", "-12s". */
  private formatDurationDelta(ms: number): string {
    return `${ms >= 0 ? '+' : '-'}${this.formatDuration(Math.abs(ms))}`;
  }

  private mono(text: string): string {
    // <code> is monospace in every client without any inline font (the span with a font stack was repeated about 90 times)
    return `<code>${this.esc(text)}</code>`;
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
