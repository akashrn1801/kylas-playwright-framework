/**
 * "Suspected cause" labels for failed/flaky tests (2026-10-15). Pure logic: no fs, no network, no clock — the same
 * shape as FailureAnalyzer.ts, so it is verifiable offline (npm run check:failure-labels).
 *
 * A label is a HINT, never a verdict. It never feeds the verdict, health score, counts, dedup key, subject line or
 * the history ledger; EmailTemplate only renders it. The default is 'unclassified'. A label other than 'flaky'
 * needs (1) a match in the tracked signature registry (failureSignatures.json) AND (2) that entry's breadth rule
 * (minimum tests and modules in THIS run), so one failing test on its own never gets a cause.
 *
 * Deliberately NOT used as evidence: MiscError.expectedReason (rbac / background-noise). Code 01503001 is tagged
 * Expected RBAC today yet also occurs with staging search-index lag, so a text rule cannot separate them
 * (listed under ambiguousCodes in the registry and shown only as a note).
 *
 * Deliberately NOT available: a changed-files / commit diff (the merge job checks out with depth 1), so no
 * "this spec changed" evidence exists here. It is left out rather than guessed.
 */
import { TestResult, deriveModuleFromFile } from './ReportParser';
import { MiscError } from '../error-collector/ErrorCollector';
import { KnownIssueMatch } from './KnownIssuesIndex';
import { RecurringIssue } from './RunHistory';
import { ShardCompleteness, isIncompleteRun } from './ShardCompleteness';
import { classifyFailure, normalizeTestTitle } from './FailureAnalyzer';
import { redactSensitiveText } from './redact';

export type SuspectedCause =
  | 'environment-suspected'
  | 'application-bug-suspected'
  | 'test-or-code-suspected'
  | 'flaky'
  | 'unclassified';

export const SUSPECTED_CAUSES: SuspectedCause[] = [
  'environment-suspected',
  'application-bug-suspected',
  'test-or-code-suspected',
  'flaky',
  'unclassified',
];

// WHY 0.3: the banner claims "one signature dominates". Below ~a third of the failures it would shout about a
// minority; sandbox 38690038228 was roughly half.
export const DOMINANT_SHARE = 0.3;

export interface MiscMatch {
  statusCodes?: number[];
  apiErrorCode?: string;
  urlPattern?: string;
  method?: string;
}

export interface FailureSignature {
  id: string;
  title: string;
  label: Exclude<SuspectedCause, 'flaky' | 'unclassified' | 'test-or-code-suspected'>;
  errorPatterns?: string[];
  misc?: MiscMatch;
  minTests: number;
  minModules: number;
  orKnownIssue?: boolean;
  kiRef: string;
  kiFile: string;
  added: string;
  confirmed: boolean;
  askKylasTeam?: string;
  why: string;
}

export interface AmbiguousCode {
  code: string;
  note: string;
}

export interface SignatureRegistry {
  version: number;
  ambiguousCodes: AmbiguousCode[];
  signatures: FailureSignature[];
}

export const EMPTY_REGISTRY: SignatureRegistry = { version: 1, ambiguousCodes: [], signatures: [] };

export interface CauseAssessment {
  label: SuspectedCause;
  evidence: string[];
  // Set only when a registry entry's breadth rule was satisfied (also for a flaky test whose failing attempt
  // matches one) — the summary and banner count by it.
  signatureId?: string;
  kiRef?: string;
}

export interface FailureCauseInput {
  test: TestResult;
  related: MiscError[];
  knownIssue?: KnownIssueMatch;
}

export interface CauseContext {
  previousRunFailedTitles: string[] | null;
  recurringFailures: RecurringIssue[];
  shardCompleteness?: ShardCompleteness | null;
}

export interface DominantSignature {
  signatureId: string;
  title: string;
  kiRef: string;
  count: number;
  total: number;
  confirmed: boolean;
  askKylasTeam?: string;
}

export interface CauseSummary {
  total: number;
  counts: Record<SuspectedCause, number>;
  dominant?: DominantSignature;
  incompleteRun: boolean;
}

/** Validates an already-parsed registry; throws with the offending id so a bad edit fails loudly in the check script. */
export function parseSignatureRegistry(raw: unknown): SignatureRegistry {
  const o = raw as Partial<SignatureRegistry> | null;
  if (!o || typeof o !== 'object' || !Array.isArray(o.signatures) || !Array.isArray(o.ambiguousCodes)) {
    throw new Error('failure signature registry: expected { version, ambiguousCodes[], signatures[] }');
  }
  const labels = new Set(['environment-suspected', 'application-bug-suspected']);
  const ids = new Set<string>();
  for (const s of o.signatures) {
    const where = `signature "${String((s as FailureSignature)?.id)}"`;
    if (!s || typeof s.id !== 'string' || !s.id) throw new Error('failure signature registry: entry without id');
    if (ids.has(s.id)) throw new Error(`failure signature registry: duplicate id ${s.id}`);
    ids.add(s.id);
    if (!labels.has(s.label)) throw new Error(`${where}: label must be environment-suspected or application-bug-suspected`);
    if (!(s.errorPatterns?.length || s.misc)) throw new Error(`${where}: needs errorPatterns or misc`);
    for (const p of s.errorPatterns ?? []) new RegExp(p, 'i'); // throws on a bad pattern
    if (s.misc?.urlPattern) new RegExp(s.misc.urlPattern, 'i');
    if (!(s.minTests >= 1) || !(s.minModules >= 1)) throw new Error(`${where}: minTests/minModules must be >= 1`);
    for (const f of ['title', 'kiRef', 'kiFile', 'added', 'why'] as const) {
      if (typeof s[f] !== 'string' || !s[f]) throw new Error(`${where}: missing ${f}`);
    }
    if (typeof s.confirmed !== 'boolean') throw new Error(`${where}: confirmed must be boolean`);
    if (s.confirmed && s.label === 'environment-suspected' && !s.askKylasTeam) {
      throw new Error(`${where}: a confirmed environment signature needs askKylasTeam`);
    }
  }
  return o as SignatureRegistry;
}

function failureText(t: TestResult): string {
  return [t.error ?? '', ...(t.allErrors ?? []), t.errorStack ?? '', t.errorSnippet ?? ''].join('\n');
}

function excerpt(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return '';
  const start = Math.max(0, m.index - 20);
  return redactSensitiveText(text.slice(start, m.index + Math.min(m[0].length, 80) + 20).replace(/\s+/g, ' ').trim());
}

interface SignatureHit {
  how: string;
}

function matchSignature(sig: FailureSignature, input: FailureCauseInput): SignatureHit | null {
  const text = failureText(input.test);
  for (const p of sig.errorPatterns ?? []) {
    const re = new RegExp(p, 'i');
    if (re.test(text)) return { how: `error text matches "${excerpt(text, re)}"` };
  }
  const m = sig.misc;
  if (m) {
    const urlRe = m.urlPattern ? new RegExp(m.urlPattern, 'i') : null;
    const hit = input.related.find(
      (e) =>
        typeof e.statusCode === 'number' &&
        (!m.statusCodes || m.statusCodes.includes(e.statusCode)) &&
        (m.apiErrorCode === undefined || e.apiErrorCode === m.apiErrorCode) &&
        (!urlRe || (e.url !== undefined && urlRe.test(e.url))) &&
        (m.method === undefined || (e.method ?? '').toUpperCase() === m.method.toUpperCase())
    );
    if (hit) {
      // WHY path only: keeps the evidence line short and never repeats a hostname in the email.
      let pathOnly = hit.url ?? '(no url)';
      try {
        pathOnly = new URL(pathOnly).pathname;
      } catch {
        /* not an absolute URL: keep as is */
      }
      const where = `${hit.method ?? 'GET'} ${redactSensitiveText(pathOnly)}`;
      return { how: `captured HTTP ${hit.statusCode}${hit.apiErrorCode ? ` ${hit.apiErrorCode}` : ''} on ${where}` };
    }
  }
  return null;
}

function hasNetworkError(related: MiscError[]): boolean {
  return related.some((e) => typeof e.statusCode === 'number' || e.type === 'requestfailed');
}

/**
 * Labels every failed and flaky test of one run. `failures` must be the hard failures plus the flaky tests (their
 * failing attempt); breadth is counted over all of them. Pure and order-independent.
 */
export function assessCauses(
  failures: FailureCauseInput[],
  registry: SignatureRegistry,
  ctx: CauseContext
): Map<TestResult, CauseAssessment> {
  // Pass 1: which signatures does each failure match textually, and how widely (tests / modules) in this run?
  const hits = new Map<TestResult, Map<string, SignatureHit>>();
  const spread = new Map<string, { tests: number; modules: Set<string> }>();
  for (const f of failures) {
    const m = new Map<string, SignatureHit>();
    for (const sig of registry.signatures) {
      const hit = matchSignature(sig, f);
      if (!hit) continue;
      m.set(sig.id, hit);
      const s = spread.get(sig.id) ?? { tests: 0, modules: new Set<string>() };
      s.tests += 1;
      s.modules.add(deriveModuleFromFile(f.test.file).name);
      spread.set(sig.id, s);
    }
    hits.set(f.test, m);
  }

  const out = new Map<TestResult, CauseAssessment>();
  for (const f of failures) {
    const t = f.test;
    const evidence: string[] = [];
    const myHits = hits.get(t) ?? new Map<string, SignatureHit>();

    // Note ambiguous codes so a reader sees them, but never use them as evidence.
    for (const e of f.related) {
      const amb = registry.ambiguousCodes.find((a) => a.code === e.apiErrorCode);
      if (amb && typeof e.statusCode === 'number') {
        evidence.push(`captured HTTP ${e.statusCode} ${amb.code} — ambiguous, not used as evidence (${amb.note})`);
      }
    }

    let chosen: { sig: FailureSignature; hit: SignatureHit } | null = null;
    const unmet: string[] = [];
    for (const sig of registry.signatures) {
      const hit = myHits.get(sig.id);
      if (!hit) continue;
      const s = spread.get(sig.id) ?? { tests: 0, modules: new Set<string>() };
      const breadthOk = s.tests >= sig.minTests && s.modules.size >= sig.minModules;
      const knownOk = sig.orKnownIssue === true && f.knownIssue !== undefined;
      if (breadthOk || knownOk) {
        if (!chosen) chosen = { sig, hit };
        if (knownOk && !breadthOk) {
          evidence.push(`${sig.title}: waived breadth because the failing code has a known-issue match (${f.knownIssue!.file ?? 'known-issues'}:${f.knownIssue!.line})`);
        }
      } else {
        unmet.push(
          `matches "${sig.title}" but only ${s.tests} test(s) in ${s.modules.size} module(s) this run (needs ${sig.minTests} test(s) in ${sig.minModules} module(s))`
        );
      }
    }

    let assessment: CauseAssessment;
    if (t.status === 'flaky') {
      const lines = [`passed on retry (${t.retries} retry${t.retries === 1 ? '' : 's'}) — flaky this run`, ...evidence];
      if (chosen) {
        const s = spread.get(chosen.sig.id)!;
        lines.push(`failing attempt: ${chosen.hit.how}; same signature "${chosen.sig.title}" in ${s.tests} test(s), ${s.modules.size} module(s) (${chosen.sig.kiRef})`);
      }
      lines.push(...unmet);
      assessment = { label: 'flaky', evidence: lines, signatureId: chosen?.sig.id, kiRef: chosen?.sig.kiRef };
    } else if (chosen) {
      const s = spread.get(chosen.sig.id)!;
      const lines = [
        `${chosen.hit.how}`,
        `same signature "${chosen.sig.title}" in ${s.tests} test(s) across ${s.modules.size} module(s) this run (${chosen.sig.kiRef})`,
        ...evidence,
      ];
      assessment = { label: chosen.sig.label, evidence: lines, signatureId: chosen.sig.id, kiRef: chosen.sig.kiRef };
    } else if (unmet.length > 0) {
      assessment = { label: 'unclassified', evidence: [...unmet, ...evidence] };
    } else {
      // No registry signature: the only remaining positive evidence is a locator/assertion failure with no network error.
      const category = classifyFailure(t, f.related);
      if ((category === 'locator' || category === 'assertion') && !hasNetworkError(f.related)) {
        assessment = {
          label: 'test-or-code-suspected',
          evidence: [
            `${category} failure, and no HTTP error or failed request was captured for this test`,
            category === 'assertion'
              ? 'an assertion mismatch can also mean the application changed — read Expected/Received'
              : 'a non-unique or missing locator can also follow an application change',
            ...evidence,
          ],
        };
      } else {
        assessment = {
          label: 'unclassified',
          evidence: [category === 'unknown' ? 'no registry signature matched' : `no registry signature matched (${category} failure)`, ...evidence],
        };
      }
    }

    // Context lines, evidence only — never change the label.
    if (ctx.previousRunFailedTitles !== null && t.status !== 'flaky') {
      const key = normalizeTestTitle(t.title);
      if (ctx.previousRunFailedTitles.some((p) => normalizeTestTitle(p) === key)) {
        assessment.evidence.push('also failed in the previous comparable run');
      }
    }
    const rec = ctx.recurringFailures.find((r) => normalizeTestTitle(r.title) === normalizeTestTitle(t.title));
    if (rec) assessment.evidence.push(`failing in ${rec.countInLastNRuns} of the last ${rec.ofLastNRuns} runs`);
    out.set(t, assessment);
  }

  // WHY (found replaying sandbox 38690038228 from its CI log): in a run dominated by one environment signature, two
  // "assertion failure with no network error" tests were labelled test/code although they most likely hit the same
  // index lag. A test-side cause is not suspected without more evidence while the environment signature dominates.
  const dominant = dominantEnvironmentSignature(out.values(), registry);
  if (dominant) {
    for (const a of out.values()) {
      if (a.label !== 'test-or-code-suspected') continue;
      a.label = 'unclassified';
      a.evidence.unshift(
        `not labelled test/code: ${dominant.count} of ${dominant.total} failures this run share the environment signature "${dominant.title}", so a locator/assertion miss is not attributed to the test code without more evidence`
      );
    }
  }
  return out;
}

function dominantEnvironmentSignature(assessments: Iterable<CauseAssessment>, registry: SignatureRegistry): DominantSignature | undefined {
  const bySignature = new Map<string, number>();
  let total = 0;
  for (const a of assessments) {
    total += 1;
    if (a.signatureId) bySignature.set(a.signatureId, (bySignature.get(a.signatureId) ?? 0) + 1);
  }
  let dominant: DominantSignature | undefined;
  for (const sig of registry.signatures) {
    if (sig.label !== 'environment-suspected') continue;
    const count = bySignature.get(sig.id) ?? 0;
    if (total > 0 && count >= sig.minTests && count / total >= DOMINANT_SHARE && (!dominant || count > dominant.count)) {
      dominant = { signatureId: sig.id, title: sig.title, kiRef: sig.kiRef, count, total, confirmed: sig.confirmed, askKylasTeam: sig.confirmed ? sig.askKylasTeam : undefined };
    }
  }
  return dominant;
}

/** Counts per label plus the one environment signature (if any) that covers a large share of the failures. */
export function summarizeCauses(
  assessments: Iterable<CauseAssessment>,
  registry: SignatureRegistry,
  shardCompleteness?: ShardCompleteness | null
): CauseSummary {
  const list = [...assessments];
  const counts: Record<SuspectedCause, number> = {
    'environment-suspected': 0,
    'application-bug-suspected': 0,
    'test-or-code-suspected': 0,
    flaky: 0,
    unclassified: 0,
  };
  for (const a of list) counts[a.label] += 1;
  return { total: list.length, counts, dominant: dominantEnvironmentSignature(list, registry), incompleteRun: isIncompleteRun(shardCompleteness) };
}
