# Rate Limits and App Error Pages — Resolved History

> **Purpose:** Resolved incidents where the Kylas app replaced a screen with its own HTTP-429 page or generic error-boundary page, and the `globalSetup` 429 absorption.
> **Read when:** A test fails with an element-not-found / timeout on a screen that "should" be there, or you are adding navigation/list-readiness code that could meet an app-rendered error page.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

The staging `GET /products/layout?view=create` `HTTP 400` in `globalSetup` is still OPEN — see `docs/KNOWN_ISSUES_ACTIVE.md`. The proposal to centralise 429 recovery is decision-record material: see `docs/adr/` (error-page recovery).

### App 429 page replaces any screen under CI load — 2026-09-29
- **Symptom:** `a[data-targetid="Other Details"]`, a Form Fields row click, or a list-table wait timed out; the failure screenshot showed "Whoa! Too many requests at once!" instead of the app.
- **Root cause:** The backend rate-limits bursts (and the concurrent shard count raised burst pressure); the app renders a full-page 429 state mid-test. Not tied to any one page object, so any unprotected navigation/assert can hit it. A plain reload is not enough during a sustained window (`waitForEntityListPage()`'s own reload-and-retry fired and still failed).
- **Fix:** `BasePage.withRateLimitRecovery()` (detects via `authManager.isRateLimitedPage()`, recovers once) wraps `clickDetailPageTab()`, `waitForEntityListPage()`'s `assertTableVisible` closure (shared by 7 modules), `FormFieldsConfigPage.open()/searchField()/openFieldForEdit()`, `ProductsAndServicesPage.goToCreateProductForm()`. Compose rate-limit OUTER, `withSessionExpiryRecovery()` inner.
- **Revert:** Remove the wrapper at a call site (additive everywhere); the helper itself in `src/core/BasePage.ts`.
- **Commit:** `bf32201` (helper), `1091c4b` (further sites).

### Generic error-boundary page ("Something is broken here") — 2026-09-30
- **Symptom:** Company `BasePage.clickDetailPageTab()`, Task `TasksPage.selectReactSelectOption()` final click and Form Fields `FormFieldsConfigPage.submit()` back-navigation, Products & Services `ProductsAndServicesPage.openProductForEdit()` Name-input wait all failed; no 429 text. Two shapes confirmed: `<span class="error-msg">Something is broken here</span>` scoped to a card, and `<div class="app-error something-is-broken">` over the whole `#app`.
- **Root cause:** A React error boundary swallowed an underlying failure — no `pageerror`/`console-error` captured. Why the component fails is not established (app side); this is defensive hardening of the test side, not a proven root-cause fix.
- **Fix:** `authManager.isAppErrorBoundaryPage()` / `tryRecoverFromAppErrorBoundary()` (text match `/something is broken/i`, plain reload — no Refresh button exists). `withRateLimitRecovery()` checks both conditions in one catch (same remedy, so one combinator by design) so every already-wrapped site got it free; three new uncovered sites wrapped (Tasks option click, `FormFieldsConfigPage.submit()`, `openProductForEdit()`).
- **Revert:** Revert `isAppErrorBoundaryPage()` use inside `withRateLimitRecovery()`.
- **Commit:** `b90a885`.

### Four residual symptoms after the first 429 fix — 2026-09-29
- **Symptom:** Company (`FFRCO9/6`), Contact (`FFRC25/6`), Deal (`FFD32`), Products & Services (`FFPS5`, `FFRPS9`, `FFRPS5` as they failed that run) hit the 429 page at still-unwrapped sites; Deal `FFRD6/5` instead timed out on `getByText('Default Deal Pipeline')` with "No Options".
- **Root cause:** (a–c) unwrapped sites. (d) a client-side race: the pipeline react-select is empty while the Add Deal modal still skeleton-loads; `GET /v1/pipelines/lookup?entityType=DEAL&q=name:` fires eagerly during modal bootstrap, never on click, and the endpoint has its own burst bucket.
- **Fix:** Wrapped `clickDetailPageTab()`, `FormFieldsConfigPage.openFieldForEdit()`, `waitForEntityListPage()`, `goToCreateProductForm()`. `DealsPage.clickAddDeal()` arms `armResponseWaitWithRecovery()` for the versioned `/v1/pipelines/lookup` response before clicking and awaits it non-fatally; `fillDealForm()`'s own option wait stays as backstop.
- **Revert:** Revert `DealsPage.clickAddDeal()`'s armed wait; remove individual wrappers.
- **Commit:** `1091c4b`.

### `globalSetup` product-fixture calls had no 429/5xx absorption — 2026-09-29
- **Symptom:** The last-starting `globalSetup` job (peak concurrent setups rose from 8 to 10) failed `GET /products/layout?view=create` with HTTP 429 before any test ran.
- **Root cause:** `ensureProductFixtures()` makes 5 unprotected calls (layout, currencies, 3× `POST /products`); raising CI job count raised burst pressure.
- **Fix:** `withTransientRetry()` in `src/auth/globalSetup.ts` (3 attempts with backoff, retries 429/5xx only, never real 4xx) around `loadProductReferenceData()` and `createOneProductFixture()`. A `max-parallel` cap was rejected (doubles wall-clock for a failure a bounded retry absorbs).
- **Revert:** Remove the `withTransientRetry` wrappers.
- **Commit:** `0195259`.

### Rate-limit / error-page recovery is now measured — 2026-10-06
- **Symptom:** No way to tell whether CI load changes reduced 429s or error-boundary hits.
- **Root cause:** Recovery was silent.
- **Fix:** `ErrorCollector.recordRecoveryEvent()` records each recovery and its outcome (retry recovered / failed); `globalSetup` transient retries use a separate main-process file (`recovery-events-main.json`) because `MiscErrorReporter.onBegin()` deletes worker files after `globalSetup`. Shown per shard in the email's "Load Signals by Job" table. Detail: `docs/known-issues/ci-pipelines.md`.
- **Revert:** Remove the three `recordRecoveryEvent` call sites; report fields render nothing when absent.
- **Commit:** `1bd03cc`.
