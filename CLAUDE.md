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
- **Lead multi-select fields ("chip drop") — root-caused and fixed (2026-07-08):** `BasePage.selectRandomFromMultiValueReactSelect()` (the generic helper behind Lead's Multi Pick List custom field and Products or Services standard field) used to silently drop a previously-landed chip mid-sequence, first suspected as an app-level React race. Confirmed via `document.elementFromPoint()` instrumentation at the exact coordinate about to be clicked: the bug was in this codebase's own click targeting. The method's "reopen the menu" step clicked the control div itself, and Playwright's default click lands on the CENTER of an element's bounding box — as chips accumulate and wrap onto multiple lines, that center point can drift onto a previously-added chip's own remove icon instead of empty control space, silently un-selecting it instead of reopening the dropdown. **Fix:** the reopen click now targets the control's own `<input>` element (a distinct child node that never overlaps a chip's remove icon) instead of the control div. The very first open (before any chips exist) still clicks the control div, since react-select's empty-state placeholder text covers the input at that point and would intercept the click. Verified stable on both create (4 fresh-lead runs, up to 9/11 selected, zero drops) and edit (6 repeated clear-and-reselect cycles on one lead, up to 11/11 selected, zero drops) — no retry involved, no create/edit distinction needed. If this ever resurfaces, re-run the `document.elementFromPoint()` instrumentation before assuming the same fix still holds — this was verified against QA's live DOM structure as of 2026-07-08, not derived from source access.

## Module Status
(counts below verified fresh via `npx playwright test --project=chromium --list` on 2026-07-17 — 272 tests total across 17 files; see README.md's Project Overview table for the full per-module UI/RBAC breakdown)
- ✅ Leads (44 tests: 19 UI + 25 RBAC)
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
