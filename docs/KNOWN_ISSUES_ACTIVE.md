# Known Issues — Active

> **Purpose:** The only list of OPEN problems in this repo — one short entry each. Resolved history lives in [known-issues/](./known-issues/README.md); real Kylas product bugs are tracked outside this repo.
> **Read when:** triaging a failure ("is this already known?"), picking up follow-up work, or closing/adding an issue at the end of a task (Definition of Done step 3).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 4a85ad7

**Rules.** Open items only. Entry ≤ 8 lines: Status · Since · What · Evidence / next check · History link. IDs (`KI-nn`) are stable — never renumber. When an item is closed, move a ≤15-line summary to its topic file (template in [CONTRIBUTING_TESTS.md](./CONTRIBUTING_TESTS.md#size-policy)) and delete the entry here. Status: **open** (confirmed, not fixed) · **inconclusive** (investigated, no root cause; do not re-close without new evidence) · **unverified** (carried over, not re-checked against the repo on the date above).

---

## A. Failing / flaky tests

### KI-01 — FFPS5: stable across re-testing, root cause unconfirmed
- **Status:** inconclusive (currently stable; original symptom never reproduced) · **Since:** 2026-09-23 (re-investigated 2026-09-28)
- **What:** `FFPS5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a product` (`tests/ui/formFields/productsAndServicesFieldLimits.spec.ts`). Six independent conditions reproduced neither the dropped-value nor the fill/locator symptom. Write-up: [form-fields.md](./known-issues/form-fields.md) (conditions list).
- **Next check:** if it fails again, capture the failing run's `trace.zip` or a screen recording *at that moment* (never obtained); do not re-argue from theory. Existing bounded retries stay as labeled hardening (rule 10).

### KI-02 — FFRPS8 is a load-dependent flake with no prior record
- **Status:** inconclusive · **Since:** 2026-10-06 CI results (reported by the repo owner)
- **What:** `FFRPS8 restricted user should confirm typing too few characters in the Text field is rejected when creating a product` (`tests/rbac/formFields/productsAndServicesFieldLimits.rbac.spec.ts`) — fails intermittently under concurrent CI load; nothing in git history or the old issue log mentions it.
- **Next check:** per rule 21 a clean isolated run proves nothing; look for the same symptom on sibling tests sharing the P&S form-field lock (`productsAndServicesFormFieldLock.ts`; generic lock: [sharding-and-locks.md](./known-issues/sharding-and-locks.md)) before treating it as test-specific. Possibly related to KI-01 (same entity, same Text field) — unconfirmed.

### KI-03 — Quotations "auto-reveal a hidden field" is a timing outlier
- **Status:** open · **Since:** 2026-09-09
- **What:** `@regression admin should auto-reveal a hidden field immediately after editing it, without re-toggling` (`quotations.spec.ts`) and its restricted twin (`quotations.rbac.spec.ts`) run several times longer than the same Hide-Empty-Fields test in every other module. Recurring Companies / Products & Services Hide-Empty-Fields failures in the 2026-09-29 run match the same shape.
- **Next check:** needs the test's own `trace.zip` (CI interleaves two workers' log lines, so the log alone cannot isolate the slow step). No guessed fix applied.

### KI-04 — Inconclusive one-off flakes (do not re-close without new evidence)
- **Status:** inconclusive · **Since:** 2026-07-06 … 2026-08-03
- **What:** six one-off flakes (Deals shared-deal Call-log permission; Quotations RBAC ~8-min `openCreateForm()` timeout; call-logs company live-search "no options"; meetings reschedule 3× HTTP 500; tasks RBAC edit-modal hang; meeting-creation 500 / Deals RBAC Task-permission timeout), each a single or unreproducible occurrence. Detail: [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md), [locators-and-timing.md](./known-issues/locators-and-timing.md).

### KI-05 — Dashboard render race (DB33 / DB36) and the stuck-dashlet symptom
- **Status:** open · **Since:** 2026-09-02
- **What:** `DB33 add Smartlist dashlet for Email` and `DB36 add Grouped Smartlists dashlet for Contact` still intermittently fail after the self-cancelling-retry bug was fixed: DB36's confirmation fetch never fires; DB33's fetch returns 200 but no dashlet paints. Separately, pre-existing Report-type dashlets on the Default dashboard stay on their loading placeholder (root cause never established; deliberately not exercised by any test).
- **Next check:** needs an app-side rendering investigation; suspected client-side paint failure under rapid multi-dashlet adds. History: [dashboard-module.md](./known-issues/dashboard-module.md).

### KI-06 — Part of the first sharded qa run's elevated flaky count is not root-caused
- **Status:** unverified · **Since:** 2026-09-09
- **What:** 14 flaky tests in that run vs a historical 1–3; 8 are explained by the `wrongPage`-landing and ellipsis-toggle fixes ([ci-pipelines.md](./known-issues/ci-pipelines.md)), the other 6 were never individually traced (no trace-level access then).
- **Next check:** compare the flaky count of the next full sharded qa runs against that baseline before opening an investigation — only a recurring test justifies one.

### KI-07 — `browser.newContext()` CDP Protocol error: one occurrence, cause unconfirmed
- **Status:** inconclusive · **Since:** 2026-08-26
- **What:** a thrown Protocol error during fixture setup in one long multi-worker run (resource-pressure-consistent, never reproduced). The adjacent structural gap (recovery login not wrapped, so setup got one attempt instead of two) was fixed ([locators-and-timing.md](./known-issues/locators-and-timing.md)); the Protocol error itself was deliberately not hardened (rule 10).
- **Next check:** a recurrence with resource metrics (`free -h`, process counts) from the runner.

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

### KI-61 — QA deal search stopped indexing new deals (2026-11-04): "Related Deals (0)", deal tests fail
- **Status:** open, environment (QA backend) · **Since:** 2026-11-04
- **What:** deals created after 11:25 UTC (ids 437935-437952, all returned by `GET /v1/deals/{id}`, status OPEN, company set) were still absent from `POST /v1/search/deal` at 14:58 UTC (3.5 h). Company and contact search were current (newest 12:43 / 12:45), leads 11:45. The company page's Related Deals card (`POST /v1/search/deal`, rule company = id AND forecastingType in OPEN) therefore answered `totalElements: 0` after every create.
- **Tests:** `companies.spec.ts:331`, `:387`, `contacts.spec.ts:318` failed 2/2 with and without B1 (ADR 0016): the create answers 201, the card shows "Related Deals (0)". Not a wait problem: no bounded wait on the search can pass while the index is stalled. `companies.spec.ts:248` and `contacts.spec.ts:244` (quotation from the panel, same deal search returning 0) pass about half the time: not yet attributed.
- **Next check:** repeat the query below when QA's indexer is restored (`search by ids` returning the deals); if the lag is seconds again, add a bounded re-issue of the app's own search (post-save refresh, plan batch B3) instead of one read. [rate-limits-and-error-pages.md](./known-issues/rate-limits-and-error-pages.md) for the 429 side.

### KI-52 — A lead shared READ-ONLY still lets the restricted user add/delete notes and add tasks via the API
- **Status:** open — Kylas [SD-32157](https://kylas.atlassian.net/browse/SD-32157) (notes), [SD-32158](https://kylas.atlassian.net/browse/SD-32158) (tasks) · **Since:** 2026-10-30
- **What:** with a `read`-only rule the API returns 200 for note create/delete and task create (meetings 422, call logs 403); the UI hides the icons. Evidence: [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md).
- **Tests:** `leads.rbac.spec.ts` L77 (notes), L79 (tasks) carry `test.fail(true, 'Kylas bug SD-…')`; "expected to fail but passed" = fixed: delete the marker, close this entry ([RUNBOOK](./RUNBOOK.md#when-it-is-an-app-bug)). UI half: L14.

### KI-57 — `assertNoFormErrors()` reads ANY error toast, including ones from unrelated requests
- **Status:** open (fixed only for company clone) · **Since:** 2026-10-30
- **What:** the company clone saved ("Company cloned (Company ID: 272255)") while the Related Deals widget raised its own error toast (`POST /v4/reports/deals` 400 000000); the test failed with "Validation errors found in company clone form". Reproduced by forcing that request to fail. Fixed for `cloneCompany()` and `failedWriteTracker` (`/reports/` POSTs); the same shape remains at ~90 other callers.

### KI-58 — Staging: lead and contact creates with an e-mail or phone return 400 000000
- **Status:** open, root cause not confirmed (backend/config suspected) · **Since:** 2026-10-30 (uniqueness set to EMAIL_PHONE)
- **What:** 2026-10-31 live: `POST /v1/leads` with unique e-mail and phone (`has-duplicates` false): name only 200; e-mail only, phone only, both 400 `{"code":"000000","errorDetails":[]}`. UI lead/contact creates fail alike; company create and QA pass. Needs the Kylas backend log / staging config; a 400 is no longer retried (ADR 0014).

### KI-59 — Unverified siblings of the 2026-11-02 sandbox fixes
- **Status:** open, watch · **Since:** 2026-11-02
- **What:** Notes-panel clicks in Contacts/Companies/Deals do not wait for the entity header; other modules keep their own react-select pickers; lead page size/sort/Kanban are shared per-user state. Detail: [locators-and-timing.md](./known-issues/locators-and-timing.md).

### KI-60 — Staging report-save 500 `01403004` (Lead reports too) and quotation-save timing (2026-11-03)
- **Status:** open · **Since:** 2026-11-03 (sandbox, staging)
- **What:** `POST /v3/reports` 500 `01403004` hit Save As and a Lead report ("Meeting-only" is stale); both now fail at once with status/code (the one existing create retry stays). Product control stays disabled if `GET /v1/deals/{id}` fails (now a labelled fast failure). 400 "Connection prematurely closed BEFORE response" on a quotation save is KI-49, not retried. `quotations.rbac` edit-shared "Save toast not visible": hardened, cause unconfirmed, needs a trace.

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
- **What:** measured token lifetimes differ between investigations (~10.4 h documented, ~20 min once, ~101 min later, 4/4 reproducible). `AuthManager.ensureFreshSession()` refreshes at <10 min remaining, sized against the wrong assumption. A ~40-minute-old storage state landing on sign-in is likewise unexplained.
- **Next check:** dedicated investigation into *why* the lifetime varies before changing shared `AuthManager` code. History: [session-expiry-and-auth.md](./known-issues/session-expiry-and-auth.md).

### KI-17 — Cross-worker re-login collision: hypothesis, never confirmed
- **Status:** inconclusive · **Since:** 2026-08-07
- **What:** two occurrences (a Lead create-POST wait; a Quotations HTTP 500 after three rapid re-auth cycles) were correlated with another worker forcing a fresh login for the same role. `AuthManager` *does* serialize file writes (`withFileLock` + atomic rename), so file corruption is excluded; a same-role session-invalidation collision is not. Almost every pipeline runs `--workers=2`, so the old "always run `--workers=1`" requirement is not observed in CI.
- **Next check:** per-worker credential isolation or a confirmed trace of the invalidation; until then treat a lone `--workers>1` ID-capture timeout near a `forcing a fresh login` log line as suspect.

### KI-20 — `waitForTimeout(500)` left in `openUserShareTypeSearch()` catch backoff
- **Status:** open (verified: the `openUserShareTypeSearch()` catch backoff in `CompaniesPage.ts`, `LeadsPage.ts`, `ContactsPage.ts` and `DealsPage.ts`, after the `Escape` keypress) · **Since:** 2026-08-09
- **Fix when touched:** replace with the condition-based wait that `QuotationsPage.fillOwner()` already uses (`ensureReactSelectMenuClosed()`, which waits for `.is-invalid__menu` to hide). (The pre-commit hook only blocks *newly added* lines, so old ones persist.)

### KI-21 — Unbounded random-option clicks remain in Leads and Quotations
- **Status:** unverified (carried over; not re-read this session) · **Since:** 2026-07
- **What:** `LeadsPage.ts` close-reason radio and convert-to-deal product selection, and several `QuotationsPage.ts` random-option pickers use a raw unbounded `.click()`. `QuotationsPage.fillOwner()` was fixed. Pattern to apply: `BasePage.selectRandomOptionWithRetry()` ([PATTERNS.md](./PATTERNS.md)).

### KI-22 — `ContactsPage.saveEditedContact()` has no network confirmation
- **Status:** open (verified: clicks Save, asserts no form errors, waits for the modal to hide) · **Since:** 2026-08-25
- **What:** the same gap `saveEditedCompany()` / Leads had; fix is the ~15-line "await the PUT response" pattern already used there. Seven test call sites exercise `ContactsPage.saveEditedContact()` (`contacts.spec.ts` x2, `contacts.rbac.spec.ts` x3, `contactFieldLimits.spec.ts` and `contactFieldLimits.rbac.spec.ts` x1 each), plus one internal call.

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

### KI-43 — Staging search index not reflecting new records (sandbox 38582148420: 64 failed, 38690038228: 55 failed)
- **Status:** open (staging environment problem, live probe 2026-10-15; no test-code fix possible; run 40279659288 passed: recovery, not proof) · **Since:** 2026-10-14
- **What:** just-created deals/contacts/leads/companies never appeared in search lookups (empty react-select, `retryFind*` false, meeting 422 `01503001`, call-log 403); a created deal stayed absent from `GET /v1/search/deal/lookup` for 188 s. Possible recurrence 2026-10-29 (run 40821683680).
- **Ask / next check:** is the staging indexer or event consumer backlogged (HYPOTHESIS)? Probe or ask the Kylas team before closing. Full signatures, traces, probe: [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md) ("OPEN (KI-43)").

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

- **KI-30 — `deriveModuleFromFile()` display names** (`Call-logs`, `ProductsAndServices`, `login.spec.ts` counted under Dashboard) are deliberately unfixed: renaming would break trend continuity in `ci/reporting-history`. Read the code comment above the final name computation before touching it.
- **KI-31 — Lead `fillEditForm()` does not update Timezone/Country/Professional fields** (Contact's updates Timezone and Professional only). Create-only was the lower-risk choice; extending it is a maintainer decision.
- **KI-32 — Company Website validation has no negative test** (the custom `UrlField` does).
- **KI-33 — Quotation report entity type is deployed to QA only** (as of 2026-09-09; **UNVERIFIED**: `ReportsPage.ts` comments disagree on stage/prod and nothing in the repo settles it); the two tests that need it self-skip via a live presence check — re-verify per environment ([ci-pipelines.md](./known-issues/ci-pipelines.md), [reports-module.md](./known-issues/reports-module.md)).

## Watch items moved to [known-issues/watch-items.md](./known-issues/watch-items.md) (2026-11-04)

Still open, text unchanged, IDs stable; moved only to keep this file's size under its budget.

| ID | Item | Status |
|---|---|---|
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
