# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
End-to-end automation framework for Kylas Sales CRM using Playwright + TypeScript.

## Standing Engineering Checklist — Apply to Every Change

A permanent, always-apply checklist distilled from real issues found and fixed across multiple sessions in this codebase — not a one-off task note. Apply this to ANY new code, fix, or change, every time, no exceptions.

1. **Reuse before building.** Before writing any new interaction/assertion logic, check whether an existing BasePage helper or Lead/Contact pattern already does this. This codebase has repeatedly duplicated the same logic across modules instead of sharing it — don't add another instance of that anti-pattern. If something genuinely needs new logic, build it once, generically, in BasePage — not copy-pasted per module.
2. **No unbounded clicks/actions.** Never write a raw `.click()`/`.fill()`/`.waitFor()` with no timeout and no retry. This exact "click registers but nothing visibly happens" React-timing race has already been found and fixed in Companies, Deals, Contacts, Quotations, and the Share-modal flow across 4 modules. Any new interaction must be bounded (a real timeout) and either retry-capable or fail loudly and fast — never hang silently for the full test timeout.
3. **Session-expiry protection is mandatory.** Any new raw Playwright assertion (`expect().toBeVisible/toHaveText/toHaveURL`, etc.) written directly in a module file — not already wrapped by an existing BasePage helper — must be wrapped in `withSessionExpiryRecovery()`. This codebase has had this exact gap recur repeatedly (5+ times across different sessions) specifically because new code forgets this. Check this every single time, not just when told to.
4. **No hardcoded dropdown options, ever.** Any picklist/multi-picklist/dropdown must read its real options live from the DOM at runtime. Never hardcode an option string, index, or assumed count — option lists can and do grow/shrink over time and differ across environments.
5. **Test data must be genuinely fresh, never randomly reused.** Any test needing an isolated/controlled entity (for RBAC checks, permission boundaries, or anything where "this specific record has zero prior access/history" matters) must create that record fresh in the test itself — never rely on a randomly-selected pre-existing record. This exact mistake produced a false conclusion once already this session (the CR9 test-isolation bug).
6. **Locators must be built on internal names, never display labels.** Custom field display labels can be renamed by account admins; internal field names cannot change. Any new locator must key off the internal name (confirmed via the field's settings screen), never the on-screen text.
7. **Check field/feature presence before assuming it exists everywhere.** Anything environment-conditional (a custom field, a config value, a feature flag) must be presence-checked and gracefully skipped (with a clear log line) if absent — never assumed to exist identically across qa/stage/prod. Environments diverge, and this codebase has already been burned by assuming otherwise (e.g. an "environment scoping" conclusion from one investigation silently going stale once data changed).
8. **Don't trust a single passing run.** Before calling anything "fixed" or "verified," re-run the specific test 3-5 times in isolation, zero flakiness accepted. A test passing once proves nothing on its own in this codebase's history.
9. **Ripple-check any shared code change.** Before modifying any method used by more than one caller (BasePage helpers, `fillXForm()`/`fillEditForm()`, any shared factory function), grep every consumer and confirm the change is purely additive / doesn't alter behavior for callers that don't care about the new thing. Treat shared code as high blast radius by default.
10. **Never patch a symptom without a confirmed root cause.** If a bug can be reproduced, root-cause it with real evidence before fixing. If it CANNOT be reproduced, don't just document and walk away — do a thorough code review to find plausible failure modes and apply a defensive hardening fix, clearly labeled as "hardened based on review, root cause of this specific occurrence not confirmed" rather than overstated as a proven fix.
11. **No silent scope expansion or silent scope-narrowing.** If you find an unrelated bug while working, STOP and report it — don't fix it silently (scope creep) and don't ignore it silently either (leaving a known issue undocumented). Flag it, let the human decide whether it's in-scope now or a tracked follow-up.
12. **Check real, live evidence over assumption — always.** Whether it's a DOM structure, a field's presence, an app's actual behavior, or whether a previous conclusion still holds — verify live/fresh rather than trusting an old investigation's conclusion or your own inference, especially if any real-world data (test data volume, environment config, account settings) could plausibly have changed since.
13. **No commits, no pushes, ever, without explicit permission.** All git operations beyond creating a branch are performed by the user only.
14. **Document with real evidence, not narrative.** Any CLAUDE.md/README.md update must include concrete evidence (exact error text, real IDs, actual pass counts, timestamps) — not a prose summary alone. Future readers (including future sessions) need to be able to verify the claim, not just trust it.
15. **ID-capture from a network response must match a versioned, specific path — never a bare substring.** Found and fixed in 3 places (`DealsPage`/`CompaniesPage`/a Deals-to-Quotation flow) where `captureXxxIdFromResponse()` matched `.includes('/deals')`/`.includes('companies')` with no version prefix, occasionally matching an unrelated background request (e.g. `/v4/reports/deals`) that raced ahead with no `id` field — silently capturing `null` and throwing a false "save failed silently" error despite a real success toast. Any new response-capture predicate must require the real versioned path (`/v1/<module>/`) and explicitly exclude `/reports/`.
16. **Session expiry has more than one symptom — protect against all of them, not just a signIn-URL redirect.** Confirmed manifestations in this codebase: a `/signIn` redirect (the common case), a distinct "Forbidden" bootstrap-time page with the URL left unchanged (a fresh-load auth-check path, different from mid-session expiry), and a `waitForResponse()`/ID-capture promise sitting after an already-covered click that can still silently time out — the click's own recovery check only covers the instant right after the click resolves, not everything awaited afterward. Being "downstream of a protected click" is not sufficient; any new awaited network-response promise needs its own explicit protection, and any new page-state check should use the shared `isSessionExpiryPage()`-style check, not a bare URL match.
17. **A locator that is unique today can become ambiguous the moment a sibling field/button is added elsewhere in the DOM — this has happened at least twice.** Confirmed twice: a Company Phones field collision from an `[id*="..."]` substring match, and (this session) Deal's estimated-closure-date field breaking the instant Deal gained its own custom Date/DateTimePicker fields, since all three shared the same `getByPlaceholder('Pick a Date')` match. Prefer the narrowest reliable scope (a stable id suffix plus tag-name scoping, or a container-scoped locator) over a broad substring/placeholder/text match, and treat "currently unique" as temporary, not permanent — especially for any field whose sibling fields could grow later (custom fields are the clearest recurring example).
18. **A bug class fixed in one place is not fixed everywhere — sweep the whole codebase for the same shape, and explicitly document any instance you deliberately leave unfixed.** The unbounded-click race (point 2) has been found and fixed in Companies/Deals/Contacts/Quotations/the Share-modal flow at different times, but a grep still confirms the identical shape exists, unfixed, in `QuotationsPage.fillOwner()` and parts of `LeadsPage.ts` — each explicitly flagged in README's Known Limitations rather than silently left to be rediscovered later. When you fix a bug class, grep for every other instance of the same shape in the same pass; anything you deliberately leave unfixed must be named explicitly, not left implicit.
19. **Retry budgets and timeouts must be sized per real observed latency for that specific environment — never copied uniformly across qa/staging/prod, and a retry-exhaustion fallback must never silently guess.** `CallLogsPage.searchAndSelectEntity()`'s staging retry budget (3×5s) is thinner than qa's (5×3s)/prod's (5×5s), and a real run needed its full budget to recover from genuine search-index propagation lag; its exhaustion path also falls through to silently clicking the first option, which can pick the wrong entity instead of failing loudly. Size retry budgets from real measured latency per environment, and make any retry-exhaustion fallback fail loudly rather than silently guess.
20. **Environment-scoping conclusions decay over time — a "qa/prod-only" or "small dataset" finding must be re-verified, not assumed permanent.** QA/staging data grows unboundedly (no module cleans up what it creates) — an earlier investigation concluded a bug was "qa/prod-specific, stage's option list is too small to trigger it," and that exact premise silently went stale once stage's data grew to the same scale weeks later. Any conclusion grounded in today's data volume/option count/list size is a snapshot, not a permanent fact — re-confirm it live before relying on it again, especially across a gap of days or weeks.
21. **A single isolated, unloaded local repro run is not proof a flake doesn't exist — some bugs only manifest under real concurrent CI load.** Multiple flakes in this codebase's history reproduced 0/N times in single-worker local isolation but were confirmed real via CI's own logs/evidence (a genuine RBAC permission race in Meetings, a `tasks.rbac.spec.ts` edit-modal hang, a Deals edit-save transient error). In each case the correct response was defensive hardening based on code review (clearly labeled as such, per point 10) or accepting it as a genuinely uncertain, load-dependent flake — never dismissing it as "couldn't reproduce, so not real."
22. **Never log a field's raw value without checking whether it's sensitive.** A generic `BasePage.fill()` used to log every filled value verbatim, including the real QA admin/restricted passwords, into every log file produced by any run touching `login.spec.ts` — a real, confirmed plaintext-credential leak across multiple historical log files (mitigated only by `logs/` being gitignored). Any new logging of a filled/typed value must check the field's purpose (a description/name pattern like `password|token|secret|api[_-]?key`) and redact — never assume a DOM attribute like `type="password"` will always be present to key off instead.
23. **This repo's CI has genuinely divergent scope and safety nets per branch — verify which pipeline actually protects a given change before trusting "CI is green."** `main` has two CI paths covering different scope (the primary Jenkins pipeline runs the full suite; the GHA `main.yml` manual fallback filters to `@regression` only); `sandbox`'s GHA path uses a dynamic 1–2 worker count that its Jenkins fallback doesn't match; `stage.yml` (ordinary push CI) and `staging-promotion-gate.yml` (manual-only, auto-merges to prod on success) are easily confused by name; and multiple Jenkins pipelines have appended `|| true` at various points, which reports green regardless of actual test outcome. Don't assume "CI passed" means the same thing on every branch — check which specific pipeline ran and what its actual scope/exit-code behavior is.
24. **Any generated report/log/evidence file that a later run can overwrite should be treated as ephemeral — capture it before running anything else if you need it.** `reports/<env>/misc-errors.json` (and even its per-worker source files) are overwritten by every subsequent Playwright invocation, including a single isolated test run in the same environment — not just the already-solved cross-process race. A full-suite run's own report was lost this way mid-session when a later isolated test run overwrote it before its data had been fully analyzed. Copy or rename anything you intend to reference later before running more tests against the same environment.
25. **Before concluding local work is lost, uncommitted, or unmerged, verify actual git state — don't reason from memory or assumption.** Check `git reflog`/`git stash list` before treating uncommitted changes as gone, and `git fetch` before trusting a local branch's view of what's merged/ahead/behind — local state can silently lag the remote, and assuming otherwise has produced false "this is lost" or "this was never merged" conclusions before.

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
- **CONFIRMED AND FIXED — a systemic navigation-drift gap across 6 modules (Deals/Companies/Contacts/Leads/Tasks/Quotations), root-caused with real evidence and fixed via one shared BasePage mechanism (2026-07-27).** Originally logged as an unconfirmed, code-review-only "tracked follow-up" after a single unreproduced flake (`deals.rbac.spec.ts`'s "Notes icon" test, page snapshot showing the admin browser unexpectedly on **"Default Dashboard"** instead of the Deals list). Escalated to a full investigation and CONFIRMED via 2 additional real, live reproductions in the same session (the same "Notes icon" test's first attempt, and the "Quotation permission... can create quotation" test hanging the full 8-minute test timeout with the identical Dashboard-bounce signature) before any fix was written.
  - **The confirmed gap:** every `waitForXDetailsPage()`/`waitForListReady()` across Deals, Companies, Contacts, Leads, Tasks, and Quotations independently duplicated the same shape — `waitForUrl()` (Playwright's `page.waitForURL()` resolves the FIRST moment the URL matches, with no guarantee it stays matching) followed by an entity-GET response wait wrapped in `.catch(() => null)`. Under heavy concurrent load, the app's own client-side router can bounce away from the just-matched URL before that GET ever fires — the silent catch swallowed this completely, letting every caller proceed as if navigation succeeded on a page that was never actually the target page. The real failure then surfaced much later, and much less legibly, as a generic element-not-found timeout with zero diagnostic signal pointing at the actual cause.
  - **Full-codebase sweep before fixing (not just the two modules where it was found):** grepped every module's `goToXList()`/`goToXDetailsById()`/`waitForXListPage()`/`waitForXDetailsPage()`-style methods. Confirmed the identical shape in **Companies, Contacts, Leads** (both list-page and detail-page variants) and **Tasks, Quotations** (detail-page variant only — their list-readiness checks are differently shaped and don't have this exact masking pattern). Checked **Meetings and Call Logs** — confirmed NO matching gap (Meetings' list-wait is a plain `waitForSelector` with no silent catch; Call Logs has no `waitForXDetailsPage()`-equivalent method at all).
  - **Fix: two new shared `BasePage` methods** (`waitForEntityDetailPage()`, `waitForEntityListPage()`) — one canonical reload-and-retry implementation, same principle as `withSessionExpiryRecovery()` itself, instead of 6 independently-drifting copies. Mirrors the exact reload-and-retry shape already proven for `assertRightPanelIconVisible()`/`LeadsPage.markLeadAsStage()`. Every module's own `waitForXDetailsPage()`/`waitForListReady()` refactored to thin wrappers around these two shared methods — including Quotations' extra 404-means-"does not exist" check, preserved unchanged (a genuine 404 is a real, fast response that still satisfies the predicate and does NOT trigger the retry path, which only fires when no matching response arrives at all).
  - **Fast-failure guarantee, explicitly verified, not assumed:** the whole point of this investigation was that a real problem must fail fast and clearly, never silently ride out the full 480s test timeout. Traced the exact worst-case bound through the code: `waitForUrl` (20s) + `domcontentloaded` (60s worst case, inherits `config.timeouts.navigation`) + entity-GET wait (15s) on the first pass, then `reload` (60s worst case) + `waitForUrl` (20s) + entity-GET wait (15s) on the retry — **absolute theoretical worst case ~190s (~3.2 min), a ~60% reduction from the previous unbounded 480s**, always with a clear diagnostic message ("entity GET response not observed within 15000ms (possible navigation drift)...") instead of a bare generic timeout. For the actual confirmed bug pattern specifically (URL matches, then the app redirects away), `waitForUrl`/`domcontentloaded` resolve almost instantly since a real page did load — realistic time-to-clear-failure is **~35-40 seconds**. Deliberately did not force the `domcontentloaded`/`reload` steps to a smaller timeout to guarantee a hard sub-60s ceiling in the extreme case, since 60s is this codebase's own already-established, evidence-based navigation baseline — artificially tightening it without evidence risks new flakiness on a legitimately slower-but-healthy load.
  - **Mandatory ripple-check, not skipped:** `goToDealDetailsById()` alone has 50 call sites; `goToDealsList()` has 54. Confirmed all 8 internal `waitForDealDetailsPage()` callers assume the deal is genuinely accessible — RBAC-denial tests use their own separate, tolerant direct-navigation logic and never call this method, so making it fail loudly (instead of silently swallowing) is safe. Verified via 5/5 real spot-check runs, one representative create/detail test per touched module (Companies, Contacts, Leads, Tasks, Quotations) — all passed cleanly, confirming the fix is purely additive with zero happy-path regression.
  - **A second, genuinely different bug found and fixed along the way, NOT the same mechanism:** re-verifying the Quotation-permission test after the navigation-drift fix, it still failed — but now in 2.0 minutes (not 8.2) with a clear validation error instead of a silent timeout. Traced to `DealsPage.getAssociatedContactId()`/`getAssociatedContactName()`/`getAssociatedCompanyName()`, which had **no explicit timeout at all** on their `getAttribute()`/`textContent()` reads — confirmed via `playwright.config.ts` that this codebase never sets `actionTimeout` (Playwright's real default is 0/unbounded). When a deal's contact never actually gets associated (the separate, already-confirmed Contact-persistence bug two entries below), `.locator('a.list__anchor').first()` matches zero elements and waits indefinitely for one to appear — that's what silently ate ~7 of the 8 minutes, with the navigation-drift fix never even triggering (confirmed: zero "reloading and retrying" log lines anywhere in the failure). **Fixed** by adding an explicit `{ timeout: config.timeouts.expect }` (10s) bound to all three reads — all 6 existing callers already treat `null` as "not present, skip sharing," so this only changes how fast that `null` arrives, never any caller's behavior.
  - **Verification, real evidence throughout, evidence-capture process corrected mid-investigation after a real loss:** an early verification loop used `tail -N` on live piped output and lost the first failure's exact error before it could be read (a real, acknowledged process failure, not glossed over) — corrected immediately by switching every subsequent run to its own dedicated, untruncated log file, one invocation at a time, confirmed saved before the next started. `tsc --noEmit`/`eslint` clean throughout.

- **Correcting a stale claim (itself now further corrected 2026-07-28 — see below): the "Quotation permission... can create quotation" individual test was NOT "passes reliably," as an earlier entry stated.** The original 2026-07-06 D24 write-up said this individual test (unlike the deleted, combined D24b) "passes reliably" — that claim was never actually quantified with a real pass rate, and 2026-07-27's data contradicted it directly: across the 2 full-suite contexts this test ran in that session, it failed in both (once as an 8-minute unrecovered double-timeout — fixed fast, see above — and, once that was fixed, as a fast, clear validation error). **2026-07-28 update: that second failure was itself retracted** — see the Contact-persistence bug's "CORRECTION, 2026-07-28" entry above. It was a false negative from an unrelated, now-fixed `config.apiBaseUrl`-normalization bug in `getAssociatedContactId()`'s detection method, not the Contact-persistence defect. Re-verified 2026-07-28 with the fix applied: **this test now passes cleanly** (D22 passed, 4.5m, zero background errors). Whether the ORIGINAL 2026-07-06 "passes reliably" claim was itself ever properly quantified remains genuinely unknown (that gap in evidence is real and unresolved) — but the specific 2026-07-27 failure that prompted this whole correcting entry is no longer a valid reason to expect this test to fail.
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
- **CONFIRMED REAL APP-LEVEL BUG (not a test-framework issue), independent of the Deal custom-fields work below: a Deal's Contact association does not persist — Company association is confirmed working correctly.** Found during the 2026-07-24 Deal custom-fields branch's regression run, confirmed independently via direct manual testing by the user (2026-07-27), who has raised it as a bug for the app team to fix. **Do not retry/mask/loosen any test around this** — every test below is deliberately left asserting the CORRECT expected behavior, per this file's own precedent (the confirmed Meetings RBAC permission-race bug) of never hiding a real defect.
  - **What's expected vs. actual:** adding a Contact to a Deal — via the create form's Associated Contacts field, the ellipsis menu's "Add Contact," or after a Reassign — should make that contact appear on the deal's detail page (`Associated Contacts` card) and be resolvable as a real linked entity. **Actual:** the contact never appears; the deal's Associated Contacts card shows "No Contacts found" / a count of 0, even though the save itself reports success with zero validation errors. **Company association has no such issue** — confirmed via 5/5 clean runs of a dedicated Company-only check (see below).
  - **Every confirmed occurrence found so far (5 independent code paths, same signature):**
    1. `deals.spec.ts` — "admin should add an existing contact to a deal from ellipsis menu and verify in Associated Contacts" (D35): `DealsPage.addContactToDeal()` selects a real, valid contact (log-confirmed: `Associated contact selected: "Kallie Funk" (index 5 of 25)`), Save reports success (`No validation errors found in deal edit form` / `Deal updated`), yet a reload shows `Associated Contacts: No Contacts found` (count 0 vs. expected 1). Reproduced 3/3 in isolated single-worker runs.
    2. `deals.rbac.spec.ts` — "restricted user contact and company owned by restricted not admin" (the original combined test, since split — see below): `TimeoutError` waiting for `.deal-contact__name` to ever render on the deal detail page.
    3. `deals.rbac.spec.ts` — "admin reassigns deal to restricted user and restricted becomes owner can edit and delete": `Error: Restricted user should be able to add a new contact after reassign — Expected: 1, Received: 0`.
    4. `deals.rbac.spec.ts` — "restricted user adds an existing contact to own deal via ellipsis": `Error: Associated contacts count should increase by 1 — Expected: 1, Received: 0`.
    5. ~~`deals.rbac.spec.ts` — "admin shares deal Quotation permission restricted user sees Quotations icon and can create quotation" (2026-07-27, found during the navigation-drift-fix investigation below).~~ **RETRACTED 2026-07-28 — see the correction entry immediately after this list. This was NOT a real occurrence of the Contact-persistence bug — it was a false negative produced by an unrelated, now-fixed bug in our own `getAssociatedContactId()` detection tool.** (Original text preserved in git history rather than deleted outright, per this file's own precedent of correcting rather than silently erasing a stale claim — see the 2026-07-06 D24 "stale claim" entry below for that same precedent.)
  - **Investigated as a possible client-side race first, per this file's own root-cause discipline, before accepting it as app-level:** the shared `BasePage.selectRandomOptionWithRetry()` helper (used by `addContactToDeal()` and 5 other call sites across Deals/Tasks/CallLogs/Meetings) returned immediately after the option click with no wait for the react-select menu's own close transition — the identical race class already root-caused for `DealsPage.cloneDeal()` and `TasksPage.selectReactSelectOption()` elsewhere in this codebase. **Fixed defensively regardless** (purely additive — bounded `waitFor({state:'hidden'})` + `.catch()`, mirroring the exact pattern already proven safe in `selectRandomFromSingleReactSelect()`/`selectRandomFromSearchableReactSelect()`), since it closes a genuine latent risk at this shared call site — but the failure reproduced identically even after this fix was applied (verified via `tsc --noEmit`/`eslint` clean). **The user's own direct manual reproduction in the live app (not through this test suite) independently confirmed this is a real backend persistence defect, not a client-side timing issue** — the defensive fix above stays, but is not credited as "the fix."
  - **Test-quality fix applied alongside, itself a separate, real finding — occurrence #2 above conflated two independent checks into one test.** The original combined test checked Company owner AND Contact owner in a single assertion block; since Contact is broken, every run failed with one conflated signal instead of two precise ones, and a real, working Company feature had no passing test of its own. **Split 2026-07-27** into two standalone tests, mirroring this file's own D24a/D24b precedent for exactly this "one test conflates two independent things" problem:
    - `restricted user can view Company owner on a deal they own` (D13a) — **verified 5/5 clean** (qa, single worker, isolated runs), confirms Company ownership displays correctly.
    - `restricted user can view Contact owner on a deal they own` (D13b) — **verified 3/3 reliably reproduces the bug** (`TimeoutError` on `.deal-contact__name`, identical failure every time — not flaky, a genuine, consistent persistence defect) — deliberately left failing, not loosened.
  - **Plausible but UNCONFIRMED connection to the pre-existing "unresolved Deals flake" entry above** (the 2026-07-06 investigation, six experiments, no confirmed mechanism, "logging a Call on a deal shared with the restricted user intermittently fails... even when contact sharing is verified correct via screenshots"): if Contact association only *sometimes* persists (consistent with "intermittent" in that older entry, vs. the *consistently* reproducing failure found here), that would plausibly explain call/quotation-log failures that depend on a resolvable associated contact — a materially better candidate mechanism than any of the six disproven theories in that entry. **Flagging as a hypothesis worth backend investigation, not a confirmed resolution of that older mystery** — the two investigations found different failure characters (intermittent vs. consistent) and should not be assumed identical without further evidence.
  - **CORRECTION, 2026-07-28 — occurrence #5 above retracted; occurrences #1-4 stand unaffected; the underlying app defect is REAL but occurrence #5 specifically never demonstrated it.** `getAssociatedContactId()`/`getAssociatedContactName()`/`getAssociatedContactsCount()` were rewritten in the SAME commit that documented occurrence #5 (`f395b14`) to read from a live `GET /v1/deals/<id>` API call (`fetchCurrentDealApiData()`) instead of scraping the buggy UI card — and that exact method was independently found, one day later, to 404 silently in CI whenever `config.apiBaseUrl` lacks the `/v1` suffix the CI secret is missing (see the dedicated bug-class entry above, "SECOND occurrence of the exact same `config.apiBaseUrl`-normalization bug class"). This means occurrence #5's own evidence-gathering tool was capable of reporting "no contact" even when a contact was genuinely linked — exactly the ambiguity occurrence #5's original write-up did not consider.
    - **Direct re-verification, with the fix applied, real evidence, not assumption:** re-ran the exact Quotation-permission test (qa, single worker, isolated) — **PASSED CLEAN (4.5m, D22 passed)**. Log-confirmed the previously-never-appearing `Sharing contact with: User 1` → `Contact shared with: User 1` now fires correctly, and `No validation errors found in add quotation from panel` → `Quotation added from panel: 10113`. Separately, direct API calls (via the now-fixed method, run against 4 real deals from the original failing CI run — 430321/430322/430323/430324) confirmed every single one genuinely had its contact linked on the backend (`associatedContacts count: 1` each, matching the exact contact selected at creation time) — the "no contact to share" conclusion for all of these was false, in every case checked.
    - **Occurrences #1-4 are NOT affected by this correction** — they predate the `fetchCurrentDealApiData()` rewrite (occurrence #1/D35 specifically was corroborated via a direct, one-off API-vs-UI comparison during the original investigation, not via this method) and used the older UI-scraping implementation, which has no dependency on `config.apiBaseUrl` at all. The underlying Kylas UI-display defect these occurrences document (`Associated Contacts` card showing "No Contacts found" despite the API genuinely having the contact) remains independently, freshly reconfirmed below — this correction narrows occurrence #5 specifically, it does not overturn the bug's existence.
    - **The Call-permission test (`deals.rbac.spec.ts` — "admin shares deal Call permission restricted user sees Call Logs icon and can log call"), re-verified the same way, gives the clean counter-example that proves this correction isn't just "the bug went away once we fixed our tool."** Same fix applied, same re-run method — the contact WAS correctly detected and shared this time (`Sharing contact with: User 1, permissions: call` → `Contact shared with: User 1`, confirmed via the now-working API check). The test **still failed**, but at a different, later, and genuinely real point: `error-context.md`'s captured page snapshot at the moment of the `#callLogModal` timeout shows a real, rendered dialog — `heading "No Contact Associated"` / `"There is no contact associated for this deal. Please add associate a contact with the deal"` — appearing alongside the deal's own `Associated Contacts` card showing `No Contacts found`, **on the exact same fresh deal (430338, created seconds earlier) that the fixed API check confirmed has `associatedContacts count: 1`.** This is a live, fresh, direct API-vs-UI mismatch reproducing in real time — the same defect class as occurrence #1/D35, independently reconfirmed today, not stale evidence. **Conclusion: the underlying Kylas Associated-Contacts UI-display defect is real and still live; occurrence #5 specifically was a false alarm from a broken checker, but the bug class it was trying to describe is genuinely still there, now demonstrated fresh via the Call-permission test instead.**
    - **Practical implication for future test runs:** any test relying on `getAssociatedContactId()`/`getAssociatedContactName()`/`getAssociatedContactsCount()` in a CI run from BEFORE 2026-07-28's `buildApiUrl()` fix should have its "no contact found"/"contact not shared" conclusions treated as unreliable, not evidence of the persistence bug specifically — re-run with the fix in place before drawing any new conclusion from these methods.

- **Stage environment CONFIRMED to NOT have the Contact-persistence display bug (nor the Call Log functional bug) above — a separate, genuine, latent TEST-SETUP bug in D13b was masked by it on qa and only surfaced once verified against stage (2026-07-27).** During a full `--retries=0` zero-tolerance verification pass of this branch's changes on **stage** (run explicitly because stage does not reproduce the bug above), `restricted user can view Contact owner on a deal they own` (D13b) failed — but with a **completely different failure signature** than every qa occurrence: the contact link rendered and opened successfully (`.deal-contact__name` found, new tab opened, `Contact owner: Playwright Stage` read back cleanly), and the test's own ownership assertion (`expect(contactOwner).not.toBe(adminName)`) failed instead, because the read-back owner **was** the admin's display name (`Playwright Stage`), not the restricted user's (`Playwright user`).
  - **Root cause, confirmed via code inspection, not the app:** D13b creates its deal via `generateDealData()` with no `associatedContactName`, which falls through to `DealsPage.selectFirstOptionFromDropdown()`'s already-documented random-pick path (see that method's own `WHY` comment, `DealsPage.ts:474-478`: *"for tests where the associated contact/company's ownership matters... picking a random pre-existing entity is unsafe (its owner/share-state is unknown and uncontrolled)"*) — i.e. a pre-existing, self-documented risk in this exact test's own setup, present identically on every environment. It was never triggered on qa only because the (separate, real) Contact-persistence display bug above always made `.deal-contact__name` time out first, masking this assertion entirely. Stage doesn't have that display bug, so execution reaches the ownership assertion for the first time and exposes the latent flaw.
  - **Fixed** (`tests/rbac/deals.rbac.spec.ts`, D13b only): create a contact explicitly as the **restricted** user first (ownership = creator, per this codebase's own factory convention — see Test Data Factories above), then pin the deal to it via `generateDealData({ associatedContactName: ownContactName })` instead of leaving it to the random pick. Purely additive to this one test; `generateDealData`'s signature/behavior for every other caller is unchanged. `tsc --noEmit`/`eslint` clean.
  - **Re-verification COMPLETE, all real evidence (2026-07-27):**
    - Fixed D13b, isolated, `--retries=0`, stage: **5/5 clean** (2.0m, 1.7m, 1.7m, 1.8m, 1.7m).
    - Regression spot-check, 1x each, `--retries=0`, stage — all unaffected by the edit: D13a **passed** (1.1m; its own pre-existing defensive skip for the same random-pick risk on Company logged a harmless `logger.warn` and did not fail), D35 **passed** (54.6s), D27 **passed** (57.4s), Call-permission **passed** (2.5m).
    - Fixed D13b re-run on **qa**, `--retries=0`: **failed**, but confirmed via `error-context.md` to be a completely different signature than the ownership bug just fixed — `TimeoutError: locator.waitFor: Timeout 60000ms exceeded... waiting for locator('.deal-contact__name').first() to be visible`, i.e. the contact link never rendered at all, the exact pre-existing qa display-bug signature, failing *before* the ownership assertion this fix touches is ever reached. Confirms the fix is correct and qa's separate, unrelated display bug is what's still blocking it there.
    - Full 12-file zero-tolerance stage pass (`--retries=0`, run in full, twice — once before this fix landed capturing the original D13b failure with real evidence, once after with D13b's edit in place and the rest of the suite continuing): **215/216 passed** across `deals.spec.ts` (19/19), `deals.rbac.spec.ts` (22/23 — the 1 failure is this exact D13b occurrence, pre-fix), `companies.spec.ts` (17/17), `companies.rbac.spec.ts` (20/20), `contacts.spec.ts` (19/19), `contacts.rbac.spec.ts` (19/19), `leads.spec.ts` (21/21), `leads.rbac.spec.ts` (27/27), `tasks.spec.ts` (11/11), `tasks.rbac.spec.ts` (11/11), `quotations.spec.ts` (15/15), `quotations.rbac.spec.ts` (14/14) — zero flaky, zero unexplained failures anywhere. Quotation-permission specifically confirmed reliable 10/10 clean isolated runs across both environments (5/5 qa + 5/5 stage). `tsc --noEmit`/`eslint` clean (0 errors) at final check.

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
- **`companies.spec.ts` CO4 flaky generic-error toast — investigated, root cause unconfirmed (2026-07-22).** See README.md's Known Limitations for full detail. Summary: correlated with (not proven caused by) a background duplicate-check lookup 400; 0/5 reproduction in isolation; `saveCompany()` has zero retry protection of any kind today on this branch. Flagged as a genuine open item, not silently dropped — needs concurrent-load reproduction before a real fix can be verified.

- **Sandbox CI 5-flaky run (`feature/lead-entity-lookup-fields-20260721`, run 29935223512, 2026-07-22) — 4 of 5 investigated with real evidence, 1 confirmed a genuine app-level RBAC gap, fixes applied where evidence supported them.** Run: `263 total, 258 passed, 0 failed, 5 flaky` (2 workers, selective sandbox suite). All 5 downloaded from the CI run's own artifacts (`error-context.md`/page snapshots) before touching any code — see below per test.
  - **`contacts.rbac.spec.ts:228` — CONFIRMED REAL APP-LEVEL RBAC BUG: a restricted user was able to create a Meeting against a Contact whose associated Company was never shared with them at all — a permission boundary that should always block this, and does on every other observed attempt. NOT fixed here (backend defect, outside this repo's control) — flagging for whoever has Kylas backend/log access.**
    - **Exact permission condition (unambiguous):** admin shared the Contact with the restricted user granting **only** the `meeting` permission (`ContactsPage.shareContact(restrictedUserName, ['meeting'])` — no `update`/`note`/`task`/`reassign`/`clone`/`delete`). The Contact's associated Company (set via its own Company field at creation) was **never independently shared** with the restricted user by any action in this test — confirmed by reading the test source (`tests/rbac/contacts.rbac.spec.ts:228-293`), which deliberately omits any `shareCompany()` call (contrast with the positive counterpart `CR9b` at line 303, which shares the company too and correctly succeeds).
    - **Expected behavior (confirmed correct on every other attempt):** `POST /v1/meetings` → HTTP 422, `errorCode: "01503001"`, `message: "Invalid company summary response."` — reproduced 4/4 clean in local isolation (qa, single worker) **and** on this exact same CI test's own Playwright-level retry (attempt 2, which passed).
    - **Actual observed behavior on CI attempt 1 (the bug):** the create was allowed through — a real Meeting was persisted. Real evidence, quoted directly from the CI run's own Playwright ARIA page-snapshot (`error-context.md`, captured automatically at the moment of the test's failure — run `29935223512`, job `88974945922`, downloaded via `gh run download`):
      ```
      - alertdialog:
          - text: Meeting created
          - generic: "(Meeting ID: 98430)"
      ...
      - heading "Meeting-1784738138087 (#98430)"
      - Invitees: User 1 (Organizer), link "S SHR1784738061652 Towne pending shr1784738061652@testkylas.com Contact"
          - /url: /sales/contacts/details/465646
      ```
      Concrete, correlatable identifiers for backend log lookup: **Meeting ID 98430**, **Contact ID 465646** (`SHR1784738061652 Towne`), meeting title timestamp `1784738138087` ms epoch = **2026-07-22T16:35:38.087Z**.
    - **Important precision about the evidence type:** this is a captured UI-level ARIA snapshot (proof of a genuinely *persisted* record — a real meeting ID linked to the real, never-shared contact — which is direct evidence of a completed backend write), **not** a raw captured HTTP response body for that specific request. The test's own `meetingPostPromise` network-capture was never evaluated in this run because execution threw at an earlier assertion (`saveThrew` expected `true`, got `false`) before reaching the response-status check — so there is no raw JSON response logged for this exact occurrence. The persisted-record evidence above is, if anything, stronger proof of an actual backend write than a response body alone would be.
    - **Why this isn't a client-side artifact:** `saveMeeting()`'s toast-error selectors were verified directly (temporary instrumented reproduction, `.toastr.rrt-error`/`.rrt-middle-container` correctly detected on every one of the 4 correctly-blocked local runs) — so this isn't a case of the test framework failing to see a real error toast; there was no error toast because the backend genuinely returned success.
    - **Likely mechanism (not confirmed, flagged for backend investigation):** the CI run used 2 concurrent workers (263 tests, > the 50-test threshold for sandbox's dynamic worker count); 4/4 single-worker local reproductions never reproduced this. This is consistent with a permission-check race under concurrent load — the same class of race already tolerated in the *safe* direction elsewhere in this codebase (`MeetingsPage.saveMeetingRetryOnEntitySummaryLag`, which retries through a transient *false-deny*), but here manifesting in the *dangerous* direction (a false-*allow*) — a materially different and more serious defect class, since it means the company-share check can, at least intermittently, be bypassed entirely rather than merely delayed.
    - **Deliberately not "fixed" in this repo**: the test's assertion is correct and must not be loosened, retried, or masked — doing so would hide a real permission-boundary defect. This needs server-side investigation (request/response logs, the permission-check code path for meeting creation vs. company-share state) that this client-side Playwright suite has no access to.
    - **Recurred a second time, independently (2026-07-23, final combined pre-commit full-suite run on stage, single worker, retries=0)** — same exact failure shape: `Captured meeting ID: 10398`, zero validation errors, contact shared with only the `meeting` permission (`"Sharing contact with: Playwright user, permissions: meeting"`, confirmed no company share in the log). Strengthens rather than changes the classification above — two independent real occurrences (one under CI's 2-worker load, one under a local single-worker run) confirms this is a genuine, recurring, intermittent backend gap, not a one-off fluke tied to concurrent-load timing specifically. Still not fixable from this repo; still not retried/masked.
    - **Timing-race investigation, corrected and CONFIRMED (2026-07-23) — this IS request-timing-dependent, not purely random.** First attempt at isolating a timing mechanism used a test that added an explicit `assertCompanyNotInList()` critical check *before* the meeting-creation attempt (to prove the company was genuinely unshared) — this ran 10/10 clean (5 immediate + 5 with an extra 2.5s delay), which looked like it disproved any timing correlation. It didn't: pulling the **actual raw timestamps from this run's own real failure** (share-complete at `10:35:08.431Z`, Save clicked at `10:35:12.498Z` — a **4.07s** gap) showed the first repro's own "immediate" variant never got faster than **11.3s** (the critical-check step itself took 5-20s and sat *before* the attempt, artificially slowing down the very case meant to be fastest) — so that 10/10-clean result never actually tested the real failure's timing window at all, and the "unexplainable, 0/10" framing was wrong. Re-ran with the critical check moved to *after* the meeting attempt (matching the real test's actual sequence — the real test never does this check inline) and 8 attempts landing naturally in a 3.9-5.6s share-to-save gap, matching the real failure almost exactly: **2/8 reproduced the bug** (attempts with gaps 5539ms and 4495ms — both `saveThrew=false, status=201`, a real meeting persisted), 6/8 correctly blocked (gaps 3942-5621ms). Not a hard threshold — the shortest gap tested (3942ms) was correctly blocked while a nearly-identical gap (5539ms vs. 5544ms) landed on opposite outcomes for two different attempts — so this is a genuine intermittent race with a chance of firing in a fast (~4-5.6s) window, not a deterministic "under Xms always fails" rule. Zero reproductions occurred in 10 slower (10-25s) attempts across both investigations. **Revised conclusion:** this is confirmed to be tied to how quickly the client moves from share-completion to the meeting-create request — a real, evidence-backed correlation, not the "unconfirmed, no consistent mechanism" classification the first (flawed) repro implied. Still a backend defect, still not fixable or maskable from this repo — but now with a concrete, reproducible trigger condition to hand to whoever investigates server-side, instead of "sometimes happens under load."
    - **Complete list of every confirmed occurrence (real, persisted records — correlatable meeting/contact IDs, not inferred):**

      | Occurrence | Env | Meeting ID | Contact ID | Share→Save gap |
      |---|---|---|---|---|
      | Sandbox CI run 29935223512 (2026-07-22) | QA-adjacent | 98430 | 465646 (`SHR1784738061652 Towne`) | not captured |
      | Stage full-suite run (2026-07-23) | Stage | 10398 | 89985 | 4067ms |
      | Fast-timing repro attempt 6 (2026-07-23) | QA | 98487 | 465753 | 5539ms |
      | Fast-timing repro attempt 8 (2026-07-23) | QA | 98488 | 465755 | 4495ms |
  - **`leads.rbac.spec.ts:389` and `:448` (right-panel "Call Logs"/"Notes" icon not visible within 120000ms after a fresh admin share) — reload-and-retry fix applied to ALL 4 modules with this check, verified.** Both timed out on `LeadsPage.assertRightPanelIconVisible()` even with the already-generous `config.timeouts.navigation` window. 0/6 local single-worker reproductions (fresh nav consistently saw the icon immediately) — consistent with this codebase's established "needs concurrent CI load to surface" pattern, so the fix was applied defensively rather than from a forced live repro of the exact race. Mechanism: the right panel's icon set is read from a permissions snapshot fetched once at page mount; a longer wait cannot help if that snapshot predates the share's propagation — only a fresh mount (reload) re-fetches it. Reused the exact bounded reload-and-retry pattern already proven for `LeadsPage.markLeadAsStage()` (root-caused 2026-07-22). Grepped the whole `src/modules/` tree for every `rightPanelIcon`/`assertRightPanelIconVisible` site — exactly 4 modules have this check (Meetings/Tasks/Call Logs/Quotations have no right-panel-icon concept at all) — and applied the identical try/reload/retry shape to all 4, each calling its own module's `waitForXDetailsPage()` after reload: `LeadsPage.ts`, `DealsPage.ts` (both previously a single `expect().toBeVisible({timeout: config.timeouts.navigation})`), `ContactsPage.ts`, `CompaniesPage.ts` (both previously `waitFor('attached', 15000)` + `expect toBeVisible(15000)`). Purely additive — the original timeout/shape per module is unchanged and only engaged on the already-failing path, so no passing test's timing changes. `tsc --noEmit` clean. Re-ran the two originally-failing leads RBAC tests 3x each (qa, single worker) after the fix — clean.
  - **`tasks.rbac.spec.ts:69` ("restricted user can edit their own task") — 0/5 reproduced, root cause of THIS occurrence NOT confirmed — defensively hardened based on code review, not a confirmed-root-cause fix.** CI showed `saveEditedTask()`'s `waitFor({state:'hidden', timeout:15000})` polling 33× over 15s with the modal never closing, but `assertNoFormErrors()` immediately prior found zero validation errors — so the save click registered with no visible error, yet the modal never closed. 5/5 local reproductions (qa, single worker, network-instrumented) all completed cleanly in ~2s with no hang, so the exact mechanism behind this one CI occurrence is **not** confirmed. Per the session's standing instruction to still hardened an unreproduced flake based on thorough code review rather than leave it purely documented: read every step `fillEditForm()`/`saveEditedTask()` run and found one concrete, real gap — `TasksPage.selectReactSelectOption()` (used for Type/Status/Priority/Reminder, the last of which is the LAST action `fillEditForm()` runs before `saveEditedTask()` clicks Save) returned immediately after its option click with no confirmation the selection had actually committed. That's the same *shape* of race already root-caused for `DealsPage.cloneDeal()` (a click landing during an async React state commit produces zero effect) — plausible but **not proven** to be this occurrence's actual cause. **Fixed defensively:** `selectReactSelectOption()` now waits (bounded 5000ms, non-fatal) for the react-select menu to actually close after the option click — a real readiness signal (the library's own state transition), not a guessed delay, matching the same "wait for a real signal, don't retry a click blindly" discipline that `DealsPage.cloneDeal()` itself converged on (an earlier click-retry attempt for that bug "made things measurably worse" per this file's own history — informing the choice to harden the wait-before, not add a retry-after, here too). Applies to all 8 call sites across both `fillEditForm()` (edit) and the create-form filler, since the fix lives in the one shared method. Ripple-checked: purely additive, bounded, and swallowed on timeout, so it cannot turn a working selection into a failure. `tsc --noEmit` clean. Re-verified 3x clean (qa, single worker) on the edit test plus 2 create-path tests sharing this method (`tasks.rbac.spec.ts` "restricted user can edit their own task", `tasks.spec.ts` "create a task via Detailed Task form", "switching Quick Form to Detailed via toggle") — no regression. As expected for preventive hardening rather than a forced reproduction, none of the 3 runs reproduced the original hang either — this confirms the happy path is unaffected, not that the fix resolved the specific CI occurrence (which remains unconfirmed, per the framing above).
  - **`deals.spec.ts:141` ("admin should change pipeline stage to Negotiation in edit") — confirmed same generic-transient-error class already fixed for create paths; `saveEditedDeal()` had zero protection; now fixed.** CI's page snapshot at failure time showed the edit form fully and correctly filled (Pipeline Stage: Negotiation, contact/company/product row all present) — ruling out a missing-field business-rule cause. The error was the exact same generic, non-field-specific toast signature (`"Uhho! Something went wrong!"`) already documented for `CompaniesPage.saveCompany()`'s transient-backend-error class. Confirmed via code read: unlike `saveCompany()`/`createLead()`/`createContact()`'s create paths, `DealsPage.saveEditedDeal()` had no response classification or retry at all (matching the module table's already-documented gap). 0/4 local reproductions of the specific failure (all clean), consistent with this being a rare, concurrent-load-triggered backend blip rather than reproducible bad data. **Fixed:** added `DealsPage.captureDealUpdateOutcome()` (mirrors `CompaniesPage.captureCompanyCreateOutcome()`'s status/fieldErrors classification, adapted for the edit path's `PUT /v1/deals/<id>` instead of the create path's `POST /v1/deals`) and rewrote `saveEditedDeal()` as a bounded 3-attempt loop that re-clicks Save on the same, still-filled edit form when the outcome classifies as transient — no re-fill needed, since a transient rejection (confirmed no field-level errors) implies no DB write occurred. A genuine validation error still surfaces via `assertNoFormErrors()` unchanged and is never retried into a false pass. Ripple check: grepped all 7 call sites of `saveEditedDeal()` (2 internal wrappers — `updateDeal()`, one product/payment edit flow — plus 5 direct test call sites in `deals.spec.ts`) — signature and success-path behavior unchanged, so all callers are unaffected. `tsc --noEmit` clean. Re-verified the originally-failing test 3x clean (qa, single worker) after the fix — no regression.

- **Session-expiry recovery — architectural overhaul, not another one-off patch (2026-07-23).** The `call-logs.rbac.spec.ts:337` failure above (session expired mid-test, recovered once via `navigateTo()`'s existing recovery, then expired AGAIN inside `assertUrl()`'s 10s poll window with zero recovery of its own) was the trigger, but the real question was *why this keeps recurring* — this exact bug class had already been independently fixed FOUR times before this session (`click()`/`fill()` 2026-07-09, `navigateTo()` 2026-07-20, `armResponseWaitWithRecovery()`/`withSessionExpiryRetry()` 2026-07-20). A full-codebase grep found **80 further raw `expect(...).toBeVisible/toHaveText/toHaveURL` calls** written directly in module page objects (Contacts 18, Companies 19, Deals 23, Leads 12, CallLogs 4, Tasks 3, Quotations 1) — every one silently unprotected, and always had been. This is the exact anti-pattern industry research on test-automation architecture names explicitly: per-method retry wrapping that new code keeps forgetting to opt into. This codebase had already solved a structurally identical problem this way once before — see `src/utils/navigation.ts`'s own header comment on `safeWaitForURL()`: three independent bare-`page.waitForURL()` bugs, each rediscovered only after a confusing CI failure, finally fixed by consolidating into one canonical function everything routes through. That was the explicit model for this fix.

  **Phase 1 — verified against the REAL app, not assumed.** Before writing any code: drove a real login through a live browser and inspected actual network traffic. Confirmed: (1) **no cookie-based session at all** — clearing `localStorage` alone (cookies untouched) immediately redirects to `/signIn`; the only cookies present are third-party analytics, unrelated to auth. (2) Login is `PUT https://api-{env}.sling-dev.com/v1/users/login`, body `{email, password, rememberMe}`, response `{token}` — a JWT stored verbatim in `localStorage.token`. Every API call sends `Authorization: Bearer <accessToken>`, where `accessToken` is a field *inside* the decoded JWT payload (`payload.data.accessToken`), confirmed by reading a real authenticated request's headers directly. (3) The JWT payload does contain a `refreshToken` field, but three plausible refresh endpoints (`/v1/users/refresh-token`, `/v1/users/refresh`, `/v1/users/token`) all returned bare, header-less `400`s lacking the real app's own CORS/CSP headers — a gateway-level rejection, not a real route. **No usable refresh endpoint exists.** (4) Directly tested "does a concurrent login invalidate another session" — logged in twice in immediate succession with the same credentials; the second login returned the **identical `accessToken`**, and the first token remained valid before and after. Concurrent re-logins with an already-valid session are server-side safe, not a conflict source (the real, already-mitigated risk is the *local* `storageStates/<env>/<role>.json` file-write race, which `AuthManager`'s existing cross-process file lock already guards).

  **Phase 2 — the first design (centralized `page.route()` network interceptor) was built, verified to partially work, then found to break normal operation and was deliberately abandoned — not shipped as broken code.** Design: intercept every Kylas API request via `route.fetch()`, and if the real response was a 401, hold it back, perform a fast headless re-login (`PUT /v1/users/login` directly, ~300ms measured, no UI navigation), retry the same request with a fresh `Authorization` header, and fulfill the route with *that* response — so the frontend never observes the 401 and never fires its own client-side redirect, which is the actual mechanism that destroys in-progress UI state in every session-expiry failure investigated in this codebase's history. First verification (a deliberate reproduction — corrupt the real token mid-test via `page.evaluate()`, confirm recovery) showed the CORE mechanism worked: 8 concurrent 401s correctly detected, deduplicated to exactly one recovery, all 8 retries returned `200`. (Caught and fixed one real bug in the same pass: `config.apiBaseUrl` already includes `/v1`, so the login URL was doubling to `/v1/v1/users/login` — a genuine 404, not a backend rejection.) But a broader regression sample then surfaced failures on completely unrelated, non-expiry tests (Deals/Tasks create, a Leads RBAC share flow) — generic `HTTP 400 "Unexpected error occurred!!"` across multiple endpoints. Isolated the cause with a decisive A/B test rather than guessing: the exact same test passes clean with **no interceptor code at all**, passes clean with the interceptor registered but forced to `route.continue()`-only (never calling `fetch()`), and **only fails once `route.fetch()` is actually used** — even on requests nowhere near a 401. Root cause (not fully confirmed, but well-evidenced): `route.fetch()` replays the request via Playwright's own Node-side networking instead of the browser's native stack, and something about that path (connection reuse, TLS/HTTP negotiation, or a browser-fingerprint header the real browser sends automatically) gets flagged by the real backend. **This makes `route.fetch()`-based interception unusable for this app** — the mechanism needed to inspect a response before deciding whether to let the page see it is exactly what the backend rejects. Immediately neutralized (route handler forced back to unconditional `route.continue()`, confirmed the previously-broken test passed clean again) before doing anything else — never left a known-broken mechanism active. The dedup/headless-login/JWT-decode logic was preserved, not deleted, since it was directly reusable for the next design.

  **Phase 3 — what was actually built instead: one shared combinator, not 80 individual hand-rolled fixes.** `BasePage.withSessionExpiryRecovery<T>(fn: () => Promise<T>): Promise<T>` — the exact same catch-recover-retry shape `click()` already used (capture the URL *before* the call, since by catch-time the page may already be on the failure page; on catch, check registration + expiry-page condition; if matched, recover once and retry `fn()`; otherwise rethrow unchanged), generalized to wrap any single Playwright call. Every one of the 80 raw call sites became a one-line change (`this.withSessionExpiryRecovery(() => expect(...).toBeVisible(...))`), retrofitted across all 7 files, plus `BasePage`'s own previously-uncovered generic helpers (`waitForVisible`, `waitForHidden`, `waitForUrl`, `assertVisible`, `assertText`, `assertFormErrorToast`) now route through it too. The LOGIC still lives in exactly one place — a future fix to the recovery mechanism only needs to change this one method, not 80+ call sites. **Complementary to, not a replacement for,** the existing `click()`/`fill()`/`navigateTo()`/`assertUrl()`/`withSessionExpiryRetry()` mechanisms, which are unchanged and remain the backstop for document-level navigations and any request shape the combinator doesn't cover.

  **Phase 4 — a SECOND real gap found via the combinator's own verification, fixed the same way (broadly, not just where found).** Deliberately reproducing `withSessionExpiryRecovery()` itself (corrupt the token, force a fresh render, confirm recovery) failed on the first isolated attempt: the page showed a distinct **"Forbidden"** client-rendered page (confirmed via screenshot: heading "Forbidden" + a "Home" button) while the URL stayed completely unchanged (confirmed via trace inspection — still the exact pre-reload URL) — a state `isSignInUrl()`'s URL-only check can never recognize. Root-caused via a second isolated test: a **mid-session** expiry while the app is already running consistently redirects to `/signIn` (confirmed repeatedly this session), but a **fresh page load/reload** with an already-invalid token hits a different, bootstrap-time auth-check code path that renders "Forbidden" instead — the exact reload-then-check pattern this session's own `assertRightPanelIconVisible()` reload-and-retry fixes use. Grepped the whole codebase for any test relying on this exact "Forbidden" page as an expected, correct RBAC-denial outcome — zero hits — so recognizing it as an expiry symptom cannot mask any current test's genuine permission-boundary assertion. **Fixed consistently, not just in the new code:** added `authManager.isSessionExpiryPage(page)` (URL check OR a page-body-text check for the confirmed "Forbidden" shape) and updated **all five** existing gate checks — `click()`, `fill()`, `navigateTo()`, `assertUrl()`, `withSessionExpiryRecovery()` — to use it instead of the narrower `isSignInUrl()` alone, matching the same "fix it everywhere the same gap exists, not just where it was found" discipline as the rest of this session. Purely additive (a genuine signIn-URL match still works exactly as before; the only new behavior is recovering from a state that previously fell through to an unrecovered failure). Re-ran the exact failing isolated repro after the fix: `withSessionExpiryRecovery()`'s own catch now correctly logs `"A wrapped call failed while on a signIn/login or Forbidden page"`, recovers, and the test passes.

  **Phase 5 — a proactive layer added on top (same session, user-requested extension): prevent the failure from happening at all in the common case, not just recover after it.** `withSessionExpiryRecovery()` is reactive — it only helps after something has already failed. `AuthManager.ensureFreshSession(page, role)` reads the JWT's own embedded absolute expiry (`payload.data.expiry`, a ms-epoch timestamp — confirmed via the same live token decode from Phase 1; no network call needed to check it) and proactively refreshes via the same fast headless login if less than **10 minutes** remain. The buffer is grounded in this session's own timing data, not guessed: individual test durations up to ~2.1 minutes were observed for the heaviest normal (non-failure) flows across this session's logs; 10 minutes gives ~5x margin over that while remaining a tiny fraction (~1.6%) of the token's own ~10.4h lifetime, so the check almost never actually triggers a refresh in normal operation. Wired into `fixtures/index.ts`'s `createRolePage()` — runs once per test, automatically, for every `adminPage`/`restrictedPage`, the same way `registerPageForRecovery()` already does. Deliberately does **not** use `route.fetch()` or any request-replay mechanism — it only ever reads `localStorage` and, if needed, calls the plain headless login directly, so it can never hit the exact rejection that killed the Phase 2 design. Verified via deliberate reproduction: since `ensureFreshSession()` never validates the JWT's signature (only decodes the payload), a fake-but-correctly-shaped unsigned token with `data.expiry` set 60s in the future was injected directly — confirmed it correctly triggered a refresh (real headless re-login, real token swapped in); a second fake token with a full ~10.4h remaining was confirmed to be left completely untouched. The real, automatic fixture-level call was also observed live during the same run, on a genuine fresh login: `"token for role admin has 29141s remaining — no proactive refresh needed"` — confirming the real wiring behaves correctly, not just the isolated unit-style test.

  **Both layers confirmed NOT to affect `login.spec.ts`, by construction, not a runtime check.** That file deliberately imports `test` from `@playwright/test` directly and uses the plain `page` fixture (never `adminPage`/`restrictedPage`) to drive its own login-form UI test. `ensureFreshSession()` and the interceptor-that-was-abandoned are only ever invoked from inside `createRolePage()`, which only the custom fixtures call — `login.spec.ts`'s tests never reach that code path at all. Ran all 4 `login.spec.ts` tests twice (once before, once after the final fix) — 4/4 clean both times, zero interceptor/proactive-check log lines present in either run.

  **Final verification, all via real runs, not assumed:** `tsc --noEmit` and `eslint` clean across every touched file (only pre-existing, unrelated `any`-type warnings remain, confirmed via `git diff` that none were introduced by this work). Ripple-checked: `reauthenticatePage()`'s only caller (`tryRecoverSessionForPage()`) unaffected by its internal headless-login rewrite (same contract, just faster/more reliable); all 80+ retrofitted call sites confirmed indentation-clean (no bare top-level `expect()` calls remain anywhere in the 7 module files). Broad regression sample (qa, single worker, isolated runs — no full-suite rerun, per the session's own updated policy that sandbox CI is the next full-suite validation): `login.spec.ts` (4/4), the two originally-failing `leads.rbac.spec.ts` icon tests (2/2), `companies.spec.ts`/`contacts.spec.ts` create-with-all-fields (1/1 each), `tasks.rbac.spec.ts` edit (1/1), and — most importantly — the exact `call-logs.rbac.spec.ts:337` test that started this whole investigation (1/1). All clean, zero regressions.

  **This mechanism's actual first real-CI execution (sandbox run `30286886093`, 2026-07-27) exposed a completely different, much more mundane bug than the elaborate token-lifetime/concurrency-race theories initially suspected — a hardcoded, never-CI-verified assumption about `config.apiBaseUrl`'s shape, confirmed root-caused and fixed 2026-07-28.** `loginHeadless()`'s comment (see above) asserted `config.apiBaseUrl` "ALREADY includes the /v1 suffix for every environment" — but that was confirmed only against the local `.env` file, never against the actual GitHub Actions secret backing the same variable name in CI. Real evidence: 64 of the ~90+ failures in that sandbox run (33 admin + 31 restricted), and 98 in the separate qa-regression run `30092655209` (2026-07-26) — both using `ENV=qa`/`QA_API_BASE_URL` — were the identical `Error: Headless login failed for role <x>: HTTP 404 from /v1/users/login`. Root cause confirmed mechanistically, not inferred: `curl -X PUT https://api-qa.sling-dev.com/v1/users/login` → `401` (reaches the real route, rejects bad creds — correct); the identical call **without** `/v1` → `404`. The CI secret evidently lacks the `/v1` suffix the local `.env` copy has — a plain, never-cross-checked drift between local and CI config, not a backend or concurrency issue.
  - **Why it looked like a token-expiry/concurrency spiral:** `ensureFreshSession()` runs unguarded in `createRolePage()`. Once a token's remaining life crossed the 10-minute buffer, every attempted proactive refresh 404'd and threw, failing fixture setup in ~11-18s before the test body ran — and because nothing was ever written on a 404, the next test read the exact same, still-aging token, producing a steady real-time countdown across dozens of consecutive tests (508s → 498s → 482s → … → 15s, one log line per test) that looked exactly like a runaway refresh loop but was actually just "every attempt fails identically, nothing changes." The eventual jump back to a fresh ~38,000-43,000s value was **not** this mechanism succeeding — it was the separate, older, UI-driven `_doLogin()` path (triggered once `attachSessionExpiryListener`'s 401-driven `clearStorageState()` or the periodic `isSessionValid()` check decided the cached state file was dead) succeeding on a completely different code path.
  - **Investigated and ruled out, with direct evidence, before accepting the simpler cause:** token-lifetime/unit/clock-skew bugs (the decode math is correct; the countdown tracks real elapsed time exactly), a backend session-reuse/refresh-is-a-no-op theory (plausible on its face given the earlier "identical token on relogin" finding, but the actual error text — a 404, not a stale-but-valid token — ruled it out directly), and a multi-worker race on the shared storage-state file (the failures track one token's decay curve one test at a time, not a pattern consistent with workers contending over a lock). No architecture change (per-worker isolated sessions, a distributed refresh coordinator, etc.) was warranted or made — the existing shared-storageState-plus-file-lock design was never actually exercised under real concurrency in a way that failed; every attempt died on the wrong URL first.
  - **Fixed:** added `AuthManager.getLoginUrl()` — normalizes `config.apiBaseUrl` (strips trailing slashes, appends `/v1` only if not already present) so the computed URL is correct regardless of which shape a given environment's `.env`/CI-secret happens to use, instead of re-relying on a convention that had already silently drifted once. `loginHeadless()`'s error message now reports the actual computed URL instead of a hardcoded string (the old message text was itself misleading during triage — it always said `/v1/users/login` regardless of what URL was actually requested). Also hardened `fixtures/index.ts`'s call site: `ensureFreshSession()` is now wrapped in try/catch — a failure in this proactive, optional optimization no longer has license to fail an entire test outright; it logs a warning and lets the existing reactive `withSessionExpiryRecovery()`/`click()`/`fill()`/`navigateTo()` paths serve as the backstop if a genuine mid-test expiry occurs anyway. Purely additive to both call sites — `loginHeadless()`'s only caller (`reauthenticatePage()`) and `ensureFreshSession()`'s only caller (`createRolePage()`) are unaffected on the success path.
  - **Verified via direct reproduction against the real backend, not just local `.env`:** a temporary script forced `QA_API_BASE_URL` to the exact CI-shaped value (no `/v1`) in-process, then called the real `getLoginUrl()`/`loginHeadless()` — confirmed the computed URL correctly became `.../v1/users/login` and the headless login **succeeded** against the live QA backend (a real token was returned) even with the CI-shaped input that 404'd before the fix. `tsc --noEmit`/`eslint` clean on both touched files. Regression spot-check: `login.spec.ts` 4/4 clean (unaffected by construction — never touches this code path); `deals.rbac.spec.ts` D12/D13a subset run with `--workers=3` (to exercise both `adminPage`/`restrictedPage` fixtures concurrently) — 2/2 clean, only the already-documented harmless `ai-agent/workflows/subscribed` 500 noise present.
  - **User pushed the fix to sandbox 2026-07-28 (commit "fix: normalize login URL construction..."), triggering CI run `30327587109`.** Live excerpts from that run (pasted mid-run, before completion) showed zero occurrences of `Headless login failed...HTTP 404` and normal, full-duration test execution instead of the previous ~15s fixture-death pattern — consistent with the fix holding, though the run's own complete final tally was still pending as of this write-up. See the very next entry below for what that same run's excerpts led to: a SECOND, independent occurrence of this exact bug class, found and fixed the same day.

- **SECOND occurrence of the exact same `config.apiBaseUrl`-normalization bug class, found ONE DAY after the first — in a call site the first fix's own ripple-check had already grepped and missed, fixed by consolidating into one shared canonical utility instead of a third hand-rolled copy (2026-07-28).** While investigating sandbox CI run `30327587109`'s Quotation-permission and Call-permission test failures (see the Contact-persistence bug's corrected entry below), `DealsPage.ts:1712`'s `fetchCurrentDealApiData()` was found to build its request URL as `${config.apiBaseUrl}/deals/${id}` — the exact same unqualified-`/v1` assumption as `authManager.ts`'s login-URL bug, one day earlier.
  - **Direct proof, against the real backend, using a real deal from the live CI run (430321):** `GET {base}/v1/deals/430321` (correct shape) → `HTTP 200`, real deal data; `GET {base}/deals/430321` (missing `/v1`, the CI-secret shape) → `HTTP 404`, `{"status":"NOT_FOUND"}`. Silently swallowed by the method's own `if (!res.ok) return null` with zero logging on either branch — meaning `getAssociatedContactId()`/`getAssociatedContactName()`/`getAssociatedContactsCount()` (everything routing through this method) returned `null`/`0` in CI **regardless of whether a contact was actually associated**, a systemic false negative, not a trustworthy check.
  - **Root cause of the miss in yesterday's ripple-check, stated plainly, not glossed over:** yesterday's fix (`getLoginUrl()`) DID grep for every `apiBaseUrl` usage and DID surface this exact line (`DealsPage.ts:1733`) in the results — but it was pattern-matched and dismissed as "a logging-only reference" without actually opening the file to read what it does. This is precisely the failure mode a ripple-check exists to prevent: finding a match is not the same as understanding it. The corrective action taken here, not just noted: a proper Phase-1 audit this time opened and read every single match (not just `apiBaseUrl` itself, but every `fetch(`, every `page.request.*`, every `.request.*` hit) across every module page object, `BasePage.ts`, `fixtures/index.ts`, `error-collector/*.ts`, factories, reporters, notifications, and test files — confirmed exactly two real request-URL-construction sites exist in the entire codebase (the login URL and this one); every other `.request()` hit is Playwright's passive `Response.request()` method-accessor on traffic the app's own frontend generates, not something this framework builds, and is categorically unaffected by `config.apiBaseUrl`'s shape.
  - **Fixed by building ONE shared, canonical utility instead of a third independent copy:** added `buildApiUrl(path)` to `config/config.ts` (strips trailing slashes, appends `/v1` only if not already present) — the exact same normalization logic `getLoginUrl()` used to carry inline. `AuthManager.getLoginUrl()` was refactored to call this shared function instead of its own copy, and `fetchCurrentDealApiData()` was fixed to use it too. Mirrors this codebase's own established precedent for exactly this problem shape (`safeWaitForURL()`'s consolidation in `src/utils/navigation.ts`) — one canonical implementation everything routes through, so a third independent hand-rolled copy can't drift into existence later.
  - **Logging added on both branches**, closing the silent-failure gap that let this hide: `fetchCurrentDealApiData()` now logs a `logger.warn` with the actual computed URL, HTTP status, and response body snippet on any failure, and a `logger.debug` with the associated-contacts count on success. This was previously completely silent on both paths.
  - **Verified via direct reproduction against the real backend and via the real code path**, not just the isolated utility: a temporary script forced `QA_API_BASE_URL` to the CI-shaped value and confirmed `buildApiUrl()` correctly computes the `/v1`-qualified URL; a second temporary script drove a real authenticated browser page through the actual `DealsPage.getAssociatedContacts()` method (not a mock) against the same CI-shaped base and got back real, correct data for 4 different live deals (430321-430324) — confirmed via live log line `fetchCurrentDealApiData: GET .../v1/deals/<id> succeeded — associatedContacts count: 1` for every one. `tsc --noEmit`/`eslint` clean. Ripple-checked: `fetchCurrentDealApiData()` has exactly one caller (`getAssociatedContacts()`), whose own return contract is unchanged; `getLoginUrl()`'s only caller (`loginHeadless()`) unaffected; `buildApiUrl()` has exactly these two intentional consumers.

## Module Status
(counts below verified fresh via `npx playwright test --project=chromium --list` on 2026-07-27 — 279 tests total across 17 files; see README.md's Project Overview table for the full per-module UI/RBAC breakdown)
- ✅ Leads (48 tests: 21 UI + 27 RBAC) — +4 vs. 2026-07-17 (L20/L21 UI, L30/L31 RBAC — the Company/Contact Lookup custom-field tests, see Known Issues)
- ✅ Companies (37 tests: 17 UI + 20 RBAC)
- ✅ Contacts (38 tests: 19 UI + 19 RBAC)
- ✅ Deals (42 tests: 19 UI + 23 RBAC) — +3 vs. 2026-07-22 (D37/D38 UI — the 9-custom-field create/edit tests; net +1 RBAC from splitting D13 into D13a/D13b, see Known Issues)
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
| dev | `@smoke` (23 tests) | 1 | GitHub Actions | — |
| qa | `@regression` (~222 tests) | 2 | GHA + Jenkins | — |
| stage | full suite, no grep (~234) | 2 | GHA + Jenkins | — |
| prod | `@prodSafe` only (31 tests) | 2 | Jenkins (primary) | — |
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
