# Key Conventions

Architectural and implementation guidelines for this codebase.

- **NEVER import from `@playwright/test` in test files** — always use `src/fixtures/index.ts`
- **NEVER hardcode test data** — use factories (`generateXxxData()`)
- **NEVER put locators in test files** — all locators live in the page object
- **ALWAYS extend `BasePage`** for page objects
- **Use `logger.*` not `console.log`** for all logging
- **Tags:** `@smoke` (navigation only), `@regression` (full), `@prodSafe` (read-only, safe on prod)
- **`test.setTimeout(480000)`** on any test that creates/edits records (local runs can be slow)

---

## Session-Expiry Protection

Session-expiry handling is covered in CLAUDE.md Rules 3 & 16. Key patterns:
- Wrap new assertions in `withSessionExpiryRecovery()` (Rule 3)
- Guard `waitForResponse()` promises with `armResponseWaitWithRecovery()` (Rule 16)
- Know that session expiry has multiple symptoms (Rule 16) — protect against all of them
