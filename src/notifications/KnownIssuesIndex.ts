/**
 * Deterministic cross-reference against .claude/known-issues.md (2026-08-24).
 *
 * WHY not real fuzzy/semantic matching: investigated and deliberately rejected
 * — see .claude/notification-system-redesign-proposal.md's item 7. A
 * similarity-scored text match against ~240 lines of prose risks confidently
 * linking a failure to the WRONG historical entry, which is worse than no
 * link at all, and has no labeled test set to verify correctness against.
 * This module only ever matches on two precise, deterministic signals —
 * an exact verbatim backtick-quoted substring, or an exact
 * `ClassName.methodName` match — both proven against real historical error
 * text during the investigation, not hypothetical.
 */
import * as fs from 'fs';

export type KnownIssueCandidateKind = 'quoted-substring' | 'method-name';

export interface KnownIssueCandidate {
  line: number;
  phrase: string;
  kind: KnownIssueCandidateKind;
}

export interface KnownIssueMatch {
  line: number;
  matchedPhrase: string;
  kind: KnownIssueCandidateKind;
}

// WHY 25 chars: short backtick spans in known-issues.md are overwhelmingly
// method/field names ("`cfTextField`", "`click()`") that are far too generic
// to safely link a failure to one specific historical entry — a 25-char floor
// keeps quoted-substring matching to genuinely distinctive error text (the
// real proven example, "Cannot read properties of undefined (reading
// 'content')", is 57 chars). Method-name matching (below) has its own,
// separate, much shorter minimum since a full `Class.method` name is already
// precise regardless of length.
export const MIN_SUBSTRING_MATCH_LENGTH = 25;

// WHY this exact shape: this codebase's own convention (confirmed via direct
// read of known-issues.md) is PascalCase page-object class names
// (DealsPage, QuotationsPage, ...) with a camelCase method — matches the real
// stack-trace shape `at DealsPage.selectDateInPicker (...)`.
const METHOD_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*\.[a-zA-Z0-9]+$/;
const BACKTICK_SPAN_PATTERN = /`([^`]{3,})`/g;

// WHY this denylist exists (added 2026-08-24, caught during this redesign's
// own real-data verification, not theoretical): a real quoted phrase in
// known-issues.md, "Test timeout of 480000ms exceeded" (line 82, part of the
// CL39 incident writeup), is long enough (33 chars) to pass
// MIN_SUBSTRING_MATCH_LENGTH — but 480000ms is this codebase's own standard
// `test.setTimeout(480000)` convention (CLAUDE.md: "on any test that
// creates/edits records"), meaning this exact generic Playwright message can
// legitimately appear on MANY unrelated tests across the whole suite, not
// just ones related to CL39's real root cause (a call-log entityType/
// dropdown bug). Verified live: a real flaky Quotations test in this
// investigation's own sample data hit this exact message for a completely
// unrelated reason and would have been confidently, wrongly linked to CL39.
// Denylisted patterns are generic Playwright/framework boilerplate with no
// code-specific content (no method name, no app-specific noun) — excluded
// from ever anchoring a quoted-substring match, though they can still appear
// as ordinary backtick-quoted text in known-issues.md for other purposes.
const GENERIC_FRAMEWORK_MESSAGE_PATTERNS: RegExp[] = [
  /^Test timeout of \d+ms exceeded\.?$/i,
  /^Timeout \d+ms exceeded\.?$/i,
];

function isGenericFrameworkMessage(phrase: string): boolean {
  return GENERIC_FRAMEWORK_MESSAGE_PATTERNS.some((p) => p.test(phrase.trim()));
}

/**
 * Parses known-issues.md's real markdown content into a flat list of
 * candidate phrases, each tagged with the 1-indexed line it came from (for
 * building a real GitHub blob#L<line> link) and which matching strategy it's
 * eligible for. Pure function — takes the file's content as a string rather
 * than reading it itself, so it can be tested against a fixed string without
 * depending on the real file's content changing under it.
 */
export function buildKnownIssuesIndex(markdown: string): KnownIssueCandidate[] {
  const candidates: KnownIssueCandidate[] = [];
  const lines = markdown.split('\n');
  lines.forEach((lineText, idx) => {
    const line = idx + 1;
    let match: RegExpExecArray | null;
    BACKTICK_SPAN_PATTERN.lastIndex = 0;
    while ((match = BACKTICK_SPAN_PATTERN.exec(lineText)) !== null) {
      const phrase = match[1];
      if (phrase.length >= MIN_SUBSTRING_MATCH_LENGTH && !isGenericFrameworkMessage(phrase)) {
        candidates.push({ line, phrase, kind: 'quoted-substring' });
      }
      // WHY strip a trailing "()" before testing the method-name shape: this
      // file's own convention backtick-quotes method references as
      // `ClassName.methodName()` (with the call parens), but a real stack
      // frame's function name never includes them — normalize once here so
      // matchKnownIssue() can compare like-for-like.
      const withoutParens = phrase.endsWith('()') ? phrase.slice(0, -2) : phrase;
      if (METHOD_NAME_PATTERN.test(withoutParens)) {
        candidates.push({ line, phrase: withoutParens, kind: 'method-name' });
      }
    }
  });
  return candidates;
}

/**
 * Looks for a real, precise match for one failure. Method-name matching is
 * tried first (a match there means "this failure occurred inside code with a
 * documented history," a strong and unambiguous signal); falls back to an
 * exact substring match only if no method-name hit exists. Returns null —
 * never a weak/uncertain guess — when neither signal is present.
 */
export function matchKnownIssue(
  errorText: string,
  stackMethodName: string | null,
  index: KnownIssueCandidate[]
): KnownIssueMatch | null {
  if (stackMethodName) {
    const methodHit = index.find((c) => c.kind === 'method-name' && c.phrase === stackMethodName);
    if (methodHit) return { line: methodHit.line, matchedPhrase: methodHit.phrase, kind: methodHit.kind };
  }
  const substringHit = index.find((c) => c.kind === 'quoted-substring' && errorText.includes(c.phrase));
  if (substringHit) {
    return { line: substringHit.line, matchedPhrase: substringHit.phrase, kind: substringHit.kind };
  }
  return null;
}

/**
 * Reads the real known-issues.md off disk. Isolated as its own tiny function
 * (rather than inlined at the NotificationService call site) so the pure
 * parsing/matching functions above stay independently testable against a
 * fixed string, per this codebase's established RunHistory.ts/
 * FailureAnalyzer.ts convention of separating fs access from pure logic.
 * Returns an empty index (never throws) if the file is missing or unreadable
 * — a missing cross-reference source must degrade to "no matches," not fail
 * the whole notification pipeline.
 */
export function loadKnownIssuesIndex(filePath: string): KnownIssueCandidate[] {
  try {
    return buildKnownIssuesIndex(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

/**
 * Extracts the innermost repo-code stack frame's `Class.method` name from a
 * raw Playwright error stack, e.g. "at DealsPage.selectDateInPicker
 * (/home/.../DealsPage.ts:606:23)" -> "DealsPage.selectDateInPicker". Returns
 * null when no frame matches this codebase's PascalCase-class convention
 * (e.g. a bare assertion failure with no named-method frame at all).
 */
export function extractStackMethodName(errorStack: string | undefined): string | null {
  if (!errorStack) return null;
  const match = errorStack.match(/at ([A-Z][A-Za-z0-9]*)\.([a-zA-Z0-9]+) \(/);
  return match ? `${match[1]}.${match[2]}` : null;
}
