# Known Issues — Active

> **Purpose:** The only list of OPEN problems in this repo — one short entry each. Resolved history lives in [known-issues/](./known-issues/README.md); real Kylas product bugs are tracked outside this repo.
> **Read when:** triaging a failure ("is this already known?"), picking up follow-up work, or closing/adding an issue at the end of a task (Definition of Done step 3).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-11-25 @ c59da69

**Rules.** Open items only. Entry ≤ 8 lines: Status · Since · What · Evidence / next check · History link. IDs (`KI-nn`) are stable — never renumber. When an item is closed, move a ≤15-line summary to its topic file (template in [CONTRIBUTING_TESTS.md](./CONTRIBUTING_TESTS.md#size-policy)) and delete the entry here. Status: **open** (confirmed, not fixed) · **inconclusive** (investigated, no root cause; do not re-close without new evidence) · **unverified** (carried over, not re-checked against the repo on the date above).

---

## A. Failing / flaky tests

### KI-03 — Quotations "auto-reveal a hidden field" is a timing outlier
- **Status:** open · **Since:** 2026-09-09
- **What:** `@regression admin should auto-reveal a hidden field immediately after editing it, without re-toggling` (`quotations.spec.ts`) and its restricted twin (`quotations.rbac.spec.ts`) run several times longer than the same Hide-Empty-Fields test in every other module. Recurring Companies / Products & Services Hide-Empty-Fields failures in the 2026-09-29 run match the same shape.
- **Next check:** needs the test's own `trace.zip` (CI interleaves two workers' log lines, so the log alone cannot isolate the slow step). No guessed fix applied.

### KI-04 — Inconclusive one-off flakes (do not re-close without new evidence)
- **Status:** inconclusive · **Since:** 2026-07-06 … 2026-08-03
- **What:** six one-off flakes (Deals shared-deal Call-log permission; Quotations RBAC ~8-min `openCreateForm()` timeout; call-logs company live-search "no options"; meetings reschedule 3× HTTP 500; tasks RBAC edit-modal hang; meeting-creation 500 / Deals RBAC Task-permission timeout), each a single or unreproducible occurrence. Detail: [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md), [locators-and-timing.md](./known-issues/locators-and-timing.md).
- **Watch, 2026-11-25 (sandbox #240, each passed on retry, cause unclear, no change):** `dashboard.rbac:501` DB22 ("Target page ... closed" waiting for `.dashboard-header h2`: the test ran out of time); `dashboard.rbac:523` DB23 (dashlet-wizard radios not visible in 120 s); `call-logs.spec:56` (`GET /v1/users/me` never sent after the page's 3 requests were aborted).

### KI-05 — Dashboard render race (DB33 / DB36) and the stuck-dashlet symptom
- **Status:** open · **Since:** 2026-09-02
- **What:** `DB33 add Smartlist dashlet for Email` and `DB36 add Grouped Smartlists dashlet for Contact` still intermittently fail after the self-cancelling-retry bug was fixed: DB36's confirmation fetch never fires; DB33's fetch returns 200 but no dashlet paints. Separately, pre-existing Report-type dashlets on the Default dashboard stay on their loading placeholder (root cause never established; deliberately not exercised by any test).
- **Next check:** needs an app-side rendering investigation; suspected client-side paint failure under rapid multi-dashlet adds. History: [dashboard-module.md](./known-issues/dashboard-module.md).

### KI-48 — Quotation form app crash (`getCurrencyId`) blanks the page
- **Status:** open · **Since:** 2026-10-28 (PROD main run 40637702829, Q27)
- **What:** uncaught `TypeError` in `getCurrencyId` blanks the page after the layout GET (200). QA `quotations.spec.ts:620`/`:640` were not this crash (KI-49).
- **Detail:** [rate-limits-and-error-pages.md](./known-issues/rate-limits-and-error-pages.md).

### KI-49 — Backend DNS failures: HTTP 400 "Failed to resolve 'sd-…'" (QA, once on staging)
- **Status:** open, environment · **Since:** 2026-10-27 (QA run 40477938102); staging 2026-10-29
- **What:** HTTP 400 `000000` "Failed to resolve '…' and search domain query" / "Connection prematurely closed BEFORE response" on `POST /v1/contacts/`, `GET /v1/quotations/layout/{list,create}` and (staging) `POST /v1/quotations/`. Detail: [rate-limits-and-error-pages.md](./known-issues/rate-limits-and-error-pages.md).

### KI-51 — Sandbox 40821683680: cross-shard admin session storm
- **Status:** open; measured 2026-11-04 on QA and staging: a new login does NOT invalidate other access tokens; the mid-run refresh path (`GET /v1/tokens/refresh/`) is untested; per-worker re-login storm addressed by ADR 0016 S1/S2 (code on this branch, not yet proven under the 10-worker sandbox load) · **Since:** 2026-10-29
- **What:** all shards share one admin; shard 3 proactively re-logged in (595 s left) at 05:26:50 and shards 1, 2, 4 saw `Session expiry detected` within 3 s, re-logging in until 05:34. First `/sales/` race capped; the storm is untouched.
- **Ask / next check:** does a new admin login kill older tokens on staging? Should CI refresh admin at all? [session-expiry-and-auth.md](./known-issues/session-expiry-and-auth.md).

### KI-72 — Task relation picked a record another shard then deleted: POST /v1/tasks/ 400 007005 / 007003 (2026-11-19)
- **Status:** fixed in code, verified on staging 2026-11-19 (tasks UI+RBAC 34/34, quotations.rbac 17/17, contacts.rbac:839/:572, tasks.spec:153) · **Seen:** sandbox 44533064234 (accf30e), tasks.rbac:74 (13:38:17Z) and tasks.spec:153 (14:24:16Z)
- **Proof (007005):** shard 5 picked contact "Shaun Jakubowski" at 13:38:05; shard 4's contacts.rbac:572 created it 13:37:17 and deleted it 13:38:11-13; the task POST got 400 `007005` "Contact not found". 007003 is the same for a lead (delete not seen in my logs).
- **Fix:** `TasksPage.fillRelation` uses only run-owned records (`TaskRelationTargets`: one lead, deal, contact, company per account and worker, deleted by no test), found by name with a lookup watcher (leads/contacts by first name: the lookup queries `firstName:`).
- **Same run:** the 429 pages came at the end of an all-worker stall (KI-71), not from extra retries (none logged). The Add dropdown now reloads once on the 429 page; missed saves name "NEVER SENT" / "SENT but NO ANSWER"; a missed contact update is checked before a second save. **Open:** a limiter change is unproven; the quotations list-layout 429 is not recovered.

### KI-74 — Staging: `POST /v1/deals/` sent, then `net::ERR_FAILED` (2026-11-25)
- **Status:** open, Kylas/environment side · **Since:** 2026-11-25
- **What:** sandbox #240 `deals.rbac:1518`: create sent +281 ms, no answer for 120 s, `net::ERR_FAILED`; passed on retry. The request left the browser, so not a lost click; see KI-71 for the stall pattern.

### KI-71 — Staging-wide API stalls: 2026-11-18 once, 2026-11-19 three windows in one run (sandbox 44361216176, 44464192762)
- **Status:** open, environment (staging backend), 4 windows in 2 days · **Since:** 2026-11-18
- **What (11-18):** every `/v1/` call held about 58 s, released together at 18:37:04-09 on 3 shards; `POST /v1/deals/` 500 `01003002` after 46 s, a contact create unanswered in 45 s, a Products lookup unanswered in 10 s. All passed on retry.
- **What (11-19, f635980, 5 shards, 4 workers each):** windows where every worker of a shard logged nothing, released together: 05:26:11-44 (s2, s5), 05:32:46-05:33:46 (all 5, released 05:33:44-46: list waits 59.5 s and 59.3 s), 05:40:54-05:41:36 (s1, s2, s4, s5). Proven by trace or log (request sent, no answer): login.spec:16 attempt 1 (login PUT; attempt 2 got 200, then no post-login request until the release), meetings.rbac:189 (`contacts/lookup`), tasks.rbac:39 (`users/lookup`, `tasks/search`), contacts.rbac:81 (`users/lookup` x5, `tenants/usage`), contacts.rbac:572 (`POST /v1/contacts/` 44,683 ms). deals.rbac:323: hold proven, but the app dropped its requests at 60 s and the test waited on a dead page (now reloads once on a transport failure). call-logs.rbac:472 attempt 1: probable, unproven (lookup returned 0 options inside the 05:41 window).
- **Not holds (ours):** deals.rbac:666, call-logs.rbac:247, call-logs.rbac:472 retry, call-logs.spec:554 (causes in CHANGELOG); fixed or instrumented 2026-11-19. Run 44533064234 (accf30e): another all-worker stall 13:42:37-13:43:20Z (s4, s5), then 429 pages: KI-72.
- **Tests:** no wait passes a stall. Create captures, saves, `LoginPage` and lookups say "sent, no answer" or "never sent"; list/detail failures append `describePageStall()`.
- **Next check:** compare timestamps across shards on a recurrence; ask Kylas for gateway logs for 2026-11-18 18:36-18:37Z and 2026-11-19 05:26, 05:32-05:33, 05:40-05:41Z.

### KI-70 — Quick-task "Assigned To" menu closes at once: it opens on hover and the click steals its focus (2026-11-18)
- **Status:** root cause found in the app bundle 2026-11-19; fixed, verify in sandbox · **Since:** 2026-11-17
- **What:** CO10, COR9, sandbox 44258530411 (deals.rbac:574), 44361216176 (companies.rbac:330, contacts.rbac:174). Both 44361216176 errors: focusin INPUT +165/+181 ms, menu ADDED, focusout INPUT -> `BUTTON.assign-to` 4 ms later, menu REMOVED 6 ms after, lookup fired after the removal, the second click adds no event.
- **Cause (bundle `index.d0a7f5a2…`, quick-task form):** `button.assign-to` has `onClick: preventDefault` and opens on `onMouseEnter`; the Field renders with `autoFocus` and `input.onBlur` closes it. Playwright's click moves the pointer (mouseenter: menu renders, input focused) then mousedown: the browser focuses the button, the input blurs, the menu closes. It passes if mousedown lands before the autofocus. A second click cannot reopen it (pointer already over the button: no new mouseenter). Due date and Priority also open on mouseenter (no blur handler). The Tasks Add dropdown (tasks.rbac:273) is a Bootstrap click toggle, cause unconfirmed.
- **Fix (2026-11-19):** `openMenuAndWaitForItem(..., {openBy:'hover'})` for Assigned To and due date (pointer parked, `hover()`, one retry); 20/20 opens passed. Close after a clean sandbox run. Tasks Add dropdown: Bootstrap click, unchanged.

### KI-69 — Restricted owner's lead menu without "Delete" (2026-11-16)
- **Status:** open, cause found, fix awaiting verification · **Since:** staging `leads.rbac.spec.ts:762` (12/12 fail), 698
- **What:** own lead's ellipsis menu had only "Clone" and "Trigger Sequence" although the API said `recordActions.delete: true`. Cause: `restricted.json` (re-auth of a signed-out page, 17:04Z) lacked `userId/tenantId/userName/slingApp`; rebuilt: both pass 2/2. Fix: state guard + globalSetup key check (ADR 0017); close after the next full runs.

### KI-68 — App shell stuck on "Loading" after a direct-URL navigation (2026-11-16)
- **Status:** open, intermittent, backend/network side proven by the network log · **Since:** staging `leads.rbac.spec.ts:744` x24 (2 of 24)
- **What:** after `goto /sales/leads/details/<id>` the page stayed on the splash: `GET /v1/entities/label` and `/v1/tenants` were never answered (HAR -1), so no lead GET followed; `waitForLeadDetailsPage()` failed by name.

### KI-67 — Clone lead form: Last Name sometimes loses the " Copy" pre-fill (2026-11-16)
- **Status:** open, tracked; tests do not fail on it (owner 2026-11-17: not an app bug) · **Since:** sandbox 38855451748 (2026-10-16); staging 2/24, 3/24 at 4 workers
- **What:** probe (store hook, traced, restricted): passing opens (38/38): FORM_SUCCESS(44) -> INITIALIZE(42) 3-21 ms later -> `CHANGE lastName "X Copy"` after the fields register. The failing open (1 of 39): CHANGE +484 ms (no field registered), then INITIALIZE(42) +508 (47 ms after FORM_SUCCESS(44)): Copy gone.
- **Test:** `cloneLead(original)` must pass: "Clone Lead" form open, original first name in it, save gives a NEW id. A missing " Copy" only adds a `known-issue` annotation + warning.

### KI-66 — Deal edit: Actual Total not recalculated after a product attach; 3 tests re-enabled with a runtime verdict (2026-11-18)
- **Status:** open; PS14, PS11 and D51 re-enabled 2026-11-19 (`test.fixme` removed; stuck attach = expected failure with the KI-66 annotation, anything else red); app edit-form race, not reported to Kylas for now · **Since:** 2026-10-09 (QA), 2026-11-16, 2026-11-18
- **Tests:** P&S PS14 / PS11 (`:161`) and D51 (`deals.spec.ts`, 11 installments): pick the admin-owned product on a deal during edit, Distribute Equally -> "Yes, Proceed" -> Save. Kept: `DealsPage.updateDealAttachingProduct` (runtime known-bug verdict) and the `updateDeal` guard.
- **Issue:** when the edit form's cached layout and the deal GET land together, `formFieldIndex` is never built, so `isActualValueFieldPresent` is false: Estimated updates, Actual Total and the banner do not, Save -> 400 `01001091`. Probe: 4/4 stuck runs never saw `layoutLoading=true`. Not tied to installment count; not reproduced manually.
- **At risk, same race:** `deals.spec.ts` "admin should distribute unallocated amount equally after adding a product…": apply the same `updateDealAttachingProduct` verdict if it fails with the KI-66 message.

### KI-65 — `productFixtureNeed` skips product fixtures when a file filter carries a `:line` suffix (2026-11-16)
- **Status:** open, not fixed (workaround below) · **Since:** found 2026-11-16 reproducing sandbox run 42064754304
- **What:** `npx playwright test tests/ui/productsAndServices/productsAndServices.spec.ts:264 ...` logs `Product fixtures: SKIPPED — file filters [...:264 ...] match none of 16 fixture-needing specs`, then the tests fail `getProductFixture: no fixture file found for ENV=staging`: `extractFileFilters` keeps the `:264` suffix, so the filter never matches a spec path (the unsafe "wrong skip" direction).
- **Next check:** strip a trailing `:\d+` (and `:\d+:\d+`) from each filter in `extractFileFilters`; add a case to its unit check. Workaround: file path + `--grep`.

### KI-64 — `assertNoFormErrors` 1.5 s grace sleep and per-module sleeps remain (2026-11-05)
- **Status:** open, deliberate leftover (ADR 0016, B3; sleeps go to B6) · **Since:** 2026-11-04 plan RC4
- **What:** `BasePage.assertNoFormErrors(context, confirmedSave?)` skips the 1.5 s pause only when the caller passes its confirmed save response (Tasks edit, due-date; Contacts edit; Meetings create; Call Logs edit). Others keep the pause. Other `waitForTimeout` left: ADR 0014 backoffs (`BasePage` ~1041, `authManager` ~167).
- **Next check:** migrate the other callers to pass their `saveAndAwait` response; never raise the 1.5 s.

### KI-63 — `BasePage.click()` legs stack to ~150 s worst case (2026-11-05)
- **Status:** open, deliberate leftover (ADR 0016, B2) · **Since:** 2026-11-04 plan RC1
- **What:** render wait (60 s) + click (15 s) + recovery render wait (60 s) + click (15 s) can exceed the 120 s CI test budget; the test then fails as "Test timeout" without the named step. Not merged into one deadline because that would cut a slow-but-healthy recovery.
- **Mitigation:** the sign-out racer starts recovery within seconds, so the second leg normally has its full budget; CI `actionTimeout` is now 60 s (was 90 s).
- **Next check:** after the sandbox 10-worker run, grep for "Test timeout of 120000ms" whose last step is a `click`.

### KI-62 — App crash `QuotationApprovalStateFieldValue` on a freshly loaded company page with quotations (2026-11-05)
- **Status:** open, app (not reported, owner decision plan section 8); test avoids the trigger · **Since:** 2026-11-04
- **What:** loading `/sales/companies/details/{id}` by URL after a quotation exists throws `TypeError: Cannot read properties of undefined (reading 'find')`; the Quotations card never renders (staging companies.spec:248 failed 3 of 5 with the old reload step, QA 3 of 8). CO12 now verifies in place and fails 2 s after an uncaught page error (ADR 0016).
- **Next check:** reload a company with a quotation 10x; if it persists, give Kylas the stack.

### KI-61 — QA deal search stopped indexing new deals (2026-11-04): "Related Deals (0)", deal tests fail
- **Status:** open, environment (QA backend) · **Since:** 2026-11-04
- **What:** deals created after 11:25 UTC (ids 437935-437952, all returned by `GET /v1/deals/{id}`) were still absent from `POST /v1/search/deal` 3.5 h later; company/contact/lead search were current. The company page's Related Deals card therefore showed 0 after every create.
- **Tests:** `companies.spec.ts:331`, `:387`, `contacts.spec.ts:318` failed 2/2; `companies.spec.ts:248` and `contacts.spec.ts:244` pass about half the time (not attributed). No wait can pass while the index is stalled.
- **Next check:** repeat the search by ids when QA's indexer is restored; if the lag is seconds again, add a bounded re-issue of the app's own search (plan batch B3). [rate-limits-and-error-pages.md](./known-issues/rate-limits-and-error-pages.md).

### KI-52 — A lead shared READ-ONLY still lets the restricted user delete the admin's note and add tasks via the API
- **Status:** open — Kylas [SD-32157](https://kylas.atlassian.net/browse/SD-32157) (notes), [SD-32158](https://kylas.atlassian.net/browse/SD-32158) (tasks) · **Since:** 2026-10-30
- **What:** with a `read`-only rule: note ADD fixed on QA 2026-11-18 (401 `000004`; staging/prod still 200); DELETE of the admin's note still 200 on QA (SD-32157); task create 200. [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md).
- **Tests:** `leads.rbac.spec.ts` L77, L80, L79 decide at run time (`applyKnownBugVerdict`, `src/utils/knownIssue.ts`): accepted = expected failure, refused = pass + annotation to add the env to `KNOWN_BUG_FIX_CONFIRMED_ENVS`. Close when all three are strict ([RUNBOOK](./RUNBOOK.md#when-it-is-an-app-bug)).

### KI-57 — `assertNoFormErrors()` reads ANY error toast, including ones from unrelated requests
- **Status:** open (fixed only for company clone) · **Since:** 2026-10-30
- **What:** the company clone saved ("Company cloned (Company ID: 272255)") while the Related Deals widget raised its own error toast (`POST /v4/reports/deals` 400 000000); the test failed with "Validation errors found in company clone form". Reproduced by forcing that request to fail. Fixed for `cloneCompany()` and `failedWriteTracker` (`/reports/` POSTs); the same shape remains at ~90 other callers.

### KI-58 — Staging: lead and contact creates with an e-mail or phone return 400 000000
- **Status:** open, root cause not confirmed (backend/config suspected) · **Since:** 2026-10-30 (uniqueness set to EMAIL_PHONE)
- **What:** 2026-10-31 live: `POST /v1/leads` with unique e-mail and phone (`has-duplicates` false): name only 200; e-mail only, phone only, both 400 `{"code":"000000","errorDetails":[]}`. UI lead/contact creates fail alike; company create and QA pass. Needs the Kylas backend log / staging config; a 400 is no longer retried (ADR 0014).
- **2026-11-25 (sandbox #240, `leads.spec:141`):** `POST /v1/leads/` 400 `000000` "Unexpected error occurred!!", no field errors; passed on retry. Same signature, Kylas side.

### KI-59 — Unverified siblings of the 2026-11-02 sandbox fixes
- **Status:** open, watch · **Since:** 2026-11-02
- **What:** Notes-panel clicks in Contacts/Companies/Deals do not wait for the entity header; other modules keep their own react-select pickers. **2026-11-16 (staging, 4 workers):** lead page size/sort/view are shared per-user state: L68 switched admin to Kanban while L65 (`leads.spec.ts:1409`) was sorting; no `.rt-tr` rows for 60 s. Mitigated 2026-11-18 inside `leads.spec.ts` only (`leadListPreferences.ts` lock, verified live); other lead specs on other shards are not covered. Own-smart-list isolation is impossible (`mark-as-preferred` makes it the user's only preferred list). Detail: [locators-and-timing.md](./known-issues/locators-and-timing.md).

### KI-60 — Staging report-save 500 `01403004` (Lead reports too) and quotation-save timing (2026-11-03)
- **Status:** open · **Since:** 2026-11-03 (sandbox, staging)
- **2026-11-19:** sandbox 44361216176 shard 1 logged 9 such 500s in 18 min; reports.spec:866 Save As failed on the attempt and the retry. Save As now has the same one retry on exactly 500 + `01403004`, after a name check (ADR 0017); an unavailable check fails by name.
- **What:** `POST /v3/reports` 500 `01403004` hit Save As and a Lead report ("Meeting-only" is stale); both now fail at once with status/code (the one existing create retry stays). Product control stays disabled if `GET /v1/deals/{id}` fails (now a labelled fast failure). 400 "Connection prematurely closed BEFORE response" on a quotation save is KI-49, not retried. `quotations.rbac` edit-shared "Save toast not visible": hardened, cause unconfirmed, needs a trace.
- **2026-11-25 (sandbox #240):** `POST /v3/reports` 500 seen again in the run's background errors; Kylas side, no code change.

### KI-53 / KI-54 / KI-55 — Lead coverage watch items (2026-10-30): old shares (hygiene), session-expired runs, meeting-ID capture; detail in [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md)

---

## B. Infrastructure and CI

### KI-50 — QA front end drops custom-field values typed in the first ~0.5 s of the product form
- **Status:** test-side fix `9e60850`, unverified by a full QA run; app-side drop to be reported to Kylas · **Since:** 2026-10-28 (about 14:10 UTC)
- **What:** on QA's new front end a custom-field value typed within about 0.5 s of the P&S form opening is posted at the top level (HTTP 200) and dropped; `waitForFormFieldDefinitions()` now waits for the definitions. Interim: 47 passed, 0 failed, all saves NESTED, one unexplained FFRPS24 timeout. Detail: [products-and-services.md](./known-issues/products-and-services.md).
- **Next check:** the promotion `qa.yml` run: no FLAT saves or "definitions not seen" warnings.

### KI-11 — The formFields shard matrix does not scale with test growth
- **Status:** open · **Since:** 2026-09-29
- **What:** `run-formfields-tests` is a fixed one-job-per-entity matrix (deliberate, [ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md)), so growth can only lengthen an entity's own job. The slowest entity (Lead) measured about 110 min against a 180-minute `timeout-minutes` (~1.6× margin) when the matrix still ran alongside the core shards.
- **Next check:** re-measure that entity's real shard duration before merging any large formFields addition; if near the ceiling, split that entity's UI and RBAC files into two sequenced jobs (the proven constraint is "never split a pair across *concurrent* machines").

### KI-16 — JWT lifetime is not a stable constant; `ensureFreshSession()` margin is unsized
- **Status:** open · **Since:** 2026-08-10 (re-opened 2026-08-11)
- **What:** measured token lifetimes differ between investigations (~10.4 h, ~20 min once, ~101 min later). Since 2026-11-05 (ADR 0016) the refresh margin is sized from the token's own `expiresIn` (app refresh trigger 10 min + longest test 8 min + 2 min, capped at half the lifetime), because the app signs the user out ~10 min before expiry when `GET /v1/tokens/refresh/` answers 400 (sandbox run 41825279669). Why the lifetime varies is unexplained.
- **Next check:** investigate why it varies. History: [session-expiry-and-auth.md](./known-issues/session-expiry-and-auth.md).

### KI-21 — Unbounded random-option clicks remain in Leads and Quotations
- **Status:** unverified (carried over; not re-read this session) · **Since:** 2026-07
- **What:** `LeadsPage.ts` close-reason radio and convert-to-deal product selection, and several `QuotationsPage.ts` random-option pickers use a raw unbounded `.click()`. `QuotationsPage.fillOwner()` was fixed. Pattern to apply: `BasePage.selectRandomOptionWithRetry()` ([PATTERNS.md](./PATTERNS.md)).

### KI-23 — `assertQuotationInList()` can false-positive on the never-cleaned QA dataset
- **Status:** open (verified: delegates to `retryFindInList()` and checks the search term appears in a row) · **Since:** 2026-08-17
- **What:** `/v1/quotations/search` is fuzzy OR-word matching capped at 10 results and the target need not be among them. Affects every test using this assertion.

### KI-24 — Four private `selectDateInPicker()` copies; the month-jump control is unused
- **Status:** open (verified: `QuotationsPage`, `CallLogsPage`, `DealsPage`, `ReportsPage`) · **Since:** 2026-08-10
- **What:** native date pickers are independently maintained, unlike the shared custom-field version; a `.custom-month-year-dropdown` direct-jump control (~41% faster for distant months) is not used in the repo.

### KI-25 — Stale "always runs `--workers=1`" comments in Reports specs
- **Status:** open, doc-only (verified at `tests/ui/reports/reports.spec.ts` ~L127/L152 and `tests/rbac/reports.rbac.spec.ts` ~L114) · **Since:** 2026-09-09
- **What:** the comments justify plain `test.describe()` (not `.serial`) by single-worker, declaration-order execution; sharding makes both false. The blocks are still safe because the assertion is `toBeGreaterThanOrEqual`. Correct the comment when either file is next edited.

### KI-26 — Repo hygiene
- **Status:** open · **What:** no committed `.env.example` (gitignored); legacy `.eslintrc.json` never read by `npm run lint`; prettier drift in `LeadsPage.ts` and `BasePage.ts` (`QuotationsPage.ts` is clean as of 2026-10-27); inert `agent_delegation` / `investigation_log` block in `.claude/settings.json`. Detail: [ci-pipelines.md](./known-issues/ci-pipelines.md). <!-- ref-ok -->

### KI-35 — React-select menu left open blocks the next click (QA only): fixed locally, not yet seen in CI
- **Status:** open for CI confirmation · **Since:** 2026-10-07
- **What:** `BasePage.ensureReactSelectMenuClosed()` ([ADR 0011](./adr/0011-react-select-menu-closed-contract.md)) is used by BasePage helpers and 9 modules (not `LeadsPage.ts`); passed locally on QA 2026-10-08. Evidence: [locators-and-timing.md](./known-issues/locators-and-timing.md). Not verified: why QA differs from stage.
- **Part 2 (open):** `saveEditedProduct()` has no `blur()` + `networkidle` before Save (`b0c6b38` claim); see [products-and-services.md](./known-issues/products-and-services.md).

### KI-44 — `CompaniesPage.captureCompanyIdFromResponse()` matches a bare `includes('companies')` (rule 15)
- **Status:** latent, NOT reproduced · **Since:** 2026-07-16 (recorded 2026-10-27)
- **What:** no `/v1/companies/` requirement (`src/modules/companies/CompaniesPage.ts:424-445`; the other modules have it). Deliberate at the time: the clone POST path was unconfirmed. Only caller `cloneCompany()`; a null id fails loudly, a wrong id is the risk.
- **Next check:** confirm the clone POST path from a trace, then reuse the regex; re-run clone 3-5x. Analysis: [locators-and-timing.md](./known-issues/locators-and-timing.md) ("KI-44 detail").

### KI-40 / KI-41 / KI-42 and the Call Logs re-open note: watch items in [reports-module.md](./known-issues/reports-module.md), [products-and-services.md](./known-issues/products-and-services.md) and [locators-and-timing.md](./known-issues/locators-and-timing.md).

---

## D. Accepted behavior / decisions needed

- **KI-30 / KI-31 / KI-32 / KI-33** (accepted behavior and decisions needed: display names, Lead edit fields, Company Website negative test, Quotation report entity on QA only) moved verbatim to [known-issues/watch-items.md](./known-issues/watch-items.md) (2026-11-18), text unchanged, IDs stable.

## Watch items moved to [known-issues/watch-items.md](./known-issues/watch-items.md) (2026-11-04)

Still open, text unchanged, IDs stable; moved only to keep this file's size under its budget.

| ID | Item | Status |
|---|---|---|
| KI-01 | FFPS5: stable across re-testing, root cause unconfirmed | inconclusive (currently stable; original symptom never repro |
| KI-02 | FFRPS8 is a load-dependent flake with no prior record | inconclusive |
| KI-06 | Part of the first sharded qa run's elevated flaky count is not root-caused | unverified |
| KI-07 | `browser.newContext()` CDP Protocol error: one occurrence, cause unconfirmed | inconclusive |
| KI-34 | Field-config reset job and concurrency groups: never run, GitHub behaviours unconfirmed | unverified (implemented 2026-10-06; only |
| KI-36 | Sandbox formFields split never exercised in a real CI run | unverified (implemented 2026-10-07) |
| KI-38 | Sandbox formFields entity selection: never exercised on GitHub | unverified (implemented 2026-10-08) |
| KI-37 | Install-step bound and incomplete-run handling: unproven by a real run's logs | partly confirmed (implemented 2026-10-08 |
| KI-12 | Sequenced formFields-after-core is not yet proven by a real run | unverified |
| KI-13 | `globalSetup` product-reference-data HTTP 400 on staging | unverified |
| KI-14 | Jenkins changes not confirmed by a real execution | unverified |
| KI-45 | Host suspend stretches Jenkins timeouts (main #13 sat 3,773 min on a 24 h limit) | fix applied 2026-10-28 (sleep masked by  |
| KI-46 | GitHub cannot see Jenkins runs | open (procedural only) |
| KI-47 | Sharded Jenkins: two core lanes at once still unproven | partly confirmed (live 2026-10-28) |
| KI-15 | Real GitHub Jobs API response shape for the "CI Job Stats" card | unverified |
| KI-18 | Unmeasured reporting pipeline gaps | open |
| KI-19 | The escalated sandbox run's formFields track ignores `--grep @regression` | open |
