# Kylas Playwright Framework

End-to-end test automation for **Kylas Sales CRM**, built on Playwright + TypeScript. 285 tests across 9 modules (17 spec files), split between functional UI coverage and RBAC (role-based access control) permission testing, running across a 6-branch CI/CD pipeline with its own reporting and email-notification system.

This document is written so a new engineer — or any of us in six months — can get productive in a day without digging through source or chat history. Where something is genuinely unresolved or fragile, it's called out explicitly in [Known Limitations](#known-limitations--open-items) rather than glossed over.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture — How It's Built](#architecture--how-its-built)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Running Tests](#running-tests)
6. [Test Tags](#test-tags)
7. [CI/CD Pipeline](#cicd-pipeline)
8. [Reporting and Notifications](#reporting-and-notifications)
9. [RBAC Testing Philosophy](#rbac-testing-philosophy)
10. [Known Limitations / Open Items](#known-limitations--open-items)
11. [Contributing / Adding a New Module](#contributing--adding-a-new-module)
12. [Troubleshooting](#troubleshooting)

---

## Project Overview

| | |
|---|---|
| **Runner** | Playwright `^1.60.0` |
| **Language** | TypeScript `^6.0.3`, strict mode, ES2022 |
| **Test data** | `@faker-js/faker` `^10.4.0` |
| **Reporting** | Playwright HTML/JSON + `allure-playwright` `^3.9.0` + a custom email/history system (see [§8](#reporting-and-notifications)) |
| **CI** | GitHub Actions (primary for most branches) + Jenkins (primary for `prod`/`main`, manual fallback elsewhere) |
| **Runtime** | Node `>=20.0.0`, npm `>=10.0.0` |

**Modules covered** (9): Leads, Contacts, Companies, Deals, Meetings, Tasks, Quotations, Call Logs, and Dashboard/Login. Every module except Dashboard has both a UI spec and an RBAC spec.

**Current suite size** (verified fresh via `npx playwright test --project=chromium --list` on 2026-07-27, do not trust any older number without re-running this):

| Module | UI tests | RBAC tests | Total |
|---|---:|---:|---:|
| Call Logs | 21 | 22 | 43 |
| Companies | 19 | 22 | 41 |
| Contacts | 19 | 19 | 38 |
| Dashboard/Login | 4 | — | 4 |
| Deals | 19 | 25 | 44 |
| Leads | 21 | 27 | 48 |
| Meetings | 8 | 8 | 16 |
| Quotations | 15 | 14 | 29 |
| Tasks | 11 | 11 | 22 |
| **Total** | **137** | **148** | **285** |

Leads gained 4 tests on 2026-07-21/22: L20/L21 (UI) and L30/L31 (RBAC) cover the new Company Lookup/Contact Lookup custom fields — see `CLAUDE.md`'s Known Issues for the full story, including 9 real bugs found and fixed while building and verifying them.

---

## Architecture — How It's Built

### Page Object Model, anchored on `BasePage`

Every page object (`src/modules/<module>/<Module>Page.ts`) extends `src/core/BasePage.ts`, which supplies the primitives every module reuses: `click`, `fill`, `selectOption`, `waitForVisible`/`waitForHidden`, `waitForUrl`, `assertVisible`/`assertText`/`assertUrl`, `assertNoFormErrors`, `takeScreenshot`, `isVisible`, `getText`, `navigateTo`, `reloadPage`, `getPageTitle`, `getCurrentUrl`, and `getLoggedInUserName`. Nothing module-specific lives in `BasePage` — it stays a thin, shared toolbox so a change to a wait helper doesn't require touching nine page objects.

Every page object follows the **same 10-section order**, top to bottom:

1. `retryConfig` (reads `config.searchRetry` or `config.meetingRetry`)
2. Locators (private `readonly` arrow functions returning `Locator`)
3. Constructor (`super(page)`)
4. Private Helpers
5. Navigation
6. Form Actions
7. Search & Open
8. Edit Actions
9. Assertions
10. Workflow Wrappers

**Why this matters in practice:** with 9 modules maintained by more than one person, the cost of "where do I even look" compounds fast. A fixed section order means anyone can jump into an unfamiliar page object already knowing that retry tuning is at the top and workflow wrappers are at the bottom — no per-file archaeology. Locators are also always lazily-evaluated arrow functions (`private readonly foo = (): Locator => ...`), never captured eagerly at construction time, because the DOM element a locator resolves to may not exist yet when the page object is instantiated.

### Custom fixture system (`src/fixtures/index.ts`)

Never import `test`/`expect` from `@playwright/test` directly in a spec file — always from `src/fixtures/index.ts`. It exports:

- **`adminPage`** / **`restrictedPage`** — the two fixtures nearly every test uses. Both call a shared `createRolePage()` helper that:
  1. Gets a browser context via `AuthManager.getContextForRole(role)` (see below) instead of a raw `storageState`, so an expired session is transparently re-logged-in rather than failing the test.
  2. Attaches `ErrorCollector` listeners (`pageerror`, `console-error`, `requestfailed`, response `>=400`) and a session-expiry listener (401 responses, or a mid-test redirect to `/signIn`) *before* the first navigation, so nothing from the very first page load is missed.
  3. Navigates to the app and races two outcomes — landing on `/sales/` vs. being redirected to sign-in — rather than a single blind `waitForURL`. On a signed-out landing it forces a fresh login and retries once (2 attempts total) before failing loudly with the last-seen URL in the error message.
  4. Dismisses the app's startup popup (`#cancel[data-dismiss="modal"]`) if present.
  5. On CI, staggers `restrictedPage` startup by a random 0–3s to avoid concurrent-session conflicts when multiple workers log in around the same moment.
- **`adminContext`** / **`restrictedContext`** — lighter-weight raw `BrowserContext` fixtures built directly from the saved `storageState` file, with none of the above error-listener/retry machinery. Use these only when a test genuinely doesn't need error capture or session-expiry handling.

### Auth flow and session caching

`src/auth/globalSetup.ts` runs once before the whole suite: logs in both roles, saves `src/auth/storageStates/<env>/<role>.json`, and captures each role's display name to `userNames.json`. During the run, `src/auth/authManager.ts`'s `AuthManager` class:

- Caches session validity **in-memory per role for 30 minutes** (`SESSION_CACHE_MS`), so most tests skip the overhead of re-validating a session that was just checked.
- Uses `withFileLock()` (an `fs.mkdirSync`-based atomic lock) around storage-state writes, so two CI workers racing a re-login don't corrupt each other's write — the actual file write itself is also rename-based (write-to-temp, then atomic rename) rather than a direct in-place overwrite.

### Data factory pattern (`src/data/factories/`)

One factory per module (`leadFactory.ts`, `contactFactory.ts`, `companyFactory.ts`, `dealFactory.ts`, `meetingFactory.ts`, `taskFactory.ts`, `quotationFactory.ts`, `callLogFactory.ts`), each exporting `generateXxxData()` plus RBAC-oriented variants:

- `generateXxxData()` — plain Faker-generated data, used when a restricted user creates their own record (ownership is inherently theirs).
- `generateAdminXxxData()` — prefixed `ADM<timestamp>` — admin-only data.
- `generateSharedXxxData()` — prefixed `SHR<timestamp>` — data the admin creates specifically to then share with the restricted user.

**Why the prefix+timestamp convention exists:** an RBAC test's entire assertion is "restricted user provably cannot see this record unless it's shared with them." Two problems make a plain Faker name insufficient for that: (1) the QA/staging environments never get cleaned up — every module's data accumulates indefinitely — so a search by a generic name can collide with old leftover records from a previous run and produce a false pass; (2) without a distinguishing prefix, there's no cheap way to tell "genuinely admin-owned, never shared" data apart from "shared" data when both need to exist side-by-side in the same test. The `ADM`/`SHR` prefix plus a timestamp makes every run's records uniquely searchable and unambiguously classifiable, which is what makes the negative assertion ("restricted user does NOT see this") trustworthy rather than accidental.

`Country` defaults to `India` in every factory — a hard CRM-side validation requirement, not a test choice.

### Custom fields and GPS address lookup

Lead, Contact, Deal, and Company each have 9 admin-configured custom fields (Text, Paragraph, Number, PickList, MultiPickList, Checkbox, Date, DateTimePicker, URL) added by hand on QA today — they are environment-conditional, not guaranteed to exist on Stage/Prod yet (confirmed live 2026-07-28: Company's fields exist on QA, and gracefully skip via `test.skip()` on both Stage and Prod). `BasePage`'s "Custom Field Helpers" section holds every generic fill/select/assert method (parameterized by the raw Kylas field name, e.g. `"TextField"`), so a module only needs its own `<MODULE>_CUSTOM_FIELD_NAMES` constant (in its own factory) plus a thin `fill<Entity>CustomFields()`/`assert<Entity>CustomFieldsOnDetail()` wrapper — never a full reimplementation. Each generic method checks DOM presence first and skips gracefully (logging why) when a field doesn't exist in the current environment, so the exact same call site starts working unchanged the moment a field is added elsewhere. Company has no lookup-type custom field, same as Deal.

Contact's address field (and Meeting's location field) also expose a "Get GPS Address" lookup — a live, Google-Places-style autocomplete search, not browser geolocation. `BasePage.fillAddressViaGpsOrManual()` (generalized out of `MeetingsPage.ts`, which had this logic private to itself until Contact needed it too) tries the GPS search first and falls back to the manual address string if the trigger isn't present or no predictions come back — returning whichever value was actually entered, since a live third-party lookup's result can't be hardcoded or assumed.

Building Contact's custom-field support (2026-07-14/15) surfaced three real, pre-existing `ContactsPage.ts` bugs, fixed along the way rather than worked around: (1) `disableRequiredFieldsToggle()` clicked unconditionally, which could flip an already-off toggle back on and hide the fields it was meant to reveal; (2) `fillEditForm()` never called that toggle at all, so custom fields were unreachable on update; (3) `modalCancelButton()` was an unscoped, page-wide locator that could resolve to the wrong (hidden, 0×0) modal's close button and hang for the full test timeout — reproduced live as an 805-retry, 8-minute stall before being scoped to the actual open modal. All three mirror bugs already fixed in `LeadsPage.ts` at some point, just never triggered in Contact until a test exercised the exact code path that exposed them.

Building Company's custom-field support (2026-07-28) was a mechanical port of the already-proven Lead/Contact/Deal pattern (`COMPANY_CUSTOM_FIELD_NAMES` in `companyFactory.ts`, `fillCompanyCustomFields()`/`assertCompanyCustomFieldsOnDetail()`/`skipIfCustomFieldsAbsent()` in `CompaniesPage.ts`, wired into both `fillCompanyForm()` and `fillEditForm()`), confirmed live before writing any code: same 9 field internal names (`cfTextField`...`cfUrlField`), same single-scroll modal structure as Contact (no tab-click needed), and a detail-page "Other Details" tab at `#nav-tab3-tab` (shifting the pre-existing "Internals" tab from index 3 to 4 — the identical drift already documented for Deal). Two pre-existing bugs found and fixed along the way while porting, not carried forward blindly: (1) same shape as Contact's bug (2) above — `CompaniesPage.disableRequiredFieldsToggle()` had the identical unconditional-click race already fixed in Contact/Lead (flips an already-off toggle back on) and `fillEditForm()` never called it at all; (2) the DealsPage reference implementation's `assertDealCustomFieldsOnDetail()` uses a raw, unwrapped `tab.click()` with no bounded timeout or session-expiry recovery — Company's port uses the existing `this.click()` helper instead, so the new code introduces zero unprotected raw Playwright calls (Deal's own copy was left as-is — flagged, not silently fixed, since touching `DealsPage.ts` was out of this task's scope).

UI tests: CO18 (create with all 9 fields), CO19 (edit all 9 fields). RBAC gap closed alongside: Deal had zero restricted-user custom-field coverage despite Lead (L29) and Contact (CR20) both having it since their own custom-field work — added D39 (create) and D40 (update) to `deals.rbac.spec.ts`, and COR21 (create)/COR22 (update) to `companies.rbac.spec.ts`, all four mirroring the existing L29/CR20 create-only pattern but extended to cover update too, per explicit request. All 6 new tests (CO18/CO19/COR21/COR22/D39/D40) verified 5/5 clean in isolation on QA each; CO18/CO19 confirmed graceful `test.skip()` on both Stage and Prod (fields not yet present there).

**Final regression gate, real evidence (2026-07-28):** all 10 UI+RBAC spec files touched this session (Companies, Contacts, Deals, Leads, Tasks — 193 tests) run in full on Stage: **189 passed, 0 failed, 0 flaky, 4 expected skips** (CO18/CO19 + COR21/COR22, Company custom fields not yet on Stage). Zero regressions anywhere from the `fillCompanyForm()`/`fillEditForm()` changes or the session-expiry fix below. Verification survived two unrelated network-connectivity drops and one memory-pressure process kill mid-run (each confirmed via direct `curl`/`free -h` checks, not assumed) — every affected batch was discarded and cleanly re-run rather than folded into the final numbers.

### Session-expiry "zombie listener" race — found, root-caused, fixed (2026-07-28)

A real full-suite regression run surfaced a genuinely reproducible-looking flake: `deals.rbac.spec.ts`'s Quotation-permission test failed on attempt 1, passed on Playwright's automatic retry. Root-caused via the run's own log (not assumption): a session expiry mid-test triggered TWO unrelated, stale session-expiry-recovery attempts from `goToContactsList()`/`goToCompaniesList()` calls that had already returned 27-54 seconds earlier in the same test — proof something from those finished calls was still alive and reacting. Mechanism: `BasePage.waitForEntityListPage()` (shared by Companies/Contacts/Deals/Leads) and `TasksPage.waitForListReady()` both raced `armResponseWaitWithRecovery(...)` (which arms real `page.on('response'/'framenavigated')` listeners) against a plain `tableLocator.waitFor(...)` — `Promise.race` never cancels its losing branch, so the abandoned listener-arming promise can keep listening for up to 60s after the calling method returns, ready to fire a wrongly-targeted recovery if a real expiry lands in that window. Fixed by swapping in a plain, listener-free `page.waitForResponse()` for the race's response branch in both places — zero functional change to list-readiness detection, only the dangerous side-channel removed. Verified 5/5 clean on QA (`--retries=0`) plus 3 further clean occurrences across Stage runs, zero retries, zero regressions in the full 193-test Stage regression above. See `CLAUDE.md`'s Known Issues for the full evidence trail, including the one honest limitation (the exact rare trigger timing wasn't cleanly reproduced synthetically, though the structural fix eliminates the mechanism regardless).

See `CLAUDE.md`'s "Custom Fields pattern" and "Reference Patterns" sections for the full field-by-field mechanism breakdown (validation quirks per field type, the DateTimePicker's two-widget split, the Internal-Name-vs-Label rename safety note, etc.) — this README section is intentionally just the map, not the territory.

### Lead's Professional/Location fields, Timezone, Country, and GPS address (2026-07-16)

`LeadsPage.fillLeadForm()` now also fills: Timezone (same react-select field/id as Contact's), the Professional section's Company Industry / Business Type / Company Employees (react-select picklists), Company Annual Revenue (a plain number input — same pattern as the Requirement section's existing Budget field, not a react-select), Company Website (a plain text input that, despite having no native `type="url"` attribute, was confirmed live to show the identical "Enter a valid URL" inline validation as the custom UrlField), a GPS-address lookup for Lead's own address (Location section), and Country (a react-select picklist). Country was confirmed live to auto-populate from a successful GPS selection for free — selecting a real address prediction fills it with no extra interaction — but not from the manual-fallback path (which never calls the Places API), so an explicit random pick still fires in that case specifically. (Company Phones was also built, then deliberately removed — see the fixed-bug note below.)

One hardening fix came out of this work, reusable enough to flag before reusing it elsewhere:

- **GPS trigger is section-scoped, not page-wide.** Lead's form has TWO "Get GPS Address" triggers with identical visible text — one for its own address, one for Professional's Company Address — confirmed live this breaks an unscoped `page.getByText(...)` with a Playwright strict-mode violation the moment Lead is in play (Contact only ever had one trigger, so this never surfaced there). `BasePage.getFormSectionContainer(sectionHeading)` locates a section by filtering `#editEntityModal`'s `div.data-container` elements for the one containing that section's own `<h2>` — confirmed live each section renders its own container wrapping both its heading and all its fields; the container's own numeric `id` is random per render and is never matched on directly. `BasePage.getGpsAddressTrigger(sectionContainer)` plus a new optional 4th parameter on `fillAddressViaGpsOrManual()` use this to scope the click, and now throw a clear error if more than one trigger resolves within the given scope instead of silently falling back to `.first()`. Contact's existing GPS call sites (previously an unscoped `page.getByText('Get GPS Address')`) were refactored onto this same helper — Lead and Contact share one mechanism now. **Re-verified post-refactor (2026-07-17)** — the PART B verification below predates this section-scoping change (the method's own signature changed again after that verification ran), so it didn't actually cover the current code. Re-ran Contact's dedicated GPS test plus the full Contacts UI suite fresh against the current code: 19/19 passed. **Also confirmed on Staging** (not just QA, 2026-07-17): logged in directly and inspected the DOM live — the same `div.data-container`/`<h2>` structure and the same 2 "Get GPS Address" triggers (Location + Professional) exist identically on Staging.

### Fixed: primary-phone locator collided with a since-removed Company Phones field (2026-07-16)

Company Phones was briefly implemented for Lead (a repeatable "Add Phone" field, container-scoped off its stable `<label id="companyPhones">` rather than a loose id substring) but surfaced a real, more fundamental bug: `LeadsPage`'s own primary-phone locator — `phoneInput = () => page.locator('input[id*="input_phone_0"]')` — is a loose substring match that ALSO matched Company Phones' first entry (`4_52_input_phone_0`), since both ids happen to contain that substring. Once a lead had a saved Company Phones value, both inputs coexisted in the DOM simultaneously on any form that pre-fills existing data (Edit, Clone) — confirmed live via a real Playwright strict-mode violation ("resolved to 2 elements"), which silently broke `cloneLead()`'s phone-uniqueness-fix step and made every clone fail against the CRM's duplicate-phone validation.

Company Phones itself was removed rather than kept alongside a workaround, but the actual fix — switching `phoneInput()` from the substring match to the exact `name="phoneNumbers[0]"` attribute (the real bound form field, confirmed live never to collide with a repeatable field's own naming) — was kept and applied to **all three** modules that had the identical fragile pattern (`LeadsPage.ts`, `ContactsPage.ts`, `CompaniesPage.ts`), not just Lead, since it's strictly safer at zero cost and removes a latent risk for whenever any of those modules grows a similar repeatable field in the future.

### Contact's Timezone and Company fields (2026-07-16)

`ContactsPage.fillContactForm()`/`fillEditForm()` now also fill Timezone (same field as Lead's) and Company — a live async lookup against real Company records (`input#4_11_input_company`, requires 3+ typed characters — confirmed live via the app's own "Type atleast 3 characters..." message below that threshold). Company selection is inherently role-scoped with no explicit branching required: `BasePage.selectRandomFromSearchableReactSelect()` searches and picks randomly from whatever the *current* page's own live session returns, and admin vs. the restricted user were confirmed live to see genuinely different, non-empty result sets for the identical search term — so a random pick never assumes one role's list applies to the other.

### Fixed: dynamic-import factory-function pattern in `leads.spec.ts` (2026-07-16)

`tests/ui/leads/leads.spec.ts`'s "admin should delete a lead" test used to import `generateAdminLeadData` via a runtime `await import(...)` + destructure, instead of a normal static top-of-file import like every other factory function in that same file. This made it uniquely vulnerable to a transient module-resolution race — confirmed live it threw `generateAdminLeadData is not a function` while `leadFactory.ts` was genuinely being concurrently edited elsewhere in an unrelated change, even though the function itself was never broken (`git show` on the merge that reorganized `leadFactory.ts` around this time confirms its export was untouched). Fixed by switching to a static import; a codebase-wide grep confirmed this was the only factory function anywhere using the dynamic-import pattern, so nothing else needed the same fix.

### Lead's Requirement text field (2026-07-16)

`LeadsPage.fillLeadRequirement()` (called from both `fillLeadForm()` and `fillEditForm()`, so this works on create and update alike) now also fills a field literally labeled "Requirement" — confirmed live to be a genuine, separate plain text input (internal name `requirementName`, id `5_11_input_requirementName`), distinct from both the section's own "Requirement" `<h2>` heading and from the pre-existing Products or Services / Currency / Budget fields. It's actually the *first* field in the section by DOM order, not fourth — filled first to match. No maxlength or client-side validation was observed on it. Contact has no equivalent field; this is Lead-only.

### Detail-page assertions for the new Lead/Contact fields (2026-07-17)

All the Lead/Contact fields added on 2026-07-16 above are now genuinely verified on the detail page after save, not just accepted by the form. Each field's detail-page container id and rendering format was confirmed via **direct live DOM inspection** (not guessed) before writing the assertion. Lead's `assertLeadStandardFieldsOnDetail()` now checks Timezone (`#timezone`, Communication tab), Country (`#country`, Location tab), all 5 Professional fields (`#companyIndustry`/`#companyBusinessType`/`#companyEmployees`/`#companyAnnualRevenue`/`#companyWebsite`, Professional tab — Company Annual Revenue confirmed to render as a plain number with no currency formatting, so `String(value)` matches directly), and Requirement (`#requirementName`). Contact's `assertContactDetailFields()` now checks Timezone and Company. Verified 3× each with fresh random data per run (which stress-tests the assertions across differing field values): Lead create + update 6/6, Contact create + update 6/6, Lead RBAC create 1/1. Lead's create-only fields (Timezone/Country/Professional — see the edit-form asymmetry note in [Known Limitations](#known-limitations--open-items)) are asserted on the create path only, via an `assertCreateOnlyFields` flag the update caller sets to `false`; Requirement and the pre-existing Salutation/Products/Currency/Budget are asserted on both paths.

### Fixed: `escapeRegExp()` duplicated privately across 5 page objects (2026-07-16)

Found while adding exact-match support to Contact's Company lookup: `escapeRegExp()` (the anchored-regex helper used to select an exact option from a search dropdown by name, avoiding a substring false-match against a similarly-named entity) existed as a **private, byte-for-byte identical** method in `DealsPage.ts`, `CompaniesPage.ts`, `ContactsPage.ts`, `LeadsPage.ts`, and `TasksPage.ts` — five separate copies of the same 2-line function, none aware of the others. Moved to one shared `protected BasePage.escapeRegExp()`; all five call sites now inherit it, with the private duplicates removed.

### `BasePage.selectRandomFromSearchableReactSelect()` gained an `exactValue` option (2026-07-16)

Same reasoning as `DealsPage.selectFirstOptionFromDropdown()`'s existing `exactName` parameter: for a test where the selected entity's specific identity matters (e.g. a Contact needs to be associated with a *freshly-created, known* Company so that company can also be independently shared and verified), picking randomly from whatever exists live is unsafe. Passing `exactValue` searches for and selects that exact option instead of a random one; passing neither preserves the original random-pick behavior unchanged.

### Fixed: Deals' `selectFirstOptionFromDropdown()` could hang for the full test timeout (2026-07-16, superseded 2026-07-17)

Root-caused a real, reproducible failure (`tests/rbac/deals.rbac.spec.ts` and `tests/ui/deals/deals.spec.ts`, both hitting an 8-minute test timeout inside this method while selecting a randomly-picked option from a large, unfiltered Associated Contact/Company lookup list): `playwright.config.ts` sets no `actionTimeout` at all, and this method's final `selectedOption.click()` was a raw, un-timed Playwright action — bypassing the shared `BasePage.click()` helper, which already carries an explicit 15s timeout specifically to prevent this class of bug (see that method's own comment). A transient detach/re-render of the options list (confirmed live via Playwright's own "element was detached from the DOM, retrying" message) then retried silently with no independent timeout, consuming the entire test budget instead of failing fast. The original fix (2026-07-16) was a bounded-timeout (15s), 3-attempt retry loop that retried the *same* `allOptions.nth(randomIndex)`. Re-verified 3× back-to-back with `--retries=0` on both originally-failing tests (6/6 passed), then re-confirmed at full-module scale: 3 complete `deals.spec.ts` + `deals.rbac.spec.ts` runs (117 total test executions across all Associated Contact/Company selections in the module) — zero dropdown-related failures across all 3 runs.

**Superseded 2026-07-17** by a second, more general failure mode found during the overnight run: one specific option *index* can be persistently non-actionable while other indices in the same list work fine, making a same-index retry futile. The fix was generalized into a single shared `BasePage.selectRandomOptionWithRetry(options, description, opts?)` — same 15s-bounded read+click, 3 attempts, but each attempt **re-rolls a fresh random index** instead of re-trying the one that just failed. `DealsPage.selectFirstOptionFromDropdown()`'s random-pick branch now delegates to it (`DealsPage.ts:495`), and the same shared method replaced 6 other identical unbounded random-option-pick call sites across `DealsPage.ts` (product row, associated contact), `TasksPage.ts`, `CallLogsPage.ts`, and `MeetingsPage.ts` — the same bug class existed in all of them, just never surfaced as an 8-minute hang there yet.

### `BasePage.fillSearchAndWaitForOptions()` — retry a react-select search on a transient network blip (2026-07-17)

Found during the overnight 272-test run: a company-lookup search (`Contact`'s Company field, via `selectRandomFromSearchableReactSelect()`) failed a whole test attempt because its underlying `/v1/companies/lookup` request hit `ERR_NAME_NOT_RESOLVED` — a brief DNS blip, not an application or test-logic problem, only recovered by Playwright's own outer test-level retry. `BasePage.ts` gained two pieces to target exactly this, and nothing broader:

- `TRANSIENT_NETWORK_ERROR_PATTERNS` (`BasePage.ts:172`) — a deliberately narrow allowlist of connection-layer error signatures that mean "no response was ever produced" (`ERR_NAME_NOT_RESOLVED`, `ERR_INTERNET_DISCONNECTED`, `ERR_NETWORK_CHANGED`, `ERR_CONNECTION_RESET`/`REFUSED`/`TIMED_OUT`, `ERR_ADDRESS_UNREACHABLE`). Deliberately excludes real HTTP 4xx/5xx responses (the server DID answer) and `ERR_ABORTED` (a routine navigation cancel) — widening this list requires the same live-evidence bar, since a false inclusion would silently retry a genuine failure.
- `fillSearchAndWaitForOptions()` (`BasePage.ts:213`) — fills the search input, arms a scoped `requestfailed` listener before the fill (so the failure can't be missed), and waits for options to appear. If they don't appear **and** a transient error was actually observed on a backend (`/v1../v9..`) request during that attempt, it clears the input, waits 1.5s (sized to the observed blip duration, not guessed), and retries — up to 3 attempts total. A non-transient failure (zero real results, or a real 4xx/5xx) is never retried; it falls straight through to a loud throw. `selectRandomFromSearchableReactSelect()` (`BasePage.ts:599`) now calls this instead of a single unretried fill.

This was implemented and left undocumented here until now — a real gap in the overnight work's own Step 5 (README/CLAUDE.md write-up), found and closed 2026-07-18 while reconciling this session's actual code against its own history.

### Overnight full-suite investigation (2026-07-16/17) — a confirmed ID-capture bug class, a real race condition, one genuine efficiency fix, and one disproven hypothesis

A full 272-test suite run (6.5h) surfaced 1 terminal failure + 5 flaky tests. Each was root-caused individually — see `CLAUDE.md`'s audit section for full per-item evidence; this is the map.

**Confirmed ID-capture false-positive bug, found in 3 places.** `DealsPage.captureDealIdFromResponse()`, `CompaniesPage.captureCompanyIdFromResponse()`, and a third instance in `DealsPage`'s "add quotation from deal panel" flow all used a bare `.includes('/deals')`/`.includes('companies')`/`.includes('/quotations')` substring match with no version prefix — each could match an unrelated background analytics/reports POST (`/v4/reports/deals`, confirmed live) that raced ahead of the real create/clone response, silently capturing `null` and throwing "save likely failed silently" even though the save had genuinely succeeded (confirmed via the exact toast text, e.g. "Quotation created (Quotation ID: 8794)"). Fixed all three by requiring the real, confirmed `/v1/<module>/` path and excluding `/reports/`; the Quotations instance also gained a toast-text fallback (reusing `QuotationsPage.captureIdFromToast()`'s already-proven parse) as defense-in-depth.

**Real race condition in `DealsPage.cloneDeal()`, root-caused with direct evidence, not assumed.** Even after the ID-capture fix, the clone test still failed intermittently. Direct request/response instrumentation showed the Save click sometimes produces **zero network activity for 60+ seconds** — not a slow response, no request at all — while the button itself stayed visible/enabled/unchanged the whole time. This rules out a detached/replaced element, a slow backend, and rate-limiting (all would show *some* network signal). Most likely cause: the click landed only ~80ms after the Clone modal became visible, while its own async pre-fill (name/owner/pipeline/contacts/company/products/campaign fields) was still committing — a React click-handler-not-yet-attached race. Fixed with a real DOM-readiness check (`await expect(nameInput).toHaveValue(/Copy/)` before clicking Save — confirms the modal's own pre-fill has actually committed) instead of a guessed delay. A first fix attempt (click-then-retry-on-no-request) was tried, made things measurably **worse** (0/5 clean, new hang), and was reverted before landing on the working fix. Verified 13/13 clean (8 isolated reproductions + 5 real test runs).

**Confirmed real, fixed, cross-environment-verified: a per-row DOM-read loop in `QuotationsPage.ts`.** Three methods (`retryFindInList()`, `assertQuotationNotInList()`, the create-quotation toast-fallback path) looped through every list row with an individual `.innerText()` call (one round-trip each) to find/check non-empty rows — the exact same *shape* of waste as the date-picker fix below (doing more round-trips than necessary for an identical result). Replaced with a single batched `allTextContents()` call. Verified with real timing across all 3 environments, 3 runs each: batched was faster in all 9 runs — QA 6.4×-33.8×, Staging 1.4×-31.1×, Prod 11.5×-38.2× (magnitude varies with each environment's real latency, which is expected; the fix itself is a pure round-trip reduction, not tuned to any one environment's timing). Functional re-verify: 3/3 clean on QA. Staging/Prod's full functional Quotations suite could not be run — both are missing the `*_ADMIN_DEAL_NAME` config the suite needs (a pre-existing environment gap, not new) — flagged as an open verification gap rather than assumed to generalize.

**Deals' dropdown-click bounded-timeout fix (already documented below) — now verified across the FULL Deals module, not just the 2 originally-failing tests.** 3 full `deals.spec.ts` + `deals.rbac.spec.ts` runs (117 total test executions): 0 dropdown-related failures across all 3. One unrelated flaky test appeared twice in these runs — the Quotation-from-deal-panel bug above, found and fixed as a direct result of this verification work.

**Investigated and DISPROVEN, not fixed: a hypothesis about the suite's single biggest time cost.** Profiling the overnight log found 2.4 hours (37% of the run's 6.5h) sitting in the gap after every "Creating authenticated browser context" call (100% of 351 instances took ≥8.7s, mean 24.4s). Hypothesized `page.goto(..., {waitUntil: 'domcontentloaded', timeout: 60000})` was an unnecessarily strict wait. Tested live: isolated timing showed the entire goto+landing sequence takes 3.8-5.2s regardless of `waitUntil` value — nowhere near 22-25s, and `commit` wasn't measurably faster than `domcontentloaded`. This disproves the client-side-inefficiency theory. The real cause is very likely genuine QA-environment load accumulating over a long, continuously-running suite (consistent with the already-documented "QA data grows unboundedly" limitation, and with the host's own swap being 100% full during the same run) — **not something to fix by touching `waitUntil`, the 60s timeout, or any retry count.** Documented here specifically so nobody re-attempts this exact hypothesis without re-deriving why it doesn't hold.

**CR13** (`tests/rbac/contacts.rbac.spec.ts`, "admin shares contact with Note Task Meeting Call permissions...") **title corrected** — it previously claimed "Quotation permissions"/"all five" but only ever tested 4 (Quotation is genuinely inapplicable to Contacts' restricted-user view, not just skipped — see the existing CR11-removal note in the same file).

### Contact + Meeting/Company RBAC — corrected premise, not a bug (2026-07-16)

Initial investigation suspected a Contact-side instance of the confirmed Lead+Meeting backend bug documented below (same errorCode `01503001`, same "Invalid company summary response." message) when creating a Meeting from a Contact that has an associated Company, if that company was never independently shared. **Corrected**: this is genuine, correct RBAC enforcement, not a bug — sharing a Contact without also sharing its associated Company means the restricted user truly cannot access that company, so any action requiring the company's data (Meeting creation) should correctly fail.

`tests/rbac/contacts.rbac.spec.ts`'s single-Meeting-permission test was reframed as a negative assertion (asserts the `422`/`01503001` denial via the network response itself, not just "the save threw"), and a new positive counterpart was added: a fresh Contact associated with a fresh, known Company (via the `exactValue` support above), with **both** the contact and the company shared — including the company sharing the same `meeting` permission granted on the contact, not a bare/empty-permissions share, which is what actually made the positive case pass. The combined multi-permission test (`admin shares contact with Note Task Meeting Call permissions...` — see the CR13 title correction above, this test's title used to also claim Quotation) was updated the same way, since its own Meeting portion needed the company shared too. Confirmed via already-collected pass data (not re-guessed) that Note/Task/Call do **not** have this company-dependency — only Meeting does; Quotation was already excluded from this suite for an unrelated, pre-existing reason. All three affected tests reconfirmed 3× back-to-back (9/9 passed).

As defense-in-depth against the same transient propagation-lag class documented for Lead below, the positive Contact case also uses the existing retry wrapper — renamed from `saveMeetingRetryOnLeadSummaryLag()` to `saveMeetingRetryOnEntitySummaryLag()` since its errorCode-only check was already generic, just the name implied Lead-only.

### Two more `net::ERR_ABORTED` endpoints added to the known-noise list (2026-07-16)

`/v1/meetings/layout?view=edit` and `/v1/tasks/relation` (the query-param form, distinct from the already-covered numeric-id `/v1/tasks/\d+/relation`) confirmed live, directly, in real otherwise-fully-passing runs to abort on navigation with zero test impact — added to `ABORT_ON_NAVIGATE_PATTERNS` in `errorFilters.ts`. Two further endpoints (`/v1/deals/layout`, `/v1/products/layout`) were also added on the strength of a user-reported CI run showing the identical pattern, but were **not** independently reproduced in this session's own runs — flagged in the source comment as second-hand evidence, not personally confirmed, in case either needs revisiting if a real failure ever correlates with it.

### 13 more error-classification entries, each individually evidence-checked (2026-07-17)

From the overnight full-suite run's 91 background errors: added `has-duplicates` to `BACKGROUND_WIDGET_NOISE_PATTERNS` — a background duplicate-check that 400s with "doesn't seem to exist or you don't have enough permissions" whenever the record is either correctly RBAC-inaccessible or was just deleted (4 confirmed instances, each individually explained, zero test-outcome correlation). Added 12 more endpoints to `ABORT_ON_NAVIGATE_PATTERNS` (`/v1/search/deal`, `/v1/search/lead`, `/v1/search/company`, `/v1/layouts/lead/edit`, `/v1/layouts/lead/detail`, `/v1/layouts/task/create`, `/v1/leads/layout/list`, `/v1/deals/layout/list` [singular — distinct from the existing plural `layouts/list` entry], `/v2/email-threads/search`, `/v1/oauth/{gmail,outlook}/authorization-url`, bare `/v1/contacts`/`/v1/leads/`) — each cross-checked against the run's own final pass/fail list before its raw report was lost to a later run overwriting the shared `misc-errors.json` file (see the open item below). **Deliberately NOT added**, despite being the single largest category (60 of 91 entries): the recurring `net::ERR_ABORTED` on the app's own JS bundles (`vendors.*`/`index.*`) — unlike every other noise entry, this one directly correlated with a real (if self-healing) test failure tonight, so it does not meet the "zero test-outcome impact" bar this list requires. It's a recurring, low-grade environmental characteristic (present from 25 minutes into the run onward, not a late-run resource-exhaustion pattern), not something to silently filter.

### Retry / flake mitigation

`config.searchRetry` (per-env retry count + wait) drives every `searchAndOpen*`/`retryFind*` method across modules. Meetings use a separate, longer `config.meetingRetry` because calendar-data aggregation is measurably slower than a plain list search. Page objects must read from these config values — hardcoding a retry count or a `waitForTimeout` loop bypasses the one place retry behavior is tuned per environment.

### Error collection (`src/error-collector/`)

`ErrorCollector` is a singleton attached by the fixtures to every `adminPage`/`restrictedPage`, passively capturing `pageerror`, `console-error` (type `error`), `requestfailed`, and any HTTP response `>= 400` during every test — independent of whether the test itself asserts on anything. `errorFilters.ts` then classifies each captured error into one of three buckets before it's written out:

1. **Noise** — dropped entirely (`isNoise()`): third-party scripts (Grammarly, Sentry, Stripe, font/CDN assets), `HTTP 429` rate-limiting, and `ERR_ABORTED` on a large, individually-enumerated list of background/prefetch endpoints that Playwright's own navigation legitimately cancels mid-flight.
2. **Expected RBAC** (`isExpectedRbacError()`) — HTTP `422`/errorCode `029003`, or specific "you don't have permission" message patterns. This is the CRM correctly denying restricted-user access — expected, but still counted and shown, just not flagged as a regression.
3. **Known background noise** (`isExpectedBackgroundNoise()`) — a **deliberately narrow** subset of endpoints (AI-workflow subscription checks, calendar-integration status, marketplace widgets, tenant usage/feature checks, dashboard summary-card polls, etc.) where a *completed* `4xx`/`5xx` response (not just an aborted one) has been individually confirmed, live, to never correlate with a test failure. Every entity CRUD/detail/search/layout endpoint is deliberately **excluded** from this list — those are load-bearing (page objects wait on their responses), so a real failure there must keep surfacing as unexpected. Widening this list without the same live-evidence bar is exactly the kind of change that could quietly bury a real outage.

Anything not caught by one of the three buckets above is **unexpected** and is what the end-of-run email and `misc-errors.json` report treat as worth investigating.

---

## Project Structure

```
kylas-playwright-framework/
├── .github/
│   ├── scripts/
│   │   └── detect-tests.sh              # Selective test detection for sandbox CI
│   └── workflows/
│       ├── dev.yml                      # push→dev — @smoke, primary for dev
│       ├── qa.yml                       # push→qa — @regression, primary for qa
│       ├── stage.yml                    # push→stage — full suite, primary for stage
│       ├── prod.yml                     # workflow_dispatch only — @prodSafe, manual/emergency (Jenkins.prod is primary)
│       ├── main.yml                     # workflow_dispatch only — @regression, manual/emergency (Jenkins is primary)
│       ├── sandbox.yml                  # push→sandbox — selective, via detect-tests.sh
│       └── staging-promotion-gate.yml   # workflow_dispatch only — gates staging→prod auto-merge
├── config/
│   └── config.ts                        # Single source of truth: env URLs/creds, timeouts, retry config
├── src/
│   ├── auth/
│   │   ├── globalSetup.ts               # Logs in both roles once before the suite
│   │   ├── authManager.ts               # Session cache, cross-process file lock, re-login
│   │   └── storageStates/<env>/         # Saved browser storage states per role (gitignored)
│   ├── core/
│   │   └── BasePage.ts                  # Base class every page object extends
│   ├── data/
│   │   ├── factories/                   # generateXxxData() per module (8 factories)
│   │   └── files/                       # Static fixture files (e.g. upload attachments)
│   ├── error-collector/
│   │   ├── ErrorCollector.ts            # Per-worker singleton — captures + classifies runtime errors
│   │   └── errorFilters.ts              # Noise / RBAC-expected / background-noise pattern lists
│   ├── fixtures/
│   │   └── index.ts                     # adminPage, restrictedPage, adminContext, restrictedContext
│   ├── modules/
│   │   ├── call-logs/CallLogsPage.ts
│   │   ├── companies/CompaniesPage.ts
│   │   ├── contacts/ContactsPage.ts
│   │   ├── dashboard/LoginPage.ts
│   │   ├── deals/DealsPage.ts
│   │   ├── leads/LeadsPage.ts
│   │   ├── meetings/MeetingsPage.ts
│   │   ├── quotations/QuotationsPage.ts
│   │   └── tasks/TasksPage.ts
│   ├── notifications/
│   │   ├── adapters/EmailAdapter.ts
│   │   ├── config/notificationConfig.ts # SMTP settings + per-env/per-branch recipient lists
│   │   ├── scripts/
│   │   │   ├── loadDotEnv.ts
│   │   │   ├── notify.ts                # `npm run notify` — sends the run-summary email
│   │   │   └── syncHistory.ts           # `npm run history:sync` — appends to ci/reporting-history
│   │   ├── EmailTemplate.ts             # HTML email renderer — orchestrator + one buildXxx() per section
│   │   ├── NotificationService.ts       # Orchestrates parse → history → analysis → email
│   │   ├── RunHistory.ts                # Pure logic: append/prune, delta, recurring-flaky/-failing, module trend, slow-test trend, suite drift, pass-rate series
│   │   ├── FailureAnalyzer.ts           # Pure logic: classifies + clusters failures on real matching signal only
│   │   └── AutomationHealth.ts          # Pure logic: weighted 0-100 health score + label + factors
│   ├── reporters/
│   │   └── MiscErrorReporter.ts         # Merges per-worker error files → reports/<env>/misc-errors.json
│   └── utils/
│       └── logger.ts                    # logger.info/warn/error/success — never console.log
├── tests/
│   ├── ui/<module>/<module>.spec.ts     # Functional UI tests (adminPage)
│   └── rbac/<module>.rbac.spec.ts       # Permission tests (adminPage + restrictedPage)
├── scripts/
│   ├── reset-sandbox.sh
│   ├── rotate-reports.sh                # Rotates reports/<env>/latest → previous before a local run
│   └── sandbox-deploy.sh                # Resets sandbox branch to dev, merges feature branch, pushes once
├── reports/<env>/{latest,previous}/     # Namespaced Playwright HTML/JSON + Allure output, per environment
├── Jenkinsfile, Jenkinsfile.qa, Jenkinsfile.staging, Jenkinsfile.prod, Jenkinsfile.sandbox
├── playwright.config.ts
├── tsconfig.json
├── CLAUDE.md            # Guidance for AI coding agents working in this repo — canonical code patterns, audit findings
├── CONTRIBUTING.md       # Daily workflow, adding a module, test conventions
├── GIT_WORKFLOW.md       # Branch promotion mechanics (PR chain, golden rules)
└── package.json
```

---

## Getting Started

**Prerequisites:** Node.js `>=20.0.0`, npm `>=10.0.0`.

```bash
git clone <this-repo-url>
cd kylas-playwright-framework

npm install
npx playwright install chromium

cp .env.example .env
# Fill in credentials — see the table below for what's actually required

npx tsc --noEmit               # sanity check — should report no errors

ENV=qa npm run test:leads      # run one module end-to-end to confirm the setup works
```

### Environment variables

`config/config.ts` reads `ENV` (`qa` | `staging` | `prod`, default `qa`), uppercases it to a prefix, and resolves every value below from `<PREFIX>_*`. **Only the active environment's variables are required** — `config.ts` throws at startup only for the active `ENV`'s missing values, so you don't need staging/prod credentials to run against QA.

| Variable | Required? | Notes |
|---|---|---|
| `<PREFIX>_APP_URL` | Yes | Throws at startup if missing |
| `<PREFIX>_ADMIN_EMAIL` / `_ADMIN_PASSWORD` | Yes | Full-access "Playwright Automation" user |
| `<PREFIX>_RESTRICTED_EMAIL` / `_RESTRICTED_PASSWORD` | Yes | Limited-access "User 1", used by every RBAC test |
| `<PREFIX>_API_BASE_URL` | No | Read but not enforced — defaults to `''` if unset |
| `<PREFIX>_ADMIN_DEAL_NAME` / `_RESTRICTED_DEAL_NAME` | Only for some Quotations tests | Quotations are created against a pre-existing deal in the DB; read via `config.deals` |

**Note:** the checked-in `.env.example` currently only lists the `*_DEAL_NAME` variables — it does **not** list `APP_URL`/`API_BASE_URL`/`ADMIN_EMAIL`/etc. for any environment. Don't assume `cp .env.example .env` gives you a complete file; you need to add the credential variables above yourself. (Flagged again in [Known Limitations](#known-limitations--open-items).)

```bash
# Reset auth if sessions look stale (QA sessions expire after ~1 hour)
rm -rf src/auth/storageStates/qa/
```

---

## Running Tests

All of the following are real `package.json` scripts or direct Playwright invocations — nothing here is invented.

### Per-module (UI + RBAC together), via npm script

```bash
ENV=qa npm run test:leads
ENV=qa npm run test:contacts
ENV=qa npm run test:companies
ENV=qa npm run test:deals
ENV=qa npm run test:tasks
ENV=qa npm run test:meetings
ENV=qa npm run test:call-logs
ENV=qa npm run test:quotations          # UI only
ENV=qa npm run test:quotations:rbac     # RBAC only, separately
```

Each of these appends `&& npm run notify` — an email goes out after every one of these runs (see [§8](#reporting-and-notifications)).

### Other npm scripts

```bash
npm run test              # plain `playwright test`, no post-run notify
npm run test:ui           # all tests, --project=chromium, then notify
npm run test:rbac         # every tests/rbac/*.spec.ts file, then notify
npm run test:login        # tests/ui/dashboard/, then notify
npm run test:headed       # --headed, then notify
npm run test:debug        # --debug (Playwright inspector)
npm run test:notify       # `npm test` then notify, unconditionally
```

`pretest` runs `scripts/rotate-reports.sh` automatically (local only — skipped when `$CI` is set), rotating `reports/<env>/latest` to `previous` before the new run starts. `posttest` runs `npm run notify` automatically, also local-only — in CI, each workflow/Jenkinsfile calls `notify` (and `history:sync`) as its own explicit step instead.

### Direct Playwright invocations

```bash
# Single spec file
ENV=qa npx playwright test tests/ui/leads/leads.spec.ts --project=chromium --workers=1
ENV=qa npx playwright test tests/rbac/leads.rbac.spec.ts --project=chromium --workers=1

# Single test by name
ENV=qa npx playwright test --grep "admin should create a new lead" --project=chromium

# By tag
ENV=qa npx playwright test --grep "@smoke" --project=chromium --workers=1

# Against a different environment
ENV=staging npx playwright test --project=chromium --workers=2
ENV=prod npx playwright test --project=chromium --workers=2
```

Locally, 4 browser projects are configured (`chromium`, `firefox`, `webkit`, `mobile-chrome` — see `playwright.config.ts`); pass `--project=<name>` to pick one, or omit it to run all four. **In CI, only `chromium` is configured** — there is no cross-browser coverage in any pipeline today.

### Reports

```bash
npm run report:playwright         # opens reports/playwright-report
npm run report:allure             # generates + opens the Allure report
npm run clean                     # rm -rf test-results reports/ allure-results
```

### Code quality

```bash
npx tsc --noEmit      # type check
npm run lint          # eslint . --ext .ts
npm run lint:fix
npm run format         # prettier --write .
```

---

## Test Tags

Every test carries at least one tag in its title (`@smoke`, `@regression`, `@prodSafe`); many carry two. Verified counts across the current 272-test suite (tags overlap, so these don't sum to 272):

| Tag | Count | Meaning | Runs on |
|---|---:|---|---|
| `@smoke` | 23 | Navigation/happy-path only — "does the page load and the core flow work" | `dev` branch (every push) |
| `@regression` | 259 | The full functional + RBAC suite | `qa` branch (every push), and manually via `main.yml` |
| `@prodSafe` | 31 | Read-only — safe to run against real production data (no creates/edits/deletes) | `prod` branch (Jenkins primary; `prod.yml` manual fallback) |

`stage` and the base `Jenkinsfile` (for `prod`/`main`) run with **no `--grep` filter at all** — the entire 272-test suite.

---

## CI/CD Pipeline

### Branch flow

```
feature/* → dev → qa → stage → prod → main
     ↑
  sandbox (pre-PR smoke check, cut from dev)
```

Feature branches are cut from `dev`. Before opening a PR into `dev`, push to `sandbox` (`sandbox.yml` selectively runs only what your change plausibly affects). From there, each promotion (`dev→qa→stage→prod→main`) is its own PR — see `GIT_WORKFLOW.md` for the exact branch-cutting/push sequence per hop.

### Per-branch matrix (verified directly against every workflow/Jenkinsfile — CLI `--workers`/`--grep` flags always win over `playwright.config.ts` and any `WORKERS` env var)

| Branch | Primary CI | Trigger | Scope | Workers (actual, from the CLI invocation) |
|---|---|---|---|---|
| `sandbox` | GitHub Actions (`sandbox.yml`) | push | Selective, via `detect-tests.sh`; falls back to `@smoke` with no changed files | Dynamic: 2 if the detected target has >50 tests, else 1. (`Jenkinsfile.sandbox` exists as a manual fallback and always uses 1, regardless of target size — a real, minor divergence from the GHA path.) |
| `dev` | GitHub Actions (`dev.yml`) | push | `@smoke` | 1 |
| `qa` | GitHub Actions (`qa.yml`) | push | `@regression` | 2 (`Jenkinsfile.qa` is explicitly commented "NOT the primary CI for qa branch" — kept only for manual runs, also `--workers=2`) |
| `stage` | GitHub Actions (`stage.yml`) | push (+ manual) | Full suite, no `--grep` | 2 (`Jenkinsfile.staging` is explicitly commented "NOT the primary CI for stage branch" — manual only, also `--workers=2`) |
| `prod` | **Jenkins** (`Jenkinsfile.prod`) | Jenkins: branch push. `prod.yml`: manual only | `@prodSafe` | 2 |
| `main` | **Jenkins** (base `Jenkinsfile`, commented "primary CI for prod and main only") | Jenkins: branch push/manual. `main.yml`: manual only | Full suite (Jenkinsfile) / `@regression` (`main.yml`) | 2 |
| — | `staging-promotion-gate.yml` | manual only (`workflow_dispatch`) | Full suite against **`STAGING_*`** secrets, then gates an approval-based auto-merge of `staging`→`prod` | 2 (this is the one CI path where the `WORKERS` env var is actually read by `playwright.config.ts`, since no `--workers` CLI flag is passed) |

**Two similarly-named files, deliberately disambiguated in their own headers (added 2026-07-07):**
- **`stage.yml`** — ordinary, push-triggered CI for the `stage` branch. No approval gate, no auto-merge.
- **`staging-promotion-gate.yml`** (renamed from `staging.yml`) — manual-only, runs against `STAGING_*` secrets, and on success + human approval via a `production-approval` GitHub Environment gate, auto-merges `staging` into `prod` with no further review. Given that blast radius, it previously had **no failure notification at all**; it now sends one like every other pipeline.

Read each file's own header comment if you're ever unsure which is which — both now explicitly cross-reference the other.

### What every CI run actually does

1. Checkout, install Node, `npm ci`, install the `chromium` browser.
2. Run the scoped test command for that branch (table above).
3. `npm run history:sync` — append this run's stats to the persistent run-history ledger (see [§8](#reporting-and-notifications)).
4. `npm run notify` — send the summary email.
5. Archive/publish the HTML report as a build artifact.

---

## Reporting and Notifications

_Restrained-enterprise email redesign (2026-07-14) — full rewrite of `EmailTemplate.ts` into an
orchestrator plus one `buildXxx()` method per section, two new pure-logic modules
(`FailureAnalyzer.ts`, `AutomationHealth.ts`), and an extended `RunHistory.ts` schema. Every
capability described below as of the 2026-07-07 P0–P5 overhaul is preserved; what's new is called
out explicitly._

### Email summary (`npm run notify` → `src/notifications/scripts/notify.ts`)

After (almost) every run, `NotificationService` parses the Playwright JSON report via `ReportParser`,
reads `reports/<env>/misc-errors.json`, reads `reports/<env>/history-delta.json` (if present), derives
a failure-cluster list and an automation-health score, and renders an HTML email via `EmailTemplate`.
It's sent through Gmail/Zoho SMTP (`src/notifications/config/notificationConfig.ts`) to a QA team
recipient list, chosen per-branch first, falling back to per-environment.

The email now includes:
- A **masthead + full-width status banner**: brand, Automation Health label, and a prominent
  PASSED/FAILED/UNSTABLE banner (✅/❌/⚠️) directly below it — a deliberate two-block layout (not
  one pill doing both jobs), so status is visible at a glance without opening the email.
- A **stale-report warning** (see [Report freshness check](#report-freshness-check) below) — rendered
  as the very first thing in the email, above the masthead, when the underlying data is suspiciously
  old.
- **Header metadata badges** (ENV/BRANCH/BUILD/SOURCE) — color-coded by actual value, not one flat
  color: ENV varies by environment (prod/staging/qa each a distinct color), SOURCE varies by CI source
  (Jenkins/GitHub Actions/local each a distinct color, with 🔧/🐙/💻 to match), BRANCH/BUILD are flat.
  This mirrors the pre-2026-07-14 template's exact color values and structure — checked directly via
  `git show` against that version rather than guessed. See
  [Email design & compatibility](#email-design--compatibility) below for why these are solid hex
  colors, not the more "obvious" `rgba()` choice.
- An **Executive Summary** — plain-language deployment recommendation, prominently flagging any
  **suite drift** (see below) and any multi-test failure cluster.
- An **Automation Health** score (0–100, Excellent/Good/Needs Attention/Critical) with its weighted
  factors, in the masthead and its own dedicated block.
- A **KPI dashboard** — total/passed/failed/skipped/flaky/pass-rate/duration/modules/retries (each tile
  tinted a subtle semantic color — light green/red/amber — matching its status, not flat white), plus
  conditional signal chips for background errors, infra-classified failures, new failures (vs. the
  previous run), and recurring-flaky count.
- A **trend section**: Δ vs. the previous run, a pass-rate **sparkline** across the last ~10 runs,
  recurring-flaky *and* recurring-failing tests (see the lookback note below), and modules trending
  worse.
- **Module Analytics** — the per-module breakdown table, now ranked by health (not alphabetical) with
  a per-module trend arrow, and a one-line Total/UI/RBAC caption above it (previously its own
  standalone "Test Type Split" block).
- **Slowest Tests** (top 5, unchanged) — now with previous-duration/diff and a regression flag.
- **Flaky Tests** — now with historical frequency and a derived risk level (High/Medium/Low/New).
- **Failure Clusters** (replaces the old flat failed-tests table) — failures sharing a *real* matching
  signal (identical error message, same source location, or same failing API endpoint+status,
  cross-referenced against `misc-errors.json`) are grouped under one header showing "N tests
  affected," each with its own full title/file/error/trace detail still listed underneath — nothing is
  summarized away, and two failures are never merged without a real shared signal.
- A **background-errors** section (unchanged in substance) distinguishing unexpected / `Expected RBAC`
  / `Known Background Noise`, now also split into app-level vs. infra-level (5xx) within "unexpected."
- An **Action Required** list, synthesized from suite drift, failure clusters, flaky tests, background
  errors, and slow-test regressions, sorted by priority.
- An **Environment** block — Playwright version, worker count, and browsers actually exercised (sourced
  from the JSON report's own `raw.config`, not guessed), plus the reporting process's own Node
  version/OS.
- A **CI/CD & Artifacts** block — the repo-relative reports directory, the run URL, and (when real,
  never fabricated) a **re-run link** (Jenkins: the job's standard `/build` trigger endpoint, derived
  from a real `buildUrl`; GitHub Actions: honestly labeled as "re-run available from this page," since
  GitHub exposes no plain re-run URL) and a **full-history link** to this environment's ledger file on
  `ci/reporting-history`, resolved from `git remote get-url origin` — omitted, not faked, when the
  remote isn't GitHub.
- A footer line with the report's generation timestamp and its own `REPORT_ENGINE_VERSION` constant
  (independent of `package.json`'s version — the template's structure changes on its own schedule).

### Run history / trend tracking (`ci/reporting-history` branch)

`npm run history:sync` (`src/notifications/scripts/syncHistory.ts`) maintains a small, append-only, capped ledger of past run stats, so the email can show a trend instead of just one run's numbers in isolation.

**Storage decision:** the ledger lives as a JSONL file on a dedicated, never-merged git branch (`ci/reporting-history`), one branch per environment history — not a database, not a GitHub Actions cache, not an external service. Rationale: it needs to survive across CI runners (rules out local disk/cache), needs no new infrastructure or secret to provision (rules out a database), and a plain-text, human-readable, git-diffable ledger is easy to inspect/debug directly (`git show ci/reporting-history:reports/qa/history.jsonl`) without any tooling. The branch is capped at `MAX_RECORDS_PER_ENV = 100` (oldest records pruned on write).

**Concurrent-write handling:** two CI runs finishing around the same time will race to push to `ci/reporting-history`. The retry loop is **fetch + `reset --hard` + recompute the delta/append fresh** on each retry attempt — not a rebase. A rebase was tried first and was dropped after it demonstrably produced real, unresolvable merge conflicts on the plain-text ledger when two pushes landed close together; reset-and-recompute never conflicts because it never tries to replay a diff.

**Extended 2026-07-14** — each record now also stores `failedTestTitles` (mirroring the existing
`flakyTestTitles`) and the top-20 slowest test durations, and each module entry now carries its `type`
(fixing a latent bug where a same-named UI and RBAC module could collide on lookup) and its real
duration (previously always `0`). The lookback used for "recurring" issues was widened from 5 to 10
runs. **"Recurring flaky"/"recurring failing"** now means: flaky (or failing) in more than 2 of the
last 10 recorded runs on this branch (`RECURRING_FLAKY_LOOKBACK = 10`, `RECURRING_FLAKY_THRESHOLD =
2`, both overridable per call). **Suite drift** is flagged whenever the current run has *any* fewer
tests than the previous run (no percentage floor — a dropped test is treated as a signal worth
confirming, never as an acceptable margin, since it's frequently a silently-broken test file rather
than genuine improvement); growth in test count is never flagged, since the suite grows continuously
as normal development. Real measured ledger size at this suite's scale (263 tests, 16 module/type
combinations): the pre-2026-07-14 schema was already ~196KB/100KB records on a typical run (not the
"~40-60KB" originally estimated); the extended schema above is ~448KB/100 records typical, ~975KB
worst-case, per environment (~1.35MB across all 3 env files at the full cap) — an accepted tradeoff,
and git's own compression keeps the real on-disk/network cost below these raw-byte figures.

**Branch/commit local-git fallback (added 2026-07-14):** both `notify.ts` (the email-facing
`resolveNotificationInput()`) and `syncHistory.ts`'s own separate `branch` derivation previously ended
their fallback chain at a static `'unknown'` string whenever no CI env var (`BRANCH_NAME`/
`GITHUB_REF_NAME`, `GIT_COMMIT`/`GITHUB_SHA`) was set — even for a plain local run inside a real git
checkout, where the actual branch/commit is one command away. Both now fall back to real local
`git branch --show-current` / `git rev-parse --short HEAD` (wrapped in try/catch — a checkout with no
git metadata still degrades to `'unknown'`, not a thrown error). Confirmed live, twice independently:
a bare local `notify` run resolved the real current branch/commit instead of "unknown," and a bare
local `history:sync` run wrote the real branch into the ledger instead of "unknown."

### Failure clustering (`src/notifications/FailureAnalyzer.ts`)

New in this redesign. `classifyFailure()` assigns one of 11 categories (locator/assertion/timeout/
api/auth/network/environment/infra/console/js/unknown) per failed test, preferring a real HTTP-status
signal from `misc-errors.json` (cross-referenced by test title) over guessing from message text alone
where one exists. `clusterFailures()` groups failures only on a real matching signal — exact error
message, identical source location, or identical failing endpoint+status — never on partial/fuzzy
similarity, since a false merge would hide a genuinely separate bug inside another one's summary. A
failure sharing no signal with any other becomes its own single-test "cluster," rendered identically
to a normal standalone failure.

### Automation health score (`src/notifications/AutomationHealth.ts`)

New in this redesign. A weighted 0-100 score (Excellent ≥90 / Good ≥75 / Needs Attention ≥50 /
Critical <50) factoring in pass rate, failure count, flakiness, unexpected background errors, suite
drift, **recurring failures/flakiness**, and **report staleness** — all six can fire together on the
same run (confirmed live: a run with recurring issues plus a stale report scored 30/Critical, with all
five applicable factors listed individually). The weights are a starting point, documented as such in
the source — revisit once real multi-run data accumulates, the same convention already used for the
slow-test regression threshold below.

**Recurring failures/flakiness** (added 2026-07-14, same day as the redesign): a real gap found by
running this against 4 sequential test runs — a test that had failed (or flaked) in 3 of the last 4
recorded runs still scored the overall run "Excellent," because the score only weighed that run's raw
counts, never the recurring-issue history the same email's Trend section already surfaces. Fixed by
penalizing recurring failures more heavily than recurring flakiness (a test that keeps failing outright
is a stronger "known, unaddressed problem" signal than one that keeps eventually passing on retry) —
confirmed live: the same 4-run scenario now scores 79/Good instead of 91/Excellent once a recurring
issue is present, without changing the 3 earlier runs' scores (they didn't have enough history yet for
anything to qualify as "recurring").

### Report freshness check (`NotificationService.checkReportFreshness()`)

Added 2026-07-14 after two real sent emails both showed report content several days older than the
actual send date — traced to `notify.ts` silently reusing whatever stale
`reports/<env>/latest/playwright-report/results.json` happened to be on disk, with **no check anywhere
in the pipeline** for how old that data actually was (confirmed via grep across the entire
`src/notifications` tree before this fix — zero references to freshness/staleness). `checkReportFreshness()`
compares `report.endTime` against `Date.now()` (the latter passed as an explicit parameter, not called
internally, so the function stays pure/testable); if the gap exceeds `STALE_REPORT_THRESHOLD_HOURS`
(default 4, overridable via env var — a starting heuristic, not statistically tuned, same convention as
the health-score weights), the email gets:
- A full-width warning banner as the very first thing in the email, above the masthead.
- `⚠️ STALE REPORT — ` prepended to the subject line, so it's visible even in an inbox list view before
  the email is opened.
- A `-30` "Data freshness" factor in the automation health score (see above) — one of the largest single
  penalties, since a stale report undermines trust in every other number in the email.

Confirmed live against the genuinely stale (4-day-old) `reports/qa/latest` artifact: correctly detected,
correctly dropped health from 100 to 70, correctly prefixed the subject.

### Email design & compatibility

The masthead/header row went through several rounds of real, evidence-based fixes worth knowing about
before touching them again:

- **Container width is fully fluid (`width="100%"`, no `max-width`), by design — not an oversight.**
  Checked the actual pre-2026-07-14 template (`git show <old-commit>:src/notifications/EmailTemplate.ts`)
  rather than guessing: it also had no width cap, ever. A capped width (600px, then 750px were both
  tried) always leaves visible white space once the reading pane is wider than the cap — there is no
  fixed number that fills every pane. The trade-off, same as the old template already had: on a very
  wide monitor, line-length and tile spacing stretch out rather than staying at a fixed comfortable
  width. Accepted explicitly, not a regression.
- **Outlook desktop renders the email body with Microsoft Word's layout engine, not a browser engine** —
  a real, documented, longstanding Microsoft architecture choice (since Outlook 2007). Word implements
  only a small legacy CSS subset: it does **not** understand `max-width` at all (any table relying on
  CSS `max-width` alone renders however its literal HTML `width` *attribute* resolves in Outlook,
  uncapped), and it silently drops unsupported property *values* — including `rgba()` transparency —
  rather than degrading them, which can produce a background color that's simply invisible with no other
  symptom. Both of these were real bugs caught in this redesign (a `max-width`-only container, and
  `rgba()`-based badge colors) — fixed by using literal HTML `width` attributes and solid opaque hex
  colors, which Word's engine has always supported.
- **Badge chips are joined with a real space character, not just CSS `margin`.** An earlier version
  relied entirely on margin for the visual gap between adjacent badges; any context that doesn't render
  margin — plain-text view, a client that strips inline styles, copy-paste, a screen reader — ran the
  label/value text of adjacent badges together with zero separation. Confirmed by stripping all HTML
  tags from the real rendered output and checking the extracted text reads correctly.
- **Emoji are scoped to two specific contextual "what am I looking at" indicators** (the status banner,
  the SOURCE badge) — reintroduced 2026-07-14, matching the old template's exact choices for exactly
  these two fields (✅/❌/⚠️ for status, 🔧/🐙/💻 for Jenkins/GitHub Actions/local). The rest of the
  email's section headers (Module Analytics, Trend, etc.) stay emoji-free — a deliberate, narrower scope
  than the old template's emoji-everywhere style, not an oversight.

### Background-error report (`reports/<env>/misc-errors.json`)

Each Playwright worker process runs its own `ErrorCollector` instance and writes its own `misc-errors-worker-<N>.json` (namespaced by env and worker index specifically to survive two workers, or two concurrent cross-environment runs, writing at once without clobbering each other). `MiscErrorReporter` (a Playwright reporter, wired into `playwright.config.ts`) merges all worker files into the final `reports/<env>/misc-errors.json` once the run ends, and prints a terminal summary tagging each error `[Expected RBAC]` / `[Known background noise]` / neither. The redundant `expected: boolean` field (always exactly `!!expectedReason`) was removed 2026-07-14 after an exhaustive grep confirmed its only 3 real consumers; all 3 now read `expectedReason` directly.

### Trace files

Every failure retains a Playwright trace (`trace: 'retain-on-failure'` in `playwright.config.ts`), plus a screenshot and video. `ReportParser` reads the trace path straight out of Playwright's own JSON report `attachments` array and converts it to a repo-relative path, so the link in the email still means something after the CI runner that produced it is gone — it matches what you'll find inside the downloaded `test-results` artifact zip. As of 2026-07-14, `ReportParser` also extracts each failure's `error.stack` and `error.location` (file/line/column) — both were previously discarded — and strips terminal ANSI color escape codes from error text (Playwright's JSON reporter embeds them raw; left in, they rendered as garbage characters and could break exact-message clustering).

---

## RBAC Testing Philosophy

Every module (except Dashboard/Login) has a paired `tests/rbac/<module>.rbac.spec.ts` alongside its `tests/ui/<module>/<module>.spec.ts`. RBAC tests use **both** `adminPage` and `restrictedPage` fixtures together, exercising the same CRM feature from two permission levels in one test:

- **"Playwright Automation"** (`adminPage`) — full-access user, can create/see/edit anything.
- **"User 1"** (`restrictedPage`) — limited-access user, whose visibility into admin-owned records is exactly what's under test.

The core pattern in nearly every RBAC test: admin creates a record with `generateAdminXxxData()` (guaranteed invisible to the restricted user, by the `ADM`-prefix convention explained in [§2](#architecture--how-its-built)), then the test asserts the restricted user genuinely cannot see it — not "the element wasn't visible," but a real absence check that can't be confused with a slow/broken page (per CLAUDE.md's audit rule: never `if (visible) {assert} else {logger.success('...correct RBAC')}` — that pattern silently converts "the page failed to load" into a false pass).

The other half of RBAC coverage is the **share/reassign/clone** family: admin explicitly shares (or reassigns, or clones) a record to/for the restricted user with a specific permission set (`update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`), and the test verifies the restricted user can now do exactly what was granted — no more, no less. These tests assume real propagation lag between the share action and the permission taking effect server-side — they poll/retry on a transient 403 rather than sleep-and-hope, and they still fail loudly on a permission that never arrives.

RBAC-expected errors (403s, 422/`029003`) are captured by `ErrorCollector` like any other error but classified `expectedReason: 'rbac'` (see [§2](#architecture--how-its-built)) — they show up in reports as confirmation the permission boundary is being enforced, not as noise to filter out and not as a regression to chase.

---

## Known Limitations / Open Items

Cross-checked against `CLAUDE.md`'s own audit notes and this session's fixes — this list reflects what's true **today**, not a stale carry-over.

- **`.env.example` is incomplete.** It currently only ships the Quotations `*_DEAL_NAME` variables — no `APP_URL`/`API_BASE_URL`/`ADMIN_EMAIL`/etc. for any environment. A first-time `cp .env.example .env` will not produce a working file; see [Getting Started](#getting-started) for the actual required variable list.
- **No cross-browser coverage in CI.** `firefox`/`webkit`/`mobile-chrome` are configured for local runs only; every CI pipeline runs `chromium` exclusively.
- **`Jenkinsfile.sandbox`'s worker count (always 1) diverges from `sandbox.yml`'s dynamic 1–2** — a minor, currently-harmless inconsistency between the GHA path (primary) and the Jenkins manual fallback for the same branch.
- **Two CI paths cover different scope for `main`:** the base `Jenkinsfile` (primary, branch-triggered) runs the full suite with no `--grep`; `main.yml` (manual-only fallback) filters to `@regression` only. They are not equivalent runs.
- **No scheduled/nightly runs exist anywhere** — every pipeline is push- or manually-triggered only.
- **No cross-environment (QA/staging/prod) data-parity check exists.**
- **QA/staging data grows unboundedly** — no module cleans up the records it creates, so search/list operations get measurably slower over the life of the environment. Retry budgets in `config.searchRetry` account for this, but it's a standing tax on every run, not a one-time cost.
- **A confirmed, unresolved app-level flake in Deals** (investigated 2026-07-06, no confirmed mechanism found across six controlled experiments): logging a Call on a deal shared with the restricted user intermittently fails with a permission error even when contact/company sharing is verified correct via screenshots. Two later-discovered client-side bugs (a substring-match contact-selector bug, and `DealsPage.fillDealForm()`'s random associated-contact/company picker) could have contaminated the original six experiments without being visible at the time, so the "no consistent mechanism" conclusion is downgraded to uncertain, not disproven. Full history and every experiment's evidence: see `CLAUDE.md`'s "Known Issues" section. Real fix requires backend/network-level access this suite doesn't have — do not re-attempt a client-side isolation without it.
- **`DealsPage.fillDealForm()`'s associated contact/company selection is intentionally randomized**, as a deliberate 2026-07-05 fix for a CI-hang/timeout problem in that picker — not a bug. For any new Deals test where the associated contact/company's *specific identity* matters (sharing, reassigning, ownership-dependent actions), pass `associatedContactName`/`associatedCompanyName` on `DealData` to select a known, freshly-created entity by exact name instead. Passing neither preserves the original random-pick behavior.
- **Recently built, not yet proven under a real live CI run at the time of writing:** the P0–P5 reporting overhaul (tiered error classification, run-history/trend tracking, trace-linking fixes, the `staging-promotion-gate.yml` rename) and the two sandbox-CI bug fixes (`tsconfig.json`'s `"types": ["node"]` fix for `ts-node`'s intermittent `@types/node` resolution failure; the `createRolePage()` browser-context leak fix) were all verified via isolated local execution and real (non-push) script runs, but not yet exercised end-to-end by an actual CI pipeline run against real GitHub/Jenkins infrastructure. Treat the very first live CI run after this work lands as still partially a verification step, not a routine run.
- **The 2026-07-14 email/reporting redesign** (restrained-enterprise `EmailTemplate.ts` rewrite, `FailureAnalyzer.ts`, `AutomationHealth.ts`, the extended `RunHistory.ts` schema, the freshness check, the local-git fallback) compiles cleanly (`tsc --noEmit`, `eslint`, zero errors) and has now been run end-to-end multiple times: a combined pass exercising every feature at once (real Playwright execution, real failure clusters, real recurring-issue and freshness penalties stacking together, real git-derived branch/commit) against a throwaway `ci/reporting-history` ledger, plus one real send via the actual SMTP path (recipient temporarily scoped to one address for that test, reverted immediately after — confirmed via empty `git diff`). What's genuinely still open: **the real `ci/reporting-history` branch itself has never been touched by any of this verification** (by design, to avoid polluting it) — the first real CI run after this ships is effectively run #1 for that branch. The automation-health weights, the 4-hour staleness threshold, and the slow-test 20%-regression threshold are all documented in source as starting heuristics, not statistically-tuned constants — expect to revisit them once real multi-run data accumulates. Real Outlook desktop rendering was verified structurally (literal HTML `width` attributes, solid non-`rgba()` colors — the specific things Word's engine is documented to require) but never captured from an actual Outlook client; likewise, email dark-mode support is best-effort CSS (`prefers-color-scheme`) never verified against a real Gmail/Outlook dark-mode render.
- **A related, deliberately unresolved architectural question:** whether long CI jobs (`qa`/`stage`, ~220+ tests on 2 workers) should be split into parallel shards is flagged but intentionally not implemented — it was raised while investigating a browser-context resource-exhaustion incident, but splitting job topology is a bigger, separate decision than the incident's actual fix warranted.
- **`SETUP.md` is legacy and describes an older, now-superseded version of this framework** (a single `playwright.yml`, a `develop`/`main`-only branch model, one `leadFactory.ts`, no error-collector or reporting system). It predates the current `dev→qa→stage→prod→main` pipeline and the multi-module suite described in this README. Prefer this README, `GIT_WORKFLOW.md`, and `CLAUDE.md` over `SETUP.md` for anything current.
- **Lead's edit form (`fillEditForm()`) does NOT update Timezone, Country, or the 5 Professional fields — Contact's edit form DOES update its Timezone/Company.** This is a real, pre-existing asymmetry (confirmed 2026-07-17): Lead's `fillEditForm()` was deliberately scoped to fill only firstName/lastName/Salutation/Requirement/custom-fields, so those 7 fields are create-only on Lead; Contact's `fillEditForm()` re-fills its Timezone/Company. The detail-page assertions added 2026-07-17 (see below) accommodate this — Lead's create-only fields are asserted on create only (`assertLeadStandardFieldsOnDetail(data, assertCreateOnlyFields)`, the update caller passes `false`). **Open decision for a maintainer:** either extend Lead's `fillEditForm()` to also update these fields (fuller update coverage, but a riskier change to a heavily-used shared method — react-select re-selection on a pre-filled edit form is exactly where subtle bugs live), or accept them as create-only. Left as create-only as the lower-risk choice, flagged rather than silently changed.
- **The same unbounded-click dropdown risk fixed in `DealsPage.selectFirstOptionFromDropdown()` (below) is still present, unfixed, in `LeadsPage.ts` (close-reason radio selection, convert-to-deal product selection) and `QuotationsPage.ts` (several random-option pickers)** — confirmed via grep, not yet verified as actually broken in either module, but the identical shape (a raw, unbounded `.click()` on a randomly-indexed option in a list that can still be populating) is present.
- **The `[id*="..."]` substring-locator pattern that caused the Company Phones collision (below) also appears, in a narrower/lower-risk form, in `CompaniesPage.ts`, `DealsPage.ts`, `ContactsPage.ts` (`[id*="input_products.0.id"]`, each already scoped with `.first()`) and `QuotationsPage.ts` (`[id*="input_products"][id*="quantity"]`, a compound match).** None confirmed broken — flagged as the same risk shape, worth a look before any of these modules grows a second field with a colliding id suffix.
- **Company Website field's validation behavior (documented above as "confirmed live to show the identical 'Enter a valid URL' inline validation") has no dedicated negative-validation test** — unlike the custom UrlField, which has `generateLeadCustomFieldInvalidUrl`. The claim was verified ad-hoc at implementation time per its own note, but has not been independently re-confirmed since, and there's no regression test guarding it.
- **`reports/<env>/misc-errors.json` (and its per-worker files) are overwritten by every subsequent test invocation, including a single isolated test run** — this is a same-process problem, not just the already-documented cross-process race. A full-suite run's own 91-entry report was lost this way during this session's own follow-up work (a later isolated test run overwrote it before its data was fully analyzed) — worth considering a timestamped/run-scoped output path for full-suite runs specifically.
- **`QuotationsPage.fillOwner()` has the identical unbounded-click race already found and fixed (2026-07-22) in `selectFromContactDropdown`/`selectFromIsInvalidControl`/the 4 modules' Share-modal helper** — confirmed via code read, not yet fixed (explicitly out of scope for that session's work). Same shape: a raw, unbounded `control.click()`/`option.click()` with no timeout. Apply the identical bounded-click + 3-attempt-retry pattern if this ever surfaces as a real hang.
- **`CallLogsPage.searchAndSelectEntity()`'s search-index-propagation-lag retry has a thin margin on staging specifically** — `config.searchRetry.staging` (3 retries × 5s) is smaller than qa's (5×3s) and prod's (5×5s); a real run needed its full budget (succeeded only on the 3rd/last attempt) to recover from genuine indexing lag. If exhausted, the method's `if (term) {...}` branch falls through to a silent "click first option" fallback, which could pick the wrong entity rather than fail loudly. Two independent proposed fixes not yet applied (deferred, per explicit instruction): (1) bump `staging`'s retry budget to match prod's; (2) make the fallback-to-first-option path throw instead of silently guessing.
- **`companies.spec.ts` CO4 ("verify all field values on detail page after create") — rare flaky generic-error toast on save, root cause NOT confirmed (2026-07-22).** Original failure: a generic, non-field-specific error toast appeared on `saveCompany()` right after the phone field was filled, ~1.2s after the app's own background "has-duplicates" phone-check lookup (`GET /v1/companies/has-duplicates?fieldName=phoneNumbers`) returned an HTTP 400 — a real, evidence-based correlation, but **not proven causal** (no error was ever captured on the actual company-create save POST itself). 5/5 reproduction attempts in isolation (single worker, retries=0) passed cleanly — this flake needs concurrent multi-worker load to surface, consistent with this codebase's documented "QA degrades under load" pattern. Confirmed via code read on this branch: `saveCompany()` has no retry/network-awareness of any kind today. (Note: a same-shaped `createLead`/`createContact`/`createCompany` creation-POST transient-retry fix was built 2026-07-21/22, but on a separate, not-yet-merged branch — `saveCompany()` on this branch has zero protection of any kind, so this isn't a gap in that fix, there's simply no fix here yet.) **Do not fix on this correlation alone** — needs either a multi-worker reproduction or more captured instances to confirm root cause before any retry/defensive-fix logic is added.

---

## Contributing / Adding a New Module

Before making any change, read `CLAUDE.md`'s **Standing Engineering Checklist** — a permanent, always-apply 14-point list distilled from real issues found and fixed across multiple sessions in this codebase.

Full daily-workflow and branch-promotion mechanics live in `CONTRIBUTING.md` and `GIT_WORKFLOW.md` — this is the module-specific checklist:

1. **Factory** — add `src/data/factories/<module>Factory.ts` exporting `generateXxxData()`, `generateAdminXxxData()` (`ADM<timestamp>` prefix), and, if the module supports sharing, `generateSharedXxxData()` (`SHR<timestamp>` prefix). Default `country: 'India'` if the module has that field.
2. **Page object** — add `src/modules/<module>/<Module>Page.ts` extending `BasePage`, following the fixed 10-section order from [§2](#architecture--how-its-built). Read the "Reference Patterns" section of `CLAUDE.md` first — the ellipsis-menu, share-modal, reassign-modal, and clone patterns are meant to be reused nearly verbatim, not reinvented per module.
3. **UI tests** — `tests/ui/<module>/<module>.spec.ts`, importing `test`/`expect` from `src/fixtures/index.ts` only. Tag every test (`@smoke`, `@regression`, and/or `@prodSafe` if it's genuinely read-only). Give any create/edit test `test.setTimeout(480000)` — local runs can be slow.
4. **RBAC tests** — `tests/rbac/<module>.rbac.spec.ts`, using both `adminPage` and `restrictedPage`. Follow the negative-assertion and share/reassign patterns in [§9](#rbac-testing-philosophy).
5. **`package.json` script** — add `test:<module>` following the existing pattern (`playwright test tests/ui/<module>/ tests/rbac/<module>.rbac.spec.ts --project=chromium && npm run notify`).

`sandbox.yml`'s selective test detection (`detect-tests.sh`) works off changed file paths, not a hardcoded module list — a new module's tests get picked up automatically, no CI config changes required for that part.

**Code conventions** (see `CLAUDE.md` for the full list): never import from `@playwright/test` directly in a spec file; never hardcode test data; never put locators in test files; use `logger.*`, never `console.log`.

---

## Troubleshooting

**`Missing required environment variable: X`** — the active `ENV`'s credentials are incomplete in `.env`. Check which `ENV=` is set and that all 5 required variables (`APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RESTRICTED_EMAIL`, `RESTRICTED_PASSWORD`) exist for that prefix — see [Getting Started](#getting-started).

**Tests fail with auth errors / redirected to sign-in mid-run** — the cached session expired (QA sessions last ~1 hour). Clear it and re-run:
```bash
rm -rf src/auth/storageStates/qa/
```
The fixtures already attempt one automatic re-login on a detected sign-in redirect before failing — if you're seeing this, it's a genuine second failure, not the first.

**`Target page, context or browser has been closed`** — investigated as part of a real sandbox CI incident. A confirmed resource leak in `createRolePage()` (a throw-before-`use()` path that skipped context/page cleanup) was found and fixed, but was *not* proven to be the direct cause of any single reported incident — only proven to be a real leak that could contribute over a long run. If you see this consistently (not once in a long run), it's worth re-opening the investigation with real evidence, not assuming the existing fix already covers it.

**`ts-node` script fails to compile with a `TS2591` (`Cannot find name 'process'`, etc.) error, but `tsc --noEmit` on the same file passes** — this exact class of bug was root-caused live: `ts-node`'s default per-file compilation only auto-discovers `@types/node` if the entry file's own import graph happens to reach into `node_modules`; a shallow/pure-logic script can silently fail to get Node's global types. Fixed at the project level via `tsconfig.json`'s `"types": ["node"]` — if you hit this again, check that setting hasn't been reverted before re-diagnosing from scratch. Also: verifying a standalone script with `ts-node --transpile-only` is not sufficient — it skips type-checking entirely and will not catch this class of bug. Verify with a real, non-transpile-only run.

**`git clone <remote-name> .` fails** — `git clone` needs a URL, not a remote name. Use `git remote get-url origin` first if you need to resolve the actual URL programmatically (see `resolveGitRemoteUrl()` in `syncHistory.ts` for the canonical pattern).

**Email report shows a wildly wrong duration or a start time that looks like an end time** — this exact bug existed and was fixed: summing every individual test's duration double-counts overlapping time under parallel workers, and Playwright's JSON report has no top-level `startTime` (only `stats.startTime`). `ReportParser.ts` now reads `raw.stats.duration`/`raw.stats.startTime` directly. If you see this again, something has regressed that fix — it was verified against real production data to the exact second, not guessed.

**Flaky test's trace link in the email points at a passing run, not the failure** — also a fixed, previously-real bug: for a flaky test, Playwright's `lastResult` is the passing retry, which has no trace (`retain-on-failure` only keeps failed-attempt traces). `ReportParser.ts` now sources the trace from the last **non-passing** attempt for flaky tests specifically.

**Clone lead/contact form shows validation errors on save** — clone pre-fills the form with the original's email/phone; you must change at least one before saving to avoid a duplicate-value rejection. See the Clone pattern in `CLAUDE.md`'s Reference Patterns.

**`saveQuickTask()` hangs or times out when called from within a Lead/Contact detail panel** — use `saveQuickTaskFromEntityDetail()` instead; `saveQuickTask()` waits for the standalone task list view, which never appears from that context. (The specific `tests/rbac/leads.rbac.spec.ts` call site previously flagged as a live instance of this bug already correctly calls `saveQuickTaskFromEntityDetail()` — confirmed 2026-07-17, this note is now purely a "watch for this pattern" guide, not an open bug.)

**Push rejected (`fetch first` / `non-fast-forward`)**
```bash
git pull origin <branch-name> --rebase
git push origin <branch-name>
```

For anything not covered here, `CLAUDE.md`'s "Audit Findings Summary" has a much deeper per-module list of known flakiness root causes and the locator/wait patterns proven to fix them — read it before touching any page object, fixture, or CI file.
