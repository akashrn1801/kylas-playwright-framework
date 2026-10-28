# Rate Limits and App Error Pages — Resolved History

> **Purpose:** Resolved incidents where the Kylas app replaced a screen with its own HTTP-429 page or generic error-boundary page, and the `globalSetup` 429 absorption.
> **Read when:** A test fails with an element-not-found / timeout on a screen that "should" be there, or you are adding navigation/list-readiness code that could meet an app-rendered error page.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-28 @ 44a20dd

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

### WATCH — POST /contacts/ and PUT /leads/{id} return HTTP 400 `000000` with empty errorDetails on prod — 2026-10-21
- **Status:** backend response, test must keep failing; classifier entry `contacts-post-400-000000-empty` (label only, KI number pending, needs 5 tests across 2 modules).
- **Evidence:** main run 39470566009 (20 Oct): `POST /contacts/` -> 400 `000000` "Something didn't work as expected", empty errorDetails, 112 times between 17:57 and 21:02 UTC (19 contacts, 2 companies, 2 meetings tests). Main run 39534804354 (21 Oct): `PUT /leads/{id}` -> 400 `000000` once (leads.rbac:107, passed on retry).
- **Message:** a failed save now reads `Backend rejected the save: POST /v1/contacts/ -> 400 000000` before the form text.

### OPEN (KI-48) — Add Quotation form crashes into a blank page (`getCurrencyId`) — 2026-10-28
- **Symptom:** `quotations.rbac.spec.ts:718` (Q27) hit the 480000 ms test timeout waiting for `[id="0_11_input_quotationNumber"]` in `QuotationsPage.fillQuotationForm`; the admin failure screenshot is entirely white.
- **Evidence (PROD main run 40637702829, shard 4, trace of the admin page):** Add Quotation clicked at 669.2 s; `GET /v1/quotations/layout/create` 200 (65 KB, 961 ms); at 670.5 s an uncaught `TypeError: Cannot read properties of undefined (reading 'id')` at `getCurrencyId` (`componentDidUpdate`), then CKEditor `Cannot read properties of null (reading 'model')`. All `api.kylas.io` calls were 200 (the only 429 was Sentry ingest); `/v1/users/me` and `/v1/tenants` 200 throughout, URL stayed `/sales/quotations/list`. No `/v1/currencies` request appears in the trace; `users/me` has `idNameStore.currency: {}`. Why the currency lookup is undefined is not established.
- **Not the error-boundary page:** that one shows "Something is broken here" and had no `pageerror`; this one has the `pageerror` and a blank page.
- **Test side:** `BasePage.fill()` waited without a timeout and turned the crash into an 8-minute hang. Since 2026-10-28 its `waitFor` is bounded by `config.timeouts.navigation` (120 s in CI, 60 s default); that is a bound, not a fix of the crash. No fix applied for the crash itself.
- **QA run 40477938102 (`quotations.spec.ts:620`, `:640`) is not this crash:** neither trace has a `getCurrencyId` text or a `pageerror`. They are the backend failure in KI-49 below.

### OPEN (KI-49) — QA backend service-discovery (DNS) failures — 2026-10-27

- **Evidence (QA run 40477938102, traces read 2026-10-28; times UTC from the trace network logs):**
  - `deals.rbac.spec.ts:342`, attempt 1: `POST /v1/contacts/` -> HTTP 400 `000000` "Failed to resolve 'sd-sales' and search domain query for configured domains failed as well: [sling-sales.svc.cluster.local, svc.cluster.local, cluster.local]", `fieldErrors: null`, 09:18:06. The classifier in `captureContactCreateOutcome()` treats only status >= 500 or "unexpected error occurred / internal server error / something didn't work as expected" as transient, so this was non-transient and the generic "Contact ID not captured after save" was thrown. Retry: `GET /v1/contacts/has-duplicates?fieldName=emails` -> 400 "Unexpected error occurred!!" at 09:19:25, the red "Uhoh! Something didn't work as expected" toast on screen, then "Timezone: react-select opened but has zero live options" (the 400 and the closed menu are correlated; no mechanism established).
  - `quotations.spec.ts:620`: `GET /v1/quotations/layout/list` -> 400 "Connection prematurely closed BEFORE response" (10:57:13); the Add Quotation button never rendered; the 120 s `waitFor` timed out.
  - `quotations.spec.ts:640` (retry1 trace): at 11:26:29 to :34 `GET /v1/marketplace/apps/actions`, `POST /v1/rules/search/action-logs` and `GET /v1/quotations/layout/create` -> 400 with the same message for 'sd-marketplace', 'sd-rule' and 'sd-order-management'; `GET /v1/notifications/unread` -> 500 after 18.9 s. The drawer sat on loading skeletons and `fill()` waited until the 480 s test timeout.
- **Other two failures in the same artifact, checked and NOT shown to be this outage:** `leads.rbac.spec.ts:145` (10:05): "User search: \"User 1\" did not appear after 3 attempts"; every `GET /v1/users/lookup/?q=firstName:User` returned 200 with "User 1" (the first took 16.9 s) and the screenshot shows the share dropdown on "Loading..."; cause not established. `companies.rbac.spec.ts:354` (09:15): `PUT /v1/companies/271878` -> 400 `000000` "Unexpected error occurred!!", the generic signature, not the DNS text; same family and close in time to the 09:18 contacts failure, but not proven the same incident.
- **Test-side change (2026-10-28, no retry added):** the Contacts, Companies, Leads and Deals create flows now put the matched request, HTTP status, code and message (or "no response within N ms" / "session expired") in the thrown error and in the transient-retry error; the Quotations list and create flows fail at once when `layout/list` or `layout/create` returns 4xx/5xx; registry signature `backend-service-discovery-failure` labels it environment-suspected.
- **Not done:** widening the transient classifier. A retry would not have rescued an outage still failing 80 s later, and would hide an environment failure.
- **Ask the Kylas team:** was QA service discovery (cluster DNS for `sd-sales`, `sd-rule`, `sd-marketplace`, `sd-order-management`) unhealthy on 2026-10-27 between about 09:15 and 11:30 UTC?
