# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
End-to-end automation framework for Kylas Sales CRM using Playwright + TypeScript.

## Tech Stack
- Playwright ^1.60.0 + TypeScript (strict, ES2022)
- Node >=20.0.0 / npm >=10.0.0
- Faker.js for test data generation
- Allure + Playwright HTML reporters
- ErrorCollector for runtime browser/network error tracking

## Key Commands

```bash
# Run a specific module (UI + RBAC)
ENV=qa npm run test:leads
ENV=qa npm run test:contacts
ENV=qa npm run test:companies
ENV=qa npm run test:deals
ENV=qa npm run test:tasks
ENV=qa npm run test:meetings
ENV=qa npm run test:call-logs
ENV=qa npm run test:quotations

# Run a single test file directly
ENV=qa npx playwright test tests/ui/leads/leads.spec.ts --project=chromium --workers=1
ENV=qa npx playwright test tests/rbac/leads.rbac.spec.ts --project=chromium --workers=1

# Run by tag
ENV=qa npx playwright test --grep "@smoke" --project=chromium --workers=1

# TypeScript check
npx tsc --noEmit

# Lint + format
npm run lint:fix
npm run format

# View reports
npm run report:playwright
npm run report:allure

# Reset auth (sessions expire after ~1 hour)
rm -rf src/auth/storageStates/qa/

# Clean all output
npm run clean
```

## Environment Variables
Copy `.env.example` and set these per-env values in `.env`:
```
ENV=qa   # qa | staging | prod

QA_APP_URL=
QA_API_BASE_URL=
QA_ADMIN_EMAIL=
QA_ADMIN_PASSWORD=
QA_RESTRICTED_EMAIL=
QA_RESTRICTED_PASSWORD=

# For Quotations (deals pre-created in DB)
QA_ADMIN_DEAL_NAME=
QA_RESTRICTED_DEAL_NAME=
```
`STAGING_*` and `PROD_*` follow the same pattern.

## Architecture

### File Layout
```
src/
  core/BasePage.ts          — Base class all page objects extend
  fixtures/index.ts         — Custom test fixtures (ALWAYS import from here)
  auth/
    globalSetup.ts          — Logs in both roles before suite, saves storage state
    authManager.ts          — Session validation + re-login with 1-hr in-memory cache
    storageStates/<env>/    — Saved Playwright browser storage states per role
  modules/<module>/
    <Module>Page.ts         — Page object class
  data/factories/
    <module>Factory.ts      — generateXxxData() / generateAdminXxxData() functions
  error-collector/
    ErrorCollector.ts       — Singleton; captures pageerror / console-error / HTTP 4xx-5xx
    errorFilters.ts         — Noise filter + expected RBAC error classifier
  reporters/
    MiscErrorReporter.ts    — Playwright reporter that writes reports/misc-errors.json
  notifications/            — Email notification service (post-run)
  utils/logger.ts           — logger.info/warn/error/success (never use console.log)

tests/
  ui/<module>/              — Functional UI tests (adminPage fixture)
  rbac/<module>.rbac.spec.ts — Permission tests (adminPage + restrictedPage fixtures)

config/config.ts            — Single source of truth for env vars, timeouts, retry config
```

### Fixtures (`src/fixtures/index.ts`)
Two custom fixtures wrap authenticated browser contexts:
- **`adminPage`** — full-access "Playwright Automation" user
- **`restrictedPage`** — limited-access "User 1"

Both fixtures: attach `ErrorCollector` listeners (pageerror, console-error, requestfailed, 4xx/5xx), dismiss startup popups, and validate/renew sessions via `AuthManager`. Always import `test` and `expect` from `src/fixtures/index.ts`, never from `@playwright/test`.

### Auth Flow
`globalSetup.ts` runs once before the suite: logs in both roles, saves `src/auth/storageStates/<env>/<role>.json`, and captures the user display name to `userNames.json`. `AuthManager.getContextForRole()` reuses cached state with a 1-hour in-memory TTL — skipping the browser validation overhead for every test in the suite.

### Page Object Structure
Every page object extends `BasePage` and follows this exact section order:
1. `retryConfig` (reads from `config.searchRetry` or `config.meetingRetry`)
2. Locators (private readonly arrow functions returning `Locator`)
3. Constructor (`super(page)`)
4. Private Helpers
5. Navigation
6. Form Actions
7. Search & Open
8. Edit Actions
9. Assertions
10. Workflow Wrappers

Locators are arrow functions (`private readonly foo = (): Locator => ...`) so they are lazily evaluated and not captured at construction time.

### Test Data Factories
Each factory exports `generateXxxData()` plus prefixed variants for RBAC isolation:
- `generateAdminXxxData()` — prefix `ADM<timestamp>` — admin-only data, guaranteed invisible to restricted user
- `generateSharedXxxData()` — prefix `SHR<timestamp>` — data admin creates then shares with restricted user
- Restricted user creates data with plain `generateXxxData()`; its ownership is their own role

Country defaults to `India` in all factories (CRM validation requirement).

### Retry / Flake Mitigation
`config.searchRetry` drives the retry loop in every `searchAndOpen*` method. Meetings use `config.meetingRetry` (more retries, longer wait) because the calendar aggregation is slower. Do not hardcode retry values in page objects — read from config.

### ErrorCollector
Captures browser-level errors passively during every test. Results are written to `reports/misc-errors.json`. RBAC permission errors (403s) are marked `expected: true` by `errorFilters.ts` so they don't pollute the unexpected-error count. Review `misc-errors.json` after a run to spot regressions independent of test assertions.

## Key Conventions
- NEVER import from `@playwright/test` in test files — always use `src/fixtures/index.ts`
- NEVER hardcode test data — use factories
- NEVER put locators in test files — all locators live in the page object
- ALWAYS extend `BasePage` for page objects
- Use `logger.*` not `console.log`
- Tags: `@smoke` (navigation only), `@regression` (full), `@prodSafe` (read-only, safe on prod)
- `test.setTimeout(480000)` on any test that creates/edits records (local runs can be slow)

## Branch Strategy
Create feature branches from `dev`. Test on sandbox (`sandbox.yml` auto-detects changed files) before opening a PR to `dev`. PRs to `main` go through the full CI matrix.

## CI/CD
- GitHub Actions: `dev.yml`, `qa.yml`, `stage.yml`, `prod.yml`, `main.yml`
- Jenkins: `Jenkinsfile` (multi-branch), `Jenkinsfile.qa`, `Jenkinsfile.staging`, `Jenkinsfile.prod`
- `sandbox.yml`: selective test detection based on changed files (uses `scripts/reset-sandbox.sh`)
- Worker count in CI is controlled by the `WORKERS` env var (set per-Jenkinsfile), defaulting to 2 if unset (`playwright.config.ts`); retries default to 1

## Known Issues
- **Lead "Company Lookup"/"Contact Lookup" custom fields — full E2E coverage added (L20/L21/L30/L31), plus 9 real bugs found and fixed across 7 page-object files during implementation and a rigorous multi-round re-verification (2026-07-21/22).** Two live, server-side, RBAC-scoped lookup fields on the Lead form's "Other Details" tab (internal names `cfCompanyLookup`/`cfContactLookup`; `GET /v1/companies/lookup`, `GET /v1/search/contact/lookup`). Tests: **L20** (UI, create with both lookups + verify detail), **L21** (UI, edit to add both lookups), **L30** (RBAC, restricted user cannot select admin-owned/unshared entities), **L31** (RBAC, restricted user can select their own). Scaffolding: `BasePage.selectLookupCustomField()`/`assertLookupCustomFieldOptionAbsent()`, `LeadsPage.fillLeadLookupCustomFields()`/`assertLeadLookupOnDetail()`/`assertLeadLookupSelectableAbsent()`. Every fix below was verified 3x on **each** of qa/staging/prod (9 runs minimum) before being considered done — not just qa. Full evidence trail lives in the session's git history; this entry is the durable summary.
  1. **Detail-page carousel reset** — Lead's "Other Details" section is a Bootstrap carousel (non-cycling); custom fields on inactive slides are `display:none` but attached, so a naive `toBeVisible` fails on a field that's simply on another slide. Fixed with `BasePage.revealDetailCarouselSlideFor()` — direction-aware chevron navigation (the carousel does NOT cycle) + token-boundary XPath for the carousel container (a naive `contains(@class,"carousel")` false-matches `.carousel-item` itself). The restricted-user detail page additionally resets to its first tab after attach — `LeadsPage.assertLeadLookupOnDetail()` retries the whole activate-tab→reveal-carousel→assert sequence as one unit to survive this.
  2. **`CompaniesPage.clickAddCompany()` modal-open race** — a single click on "Add Company" intermittently didn't open the modal (React click-handler-not-yet-attached race, same class as the pre-existing `DealsPage.cloneDeal()` bug documented below) with zero recovery. Fixed with a bounded re-click retry until `nameInput()` is actually visible — backward-compatible (exits after one attempt in the normal case).
  3. **`createCompany`/`createLead`/`createContact` transient-backend-400 blind spot** — the create POST intermittently returns a generic error (`{"message":"Unexpected error occurred!!","fieldErrors":null}` or a 5xx) with no session-expiry redirect, so the existing `withSessionExpiryRetry` mechanism doesn't catch it; the save fell through to a false "ID not captured — save likely failed silently" throw. Fixed by classifying the create-POST response by BODY content (2xx→success; non-2xx generic message/empty `fieldErrors`/any 5xx→`TransientXxxSaveError`, retried up to 3x with hard-navigation cleanup; populated `fieldErrors`→genuine, never retried) in all three `saveXxx()` methods. Proven via deliberate `page.route()` injection (4/4: transient retries+succeeds, genuine throws+no-retry) before trusting it on real data.
  4. **Close-lead toggle visibility flake (`leads.spec.ts` L11/L12, "mark lead as Closed Lost/Unqualified")** — `LeadsPage.markLeadAsStage()`'s `closeLeadToggleButton().waitFor(10000)` failed once in a long full-suite run. Measured the REAL baseline via live timing instrumentation (5 samples): the toggle normally appears 836-2575ms after navigation — the existing 10s bound already has 4-12x headroom, so this was NOT a case of an arbitrarily tight timeout to blindly widen. Fixed with a bounded reload-and-retry (reload + re-run `waitForLeadDetailsPage()` + re-check once) targeting the specific "rare render delay under load" scenario, not a bigger number.
  5. **Share-modal ~9-minute hang across Leads/Companies/Contacts/Deals** — `shareXxx()`'s "select User" click (`userOption.click()`) was a raw, unbounded Playwright click in all 4 modules; if it silently didn't register, the following search input never mounted and the subsequent unbounded `.fill()` hung until the outer `test.setTimeout` (~8-10min) — this was the root cause of a stalled full-suite regression run. Fixed with an identical `openUserShareTypeSearch()` helper added to all 4 page objects (not centralized into `BasePage` — matches this codebase's existing convention of duplicating the Share-modal pattern per module): bounds every click to `config.timeouts.expect` and retries the whole open→select→verify sequence up to 3 times.
  6. **`QuotationsPage.selectFromIsInvalidControl()`** — same unbounded-click race as #5 (status/company/contacts react-select fields), fixed identically (bounded click + 3-attempt retry).
  7. **`DealsPage.selectFirstOptionFromDropdown()`'s random-pick branch on Associated Company** — picked a random index from the full UNFILTERED `.is-invalid__option` list (can be 25+ options on a long-lived env); under real load, reading/clicking a random index intermittently timed out on ALL 3 bounded attempts (confirmed live on **stage**, not just qa/prod — an earlier, narrower investigation had scoped this "qa/prod only, stage's list is too small," but stage's data had grown to the same scale by the time this was re-hit — **a reminder that environment-based scoping needs re-confirming, not assumed permanent**). Fixed by batch-reading every option's text via `allTextContents()` (one round trip), picking one at random, then typing it to filter the list down to a single match and clicking that — mirrors the already-reliable `exactName` code path immediately above it in the same method.
  8. **`ContactsPage.selectFromContactDropdown()` unbounded-click** (salutation/campaign/source, create+edit — 6 call sites) — identical race to #5/#6/#7, confirmed live hanging the full 480s timeout on **prod**. Fixed identically (bounded click + 3-attempt retry).
  9. **`CallLogsPage`'s "Associated Deal" field — root cause was data linkage, NOT a search-index-lag race.** Two existing tests (`call-logs.rbac.spec.ts` CL22, `call-logs.spec.ts` CL4) request `includeAssociatedDeal: true` and their titles claim to "verify both entity associations on detail panel," and intermittently the deal search returned zero options after all retries, logged as "may not be search-indexed yet." Root-caused via a deliberate live DOM investigation: even a 15s wait + 5 retries still found nothing, because `ensureOwnedDealExists()` created the deal via `generateDealData()` with NO `associatedContactName` — per this codebase's own documented random-associated-contact-picker behavior (see `DealsPage.fillDealForm()`'s entry below), the deal got linked to a random, unrelated contact, never the one the call-log flow just created. No amount of retrying or waiting could ever have found a deal that was never actually related. **Fixed** by threading the contact's name through `ensureOwnedDealExists(associatedContactName?)` → `generateDealData({associatedContactName})`, making the deal genuinely linked. **Separately, a real test-coverage gap was found and closed along the way:** neither CL4 nor CL22 had ever actually asserted the deal appears on the detail panel, despite their titles claiming to — added `CallLogsPage.assertAssociatedDealOnDetail(dealName: string | null)` (locator confirmed via live DOM inspection: `div.link-primary` containing the deal name), deliberately null-safe so a genuinely-unavailable association is never turned into a false failure, and wired it into both tests.
  - **Verification discipline used throughout:** every fix above was proven with real evidence (live log timelines, deliberate `page.route()`/DOM reproduction where relevant — never assumption), and every one was re-verified 3x on each of qa, staging, AND prod (not just the environment it was found on) before being accepted as done — a lesson learned directly from #7 finding that an earlier "qa/prod only" environmental scoping had silently gone stale.
- **Session-expiry recovery for `waitForResponse()` ID-capture — built, and two real bugs found+fixed via deliberate reproduction (2026-07-20).** Two new `BasePage` methods close the gap where a `page.waitForResponse()` used to capture a save's response/ID was blind to mid-test session expiry (confirmed live twice: `leads.rbac.spec.ts:398`, `call-logs.spec.ts:305`), waiting out the full configured timeout instead of recovering:
  - `armResponseWaitWithRecovery(predicate, description, timeout)` — a drop-in replacement for the raw `this.page.waitForResponse(predicate, {timeout})` call at ~51 sites across 8 page-object files. Races the real response against `authManager.armSessionExpirySignal()` (the same 401/signIn-redirect detection `attachSessionExpiryListener` already uses, as a one-shot awaitable). On expiry: recovers the session, then fails FAST (~1-2s) instead of hanging — deliberately does **not** try to resume the original in-flight request, since the confirmed observed behavior is a full-page redirect to `/signIn` that destroys whatever form/modal triggered the request; blindly re-clicking a vanished button would be worse than today's slow-but-self-healing behavior.
  - `withSessionExpiryRetry(workflowFn, description)` — wraps an entire top-level workflow method (`createLead`, `updateLead`, `createContact`, `updateContact`, `createDeal`, `createDealWithPayments`, `updateDeal`, `createCompany`, `updateCompany`, `updateCompanyFull`, `createMeeting`, `createQuickTask`, `createQuickTaskThenSwitchToDetailed`, `createDetailedTask`, `updateTask`, `createQuotation`, `updateQuotation`, `updateCallLog`). If expiry is detected anywhere during the call, retries the whole method once — genuine same-attempt recovery, invisible to the test. **Deliberately NOT applied** to share/reassign/clone/add-from-panel methods across every module — a dedicated investigation (4 parallel file-pair agents) confirmed these assume the page is already on a specific entity's detail view with the ellipsis menu/panel reachable; they don't navigate there themselves, so a blind retry after a recovery navigation would fail *worse* than today. Those keep only the `armResponseWaitWithRecovery` treatment. `LeadsPage`/`ContactsPage` additionally clone their input `data` at the top of each retry attempt (`cloneContactDataForRetry()` goes one level deep for the nested `customFields` object) — confirmed via grep that `fillLeadForm`/`fillContactForm`/their edit-form counterparts mutate their parameter in place (timezone, address, company, custom-field picks); every other module's fill methods confirmed to NOT mutate their input, so no cloning was needed there.
  - **Duplicate-safety of the whole-method retry is not assumed** — confirmed architecturally: a genuine session expiry always surfaces as a clean HTTP 400/401 rejection (auth middleware blocks the request before any business logic/DB write runs), so re-invoking with the same input can never create a duplicate record.
  - **Two real bugs found via deliberate reproduction before trusting this design** (a synthetic test using `page.route()` to inject a fake 401 on the exact lead-create POST, not assumption):
    1. **A race in the original flag-based coordination.** The first design had `armResponseWaitWithRecovery` set a WeakMap flag *after* fully awaiting its own recovery (a real re-login, 10+ seconds) so `withSessionExpiryRetry` could check "did expiry actually happen" without retrying on unrelated errors. This arrived too late for methods shaped like `LeadsPage.saveLead()`: it arms an ID-capture promise *without* awaiting it immediately, then runs other code (`assertNoFormErrors()`) that reacts to the same underlying failure much faster (~1.5s, a DOM toast-check). Reproduced live: `assertNoFormErrors()` threw and propagated out of the whole workflow before the flag had been set, so the retry never fired despite a genuine, confirmed expiry. **Fixed** by redesigning `armSessionExpirySignal()` to expose a synchronous `hasFired()` boolean (toggled the instant the browser event arrives — Playwright's `page.on(...)` callbacks are synchronous with no awaited chain, always preceding any JS-level reaction to that same event) and having `withSessionExpiryRetry` arm its **own** independent signal covering the whole `workflowFn` call, rather than depending on a nested call's flag.
    2. **A competing-navigation race in `tryRecoverSessionForPage()` itself.** When expiry is detected mid-interaction (not a page-level navigation), the real app's own frontend can independently fire its own client-side redirect to `/signIn` in reaction to the same 401 — a genuine competing navigation on the same page/frame. Reproduced live: `tryRecoverSessionForPage`'s own `page.goto(returnUrl)` failed with `net::ERR_ABORTED; maybe frame was detached?` immediately after the injected 401, because the app's own concurrent redirect won the race. **Fixed** with a single bounded retry keyed on this exact signature (`ERR_ABORTED` specifically means "a different navigation pre-empted this one," not a real network failure) — by the second attempt, whatever competing navigation was in flight has settled.
  - **Verified, not assumed**: 3/3 clean reproduction runs after both fixes (fake-401 injected on attempt 1, real save succeeds on the retried attempt 2, original caller's `data` object confirmed uncorrupted by the aborted-then-retried fill). Also confirmed zero regression: a normal, non-expiring `leads.spec.ts` create test still passes clean, and `login.spec.ts` (the unregistered-page case) still passes 4/4.
- Annual Revenue field in `CompaniesPage` — commented out (prod bug)
- QA sessions expire after ~1 hour — run `rm -rf src/auth/storageStates/qa/` to force re-login
- Clone lead/contact creates a pre-filled form — must change email/phone to avoid duplicate validation errors
- `saveQuickTask()` waits for the task list view — use `saveQuickTaskFromEntityDetail()` when called from an entity detail page
- **Unexplained, unresolved app-level flake (Deals, investigated 2026-07-06 — no confirmed mechanism, do not trust any single theory below):** logging a Call on a deal shared with the restricted user intermittently fails with "Uhoh! You don't seem to have the necessary permission to perform this activity." even when the deal, its associated contact, and its associated company are all freshly and correctly shared (confirmed via screenshots showing every field, including Associated Contact, filled correctly and matching the live Associated Contacts card). Six controlled experiments were run in a single investigation session; every theory tested was disproven by a subsequent experiment:
  1. Sharing `call` alone (D21) or `quotation` alone (D22) — both pass reliably across repeated runs.
  2. Sharing `call`+`quotation` together, then immediately attempting Call — fails consistently, including in a brand-new Playwright session touching nothing else first.
  3. Theory "Meeting creation corrupts the restricted user's session" — disproven: a test sharing only `call`+`quotation`, never touching Meeting, reproduced the identical failure.
  4. Theory "it's deal/contact/company-specific propagation lag" — disproven: a completely fresh, separately-shared deal with its own fresh contact/company, in the same session, failed identically.
  5. Theory "it's about how many deal GET re-fetches happen before the Call attempt" — disproven: 4 plain re-navigations to the deal with no edit action still failed.
  6. One data point that doesn't fit any of the above: sharing ALL SIX permissions together (including call+quotation) and doing an Update (an actual edit+save, not just navigation) before attempting Call — succeeded.
  No consistent mechanism explains all six observations. This needs backend/network-level investigation (request/response inspection, server logs) that this client-side test suite has no access to — do not spend further time trying to isolate this from the Playwright side without that access.
- **ID-capture false-positive bug class — found in 3 places, fixed (2026-07-17):** `DealsPage.captureDealIdFromResponse()`, `CompaniesPage.captureCompanyIdFromResponse()`, and a third instance in `DealsPage`'s "add quotation from deal panel" flow all used a bare URL-substring match (`.includes('/deals')`, `.includes('companies')`, `.includes('/quotations')`) with no version prefix in their `waitForResponse()` predicate — each could match an unrelated background POST (confirmed live: `/v4/reports/deals`) that raced ahead of the real create/clone response and returned a body with no `id` field, silently capturing `null` and throwing a "save likely failed silently" error even though the save genuinely succeeded (confirmed via the app's own success toast showing the real ID at the exact moment of the false failure). Fixed all three by requiring the real, confirmed `/v1/<module>/` path + excluding `/reports/`. **If you add a new `captureXxxIdFromResponse()` anywhere, require the versioned path from the start — do not copy the old bare-substring shape.**
- **`DealsPage.cloneDeal()`'s Save-button click can silently produce zero effect — root-caused, fixed (2026-07-17).** Even after the ID-capture fix above, the clone test still failed intermittently. Direct request/response/console instrumentation confirmed: on failure, the Save click registers at the DOM level (no exception) but produces **zero network requests for 60+ seconds** — not a slow response, none at all — while the button stays visible/enabled/unchanged throughout. This rules out element detachment, a slow backend, and rate-limiting (all would leave *some* network trace). Most likely mechanism: the click landed only ~80ms after the modal became visible, while its own async pre-fill (contacts/company/products/campaign fields) was still committing — a React click-handler-not-yet-attached race. **Fix:** wait for `nameInput()` to actually contain "Copy" (confirms the modal's pre-fill has committed to the DOM) before clicking Save — a real readiness check, not a guessed delay. A first attempt (click-then-retry-if-no-request-seen) made things measurably worse (0/5, a new hang) and was reverted before landing on this fix. Verified 13/13 clean (8 isolated repro runs + 5 real test runs). **If a similar "click succeeds but nothing happens" symptom appears in another module's clone/save modal with substantial async pre-fill, check for this exact race before assuming it's something else.**
- **`QuotationsPage.ts` per-row DOM-read loop — confirmed real waste, fixed, cross-environment verified (2026-07-17).** Three methods (`retryFindInList()`, `assertQuotationNotInList()`, the create-quotation toast-fallback) looped through every `.rt-tr-group` row with an individual `.innerText()` call (one round-trip each) to find/check non-empty rows. Replaced with one batched `allTextContents()` call — identical result, 33.8×/31.1×/38.2× faster (QA/Staging/Prod respectively, best case; never slower in 9 total timing runs across all 3 environments). This is the same *shape* of bug as the date-picker fix documented in Reference Patterns — doing more round-trips than the result actually requires. **If you find a `for (let i = 0; i < count; i++) { locator.nth(i).innerText() }` pattern anywhere else, this is the fix — `allTextContents()`/`allInnerTexts()` returns the same data in one round-trip.**
- **Investigated and DISPROVEN — do not re-attempt without new evidence (2026-07-17):** profiling a 6.5h/272-test overnight run found 2.4 hours (37% of total runtime) in the gap after every "Creating authenticated browser context" fixture log line (100% of 351 instances ≥8.7s, mean 24.4s). Hypothesized `navigateAndConfirmLoggedIn()`'s `page.goto(config.appUrl, {waitUntil: 'domcontentloaded', timeout: 60000})` was an unnecessarily strict condition, redundant with the `Promise.race([waitForURL(/sales/), waitForURL(/signIn/)])` immediately after it. Tested live: isolated timing (3 runs each of `domcontentloaded`/`commit`/`load`) showed the whole goto+race sequence takes 3.8-5.2s regardless of `waitUntil` — nowhere near 22-25s, and `commit` was not measurably faster. **This is not a client-side bug** — the real cause is almost certainly genuine QA-environment load accumulating over a long, continuously-running suite (consistent with the "QA data grows unboundedly" pattern already documented, and with the host's own swap being 100% full during the same run). Do not touch `waitUntil`, the 60s timeout, or any retry count here without new, different evidence than what's already been tested and disproven.
- **CR13 title corrected (2026-07-17):** `tests/rbac/contacts.rbac.spec.ts`'s combined-permissions test previously claimed "Note Task Meeting Call Quotation permissions"/"all five" in its own title but only ever shared/verified 4 (Note, Task, Meeting, Call) — Quotation is genuinely inapplicable to Contacts' restricted-user view (see the CR11-removal note in the same file), not just an oversight. Title and internal comments now say "four," named explicitly.
  **Caveat added 2026-07-06:** all six experiments above were conducted *before* two subsequently-discovered client-side bugs were known — (a) a substring `hasText` contact-selection match that could silently pick the wrong, inaccessible "`<name>` Copy" clone contact, and (b) `DealsPage.fillDealForm()`'s associated contact/company pickers selecting an arbitrary existing entity (via `selectFirstOptionFromDropdown`) rather than a freshly-created, known-owned one. Either could have contaminated any of the six runs without being visible in the isolation experiments as designed. This makes the "session corruption" / "no consistent mechanism" conclusion **uncertain, not disproven with full confidence** — not a new investigation, just a downgrade of confidence in the existing one.
  **Resolution (2026-07-06):** the combined-six-permission test was split into D24a (Update/Note/Task/Meeting, one shared deal — passes reliably) and a since-deleted D24b (Call+Quotation shared together on one deal). D24b was removed rather than kept red or worked around, since every fix attempt above failed and a permanently-failing test is just noise. Individual coverage for both permissions still exists and passes reliably: see `admin shares deal Call permission restricted user sees Call Logs icon and can log call` and `admin shares deal Quotation permission restricted user sees Quotations icon and can create quotation` in `tests/rbac/deals.rbac.spec.ts`. What's *not* covered by any current test: Call and Quotation permissions granted to the same user in the same share action — that scenario is exactly what triggers this bug, and reintroducing a test for it should wait until someone with backend/network access has actually diagnosed the mechanism above.
- **`DealsPage.fillDealForm()`'s associated contact/company selection is random by design — know why before "fixing" it (2026-07-06):** `selectFirstOptionFromDropdown()` picks a **random** index from the unfiltered dropdown, not the first one. That randomization was itself a deliberate 2026-07-05 fix for a *different* problem (CI hangs/timeouts on this picker) — nobody connected it to the side effect of landing on an arbitrary pre-existing contact/company with unknown, uncontrolled ownership/share-state until the 2026-07-06 investigation above. For any **new** Deals test where the associated contact/company's ownership matters (sharing, reassigning, permission checks, or any contact-specific action) — pass the new `associatedContactName`/`associatedCompanyName` fields on `DealData` to select a freshly-created, known entity by exact-match name instead of relying on the random pick. Passing neither preserves the original random-index behavior unchanged (verified 2026-07-06 against `D30`/`D31`) — don't revert the randomization itself to "fix" a timeout without re-checking this trade-off first.
- **`deals.spec.ts:31` ("create a deal with all fields and verify part payments") flaked once in a full-suite run (2026-07-18) — investigated, accepted, not chased further.** Failed on attempt 1 with `selectRandomOptionWithRetry` exhausting all 3 bounded attempts on the Associated Company field (indices 11, 17, 19 of 25 total, each a genuine 15000ms `TimeoutError` — not a hang, the fix worked exactly as designed), then passed on Playwright's own outer retry (29.5s). Two things confirmed via the failure screenshot and 5× isolated re-runs: (1) the Company field is a **grouped** react-select (`CONTACT'S ASSOCIATED COMPANY` section + `OTHERS` section) — structurally different from the flat Associated Contact field that's never flaked, and a shape `selectRandomOptionWithRetry` wasn't specifically characterized against; (2) 5 isolated re-runs immediately after all passed clean with **zero retries**, but every one of them had only 11 total company options — the original failure's 25-option list (accumulated ~4 hours into the full-suite run) couldn't be reproduced in a fresh isolated run. Given the fix demonstrably worked as intended in both the real failure (bounded fail-fast, not an 8-minute hang) and 5/5 clean isolated reruns, and the option-count difference lines up with the already-documented "QA data grows unboundedly over a long run" pattern — **accepted as resolved, not investigated further.** If this specific test (or another grouped-dropdown field) flakes again, check whether it's still correlated with a large option count before assuming a new cause.
- **Random-option-pick dropdowns could hang for the full test timeout in 5 modules, not just Deals — generalized fix (2026-07-17):** `DealsPage.selectFirstOptionFromDropdown()`'s 2026-07-16 fix (bounded 15s retry on a stuck option click) covered one symptom but not the underlying bug class: 6 other call sites across `DealsPage.ts` (product row, associated contact), `TasksPage.ts`, `CallLogsPage.ts`, and `MeetingsPage.ts` picked a random react-select option via the exact same unbounded `textContent()`+`.click()` shape. Also found during the same overnight run: retrying the *same* index (the original 07-16 fix) is sometimes futile — one specific index can be persistently non-actionable while every other index in the same list works fine. Both fixed together via one shared `BasePage.selectRandomOptionWithRetry(options, description, opts?)`: 3 attempts, each bounding read+click to 15000ms, and each **re-rolling a fresh random index** rather than re-hitting the one that just failed. All 7 call sites now use it. **If you add a new "pick a random option from an open react-select menu" call site anywhere, use this shared method — do not write another inline unbounded read+click.**
- **`BasePage.fillSearchAndWaitForOptions()` — retries a react-select search on a transient DNS/network blip, nothing else (2026-07-17):** found in the same overnight run — Contact's Company-field lookup (`selectRandomFromSearchableReactSelect()`) failed a whole test attempt when its `/v1/companies/lookup` request hit `ERR_NAME_NOT_RESOLVED`, a brief DNS blip with zero application-logic cause. `TRANSIENT_NETWORK_ERROR_PATTERNS` is a deliberately narrow allowlist of connection-layer failures (DNS/connection reset/refused/timeout/unreachable) — explicitly excludes real HTTP 4xx/5xx (server did respond) and `ERR_ABORTED` (routine nav cancel). `fillSearchAndWaitForOptions()` arms a scoped `requestfailed` listener before filling the search input; if options don't appear **and** a transient error was actually observed on a backend request, it retries (clear, 1.5s wait, re-fill) up to 3 attempts — a non-transient failure (real 4xx/5xx, or genuinely zero results) throws immediately, no retry. **Do not widen the pattern allowlist without the same live-evidence bar** — a false inclusion would silently retry a real, non-transient failure. This was implemented but not written up here until 2026-07-18, during a session-continuity check that found the gap.
- **`quotations.rbac.spec.ts:380` ("restricted user should see entity chip on detail page of shared quotation") — 8-minute timeout, investigated, mechanism NOT confirmed, not fixed (2026-07-20).** Failed once in CI with a `TimeoutError` on the admin page's `.click()` filtering `'Add Quotation'`, ending in `Test timeout of 480000ms exceeded` / `browser has been closed` — traced to `QuotationsPage.ts:590` (`openCreateForm()`), reached via `adminQP.createQuotationWithOwner()` inside this test (T25), not the restricted user's own flow. Live-reproduced the exact production sequence (nav to quotations list → the same ~1000ms wait `waitForListReady()` uses → click) 5 times against real QA — **5/5 clean**, modal opened correctly every time, could not reproduce. One concrete, confirmed (not speculative) structural fact found along the way: `openCreateForm()`'s click is a raw `locator.click()` with no per-call timeout, and neither `playwright.config.ts` nor `QuotationsPage.ts` sets a global `actionTimeout` — so if this click's actionability check ever silently never resolves (the same failure *class*, though not confirmed the same *cause*, as the root-caused `DealsPage.cloneDeal()` React click-handler race above), there is nothing to fail it fast; it retries until the enclosing test's own `test.setTimeout(480000)` kills it. That explains *why* a stuck click here costs 8 minutes instead of a quick error — it does **not** explain *why* the click got stuck that one time. This raw-click-with-no-bound shape is not unique to this call site — it's the prevailing style throughout `QuotationsPage.ts` (dozens of other sites use the same unwrapped `locator.click()`), so it is **not** a safe one-line fix; rewriting all of them on unconfirmed evidence would be a guess-fix, not a root-cause fix. **Accepted as an unresolved, one-time flake — do not attempt a timing/wrapper fix without new evidence.** If it recurs, capture live console/network instrumentation at the moment of failure (the same method that actually root-caused the Deals clone race) rather than reproducing blind.
- **Session-expiry recovery mechanism (added 2026-07-20, see the mechanism's own comments in `authManager.ts`/`BasePage.ts`) does NOT cover raw `page.goto()` calls in test files — confirmed via a genuine live failure, pattern-class sweep done, fix NOT yet applied (2026-07-20).** `leads.rbac.spec.ts:97` ("admin shares lead Update permission restricted user sees edit button and only Clone in ellipsis") failed in a full-suite run with `expect(locator('#edit-action-btn')).toBeVisible()` timing out on the sign-in page. Root cause confirmed via log correlation: `[WARN] Session expiry detected for restricted — redirected to .../signIn` fired mid-test (the existing passive detector), immediately after `adminLeadsPage.shareLead(...)` and right before the test's own `await restrictedPage.goto(...)` at line 111 — a **raw `restrictedPage.goto()` call, not `BasePage.navigateTo()`**. This is the exact same gap already found and fixed once today in `quotations.rbac.spec.ts` (see the session-recovery mechanism's own history) — recovery only lives in `navigateTo()`/`click()`/`fill()`, and a raw `page.goto()` bypasses all three. Passed cleanly on Playwright's own retry (1.8m). **Exhaustive sweep done immediately (not deferred):** `grep -rn "restrictedPage\.goto(\|adminPage\.goto("  tests/` finds **29 raw-goto call sites across 7 files** — `leads.rbac.spec.ts` alone has 18 (the heaviest concentration), plus `deals.rbac.spec.ts` (2), `call-logs.rbac.spec.ts` (2), `quotations.rbac.spec.ts` (1 remaining — a **sibling test in the same file already touched today**, T25 at line ~393, was NOT covered by the earlier fix, which only touched the one failing test, T26 — direct confirmation that a scoped fix without a full sweep leaves siblings exposed), and 3 UI-only files (`deals.spec.ts`, `contacts.spec.ts`, `leads.spec.ts`) using `adminPage.goto()` (lower risk — admin sessions expire less predictably mid-test than restricted, but same gap in principle). **Fix deliberately NOT applied yet**: every one of these files is actively exercised by the full-suite run in progress when this was found — editing any of them mid-run risks version-mixing between what's on disk and what the running worker already loaded. This is next on the list the moment the current full run completes. Evidence preserved: `logs/evidence/leads-rbac-L11-session-expiry-raw-goto-20260720/` (trace.zip, 2 screenshots, error-context.md).
  **Second, distinct manifestation found ~20 minutes later in the same run (2026-07-20):** `leads.rbac.spec.ts:398` ("admin shares lead with Call permission and restricted user can log call from lead detail") failed with `Error: Lead ID not captured after save — cannot proceed (save likely failed silently)`. Log correlation: `[WARN] Session expiry detected for admin — redirected to .../signIn` fired **during** `adminLeadsPage.createLead()`'s save step — the `POST /v1/leads/` request itself came back `HTTP 400` (an expired-session rejection, not a validation error) and the pre-armed `page.waitForResponse()` ID-capture promise, which only matches a success-shaped response, then legitimately timed out at 60000ms. Passed cleanly on retry (1.5m). **This is a THIRD code path the recovery mechanism doesn't cover**, distinct from the raw-goto gap above: it's not a navigation at all — it's a `page.waitForResponse()` promise awaited after a `this.click()` call that (per its own recovery logic) succeeds because the click itself didn't land on sign-in *at the instant checked*; the actual redirect happened asynchronously afterward, while the response promise was still pending. This shows the coverage gap is broader than "raw goto" — **any awaited `page.waitForResponse()`/ID-capture promise sitting after a covered click is still exposed**, since `click()`'s recovery check is a one-time synchronous check right after the click resolves, not a guard around everything that happens afterward. Noted here as a related but architecturally distinct gap — do not fold this into the "just add navigateTo() to the raw-goto sites" fix without separately considering response-capture promises. Evidence: `logs/evidence/leads-rbac-call-permission-admin-session-expiry-20260720/`.
  **Third occurrence of the same symptom, ROOT CAUSE UNCONFIRMED this time (2026-07-20):** `call-logs.spec.ts:305` ("admin should verify owner field is visible and correctly populated on call log detail panel") failed with the identical `Error: Lead ID not captured after save`, and the log shows the identical shape (`HTTP 400 [POST] /v1/leads/` then `waitForResponse` 60000ms timeout) — **but this time `[WARN] Session expiry detected` did NOT fire.** Passed on retry (1.4m). Logging this as another instance of the same *symptom* (the `waitForResponse` ID-capture blind spot), but explicitly **not** claiming it's confirmed session-expiry — the passive listener's silence means either (a) it genuinely was expiry but the app's redirect didn't happen for this endpoint/error-code combination, evading the listener, or (b) this was an unrelated, real transient 400. Not enough evidence to pick one; don't assume either without more data. This strengthens the case for the already-planned fix (guard `waitForResponse` promises generically) rather than something narrower keyed only to the passive-listener signal.
- **`call-logs.spec.ts:391` ("admin should create deal call log, navigate to deal detail via entity link...") — NEW failure shape, genuinely uninvestigated further, one occurrence (2026-07-20).** `Error: Company: live search for "com" returned no options after 3 attempt(s)` — thrown by `BasePage.fillSearchAndWaitForOptions()` (the 2026-07-17 transient-network-retry helper). Critically, the error message has **no** `— last transient network error: ...` suffix, meaning `lastTransient` was null — per the method's own logic (`if (lastTransient && attempt < maxAttempts) continue`), a null `lastTransient` means it did **not** retry at all and broke after just 1 attempt, despite the message saying "after 3 attempt(s)" (the message hardcodes `maxAttempts` regardless of how many attempts actually ran — a minor cosmetic inaccuracy in the error text, not the real bug). The search term `'com'` (`ContactsPage.ts:591`, `selectRandomFromSearchableReactSelect(..., 'com', 'Company', ...)`) is a **hardcoded generic 3-char literal**, not derived from any specific company name — deliberately broad so it matches virtually any company in a healthy environment. This exact code path had already succeeded dozens of times earlier in this same run (every prior contact creation exercises it), so this is very likely a one-off environmental blip rather than a code defect — but unconfirmed. **Notable correlation, not yet a conclusion:** this failure landed within the same window the run's swap usage was actively climbing (390Mi→511Mi→683Mi across the checkpoints immediately before this failure) — worth checking if it recurs alongside further swap pressure, but one data point isn't enough to call this causal. Evidence preserved: `logs/evidence/call-logs-company-livesearch-noresults-20260720/`. Not fixed — needs either a recurrence or a live-reproduction session to settle, same bar as the quotations:380 precedent.
- **🔒 Real credential leakage into plaintext log files — confirmed AND FIXED, verified with real evidence (found + fixed 2026-07-20 during a routine secret-scan check of a full-suite run log).** `tests/ui/dashboard/login.spec.ts` (lines ~19-29) calls `loginPage.loginWithCredentials(config.users.admin.email, config.users.admin.password)` and the same for the restricted user — these are the **real** `QA_ADMIN_PASSWORD`/`QA_RESTRICTED_PASSWORD` values from `.env`. That flows into `LoginPage.enterPassword()` → `this.fill(this.passwordInput(), password, 'password field')` → generic `BasePage.fill()`, which unconditionally logs `logger.info(\`Filling ${description} with: ${value}\`)` **with no masking for sensitive fields** — so the real plaintext password for both accounts gets written to every log file produced by any run that includes `login.spec.ts` (every full-suite run, plus `npm run test:login`). Confirmed via grep against 5 historical log files in `logs/` (including the 2026-07-18 full-suite run) — **this is a long-standing, pre-existing gap, not something introduced today.** Mitigating factor: `logs/` is gitignored and was never committed, so exposure is confined to the local filesystem, not pushed anywhere. `authManager.ts`'s own `_doLogin()` (used by `globalSetup.ts` and mid-test recovery re-logins) was already safe — it fills the password via a raw locator call and never logs the value, so this leak was confined specifically to `login.spec.ts`'s direct `LoginPage.loginWithCredentials()` calls. A full grep of the entire codebase for every other place that could log a credential/token/session-id/cookie found nothing else — this was the only real leak.

**Fixed 2026-07-20** (once the full run completed, safe to touch `BasePage.fill()`): added `BasePage.SENSITIVE_FIELD_PATTERN` (`/password|passwd|pwd|secret|token|api[_-]?key/i`) and `isSensitiveFieldDescription()` — `fill()` now logs `[REDACTED]` instead of the real value whenever the caller's `description` matches. Deliberately description-based, not a DOM `type="password"` attribute check — a full grep confirmed `#input_password` is the only password-type locator anywhere in the codebase and its one call site (`LoginPage.enterPassword()`) already passes an accurate description, so a synchronous string check catches the real case with zero added latency across the many thousands of `fill()` calls in a full suite run; an async DOM check would cost that latency everywhere to protect against a scenario confirmed not to exist today. Deliberately did **not** mask email/username in the same fix — confirmed both `QA_ADMIN_EMAIL`/`QA_RESTRICTED_EMAIL` are `@mailinator.com` disposable test addresses (a public inbox service, not real PII), and this codebase already logs plenty of similarly-fake generated emails for every created test entity — masking only the login email would be inconsistent for near-zero security benefit and would cost real debuggability on login-flow failures.

**Verified with real evidence, not "should be masked now":** re-ran `login.spec.ts` after the fix (`logs/login-spec-mask-verify-20260720.log`) — grepped the resulting log for the real `QA_ADMIN_PASSWORD`/`QA_RESTRICTED_PASSWORD` values: **zero occurrences**. Confirmed `[REDACTED]` appears exactly where expected (3 hits — admin login, restricted login, and even the synthetic `'wrongpassword'` negative-test literal, which is also masked since the mask is keyed on the field being a password field, not on whether that specific value happens to look sensitive — the stricter, more consistent behavior the user asked for). All 4 `login.spec.ts` tests still pass; `tsc --noEmit` clean.

**Still open, not a code fix:** the 5 historical log files that already contain the real plaintext password (from before this fix) still exist on disk in `logs/` — gitignored, never committed, so exposure is local-filesystem only. Recommended precaution (not yet acted on): rotate the QA credentials, independent of this code fix.
- **`meetings.spec.ts:120` ("admin should reschedule a meeting") — one occurrence, backend 500s correlated with failure, uncertain/environmental (2026-07-20).** Failed with `Error: Validation errors found in meeting create form: ... Error messages: ErrorSomething went wrong.✕` right after three separate `HTTP 500 [GET] /v1/meetings/meeting-invitee/lookup` responses were logged during the same test (once mid-form-fill, twice more near Save). Passed cleanly on retry (50.8s). Classified the same tier as the share-modal timeout and company-live-search blip above — a real backend 500 correlating with a real user-facing "Something went wrong" toast is suggestive, but a single occurrence that self-resolved on retry isn't strong enough evidence to escalate to `APPLICATION_BUGS_FOUND.md` as a confirmed app bug (that bar requires independent live reproduction, per the ORB call-recording entry's precedent). Evidence preserved: `logs/evidence/meetings-reschedule-invitee-lookup-500-20260720/`. Watch for recurrence of `meeting-invitee/lookup` 500s correlating with an actual save failure (as opposed to the routine, harmless `/v1/ai-agent/workflows/subscribed` 500s seen constantly throughout this run with zero test impact) before escalating.
- **The full run's ONE genuine terminal failure — root cause confirmed (raw connection reset, not a code defect), cascade mechanism fully explained, uncertain/environmental (2026-07-20).** `quotations.spec.ts:247` ("admin should verify quotation status is Draft after create") failed on `HTTP 400 [POST] /v1/quotations/` — `Error: "Connection has been closed BEFORE response, while sending request body"`. This is a **raw TCP/HTTP connection reset mid-request**, not a locator/timing/validation issue — and the code's own handling is correct, not buggy: `QuotationsPage.saveQuotationHandlingInaccessibleEntities()` (`QuotationsPage.ts:853`) explicitly recognizes this is *not* the expected retryable 029003 "inaccessible entity" error and re-throws immediately rather than masking it behind retry logic — exactly the discipline this codebase's own top-10 rules call for. **Why this became a terminal failure instead of a normal flaky recovery (mechanism fully traced, not guessed):** `quotations.spec.ts` uses `test.describe.configure({ mode: 'serial' })`. On failure, Playwright's retry re-runs the **entire serial file from the start**, not just the failed test. `quotations.spec.ts:131` (an earlier test in the same file) had already passed cleanly in the first pass — but hit the **identical** "Connection has been closed" error during the retry pass, before the chain ever reached test 247 again. That made `:131` **flaky** (one pass + one fail across its two attempts — the 7th flaky test this run, not previously listed) and left `:247`'s own retry never executing at all (shown as "did not run" in the log), so `:247` has zero passing attempts anywhere → genuine terminal failure. The same serial-mode cascade also produced the run's "5 did not run" (the 5 tests positioned after `:247` in the file, skipped after its first-pass failure — `:270`, `:296`, `:320`, `:345`, `:370`). **Scope check:** `grep -c "Connection has been closed"` across the whole 4-hour, 272-test log = exactly 3 hits, all inside this same ~1-minute failure window — not a recurring pattern elsewhere in the run. **Classification: (C) uncertain/environmental** — a raw connection reset isn't fixable in test code (no retry logic would help a mid-flight TCP reset), and one isolated 60-second window in a 4-hour run doesn't meet the bar for escalating to `APPLICATION_BUGS_FOUND.md` as a confirmed backend defect. **Correlation worth noting, not concluding:** this window falls within the same general period the run's swap usage had been sitting at ~100% for several consecutive checkpoints (see the swap-tracking history from this same run) — plausible (resource-starved host degrading outbound socket handling) but unconfirmed; would need a repeat occurrence correlated with swap pressure specifically to treat as more than a hypothesis. Evidence preserved: `logs/evidence/quotations-status-draft-terminal-failure-20260720/` (the original failure) and `logs/evidence/quotations-field-values-retry-connection-closed-20260720/` (test `:131`'s retry failure that blocked `:247`'s own retry).

**Fixed 2026-07-20** — added a narrow, bounded retry in `QuotationsPage.saveQuotationHandlingInaccessibleEntities()` keyed on this EXACT confirmed message text (`TRANSIENT_CONNECTION_RESET_PATTERN = /Connection has been closed BEFORE response/i`), checked before the existing 029003 inaccessible-entity classification so it can never be confused with or consume one of that logic's 3 entity-removal attempts. Up to 2 retries, no backoff (the confirmed occurrences recovered on the very next attempt with zero delay — Playwright's own outer retry, which also has zero backoff, already proved this), and if the budget is exhausted while still hitting this exact signature, throws a clear, distinct error rather than falling through to the unrelated inaccessible-entity path or silently swallowing. **Deliberately narrow** — does not retry on any other error shape, matching the same "don't broaden without evidence" discipline as `TRANSIENT_NETWORK_ERROR_PATTERNS`/`fillSearchAndWaitForOptions()`. **Safe under `quotations.spec.ts`'s serial mode by construction**: this retry is entirely internal to one `save()` call inside one test's single attempt — it happens strictly before Playwright's own test/serial-file-level retry would ever be considered, and only reduces the chance of reaching that point; it does not intercept or alter Playwright's own retry mechanics. **Verified via deliberate reproduction** (not assumed): a temporary test (`tests/tmp-connection-reset-verify.spec.ts`, deleted after use) used `page.route()` to inject the exact confirmed error response on the first save attempt only, precisely matching the real method's own URL/method predicate (an earlier, broader route pattern accidentally intercepted the quotations list's own search POST instead of the save POST — caught and fixed before trusting the result, a reminder that a passing test doesn't confirm what it's actually testing without checking *which* request got intercepted). Ran 3/3 clean — each time the log showed the retry firing and the save succeeding on the second attempt. Separately verified the exhaustion path: injecting the error on every attempt (exceeding the 2-retry budget) correctly threw the new "still hitting a transient connection reset" error after exactly 2 retries, proving it fails loudly rather than hanging or swallowing.
- **Lead multi-select fields ("chip drop") — root-caused and fixed (2026-07-08):** `BasePage.selectRandomFromMultiValueReactSelect()` (the generic helper behind Lead's Multi Pick List custom field and Products or Services standard field) used to silently drop a previously-landed chip mid-sequence, first suspected as an app-level React race. Confirmed via `document.elementFromPoint()` instrumentation at the exact coordinate about to be clicked: the bug was in this codebase's own click targeting. The method's "reopen the menu" step clicked the control div itself, and Playwright's default click lands on the CENTER of an element's bounding box — as chips accumulate and wrap onto multiple lines, that center point can drift onto a previously-added chip's own remove icon instead of empty control space, silently un-selecting it instead of reopening the dropdown. **Fix:** the reopen click now targets the control's own `<input>` element (a distinct child node that never overlaps a chip's remove icon) instead of the control div. The very first open (before any chips exist) still clicks the control div, since react-select's empty-state placeholder text covers the input at that point and would intercept the click. Verified stable on both create (4 fresh-lead runs, up to 9/11 selected, zero drops) and edit (6 repeated clear-and-reselect cycles on one lead, up to 11/11 selected, zero drops) — no retry involved, no create/edit distinction needed. If this ever resurfaces, re-run the `document.elementFromPoint()` instrumentation before assuming the same fix still holds — this was verified against QA's live DOM structure as of 2026-07-08, not derived from source access.

## Module Status
(counts below verified fresh via `npx playwright test --project=chromium --list` on 2026-07-22 — 276 tests total across 17 files; see README.md's Project Overview table for the full per-module UI/RBAC breakdown)
- ✅ Leads (48 tests: 21 UI + 27 RBAC) — +4 vs. 2026-07-17 (L20/L21 UI, L30/L31 RBAC — the Company/Contact Lookup custom-field tests, see Known Issues)
- ✅ Companies (37 tests: 17 UI + 20 RBAC)
- ✅ Contacts (38 tests: 19 UI + 19 RBAC)
- ✅ Deals (39 tests: 17 UI + 22 RBAC)
- ✅ Meetings (16 tests: 8 UI + 8 RBAC)
- ✅ Tasks (22 tests: 11 UI + 11 RBAC)
- ✅ Quotations (29 tests: 15 UI + 14 RBAC)
- ✅ Call Logs (43 tests: 21 UI + 22 RBAC)
- ✅ Dashboard/Login (4 tests, UI only)

---

## AUDIT FINDINGS SUMMARY
_Full audit performed 2026-07-01 across all modules, core framework, and CI/CD. This is a compact reference — read this before touching any page object, fixture, or CI file to avoid re-introducing known root causes of flakiness._

### Top 10 rules that PREVENT the issues found
1. Every detail-page navigation must wait for the entity's GET API response (`waitForResponse(/\/v1\/<module>\/\d+$/)`), not just URL + `domcontentloaded`. Several modules skip this — it's the #1 flakiness source.
2. Every share/reassign/delete/save must capture a `waitForResponse` promise **before** clicking, and await it — never end a mutation with only `waitForTimeout`.
3. All search/find/retry logic must read from `config.searchRetry`/`config.meetingRetry` via the page object's `retryConfig` getter — never hardcode loop counts or sleep values.
4. Scope locators to their container (modal/card/row) and use `.first()` or `exact: true` on any text filter — never bare `getByText('Add'|'Save'|'Edit')` at page level.
5. Never use DOM-position (`nth(n)`) or CSS-in-JS hash classes (`.css-xxxxx`) as locators — prefer stable `id`/`name`/`data-*`/role+accessible-name.
6. Cross-role (admin+restricted) tests must assume propagation lag — poll/retry on 403, never a single fixed sleep "to prevent permission errors."
7. Negative/RBAC assertions must distinguish "correctly absent" from "failed to load" — never `if (visible) {assert} else {logger.success('...correct RBAC')}`.
8. Count-based assertions (notes, list rows) must capture a baseline **before** the mutating action and assert `baseline + N` — never assert an absolute count.
9. Give every `expect()`/thrown assertion a message with the entity id/name — bare `expect(x).toBeTruthy()` gives zero triage signal on a rotating-flake investigation.
10. Assume QA/staging data grows unboundedly (no module cleans up) — search/list operations get slower over the life of the environment; budget retries accordingly.

### Anti-patterns to NEVER do (each one is a confirmed root cause in this codebase)
- Raw `page.goto()` + `waitForURL()` + `waitForTimeout()` in a **test file**, bypassing the page object's own `waitForXDetailsPage()` — the single most repeated anti-pattern (15-18+ sites per RBAC file).
- Marking `waitForXDetailsPage()`/equivalent `private` — RBAC tests will reinvent a weaker inline version instead of importing the real one (happened in Contacts, Leads).
- `Promise.race([waitForResponse, elementVisible])` for list/detail readiness — a stale-but-visible container can win the race and satisfy the wait on old data.
- `.locator(...).filter({ hasText: X }).first().click()` to open a row when `X` may not literally be the row's rendered text (e.g. custom prefix vs. system-generated number) — verify identity **after** navigating, don't trust the click landed right.
- `click({ force: true })` to bypass actionability checks — masks a real overlay/blocking-element bug instead of surfacing it.
- Catch-and-log-success on any exception ("...expected behaviour") — converts a real failure into a silent pass.
- Trusting `playwright.config.ts`'s `workers: isCI ? 2 : ...` to mean "1 worker in CI" — it does not; verify actual config before reasoning about parallel safety.
- Trusting a `private static` in-memory cache (e.g. `AuthManager`) to synchronize across CI workers — each Playwright worker is a separate OS process; only file locks/atomic writes work cross-process.
- Writing directly to a shared file (`storageStates/<env>/<role>.json`, `misc-errors.json`) via plain `fs.writeFileSync` from code that can run in multiple workers — write-temp-then-rename or accept last-writer-wins data loss.
- Appending `|| true` to a CI test-run command — it reports green regardless of failures; the only signal left is a buried email attachment.

### CI/CD flow (as of audit; verify against live Jenkinsfiles/workflows before relying on this)
| Branch | Scope | Workers | Runner | Known issue |
|---|---|---|---|---|
| sandbox | selective via `detect-tests.sh`, fallback `@smoke` | dynamic | GitHub Actions | Jenkins capture (`\| tail -1`) differs from GHA capture — can select wrong scope |
| dev | `@smoke` (~18 tests) | 1 | GitHub Actions | — |
| qa | `@regression` (~222 tests) | 2 | GHA + Jenkins | — |
| stage | full suite, no grep (~234) | 2 | GHA + Jenkins | — |
| prod | `@prodSafe` only (~13 tests) | 2 | Jenkins (primary) | Deals module has **zero** `@prodSafe` tests |
| main | full suite, no grep (Jenkins primary) | 2 | Jenkins primary; `main.yml` (GHA, manual) wrongly filters `@regression` only | Two CI paths for `main` cover different scope |

Also confirmed: `Jenkinsfile` (main/prod), `Jenkinsfile.sandbox`, and (formerly) `staging.yml` append **`|| true`** — these pipelines go green regardless of test outcome. No scheduled/nightly runs exist anywhere. No cross-environment (QA/staging/prod) data-parity check exists.

**Renamed 2026-07-07 (reporting overhaul, P5):** `staging.yml` → `staging-promotion-gate.yml`. It was never actually "CI for the stage branch" (that's `stage.yml`, push-triggered on `stage`) — it's a manually-dispatched pipeline (`workflow_dispatch` only) that runs the full suite against `STAGING_*` secrets and then gates an approval-based auto-merge of `staging` into `prod`. The near-identical name to `stage.yml` was a standing source of confusion; the new name states what it actually does. It also previously had **no failure notification at all** despite gating a promotion to prod — fixed in the same change (see the file's own header comment for the full explanation).

### Module-specific known issues
| Module | Known issue |
|---|---|
| **Leads** | `waitForLeadDetailsPage()` has no GET-response wait (used by nearly every flow). `shareLead`/`reassignLead`/`convertLeadToAll` end in flat `waitForTimeout`, not a response wait. `assertOwnerOnDetail` uses unscoped `text=` instead of the already-defined (but unused) `detailOwner` locator. |
| **Contacts** | `waitForContactDetailsPage()` exists and is correct but is `private` — 18+ RBAC call sites bypass it with raw `goto`+2-3s sleep instead. `shareContact`/`reassignContact` same gap as Leads. |
| **Companies** | C13's "fix" (assert `lastName` instead of `firstName`) treats the symptom, not the cause — real bug is no wait for the Contacts card to refetch after re-navigation; assert **both** fields + wait for card refresh. CLAUDE.md's "Annual Revenue commented out" is **stale** — the field is active; only the detail-page assertion is skipped (currency formatting). |
| **Deals** | `pipelineControl()`/`sourceControl()` use `nth(2)`/`nth(3)` on generic `div`+text filters — brittle. `campaignControl()` locator chains through CSS-in-JS hash classes (`.css-2b097c-container`) that regenerate on any frontend rebuild — highest single locator risk in the codebase. `saveEditedDeal`/`addProductRow`/`addPartPayments` have no response-listener and no retry (unlike `saveDeal`, which does both correctly). |
| **Meetings** | `addButton()` is unscoped (`getByRole('button',{name:'Add'})` page-wide) and the open-form retry loop is hardcoded (3 attempts/15s) instead of using `config.meetingRetry` — root cause of the 600s Add-button timeout. Title field has two reactive re-check patches (after fill, after full form fill) but nothing right before the actual save click — medium/location/description fills after the second guard can still clear it. |
| **Tasks** | `waitForListReady()`'s `Promise.race` still lets a stale-but-visible list satisfy the wait — not yet fixed, same anti-pattern as documented above. **Corrected 2026-07-17** (this row was stale): `waitForTaskDetailsPage()` now exists and correctly waits for URL + `domcontentloaded` + the task GET response (canonical pattern); `openTaskInDetailPanel()` also already uses a properly-scoped `waitForResponse()` matching `/v1/tasks/\d+$`, not a flat `waitForTimeout(800)` — both fixed in a prior session but never documented here until now. `tests/rbac/leads.rbac.spec.ts` already correctly calls `saveQuickTaskFromEntityDetail()` from the lead-detail-panel context — the previously-documented footgun call site is already fixed too. |
| **Quotations** | `searchAndOpenQuotation()` filters list rows by custom-prefix summary/number, but rows render system-generated numbers (`QUO-00042`) — the filter can match the wrong row with no identity check after click (root cause of the "wrong quotation loaded" bug). `assertDetailPageFields()` only `logger.warn()`s on a title mismatch instead of throwing. T7 depends on a shared, non-isolated deal (`config.deals.adminDealName`) instead of creating its own. |
| **Call-logs** | No retry-on-403 exists anywhere despite a commit message claiming to add "permission propagation retry" (`grep -r propagat src/` returns zero hits). `searchAndSelectEntity`'s ADM/SHR-prefix filter silently falls back to **unfiltered** options when the filtered pool is empty — likely the real cause of "necessary permission" errors on Associated Deal/Contact sub-fields, not a timing race. `callLogsProductivityButton()` still targets `button[...] svg` (detach-prone on React re-render) even though test CL31c already found and fixed this inline — never backported to the shared locator. `assertOnCallLogsListPage()`/`waitForListReady()` cannot distinguish "empty list" from "slow" from "broken search API" (list-search API 404s on QA per existing code comment). |
| **Core framework** | `playwright.config.ts:12` hardcodes `workers: isCI ? 2 : ...` — **CLAUDE.md's "workers forced to 1 in CI" claim above is false**; Jenkinsfiles set `WORKERS=1` but it's never read for this. `AuthManager`'s `private static` caches only synchronize within one process, not across the real 2 CI workers — concurrent re-login races the shared `storageStates/<env>/<role>.json` file (non-atomic write). `ErrorCollector` writes `misc-errors.json` via plain `fs.writeFileSync` with no cross-process lock — 2 workers writing concurrently means last-writer-wins, silently dropping one worker's errors. `expect.timeout` is hardcoded to `20000` in CI, ignoring `config.timeouts.expect`. |

### Established wait/locator patterns per module (verify before assuming a module is "safe")
| Module | `waitForXDetailsPage` has GET-response wait? | Retry-find pattern | Primary locator risk |
|---|---|---|---|
| Leads | ❌ No | ✅ `retryFindLead` (searchRetry) | Unscoped `text=` for stage/owner |
| Contacts | ✅ Yes, but `private` (bypassed) | ✅ `retryFindContact` | Whole-body `toContainText` (weak, not field-scoped) |
| Companies | ✅ Yes, correct | ✅ `retryFindCompany` | Unscoped Add button; no-`.first()` pipeline text |
| Deals | ❌ No | ✅ `retryFindDeal` (asymmetric — no retry for the negative/not-in-list case) | `nth(2)`/`nth(3)` + CSS-hash locators (critical) |
| Meetings | ❌ No GET wait anywhere in module | ✅ `retryFindMeetingInList`, but other loops hardcode instead of using `config.meetingRetry` | Unscoped Add button (root cause), `getByText(...).last()` |
| Tasks | ✅ Yes, correct (corrected 2026-07-17 — this row previously said missing) | ✅ `retryFindTask` (searchRetry) | Mostly fine; some unscoped `.dropdown-menu` selectors; `waitForListReady()`'s `Promise.race` risk still present |
| Quotations | ⚠️ Partial — `goToQuotationDetail` correct, `searchAndOpenQuotation` has none | ⚠️ `retryFindInList` exists but is NOT used by `searchAndOpenQuotation` | `filter({hasText})` against mismatched row text (T22 root cause) |
| Call-logs | ❌ Abandoned (QA search API 404s) — DOM-only wait | ✅ `retryFindCallLog`, but search-only; no retry-on-permission | SVG-targeted button locator (detach-prone) |

---

## Reference Patterns

Canonical code patterns used across Leads, Contacts, Companies page objects and RBAC specs.  
Read this section instead of re-reading source files for these recurring shapes.

---

### 1. `waitForXDetailsPage()` — URL + domcontentloaded + API response

```typescript
private async waitForCompanyDetailsPage(): Promise<void> {
  await this.page.waitForURL(/sales\/companies\/details\//, { timeout: 20000 });
  await this.page.waitForLoadState('domcontentloaded');
  // WHY: Wait for GET API — ensures React has entityId in state before share/edit fires
  await this.page.waitForResponse(
    (res) => res.url().match(/\/v1\/companies\/\d+$/) !== null && res.request().method() === 'GET',
    { timeout: 15000 }
  ).catch(() => null);
}
```

Adapt URL regex and `/v1/<module>/\d+$` per module. The `.catch(() => null)` makes the wait non-fatal.

---

### 2. Ellipsis menu pattern

**Locators:**
```typescript
private readonly ellipsisButton = (): Locator =>
  this.page.locator('button.btn.dropdown-toggle.btn-down-arrow.btn-primary').first();

private readonly ellipsisMenuItem = (text: string): Locator =>
  this.page.locator('.dropdown-menu.show').locator('a.dropdown-item').filter({ hasText: text });
```

**Methods:**
```typescript
async openEllipsisMenu(): Promise<void> {
  await this.ellipsisButton().scrollIntoViewIfNeeded();
  await this.ellipsisButton().click();
  await this.page.waitForTimeout(500);
}

async clickEllipsisOption(optionText: string): Promise<void> {
  await this.openEllipsisMenu();
  const item = this.ellipsisMenuItem(optionText);
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
}

async assertEllipsisOptionNotVisible(optionText: string): Promise<void> {
  const item = this.ellipsisMenuItem(optionText);
  await expect(item).toBeHidden({ timeout: 3000 }).catch(async () => {
    const count = await item.count();
    expect(count).toBe(0);
  });
}
```

Note: Contacts edit button = `#edit-action` (no `-btn`), Leads/Companies = `#edit-action-btn`.

---

### 3. Share modal pattern (3-char search minimum, JS label click)

```typescript
async shareXxx(restrictedUserName: string, permissions: string[] = []): Promise<void> {
  await this.clickEllipsisOption('Share');
  await this.page.waitForTimeout(1000);
  // Open Share To type dropdown, select "User"
  const shareTypeControl = this.page.locator('.modal.show').locator('.is-invalid__control').first();
  await shareTypeControl.click();
  await this.page.locator('.is-invalid__option').filter({ hasText: 'User' }).first().click();
  await this.page.waitForTimeout(500);
  // WHY: Search requires ≥3 chars — find first eligible word, fallback to first 3 chars
  const words = restrictedUserName.trim().split(' ');
  const validWord = words.find((w) => w.length >= 3) ?? restrictedUserName.trim().substring(0, 3);
  await this.page.locator('[id="undefined_undefinedundefined_input_toId"]').fill(validWord);
  await this.page.waitForTimeout(800);
  await this.page.locator('.is-invalid__option').filter({ hasText: restrictedUserName }).first().click();
  await this.page.waitForTimeout(500);
  // WHY: JS click on label — CSS sibling selector unreliable in Playwright
  for (const permission of permissions) {
    const toggle = this.page.locator(`#inp_${permission}`);
    const isChecked = await toggle.isChecked().catch(() => false);
    if (!isChecked) {
      await this.page.evaluate((perm) => {
        const input = document.querySelector(`#inp_${perm}`) as HTMLElement;
        (input?.parentElement?.querySelector('label') as HTMLElement)?.click();
      }, permission);
      await this.page.waitForTimeout(300);
    }
  }
  await this.page.locator('.modal.show button.btn-primary.ml-auto').first().click();
  await this.page.waitForTimeout(1000);
}
```

**Reassign modal:**
```typescript
async reassignXxx(userName: string): Promise<void> {
  await this.clickEllipsisOption('Reassign');
  await this.page.waitForTimeout(500);
  const words = userName.trim().split(' ');
  const validWord = words.find((w) => w.length >= 3) ?? userName.trim().substring(0, 3);
  const reassignInput = this.page.locator('[id="undefined_undefinedundefined_input_entitySelection"]');
  await reassignInput.fill(validWord);
  await this.page.waitForTimeout(800);
  await this.page.locator('.is-invalid__option').filter({ hasText: userName }).first().click();
  await this.page.waitForTimeout(500);
  await this.page.locator('.modal.show button.btn-primary.ml-auto').first().click();
  await this.page.waitForTimeout(1000);
}
```

**Share permission keys:** `update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`

---

### 4. Clone pattern (duplicate-avoidance, ID capture before save)

```typescript
async cloneXxx(): Promise<number | null> {
  await this.clickEllipsisOption('Clone');
  await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
  await this.page.waitForTimeout(1000);
  // Read original value before other fills (used for safety refill)
  const originalName = await this.nameInput().inputValue().catch(() => '');
  // Change email to avoid duplicate error
  if (await this.emailInput().isVisible().catch(() => false)) {
    await this.emailInput().fill(`clone${Date.now()}@testkylas.com`);
  }
  // Change phone — Indian format: starts 6/7/8/9, 10 digits total
  if (await this.phoneInput().isVisible().catch(() => false)) {
    const newPhone = faker.helpers.arrayElement(['6','7','8','9']) + faker.string.numeric(9);
    await this.phoneInput().clear();
    await this.phoneInput().fill(newPhone);
  }
  // Safety: contacts check lastName, companies check name — refill if cleared
  const nameValue = await this.nameInput().inputValue().catch(() => '');
  if (!nameValue) await this.nameInput().fill(`${originalName || 'Entity'} Copy`);
  // WHY: Set up ID capture BEFORE save — response may arrive during click
  const idPromise = this.captureXxxIdFromResponse();
  await this.click(this.saveButton(), 'save cloned entity');
  await this.assertNoFormErrors('clone form');
  const id = await idPromise;
  await this.page.waitForTimeout(1500); // stays on original detail page
  return id;
}
```

For contacts clone: check `lastNameInput` value instead of `nameInput`.

---

### 5. Right panel icon pattern (SVG ID map + dual-selector locator)

```typescript
// WHY: SVG gradient IDs differ per icon — more reliable than title attribute alone
private readonly rightPanelIconSvgMap: Record<string, string> = {
  'Notes':      'paint0_linear_972_2654',
  'Tasks':      'clip-Ic_Task',
  'Meetings':   'clip-Ic_Meetings',
  'Call Logs':  'paint1_linear_contacts',   // Contacts only — Leads: 'paint1_linear_leads'
  'Quotations': 'Quotation_Icon-16px_New',
  // Companies: omit 'Call Logs' — not available on company detail
};

private readonly rightPanelIcon = (title: string): Locator => {
  const svgId = this.rightPanelIconSvgMap[title];
  if (svgId) {
    return this.page
      .locator(`button.btn.btn-transparent:has(svg #${svgId}), button.btn.btn-transparent[title="${title}"]`)
      .first();
  }
  return this.page.locator(`button.btn.btn-transparent[title="${title}"]`);
};
```

---

### 6. Note add/delete with baseline-relative count assertion (L28/CR17 pattern)

**CRITICAL** — always capture baseline BEFORE adding notes; never hardcode counts.

```typescript
// In the test (or inline in a page method):
// 1. Open Notes panel
await restrictedPage
  .locator('button.btn.btn-transparent:has(svg #paint0_linear_972_2654)')
  .first().click();
await restrictedPage.waitForTimeout(500);

// 2. Capture baseline BEFORE adding anything
const baselineCount = await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count();

// 3. Add first note (to keep)
await restrictedPage.locator('textarea.notes-textarea').click();
await restrictedPage.waitForTimeout(1000);
await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to keep');
await restrictedPage.waitForTimeout(500);
await restrictedPage.getByText('Add', { exact: true }).click();
await restrictedPage.waitForTimeout(1500);

// 4. Add second note (to delete)
await restrictedPage.locator('textarea.notes-textarea').click();
await restrictedPage.waitForTimeout(1000);
await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to delete');
await restrictedPage.waitForTimeout(500);
await restrictedPage.getByText('Add', { exact: true }).click();
await restrictedPage.waitForTimeout(1500);

// 5. Assert +2 relative to baseline
expect(await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count()).toBe(baselineCount + 2);

// 6. Delete newest note (notes are newest-first)
const lastNoteEllipsis = restrictedPage.locator('div.row.pt-2.pl-2.pr-2')
  .first().locator('button[data-toggle="dropdown"]');
await lastNoteEllipsis.click();
await restrictedPage.waitForTimeout(300);
await restrictedPage.locator('.dropdown-menu.show .dropdown-item').filter({ hasText: 'Delete' }).click();
await restrictedPage.waitForTimeout(500);
await restrictedPage.locator('button#confirm.btn-danger').waitFor({ state: 'visible', timeout: 5000 });
await restrictedPage.locator('button#confirm.btn-danger').click();
await restrictedPage.waitForTimeout(1500);

// 7. Assert +1 relative to baseline
expect(await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count()).toBe(baselineCount + 1);

// 8. Verify note text via CKEditor iframes (skip active editor)
const checkNoteText = async (text: string): Promise<boolean> =>
  restrictedPage.evaluate((t) => {
    for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
      if (iframe.title?.includes('Rich Text Editor')) continue;
      try { if (iframe.contentDocument?.body?.innerText?.includes(t)) return true; } catch {}
    }
    return false;
  }, text);
expect(await checkNoteText('Note to delete')).toBe(false);
expect(await checkNoteText('Note to keep')).toBe(true);
```

---

### 7. Add deal from modal (pipeline selection + product row + part payments + response listener)

```typescript
// WHY: Pipeline locator — nth(2) targets the visible React Select inside the deal modal
const pipelineControl = this.page.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
await pipelineControl.click();
await this.page.getByText('Default Deal Pipeline', { exact: true })
  .waitFor({ state: 'visible', timeout: 10000 });
await this.page.getByText('Default Deal Pipeline', { exact: true }).click();

// Add product row (DealsPage helper)
await dealsPage.addProductRow();

// Add 2 part payment installments
await dealsPage.addPartPayments(2);

// WHY: ALWAYS set up response listener BEFORE clicking save
const dealIdPromise = this.page.waitForResponse(
  (res) =>
    (res.url().includes('/deals') || res.url().includes('/deal')) &&
    res.request().method() === 'POST' &&
    (res.status() === 200 || res.status() === 201),
  { timeout: 30000 }
).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
}).catch(() => null);

await this.page.locator('#editEntityModal button.save-button').click();
await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
const dealId = await dealIdPromise;
```

Without product, fill estimated value as fallback:
```typescript
const estimatedValueInput = this.page.locator('[id="1_21_input_estimatedValue"]');
if (await estimatedValueInput.isVisible().catch(() => false)) {
  await estimatedValueInput.fill('50000');
}
```

---

### 8. Add contact from modal — exact field IDs (captured from live DOM)

When adding a contact from a company or lead detail page modal:

```typescript
// Modal title check
await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 });

// WHY: These IDs are from the company/lead "Add Contact" modal — not the standalone contact form
await this.page.locator('[id="0_12_input_firstName"]').fill(contactData.firstName);
await this.page.locator('[id="0_13_input_lastName"]').fill(contactData.lastName);

// Email — click Add Email button first (scoped to modal to avoid page-level ambiguity)
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Email' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_11_input_email_0"]').fill(contactData.email);

// Phone — same pattern
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Phone' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_12_input_phone_0"]').fill(contactData.phone);

// WHY: Set up response listener BEFORE save
const contactIdPromise = this.page.waitForResponse(
  (res) => res.url().includes('/v1/contacts') && res.request().method() === 'POST' &&
    (res.status() === 200 || res.status() === 201),
  { timeout: 30000 }
).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.id ?? body?.data?.id ?? null;
}).catch(() => null);

await this.page.locator('#editEntityModal button.save-button').click();
await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
const contactId = await contactIdPromise;
```

**Standalone contact create form IDs differ:** `input[name="firstName"]`, `input[name="emails[0].value"]`  
**Edit mode email/phone IDs:** `[id="1_11_input_email_0"]`, `[id="1_12_input_phone_0"]`

---

### 9. Custom Fields pattern (generic helpers + per-module constants + environment safety)

Built 2026-07-08 for Lead's 9 custom fields (Text, Paragraph, Number, PickList, MultiPickList,
Checkbox, Date, DateTimePicker, URL). **Read this before adding custom-field support to any other
module (Contacts/Companies/Deals/Meetings/Tasks) — reuse the BasePage methods, don't re-implement
them.**

**Extended 2026-07-21/22** with 2 more field types — Company Lookup / Contact Lookup
(`cfCompanyLookup`/`cfContactLookup`, live server-side RBAC-scoped searches, NOT a static
picklist) — see the Known Issues entry above for the full L20/L21/L30/L31 story and the
9 bugs found while building them. `BasePage.selectLookupCustomField()` deliberately does
NOT delegate to `selectRandomFromSearchableReactSelect()` — that method types `exactValue`
as the search term, which breaks for Contact Lookup where the search token (first name)
differs from the option's full display text (first + last name).

**Where things live, and why:**

| Piece | Lives in | Why |
|---|---|---|
| Fill/select/assert methods for each of the 9 field *types* | `BasePage.ts` (generic, reusable) | Parameterized by a raw Kylas field-name **string** (e.g. `"TextField"`), not by any typed constant — so every module can call the exact same methods unchanged. |
| Detail-page date/date-time display formatters | `BasePage.ts`, `protected` (`formatCustomFieldDetailDate`, `formatCustomFieldDetailDateTime`) | The rendered format (`"Jul 13, 2026"` / `"Jul 13, 2026 at 10:30 am"`) is a **Kylas-platform convention**, not Lead-specific — confirmed live. `protected` (not `private`) so subclasses can call them directly. |
| The exact field **names** for one module (e.g. `LEAD_CUSTOM_FIELD_NAMES`) | that module's own factory (e.g. `leadFactory.ts`) | Each module defines and owns its own `<MODULE>_CUSTOM_FIELD_NAMES` constant — **mirror this pattern per module, never import one module's constant into another's.** Each entity gets these fields added independently and by hand; a shared constant would create false coupling and collision risk the moment two modules' field sets diverge (different names, or one module getting a field type the other doesn't have yet). |
| The `LeadCustomFieldData` interface + `generateLeadCustomFieldData()` | `leadFactory.ts` | Same reasoning — module-owned data shape, not shared. |
| The actual fill/verify call sites | `LeadsPage.fillLeadCustomFields()` (private) + `LeadsPage.assertLeadCustomFieldsOnDetail()` (public) | Each module gets its own thin `fill<Entity>CustomFields()` / `assert<Entity>CustomFieldsOnDetail()` wrapper that calls the generic BasePage methods with its own `<MODULE>_CUSTOM_FIELD_NAMES` constant. |

**The environment-safety contract (non-negotiable for every new fill method):**

Custom fields get added to one entity, on one environment, by hand — QA today, Stage/Prod later,
often weeks apart, with identical names once added. Every BasePage custom-field method therefore:
1. Checks DOM presence first (`isCustomFieldPresent()` — an `input[id$=...], textarea[id$=...]`
   suffix match, count > 0).
2. If absent: logs a clear `logger.info(...)` line naming the field and stating **why** it's being
   skipped (so CI output is self-explanatory without reading source), then returns — **never
   throws**.
3. If present: fills/selects/asserts normally.

This means the exact same call site (e.g. `fillLeadCustomFields()`, wired into both
`fillLeadForm()` and `fillEditForm()`) starts working the moment the fields exist in a new
environment — **zero code changes required**. Do not add a "does this environment have custom
fields" branch anywhere else; the presence check inside each BasePage method is the only gate.

**Locator strategy — match by suffix, not the numeric prefix:**

Kylas's live custom-field ids look like `7_11_input_customFieldValues.cfTextField`. The numeric
prefix (`7_11`) was confirmed live (2026-07-08, three independent passes: fresh create-form, the
same form after a full reload, and an edit-form on an existing record) to be a static per-render
wrapper index — identical across all three. `customFieldInputLocator()` still matches on the
**suffix** (`_input_customFieldValues.cf<Name>`) rather than the full id, scoped to
`input[id$=...], textarea[id$=...]` — this is strictly safer at zero extra cost (the numeric
prefix could in principle change; the suffix cannot) and, critically, **avoids a real collision**:
react-dates renders an accessibility `<p id="DateInput__screen-reader-message-<the real input's
id>">` next to every Date/DateTimePicker field, which — being built by prefixing the real input's
own id — *also* ends with the same suffix and breaks an unscoped `[id$=...]` match. Confirmed live
the hard way; don't drop the tag-name scoping when reusing this pattern.

**DateTimePicker is two independent widgets, not one:** a `SingleDatePicker` (react-dates, same
widget as the plain `Date` field and `QuotationsPage.selectDateInPicker()`) for the date half, plus
a **separate** `rc-time-picker` (same widget already handled in `MeetingsPage.fillTimePicker()` /
`CallLogsPage`) for time — the time input starts `disabled` and only becomes enabled once a date is
picked. Don't assume a "DateTimePicker"-named field uses one combined widget just because the name
suggests it; confirm live per field.

**Validation mechanisms differ per field — don't assume one applies to all:**
- Some fields validate client-side, inline, on blur (`.invalid-feedback`/`.help-text.error`) —
  confirmed for `TextField` (max length) and `UrlField` (malformed URL).
- Some fields have **no client-side check at all** and are only rejected server-side on Save, via a
  **generic** toast that never names the field (`assertFormErrorToast()`) — confirmed for
  `ParagraphText` (its length limit exists only in the raw API error response, never in the UI).
- Some fields (e.g. a native `<input type="number">`) make an invalid value **impossible to enter
  via the UI at all** — Playwright's `fill()` itself throws on non-numeric text, and a real browser
  blocks the keystrokes too. Don't manufacture a fake negative-test scenario for these; skip them
  explicitly with a comment saying why (see `leadFactory.ts`'s `generateLeadCustomFieldInvalidUrl`
  region for the precedent).

**Reference implementation to copy from:** `src/modules/leads/LeadsPage.ts`
(`fillLeadCustomFields()`, `assertLeadCustomFieldsOnDetail()`, the `showRequiredToggle`/
`openOtherDetailsFormSection()` visibility-gating pair) + `src/data/factories/leadFactory.ts`
(`LEAD_CUSTOM_FIELD_NAMES`, `LeadCustomFieldData`, `generateLeadCustomFieldData()`) +
`src/core/BasePage.ts`'s "Custom Field Helpers" section. When Contacts/Companies/Deals get their
own custom fields, start by reading these three files, not by re-deriving the pattern from scratch.

**One toggle gotcha worth knowing before you copy `openOtherDetailsFormSection()`-style
visibility-gating elsewhere:** the "Show Required & Important Fields" toggle's on/off state is
**not** re-initialized per form open — it persists across sessions (server/localStorage-backed).
`disableRequiredFieldsToggle()` used to click it unconditionally whenever visible; fixed to check
`showRequiredToggleCheckbox().isChecked()` first, because a blind click on an *already-off* toggle
flips it back **on**, hiding the very section you're trying to reach. If another module's
equivalent toggle has the same persistence behavior, apply the same idempotency check.

---

### 10. Custom field Internal Name vs Label — renaming a field's display label is always safe

Confirmed live (2026-07-08) by inspecting the actual field edit dialog at
`/setup/fields/leads/list` (Settings → Customizations → Form Fields → Lead) — not inferred from the
API response alone. Kylas custom fields have **two separate identifiers**:

- **Label** — the user-facing display name (e.g. "Text Field"). Editable anytime by an admin.
- **Internal Name** — e.g. `cfTextField`. Set once at field creation and **architecturally
  impossible to change afterward**: the field's own Edit dialog exposes only a "Display Name"
  input (plus Description, Is Filterable, Is Sortable) — there is no "Internal Name" field
  present anywhere in that form, not merely disabled.

All Lead custom-field locators in this codebase (`customFieldInputLocator()` in `BasePage.ts`, the
`LEAD_CUSTOM_FIELD_NAMES` constants in `leadFactory.ts`) are built on the **Internal Name**, and so
is the app's own API — `customFieldValues` in a lead's GET response is keyed by `cf<Name>`
(confirmed via the raw API response, e.g. `customFieldValues.cfTextField`), not by the label. This
means **renaming a custom field's display label in the app is always safe and requires zero code
changes** on this side.

**One real exception, not a rename:** if a field is *deleted and recreated* with a different
internal name, that would break every locator built on the old name — but that's a field
re-creation, not a rename, and a separate, much rarer risk. Worth remembering if a field's
"identity" (not just its label) ever genuinely changes.
