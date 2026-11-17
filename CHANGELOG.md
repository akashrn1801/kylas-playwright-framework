# Changelog

> **Purpose:** Newest-first, one line per significant change to the framework, CI and docs.
> **Read when:** You need to know when something changed, or you finished work (Definition of Done step 2: add one line).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 4a85ad7

Format: `- YYYY-MM-DD — <type>: <what> (<hash>)`. Detail lives in git history and in `docs/known-issues/`, `docs/adr/`. Older months are compressed to one line per theme.

## Unreleased

- 2026-11-17 — refactor: meetings B6, 43 sleeps -> 0 (MeetingsPage + UI/RBAC specs); `saveEditedMeeting`/reschedule confirm `PUT /v1/meetings/{id}`, `saveMeeting` confirms `POST /v1/meetings` (a refused create always throws; the toast-popup click is dropped, callers go ID-first), mark conducted / cancel confirm `POST .../conduct` and `.../cancel` and a missing cancel-confirm popup fails by name, Add form and `createMeeting` have no retry loop, the invitee pick takes the first non-selected option and asserts the chip (a restricted creator's first option was themself, so no invitee was ever added), medium/Related To wait on menus and fail by name on a type without records (no hardcoded search terms), sort must succeed (Apply's `POST /v1/meetings/search`), the lag retry is a bounded `toPass` on 422/01503001 only, M14 uses a fresh unshared admin lead with positive controls (it was vacuous: restricted sees shared ADM leads), the GPS test asserts the location value and closes the form via `closeAddForm()` (Escape does not close it), dead `openFilterPanel` removed
- 2026-11-17 — refactor: tasks B6, 35 sleeps -> 0 (TasksPage + RBAC spec); quick-task save requires the form to close, `fillQuickTaskForm` waits for each menu and asserts each pick (a missing option fails by name), `openDetailedTaskForm` has no retry loop, `fillRelation` fails by name on a type without records, `saveEditedTask` confirms its PUT, mark complete confirms `PUT /v1/tasks/{id}/complete` and TK6/TK16 assert the Completed status, note add/list wait on `POST /v1/notes/relation` and `GET /v1/tasks/{id}/notes`, `retryFindTask` is a bounded `toPass` on `POST /v1/tasks/search`, dead `openFilterPanel` removed; changelog entries 2026-11-03..2026-10-20 (29) moved verbatim to docs/CHANGELOG_ARCHIVE.md
- 2026-11-17 — refactor: companies B6, 40 sleeps -> 0 (CompaniesPage + UI/RBAC specs); delete/share/reassign confirm their own response (`saveAndAwait`), deleted company must answer 404 / `02801002`; share-type pick is one pass (Leads and Companies, no retry loop); COR8/COR13 assert the note text, COR11 the quotation id in the card list; Add Contact fails by name on a missing Email/Phone; `retryFindCompany` is a bounded `toPass`; new `MeetingsPage.saveMeetingFromEntityPanel()`
- 2026-11-17 — refactor: leads RBAC L77/L79 titles carry "(API)" and comments/KI-52/RUNBOOK point to L14 as the UI half; `tokenAcceptedByApi` returns false on 400 `001002` (revoked token) instead of throwing
- 2026-11-17 — fix: auth (ADR 0017): globalSetup reports each session end (email Run Details) and with < 4 h left fails by name locally / warns in CI / logs out + logs in only with SESSION_RENEW=1 (a login cannot extend a live session, ADR 0017); it logs in again when a state lacks `userId/tenantId/userName/slingApp`; every state save goes through `saveGuardedStorageState`; re-auth runs under the role lock and adopts a newer saved token; rights polls re-read the token and fail on `400 001002` (proof: staging lead specs 79 passed, 2 runs; delete + reassign 2/2; clone x24 3 failed = KI-67)
- 2026-11-17 — refactor: B6 Leads (59 sleeps -> 0; convert section gates, strict share/reassign/convert/clone responses; `src/utils/recordActionsApi.ts` shared poll core; proof: lead specs 79 passed)
- 2026-11-16 — fix: B6 CallLogs (proof = staging, call log specs once, 57 passed / 1 skipped / 0 failed, plus a 174-test `--repeat-each=3` run 171 passed / 3 skipped before the last edits): 55 `waitForTimeout` -> 0 in `CallLogsPage`, `call-logs.spec`, `call-logs.rbac.spec`; each wait is on the data or state the next step needs (list search answered + skeleton gone, control enabled, menu closed, `POST …/notes`, `GET /v1/users/me`). Found while root-causing 3 runs: react-select multi-select toggles closed on re-open and re-picking a selected option unselects it (picks now only unselected, checked count asserted); CL10 never opened its calendar (Date picker disabled, blocked-day `aria-label` prefix) and now asserts tomorrow is blocked; `saveCallLog` permission retry removed (ADR 0014; ADR 0017 amended), D21/CR10/contacts-4-permissions poll `recordActions` as the restricted user via the new `waitForRecordAction`/`pollRecordActions` (`src/utils/recordActionsApi.ts`, also used by the lead share-rule tests); Deal-flow Type step waits for the control to be enabled (hardened, root cause of the late form update not confirmed). Checklist moved to `docs/PATTERNS.md`; KI-66 updated; CL24 stays `test.skip` (see BRANCH_STATUS) (uncommitted)
- 2026-11-16 — fix: sandbox 42064754304 PS12/PS15 (quotation edit save never sent): `QuotationsPage.clickEditButton`/`clickEllipsisEdit` now wait for `layout/edit` + the loaded quotation number (`waitForEditFormReady`, same pattern as `openCreateForm`; a 4xx layout fails by name), `addFreshProductByName` reads rows after that gate and throws instead of overwriting a filled row (`BasePage.addProductRowAndSearchByName` got an optional `beforeSearch` guard, inert for other callers); both tests create their own minimal deal (a deal's products fill the 3-row form). Proof on staging: 10/10 (`--repeat-each=5 --retries=0`), each with one `PUT /v1/quotations/<id>` 200; full quotations + P&S run 56/57, the one failure (rbac:161 deal edit, 400 `01001091`) is NOT fixed, see KI-66 and KI-65 (productFixtureNeed `:line` filter) (uncommitted)
- 2026-11-05 — fix: sandbox 42034935606 (95c85db): the company formFields job died in globalSetup on `PUT /users/login` 400 `000004` "Database error" (10 jobs logging in together; S1/S2 treated it as definitive). Only that exact login answer is retried (2 extra attempts, 5-10 s pause; `isLoginDatabaseError`, ADR 0017 exception to ADR 0014 §1) and `sandbox.yml` staggers job starts by 20 s x slot (S3); `sessionCheck.ts` uses `logger` instead of `console` (uncommitted)
- 2026-11-05 — fix: B5 shared login state (bbf77eb; proof = sandbox run): the saved session is cleared only when the API rejects its token (`clearStorageStateIfRejected`, `src/auth/sessionCheck.ts`), login lock stale by holder age (5 min, was 30 s of waiting), CI reuses a state file written while it waited (no serial re-logins), fixture setup goes to `/sales/home` first, "headless re-auth did not stick" instrumented (token acceptance + localStorage keys), not reproduced on QA; ADR 0017 (pending)
- 2026-11-05 — fix: B4 (proof = sandbox run) check before retry, never double-submit: Leads Save clicked once (no re-click loop), `createLead` asks `has-duplicates` before a retry, quotation create 500 / connection reset polls the search API for the number before its one retry (`src/utils/quotationApi.ts`), no success inferred from the URL (`assertSuccessToast`, save loop), deals.rbac `logCallWithRetry` -> single-attempt `logCallFromDealPanel` without the `aria-hidden` hack, `withRateLimitRecovery` no longer reloads the "Something is broken" page (fails with the last failed request); ADR 0017 (8cac9c9)
- 2026-11-05 — fix: B3 (QA-proven for tasks, contacts, call-logs, UI quotations; staging proof = the sandbox run) `BasePage.saveAndAwait`/`clickWhenReady`; contact edit/delete and task due date await their own answer before the modal check; task create has one strict `POST /v1/tasks` wait (shared id capture no longer matches `/v1/tasks/search` or ignores a 4xx/5xx); call-log create arms `POST /v1/call-logs`; quotation deal picker waits for the deal lookup and `GET /v1/deals/{id}` (1 s sleep removed), status check retries; reports search POST retried only for transport/429/5xx with status in the error; leads duplicate-email test polls the search API first; KI-64 (`assertNoFormErrors` 1.5 s left) (072b6b2)
- 2026-11-05 — fix: B2 form-field lock wait fails with the holder and its heartbeat age 15 s before the fixture timeout (both lock implementations); CI `actionTimeout` 90 s -> 60 s so a stuck action fails by name inside the 120 s test budget (d5f8dfa)
- 2026-11-05 — fix: session-expiry class (P&S sandbox failure) — refresh buffer from the token's lifetime (20 min for a 47 min token), sign-out racer in `waitForEntityListPage`/`waitForRendered` (recovery in seconds, was 2 x 120 s), formFields afterAll hooks via `AuthManager` (no ENOENT) (89be7ed)
- 2026-11-05 — fix: CO12 company quotation card — verify in place after the card's own refresh instead of reloading by URL (the reload rendered the app's `QuotationApprovalStateFieldValue` crash), armed card-list wait replaces a 2 s sleep, `pageErrorTracker` fails the wait 2 s after an uncaught page error with its text; staging 15 of 15 (b91a2b3)
- 2026-11-04 — docs: KI-61, QA deal search stopped indexing new deals (18 deals created after 11:25 UTC not searchable 3.5 h later); three companies/contacts deal tests fail because of it (pending)
- 2026-11-04 — fix: `waitForRendered` rethrows non-timeout errors at once, a failed read is cleared by a later 2xx for the same path, widget-scoped "Something is broken" no longer fails other controls, timeout says elapsed seconds; `waitForListReady` loses its 5 s floor; ADR 0016 (7ed7f56)
- 2026-11-04 — fix: sessions validated once per role by one API call in globalSetup (workers trust the state; a 401/signIn still clears it), at most 2 concurrent logins per machine (`src/auth/loginGate.ts`, replaces the random pre-login sleep), login retries only for no-response/429/5xx and a 400 fails naming status+code+message; ADR 0016, KI-51 updated; QA 18/18 first attempt, staging proof pending (b30e7de)
- 2026-11-04 — chore: hardening batch B0 (measurement): `RETRY_COUNT=0` now honoured (was forced to 1), response-wait timeouts and `waitForListReady` name the awaited signal and elapsed ms; ADR 0016 started; no timeout/retry/outcome changed (e9c9e2a)
- 2026-11-04 — fix: flaky tests of sandbox run 2026-11-03: `actionTimeout` (was unbounded), `BasePage.waitForRendered()`/`explainAppErrorPage()` fail fast on the app error screen / a failed page GET, Tasks ID-open recovers from the 429 page, the lock wait has its own fixture budget, R65 compares the report with the live API count, not `< before`; `npm run check:fail-fast` (pending)
- 2026-11-03 — fix: email labels: KPI/trend "Passed first time" vs Health "Passed incl. flaky" (were two "Pass rate" numbers); flaky tests say "passed on retry" or "recovered on rerun" (cards, banner, summary); covered by `check:failure-labels` (pending)
- 2026-11-03 — test: scenario suite for the rerun shard (`scripts/check-rerun-scenarios.ts`, run by `check:rerun`): 16 scenarios through the real parser, email and history; fixes: did-not-run tests counted apart from Failed and Passed (not Flaky) when they pass on rerun, a test recovered in an earlier rerun stays Flaky when a later rerun fails it, stacked reruns keep earlier rows, both table columns add up (Skipped, Did not run, Total rows), no rerun section when nothing needed one (pending)
- 2026-11-03 — fix: rerun colour rules: a flaky-only first run reruns the flaky tests and is green when all pass (still listed and counted flaky); failed/did-not-run first runs rerun only those (flaky ones keep it at least amber); Skipped tile excludes did-not-run, new "Did not run" tile; scenarios 19-21 in `check:rerun` (pending)
- 2026-11-03 — fix: a run whose only issue is tests that did not run (serial dependents, cut-off shard, no skip annotation) or ran only on the rerun is Unstable, not Passed: banner "N did not run" / "N ran only on rerun" and a note; deliberate skips unchanged; scenarios 17-18 in `check:rerun` (pending)
- 2026-11-03 — fix: email review: skipped (did-not-run) tests add no phantom retries or "swept" counts, "1 retry / 2 retries", no empty `id=""` on flaky rows, dedup key includes flaky count; covered by `check:failure-labels` (pending)
- 2026-11-04 — docs: older Unreleased entries (2026-10-20 to 2026-10-06, 28 entries) moved verbatim to [docs/CHANGELOG_ARCHIVE.md](./docs/CHANGELOG_ARCHIVE.md); KI-11 stays, the CI/Jenkins/reporting watch items (KI-12–15, 18, 19, 34, 36–38, 45–47) moved verbatim to [docs/known-issues/watch-items.md](./docs/known-issues/watch-items.md) (4c10d24)

## 2026-10

- 2026-10-06 — fix: run formfields shards after core shards, skip unused product fixtures, record per-shard load signals (1bd03cc, ADR 0007)
- 2026-10-05 — fix: split RBAC serial blocks per section, recover from app error-boundary pages, compress known-issues (b90a885, ADR 0006/0008)

## 2026-09

- 2026-09-30 — fix: root-cause browser-closed list-readiness timeout, add contributor guide and guard-rail scripts (check:conventions, check:test-counts, new:module) (3d58073)
- 2026-09-29 — fix: scope lock to mutating tests, add 429 recovery, file-atomic shard planner, per-module reporting (bf32201, ADR 0003)
- 2026-09-29 — fix: resolve four residual timing issues; add job stats, retry breakdown and overlap detection to the email (1091c4b)
- 2026-09-29 — fix: transient-error retry for globalSetup product fixture calls (0195259)
- 2026-09-29 — fix: carve formFields out of sharding to stop cross-shard field-config races (6ec6e3f, ADR 0002)
- 2026-09-29 — fix: remove serial-mode skip cascade, fix afterAll timeout budget, honest retry reporting (9e35fc1)
- 2026-09-28 — fix: harden globalSetup token retry, sandbox shard-completeness check, module naming in reports (253afc3)
- 2026-09-28 — fix: dedicated custom fields to end cross-shard field-config collisions (ab06f5e, ADR 0001)
- 2026-09-28 — feat: Form Field Limit configuration tests for Lead, Contact, Company, Task, Deal, Products & Services (b9b88d7)
- 2026-09-10 — fix: notify false-alarm gating, Jenkins disableConcurrentBuilds, Quotations row-search wait, Reports drill-through retry (23d5233, 18b2c89, 08c54cc)
- 2026-09-09 — fix: suite-drift detection scoped by branch and test scope (7910c7e)
- 2026-09-09 — fix: skip Quotation entity-type report tests where not deployed; sharding order-dependency audit (6184a11)
- 2026-09-09 — fix: ellipsis-menu double-click bug and wrongPage navigation outcome (e8529d6)
- 2026-09-09 — fix: Jenkins per-stage timeouts replace pipeline-wide timeout (276d82f)
- 2026-09-09 — fix: shard qa/stage/sandbox/main CI to escape the 6h job ceiling, shard counts computed dynamically (cd22b91, 8e96dc8, a55e1e9)
- 2026-09-09 — fix: notify pipeline cannot misreport or crash silently on a bad run (d7de24c)
- 2026-09-08 — fix: PROD Build #4 failures; Hide Empty Fields tests across 8 modules (23818d0)
- 2026-09-05 — fix: revert stage workers=1 mitigation, timeout margin on qa/main (7e360e6)
- 2026-09-04 — feat: Cloned From field tests, dynamic CI duration estimates, Jenkins branch-to-test selection fix (09989be)
- 2026-09-03 — feat: Dashboard module (UI + RBAC) (7c5b992); fix: false drift alarm, R15/R48/R55 own-Lead data races (fa65807, b50a364, 253b950, 4c8dffd)

## 2026-08

- 2026-08-26 — fix: report-count verification accuracy, IST timezone, deadline-aware fixture timeout (aefd527); narrow time window option (02fe0a2)
- 2026-08-25 — fix: history-sync temp clone had no credentials, all pushes silently failed (4477e0f); backoff and permissions fixes (2324ca7, ad26f8a, 133e733)
- 2026-08-25 — fix: Build #147 flakes: Leads delete confirm, saveEditedCompany confirmation, R36/R64 report windows (9a34843, ef6b496, 0bc3795)
- 2026-08-24 — feat: redesigned notification email system (30e8870)
- 2026-08-23 — fix: Deals clone flakiness, Products chip-clearing race, product search truncation (31d93d0, aa49652)
- 2026-08-22 — feat: Reports module with run-count verification (0f46591)
- 2026-08-12 — docs/fix: README consolidation; waitForTimeout replaced by condition waits; Quotations ID capture (8202bea, 9185a7b, 0c5d3bf)
- 2026-08-09 — fix: root-cause six sandbox failures across Call Logs, Deals, Meetings, Quotations, Tasks (9c9a710)
- 2026-08-08 — fix: Task custom-field suffix bug, multi-select cap (95e602e)
- 2026-08-06 — fix: eliminate `any`, enforce no-explicit-any at pre-commit (5eaf7ae); docs consolidation (acb51b2)
- 2026-08-01 — chore: framework reliability overhaul: 13 subagents, hooks, agent delegation guide, CLAUDE.md split into .claude/ reference files (e181a6a..7e6b078)
- 2026-08-01 — feat: Meeting, Quotation, Call Log, Task custom fields; session-expiry hardening (26593ea, 40dc671)

## 2026-07

- 2026-07-29 — feat: Company custom fields; zombie session-expiry listener fix (beb1d42)
- 2026-07-28 — fix: shared buildApiUrl(), login URL normalization; sandbox default env switched to staging (0276029, 0971b3b, c85a7b3)
- 2026-07-27 — feat: Deal custom fields; navigation-drift fix across six modules (f395b14)
- 2026-07-22 — feat: Lead Company/Contact lookup custom fields and nine bug fixes (aec071e, 731b6c6)
- 2026-07-19 — fix: globalSetup login wait for staging CI (5039c0d)
- 2026-07-14 — feat: enterprise email reporting overhaul: failure clusters, health score, run-history ledger (f224a5c)
- 2026-07-08 — docs: README ground-up rewrite (9ac4e17)
- 2026-07-06 — test: Deals share/reassign/clone/add-contact/delete UI + RBAC (c9a4537)
- 2026-07-04 — fix: flaky RBAC tests, Jenkins timeout formula (b89cdd0)
- 2026-07-01 — fix: Jenkinsfile prod runs @prodSafe, main full suite (cbecda1)

## 2026-06

- Companies and Contacts modules full CRUD, share/reassign/clone, productivity panel (16a6c6d, 29b02ca)
- Quotations module and its serial mode for two-worker CI (b389e35, 0271e76)
- Meetings module; global misc-error capture; modern email template with module breakdown (6dbe2a5, d5de945, 798422b)
- Selective test runner for feature branches; Jenkinsfile.sandbox (bea17b5, c5c06f7)
- CI stabilization on GitHub Actions: two workers, staggered restricted sessions, API-first list readiness (26c4acd, ab5ad5a)
- Notify step added to all workflows and Jenkinsfile (a7dff5e, 533e79f)

## 2026-05

- 2026-05-30 — Deals module (d4b5d6d); Companies module (73fe067)
- 2026-05-23 — Per-branch GitHub Actions workflows, Jenkinsfile.qa, qa/prod pipelines, auto-promotion (28f49bc, 71429de, 5c0094f)
- 2026-05-22 — Per-environment credentials and isolated storage states (d8ff4ba)
- 2026-05-21 — Jenkins pipeline, multi-env support, AuthManager fixes (7463fe2, 58069bf)
- 2026-05-20 — Initial setup, login, Leads CRUD and RBAC (1f30285, 8795fe0, ff899de)
