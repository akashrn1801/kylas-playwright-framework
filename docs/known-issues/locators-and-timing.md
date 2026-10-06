# Locators, Waits and Timing — Resolved History

> **Purpose:** Resolved code bugs in page objects and shared `BasePage` helpers: navigation readiness, dropdown picks, locators, ID capture, CI-found timing fixes.
> **Read when:** writing or debugging a wait/locator/dropdown interaction, or a failure looks like "click did nothing", "element not found", "timeout".
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Open items: [../KNOWN_ISSUES_ACTIVE.md](../KNOWN_ISSUES_ACTIVE.md) (KI-20…KI-24). Reusable rules: [../PATTERNS.md](../PATTERNS.md). Session/429 recovery: [session-expiry-and-auth.md](./session-expiry-and-auth.md), [rate-limits-and-error-pages.md](./rate-limits-and-error-pages.md).

### Navigation drift across 6 modules — 2026-07-27
- **Symptom:** Generic element-not-found timeouts long after a list/detail page "loaded".
- **Root cause:** Every `waitForXDetailsPage()`/`waitForListReady()` (e.g. `TasksPage.waitForListReady()`) resolved on the first URL match with no guarantee it stayed, and the entity-GET wait had a silent `.catch(() => null)`; the client router could bounce away under load. Also `DealsPage.getAssociatedContactId()`/`getAssociatedContactName()` had no timeout (this repo sets no `actionTimeout`, default 0), and a zombie session-expiry listener outlived `Promise.race`.
- **Fix:** shared `BasePage.waitForEntityDetailPage()`/`waitForEntityListPage()`; explicit 10s bound on the Deals getters; listener-free `page.waitForResponse()` in the race.
- **Revert:** restore the per-module copies (not advised).
- **Commit:** `f395b14`.

### Random-option-pick dropdown hangs — 2026-07
- **Symptom:** Unbounded 480s hangs picking a random react-select option (Deals product row/associated contact, Tasks, Call Logs, Meetings).
- **Root cause:** Unbounded `textContent()` + `.click()`; retrying the same index can be futile (one index persistently non-actionable).
- **Fix:** `BasePage.selectRandomOptionWithRetry(options, description, opts?)` — 3 attempts, 15000ms each, re-rolling a fresh index. `DealsPage.fillDealForm()` associated contact/company is random by design (2026-07-05 CI-hang fix); pass `associatedContactName`/`associatedCompanyName` when ownership matters.
- **Revert:** revert the helper and call sites.
- **Commit:** `0b8c735`.

### `BasePage.fillSearchAndWaitForOptions()` retry allowlist — 2026-07
- **Symptom:** Transient network errors during option search failed tests.
- **Root cause:** No retry on transient failures.
- **Fix:** `TRANSIENT_NETWORK_ERROR_PATTERNS` is deliberately narrow (DNS, reset, refused, timeout, unreachable); excludes real HTTP 4xx/5xx and routine `ERR_ABORTED`. Do not widen without live evidence.
- **Revert:** n/a.
- **Commit:** unknown — see `git log -S'TRANSIENT_NETWORK_ERROR_PATTERNS'`.

### ID-capture predicates matched unrelated background requests — 2026-07
- **Symptom:** False "save failed silently" despite a success toast; ID captured as `null`.
- **Root cause:** `captureXxxIdFromResponse()` used `.includes('/deals')`/`'companies'`, matching an analytics POST (`/v4/reports/deals`) in 3 places.
- **Fix:** require the versioned `/v1/<module>/` path and exclude `/reports/`. Two further `armResponseWaitWithRecovery` races fixed: a synchronous `hasFired()` signal, and a bounded retry for the app's own redirect aborting recovery navigation (`net::ERR_ABORTED`).
- **Revert:** n/a — keep.
- **Commit:** `a1d8291`.

### Lead multi-select "chip drop" — 2026-07
- **Symptom:** `selectRandomFromMultiValueReactSelect()` silently dropped an earlier chip.
- **Root cause:** The reopen click hit the control div's centre, which drifts onto a prior chip's remove icon as chips wrap.
- **Fix:** target the control's own `<input>` child.
- **Revert:** revert that locator.
- **Commit:** unknown — see `git log -S'selectRandomFromMultiValueReactSelect'`.

### Company Phones field collision — 2026-07
- **Symptom:** A Lead phone locator also matched Company Phones' first entry.
- **Root cause:** Loose `input[id*="input_phone_0"]` substring match.
- **Fix:** exact `name="phoneNumbers[0]"` in Leads/Contacts/Companies. Also: GPS "Get GPS Address" trigger is section-scoped (`BasePage.getFormSectionContainer()`/`getGpsAddressTrigger()` throw on ambiguity); `escapeRegExp()` consolidated into `BasePage`.
- **Revert:** revert the locators.
- **Commit:** `c9a4537` (`escapeRegExp`).

### Per-row DOM-read loops in `QuotationsPage.ts` — 2026-07
- **Symptom:** List verification 6–38x slower than needed.
- **Root cause:** Three methods called `.innerText()` per row in a loop.
- **Fix:** one batched `allTextContents()`. Apply the same wherever the loop shape recurs.
- **Revert:** n/a.
- **Commit:** unknown — see `git log -S'allTextContents' -- src/modules/quotations`.

### `CallLogsPage` Associated Deal "zero options" — 2026-08
- **Symptom:** Intermittent empty option list.
- **Root cause:** Data linkage, not index lag: `ensureOwnedDealExists()` created the deal without `associatedContactName`, linking a random contact. "Index lag" has been the wrong first guess twice — disprove it first.
- **Fix:** thread the contact name through.
- **Revert:** revert the call-site argument.
- **Commit:** unknown — see `git log -S'ensureOwnedDealExists'`.

### Sandbox batch: CL21/CL23/TC23/TC21/TK24/CL22/CL24 — 2026-08-03
- **Symptom:** Seven CI-only failures.
- **Root cause:** CL21/CL23 menu left open intercepting pointer events; TC23 three stacked `waitForTimeout(200)` in `BasePage.selectDateTimeCustomField()` blew the 480s budget; CL22 unscoped "Log a call" locator; CL24 too-narrow validation-error locator; TC21 tab click without `withSessionExpiryRecovery()`; TK24 unbounded `expect(timeInput).toBeEnabled()`.
- **Fix:** `openDropdownById()` + `force: true`; one condition wait for `.rc-time-picker-panel` to hide; `.first()` scope; add `.alert-danger:visible`; wrap in recovery; 5s non-blocking check with warning.
- **Revert:** revert per-method.
- **Commit:** unknown — see `git log --grep=CL21`.

### Sandbox batch: CL39/CL32/CL33/D28/Quotations detail — 2026-08-09
- **Symptom:** Five failures in a `--workers=2` run.
- **Root cause:** CL39 two `generateCallLogData()` calls without pinned `entityType` could yield a nonexistent `callType` and the option click had no timeout; D28 `DealsPage.cloneDeal()` never verified it saw the Clone modal (`#editEntityModal` is shared); `QuotationsPage.waitForListReady()` never checked readiness and `openCreateForm()`'s click was unbounded; CL32/CL33 are the app-side JS race in `openCallLogForm` — `CallLogsPage.openLogACallForm()` exhausts its 5 attempts when the app throws `Cannot read properties of undefined (reading 'content')` under concurrent sessions (see [../../APPLICATION_BUGS.md](../../APPLICATION_BUGS.md) entry 1); CL18 general load.
- **Fix:** pin `entityType`, bound option clicks; check `.modal-title`, widen Name pre-fill wait 10s→20s (also `TasksPage.cloneTaskViaEllipsis()`); race list container vs create button, route click through bounded `this.click()`, bound `fillOwner()` (3 attempts); log the real caught error and URL on every `CallLogsPage.openLogACallForm()` retry; reload-and-retry on `CallLogsPage.clickEditButton()`.
- **Revert:** revert per-method.
- **Commit:** unknown — see `git log --grep=CL39`.

### Call recording `ERR_BLOCKED_BY_ORB` retracted — 2026-08-11
- **Symptom:** Recording playback blocked.
- **Root cause:** Test fixture `test-recording.mp3` was a 40-byte ID3-only stub, not a Kylas defect.
- **Fix:** regenerated with real audio.
- **Revert:** n/a.
- **Commit:** unknown — see `git log -- src/data/files/test-recording.mp3`.

### Deals clone saved a stale name — 2026-08-23
- **Symptom:** `DealsPage.cloneDeal()` pre-save readiness wait timed out under load; a first non-fatal fix saved a clone with its pre-"Copy" name.
- **Root cause:** Save clicked while async pre-fill still committed; a modal snapshot is not an end state.
- **Fix:** bounded 2-attempt modal-open-and-settle retry; verify via captured new ID ≠ original ID and the name on the clone's own detail page (`assertClonedDealName()`). Rule: verify a mutation by its stable end state.
- **Revert:** revert `cloneDeal()`/`assertClonedDealName()`.
- **Commit:** `c9a4537`.

### Products chip clearing and product-search truncation — 2026-08-23
- **Symptom:** `clearAllProducts()` threw "chips still present after the clear loop reported done"; product search for fixtures returned 50 alphabetical rows without the target.
- **Root cause:** Async hydration of the Requirement section; `BasePage.searchAndSelectByName()` searched the first word only and every fixture starts with `[QA-Auto]`.
- **Fix:** bounded 4-round settle loop (stability window); search with the full name; removed a stray `waitForTimeout(150)`.
- **Revert:** revert the two methods.
- **Commit:** `0c5d3bf`.

### Sandbox Build #147 fixes — 2026-08-25
- **Symptom:** R36/R64 report-count tests and COR7 flaked; Meeting reports failed first Save.
- **Root cause:** `LeadsPage.deleteLead()` lacked network confirmation; coarse ±1-day report window not scoped to the entity; `CompaniesPage.saveEditedCompany()` lacked network confirmation; backend `HTTP 500`/`code: "01403004"` on the first Meeting-report Save (see [../../APPLICATION_BUGS.md](../../APPLICATION_BUGS.md)).
- **Fix:** mirror `deleteDeal()` confirmation; `verifyRunCountForEntity()` optional `filters?` with a unique tag; no-data header race in `getReportTotalFromHeader()`; bounded 2-attempt retry on that exact 500; `saveEditedCompany()` confirmation (verified 22/22 under `--workers=2`).
- **Revert:** revert per-method.
- **Commit:** `73fe067`.

### Reports run-count verification reads the API, not the DOM — 2026-08-26
- **Symptom:** `getApiCountForWindow()` ignored `filters`; run-count read a tooltip; `fillTimeInPicker()` used the runner's local timezone.
- **Root cause:** DOM scrape as authority; missing filter mapping; app interprets the custom range in Asia/Kolkata.
- **Fix:** `armReportDataResponseCapture()`/`sumReportDataResponse()` read `POST /v3/reports/<plural>`; filter map in `getApiCountForWindow()`; `toIstWallClockDate()` for the `narrowWindow` path (verified under `TZ=UTC`).
- **Revert:** revert `ReportsPage.ts` helpers.
- **Commit:** `aefd527`, `0f46591`, `02fe0a2`.

### Fixture setup killed by the CI test timeout — 2026-08-26
- **Symptom:** Tasks RBAC failed with `browser.newContext()` Protocol error, then the retry was killed by the 120s test timeout.
- **Root cause:** `createRolePage()`'s recovery login had no try/catch (only 1 of 2 attempts used); `navigateAndConfirmLoggedIn()`'s worst case exceeded the governing timeout.
- **Fix:** try/catch and fall through; deadline-aware stages (`Date.now() + testInfo.timeout * 0.85`, waits capped to remaining time, fail fast with a diagnostic). Protocol error itself never reproduced (rule 10: hardened, not proven).
- **Revert:** revert `src/fixtures/index.ts` deadline logic.
- **Commit:** `fb50b93`.

### PS6 "browser closed" timeout collision — 2026-09-30
- **Symptom:** `page.reload: Target page, context or browser has been closed` after `list table not visible within 120000ms … reloading and retrying once`.
- **Root cause:** PS6 lacked `test.setTimeout(480000)` so the 120s CI default governed, while `NAVIGATION_TIMEOUT: 120000` made `waitForEntityListPage()`'s internal waits sum to more than that; the outer timeout tore down the context mid-recovery. Not caused by concurrent job count (each job has its own VM).
- **Fix:** added the timeout; `waitForEntityListPage()` is deadline-aware (0.85 × `test.info().timeout`, each wait `max(5000, min(navigation, remaining))`, fail fast under 15000ms).
- **Revert:** revert the deadline logic in `BasePage.waitForEntityListPage()`.
- **Commit:** unknown — see `git log -S'waitForEntityListPage' --since=2026-09-29`.

### Dynamic-import factory race in `leads.spec.ts` — 2026-07
- **Symptom:** Transient module-resolution failure in the delete-lead test.
- **Root cause:** Dynamic `import()` of a factory.
- **Fix:** static import (grep confirmed the only instance).
- **Revert:** n/a.
- **Commit:** unknown — see `git log -S'import(' -- tests/ui/leads/leads.spec.ts`.

### Native `Date` picker detached-element race — 2026-08-10
- **Symptom:** `BasePage.selectDateCustomField()` final day click failed in ~50% of Deal create+edit cycles.
- **Root cause:** Not "previous calendar still closing" (all calendars permanently mounted); suspected rapid-fire fills leaving a React re-render lagging — unconfirmed. A 3-attempt reopen retry had 0% success.
- **Fix:** 1 attempt then typing fallback; warning is expected, self-healing (24/24 verified). Shared by every module with date custom fields.
- **Revert:** revert `selectDateCustomField()`.
- **Commit:** `0c5d3bf`.
