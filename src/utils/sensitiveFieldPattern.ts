// WHY: extracted from BasePage.ts (2026-08-24) so the notification pipeline's
// error/response-body redaction (src/notifications/redact.ts) can reuse the
// EXACT same keyword list BasePage.fill() already redacts against, instead of
// maintaining a second, independently-drifting copy. Single call site inside
// BasePage.ts before this extraction (confirmed via grep) — a pure, safe
// refactor, not a behavior change.
export const SENSITIVE_FIELD_PATTERN = /password|passwd|pwd|secret|token|api[_-]?key/i;
