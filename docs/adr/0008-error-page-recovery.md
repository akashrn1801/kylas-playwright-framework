# ADR 0008 — Recover from app error pages at the call site

> **Purpose:** Records how tests recover from the app's 429 page and error-boundary page, and the proposed central follow-up.
> **Read when:** A test fails with 'Too many requests' or 'Something is broken', or you are adding a raw navigation/list assertion.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-09-30 (call-site wrapping). Proposed — centralization (below), not implemented.

## Context
Under concurrent CI load the app can replace any screen with its own "Whoa! Too many requests at once!" page, or with a generic React error-boundary fallback ("Something is broken here", seen card-scoped and whole-`#app`). Both are recognised by `src/auth/authManager.ts` (`isRateLimitedPage()`, `isAppErrorBoundaryPage()`); a plain reload recovers a normal case, but a sustained 429 window can defeat one reload. Root cause of why the app fails is not established; this is defensive hardening. Session expiry (`withSessionExpiryRecovery`) is a separate, older mechanism. Incident history: [rate-limits-and-error-pages](../known-issues/rate-limits-and-error-pages.md).

## Decision
`BasePage.withRateLimitRecovery(fn)` (`src/core/BasePage.ts`) runs `fn`, and on failure checks both page states, reloads and retries once; every outcome is recorded via `ErrorCollector.recordRecoveryEvent()`. It is applied per call site: `clickDetailPageTab()`, `waitForEntityListPage()`'s table assertion, `FormFieldsConfigPage` (`open`, `searchField`, `openFieldForEdit`, `submit`), `ProductsAndServicesPage` (`goToCreateProductForm`, `openProductForEdit`), `TasksPage.selectReactSelectOption()`. When combined with session recovery, nest rate-limit outer: `withRateLimitRecovery(() => withSessionExpiryRecovery(...))`.

## Consequences
- Each wrapped site gets exactly one retry; nesting is safe because each combinator has its own one-shot budget.
- Coverage is by call site: a new raw assertion outside these helpers is unprotected until wrapped.

## How to revert
Unwrap call sites; `withRateLimitRecovery` can stay as a no-op candidate. Failures then surface as bare timeouts.

## Proposed follow-up: centralize
Verified 2026-10-06 against `src/core/BasePage.ts`: NOT implemented. `isRateLimitedPage` is referenced only inside `withRateLimitRecovery`; `click()`, `fill()`, `navigateTo()` (session-expiry check only) and `armResponseWaitWithRecovery()` (races the response against a session-expiry signal only) have no rate-limit handling. Real gap: `DealsPage.clickAddDeal()` arms a `/v1/pipelines/lookup` wait with no 429 awareness.
- **Option A:** put the check inside `click()`/`fill()`/`waitForEntity*Page()`/`armResponseWaitWithRecovery()`. Closes the "next uncovered site" problem, but changes the highest-blast-radius methods for the whole suite at once.
- **Option B:** one combinator (`withNavigationRecovery()`) that both session and rate-limit paths call, used by `armResponseWaitWithRecovery()` and `click()`'s catch. Smaller blast radius, still relies on callers choosing it.
- **Constraint for either:** total attempts must stay bounded and testable (two independent retry loops that trigger each other could retry a save four times). Decide using whether new uncovered sites keep appearing in CI.
Implement as its own reviewed change, never folded into a call-site fix.

## Commit(s)
`bf32201` (429 recovery), `1091c4b` (three more sites), `b90a885` (error-boundary page).
