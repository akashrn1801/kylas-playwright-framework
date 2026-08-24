import { SENSITIVE_FIELD_PATTERN } from '../utils/sensitiveFieldPattern';

// WHY a distinct pattern from SENSITIVE_FIELD_PATTERN itself, not a direct
// reuse (2026-08-24): BasePage.isSensitiveFieldDescription() checks whether a
// whole description STRING ("password field") is about a sensitive field.
// This module redacts a VALUE embedded inside free-form text (a thrown error
// message, a stack trace, an API response body) — e.g. `"apiKey":"abc123"` or
// `password: Sup3rSecret!` — where the sensitive keyword and its value are
// two different substrings of a much longer blob. The keyword LIST is kept
// identical (reused via SENSITIVE_FIELD_PATTERN.source) so the two can never
// drift apart on what counts as "sensitive"; only the surrounding
// key-then-separator-then-value shape is new, because that shape doesn't
// exist in a plain description string.
const SENSITIVE_VALUE_PATTERN = new RegExp(
  `(["'\`]?\\b(?:${SENSITIVE_FIELD_PATTERN.source})\\b["'\`]?)\\s*[:=]\\s*["'\`]?([^"'\`\\s,}]+)["'\`]?`,
  'gi'
);

// WHY a SECOND, separate pattern (added 2026-08-24, caught during this
// redesign's own end-to-end verification, not theoretical): an HTTP
// "Authorization: Bearer <token>" header is one of the single most common
// real shapes a raw secret leaks through — confirmed live that
// SENSITIVE_VALUE_PATTERN above does NOT catch it, because the sensitive
// KEYWORD ("token") never actually appears as the key name in this shape —
// the key is "Authorization", and "Bearer" is a scheme label, not a keyword
// match. This is a real gap a synthetic test case surfaced, not a
// hypothetical — fixed with its own dedicated pattern rather than trying to
// force one regex to cover two structurally different leak shapes.
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9\-_.]+/gi;

/**
 * Scrubs a sensitive-looking key/value pair (password, token, secret, apiKey,
 * etc. — the exact same keyword list BasePage.fill() already redacts) AND a
 * bare "Bearer <token>" auth header out of free-form text before it's
 * embedded in an email. Applied to every raw Playwright/API string this
 * redesign surfaces (error messages, stack traces, snippets, MiscError
 * response bodies) — none of which passed through BasePage's own redaction,
 * since that only ever guarded a typed VALUE at fill-time, not a value that
 * later appears inside a thrown error or an API response body. Text with
 * neither shape present is returned byte-identical — verified against real
 * captured error strings from this investigation, none of which contain
 * either shape.
 */
export function redactSensitiveText(text: string): string {
  return text
    .replace(SENSITIVE_VALUE_PATTERN, (_match, key: string) => `${key}: [REDACTED]`)
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]');
}
