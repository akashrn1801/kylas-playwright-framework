# Known Issues — Active

> **Purpose:** The only list of OPEN problems in this repo — one short entry each. Resolved history lives in [known-issues/](./known-issues/README.md); real Kylas product bugs are tracked outside this repo.
> **Read when:** triaging a failure ("is this already known?"), picking up follow-up work, or closing/adding an issue at the end of a task (Definition of Done step 3).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-28 @ 0f87be3

**Rules for this file.** Open items only. Entry ≤ 8 lines: Status · Since · What · Evidence / next check · History link. IDs (`KI-nn`) are stable — never renumber. When an item is closed, move a ≤15-line incident summary to its topic file (template in [CONTRIBUTING_TESTS.md](./CONTRIBUTING_TESTS.md#size-policy)) and delete the entry here. Status words: **open** (confirmed, not fixed) · **inconclusive** (investigated, no root cause; do not re-close without new evidence) · **unverified** (carried over, not re-checked against the repo on the date above).

---

## A. Failing / flaky tests

### KI-01 — FFPS5: stable across re-testing, root cause unconfirmed
- **Status:** inconclusive (currently stable; original symptom never reproduced) · **Since:** 2026-09-23 (re-investigated 2026-09-28)
- **What:** `FFPS5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a product` (`tests/ui/formFields/productsAndServicesFieldLimits.spec.ts`). Originally read as a backend dropping the custom-field value; a headed-mode watch showed a different (fill/locator) symptom. Six independent conditions reproduced neither shape. Write-up: [form-fields.md](./known-issues/form-fields.md) (conditions list).
- **Next check:** if it fails again, capture the failing run's `trace.zip` or a screen recording *at that moment* — the one evidence type never obtained; do not re-argue from theory. Existing bounded retries in `productsAndServicesFieldLimits.spec.ts` and `ProductsAndServicesPage.assertCustomFieldValueOnEditPage()` stay as labeled hardening (rule 10).

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
- **What:** six one-off flakes (Deals shared-deal Call-log permission; Quotations RBAC ~8-min `openCreateForm()` timeout; call-logs company live-search "no options"; meetings reschedule 3× HTTP 500; tasks RBAC edit-modal hang; meeting-creation 500 / Deals RBAC Task-permission timeout). Each was one occurrence or unreproducible locally; rule 21 forbids dismissing load-dependent flakes. Full list and detail: [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md), [locators-and-timing.md](./known-issues/locators-and-timing.md). Search by test title, not line number.

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
- **What:** uncaught `TypeError` in `getCurrencyId` blanks the page after the layout GET (200). Unchecked: QA run 40477938102 `quotations.spec.ts:640`/`:620`. `BasePage.fill()` has no timeout.
- **Detail:** [rate-limits-and-error-pages.md](./known-issues/rate-limits-and-error-pages.md).

---

## B. Infrastructure and CI

### KI-34 — Field-config reset job and concurrency groups: never run, GitHub behaviours unconfirmed
- **Status:** unverified (implemented 2026-10-06; only static checks done) · **Since:** 2026-10-06
- **What:** [ADR 0009](./adr/0009-field-config-reset-and-account-lock.md). 11 unconfirmed items (full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md)): the tool ran against a real app only as one local dry-run (2026-10-23), never as a real reset; timeouts are guesses; GitHub behaviour of `continue-on-error`, approval-waiting runs, `always()` after cancel and a displaced pending `stage` push is unobserved.
- **Next check:** user dry-runs `npm run reset:field-config -- --env qa|staging|prod --dry-run` while no CI run is active on that account; first real CI run of each workflow after merge. Former KI-10 is closed in [sharding-and-locks.md](./known-issues/sharding-and-locks.md) only as "guard added", not as proven.

### KI-36 — Sandbox formFields split never exercised in a real CI run
- **Status:** unverified (implemented 2026-10-07) · **Since:** 2026-10-07
- **What:** checked offline only (real `decide` script on synthetic file lists, actionlint, `--list`). Unobserved on GitHub: skipped-`run-tests` matrix behaviour; the 180-min scoped timeout is unmeasured. Full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md).
- **Next check:** first sandbox push touching only formFields files; confirm 6 matrix jobs run, `playwright-selective` shows skipped, and the email lists 417 tests.

### KI-38 — Sandbox formFields entity selection: never exercised on GitHub
- **Status:** unverified (implemented 2026-10-08) · **Since:** 2026-10-08
- **What:** sandbox runs only the formFields entities `detect-tests.sh` selects (run 37753304635: a `ProductsAndServicesPage.ts`-only change moved all 417 tests). Offline only. Notable: the dependency rule is direct-import only (a transitively reached file selects nothing). Full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md). Revert: 2026-10-08 amendment in [ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md).
- **Next check:** first sandbox push touching one entity's files: expect one `playwright-formFields (<entity>)` job, `playwright-selective` per the scoped files, and a complete-run email.

### KI-37 — Install-step bound and incomplete-run handling: unproven by a real run's logs
- **Status:** partly confirmed (implemented 2026-10-08; mirror rewrite and a healthy install read in real CI 2026-10-28) · **Since:** 2026-10-07
- **What:** [ADR 0010](./adr/0010-incomplete-run-handling-and-bounded-install.md). Confirmed in sandbox run 40454948545 (shard 1, job 122026090281): the azure apt mirror rewrite and a first-attempt install in 28 s (limit 300 s). Still stub-tested only, because they did not trigger: the retry, the leftover-`apt-get` kill and the 570 s budget (apt-stall cause in run 37669596623 unknown); `syncHistory` only via pure functions. Full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md).
- **Next check:** the first real install failure or retry: it shows the `Playwright browser install failed` annotation and exercises the retry/kill/budget paths.

### KI-11 — The formFields shard matrix does not scale with test growth
- **Status:** open · **Since:** 2026-09-29
- **What:** `run-formfields-tests` is a fixed one-job-per-entity matrix (deliberate, [ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md)), so growth can only lengthen an entity's own job. The slowest entity (Lead) measured about 110 min against a 180-minute `timeout-minutes` (~1.6× margin) when the matrix still ran alongside the core shards.
- **Next check:** re-measure that entity's real shard duration before merging any large formFields addition; if near the ceiling, split that entity's UI and RBAC files into two sequenced jobs (the proven constraint is "never split a pair across *concurrent* machines").

### KI-12 — Sequenced formFields-after-core is not yet proven by a real run
- **Status:** unverified · **Since:** 2026-10-06 (commit `1bd03cc`)
- **What:** `needs: run-tests` + `if: ${{ !cancelled() }}` on `run-formfields-tests`, the conditional product-fixture creation (`src/auth/productFixtureNeed.ts`) and the load-signal table are checked by actionlint and synthetic runs only. `main.yml`'s `run-tests`, `run-formfields-tests`, `reset-field-config` and `merge-and-report` jobs carry `environment: production` (`plan` does not); if that environment has required reviewers a second approval prompt appears (not knowable from the repo). Wall-clock roughly doubles for the sharded workflows by design ([ADR 0007](./adr/0007-sequence-formfields-after-core.md)).
- **Next check:** first real run — confirm all three job-graph cases, the "Load Signals by Job" table, and (on `main`) the approval behavior.

### KI-13 — `globalSetup` product-reference-data HTTP 400 on staging
- **Status:** unverified · **Since:** 2026-09-04
- **What:** `GET /products/layout?view=create` once returned `HTTP 400` before any test started on staging (QA unaffected; reproduced 2/2 that day; fixture cache timestamps argued against a permanently broken endpoint). `withTransientRetry()` now retries only 429/5xx, so a 400 would still fail fast. Most likely staging backend contention after staging absorbed two heavy pipelines (2026-07-28); never root-caused.
- **Next check:** needs backend/infra access; replicate `globalSetup.ts`'s exact two-logins-then-API sequence under concurrent load. History: [rate-limits-and-error-pages.md](./known-issues/rate-limits-and-error-pages.md).

### KI-14 — Jenkins changes not confirmed by a real execution
- **Status:** unverified · **Since:** 2026-09-04 / 2026-09-09
- **What:** the per-stage timeouts in the base `Jenkinsfile`, its branch-to-test-selection fix and the `github-credentials` binding for `history:sync`/`estimate-duration` were verified structurally (lint + read-through) only. Sharding: [ADR 0012](./adr/0012-jenkins-sharded-runs-locks-and-guard.md), runtime [KI-47](#ki-47--sharded-jenkins-runtime-unproven-until-the-qa-test-runs). Main builds #5-#14: only #8 (2026-09-10) ran tests; the rest were aborted at or before the approval gate.
- **Next check:** watch the first real run per branch: selection, stage timeouts enforcing, a new `runSource: "jenkins"` record in `history/<env>.jsonl` on `ci/reporting-history`. History: [ci-pipelines.md](./known-issues/ci-pipelines.md).

### KI-45 — Host suspend stretches Jenkins timeouts (main #13 sat 3,773 min on a 24 h limit)
- **Status:** fix applied 2026-10-28 (sleep masked by the maintainer; not re-checked by Claude); stamps unconfirmed · **Since:** 2026-10-20
- **What:** #13 parked at the approval gate 2026-10-20 17:56Z; its 24 h timeout fired 2026-10-23 08:49Z; the journal shows 38.8 h of suspend in that window (#10, #12 fit too). Likely mechanism, unverified: JVM timers stop during suspend. Fix: sleep disabled 2026-10-28 ([RUNBOOK](./RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 1; keep the laptop plugged in); the approval step logs the real wall-clock age.
- **Next check:** the wall-clock stamps on the next real approval (age matches the Jenkins timeout). History: [ci-pipelines.md](./known-issues/ci-pipelines.md).

### KI-46 — GitHub cannot see Jenkins runs
- **Status:** open (procedural rule only) · **Since:** 2026-10-28
- **What:** the Jenkins account locks and collision guard stop a Jenkins run overlapping Jenkins or GitHub runs, but the `kylas-*` concurrency groups only see GitHub runs ([ADR 0009](./adr/0009-field-config-reset-and-account-lock.md)) and workflow edits are out of scope. Dispatching `main.yml`/`prod.yml` (or pushing `qa`/`stage`/`sandbox`) while a Jenkins run holds the account is not prevented, and the guard has a check-then-run window.
- **Next check:** check Jenkins for a running build on that environment before any manual dispatch ([RUNBOOK](./RUNBOOK.md#jenkins-sharded-runs-setup-and-operation)). A real fix needs a workflow-side check: a maintainer decision.

### KI-47 — Sharded Jenkins runtime unproven until the QA test runs
- **Status:** unverified · **Since:** 2026-10-28
- **What:** [ADR 0012](./adr/0012-jenkins-sharded-runs-locks-and-guard.md) was checked offline only (Groovy syntax, stubs, `tsc`; the maintainer's linter run on 2026-10-28 validated all five Jenkinsfiles). Never run: the lock steps (in every Jenkins test run, sharded or not), `parallel`/`node`/`ws`/`stash`, script approvals, the `finally` reset after an abort, sharded merge/history/notify, the scoped-run banner, every speedup/memory estimate. To confirm on the first guard run: the PAT believed to be in Jenkins ("Jenkins setup", classic, repo scope, no expiry; covers Actions read) is the stored one.
- **Next check:** [RUNBOOK](./RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 6, in order: (1) one ordinary manual build of the branch on QA, `SHARDED_TEST` off: `Taking lock 'kylas-qa-account'`, `Lock ... held`, the guard's `Clear` line, then the normal Run Tests stage (no scope option on that path: full suite, est. 8.6-11 h; abort once Run Tests starts); (2) a core-only QA trial (`SHARDED_TEST`, `FF_ENTITIES=none`); (3) a full sharded QA run compared with GitHub's `qa.yml` results.

### KI-15 — Real GitHub Jobs API response shape for the "CI Job Stats" card
- **Status:** unverified · **Since:** 2026-09-29
- **What:** `src/notifications/JobStats.ts` assumes `started_at` / `completed_at` / `name` per job from GitHub's documented schema; never seen against a real run's response. The email section also depends on the formFields job-name template.
- **Next check:** first real sharded run — section renders, total is sane, only the notify job is `incomplete`.

### KI-16 — JWT lifetime is not a stable constant; `ensureFreshSession()` margin is unsized
- **Status:** open · **Since:** 2026-08-10 (re-opened 2026-08-11)
- **What:** measured token lifetimes differ between investigations (~10.4 h documented, ~20 min once, ~101 min later, 4/4 reproducible). `AuthManager.ensureFreshSession()` refreshes at <10 min remaining, sized against the wrong assumption. A ~40-minute-old storage state landing on sign-in is likewise unexplained.
- **Next check:** dedicated investigation into *why* the lifetime varies before changing shared `AuthManager` code. History: [session-expiry-and-auth.md](./known-issues/session-expiry-and-auth.md).

### KI-17 — Cross-worker re-login collision: hypothesis, never confirmed
- **Status:** inconclusive · **Since:** 2026-08-07
- **What:** two occurrences (a Lead create-POST wait; a Quotations HTTP 500 after three rapid re-auth cycles) were correlated with another worker forcing a fresh login for the same role. `AuthManager` *does* serialize file writes (`withFileLock` + atomic rename), so file corruption is excluded; a same-role session-invalidation collision is not. Almost every pipeline runs `--workers=2`, so the old "always run `--workers=1`" requirement is not observed in CI.
- **Next check:** per-worker credential isolation or a confirmed trace of the invalidation; until then treat a lone `--workers>1` ID-capture timeout near a `forcing a fresh login` log line as suspect.

### KI-18 — Unmeasured reporting pipeline gaps
- **Status:** open · **Since:** 2026-09-30 / 2026-10-06
- **What:** (a) `syncHistory.ts`, `notify.ts`, `src/reporters/MiscErrorReporter.ts` still use `console.*` instead of `logger` (verified: 11 / 1 / 28 call sites); (b) misc errors captured by `ErrorCollector` inside `globalSetup` are written to a pid-named worker file (`WORKER_ID` falls back to `process.pid`) that `MiscErrorReporter.onBegin()` deletes (pre-existing); recovery events are not affected, they go to `recovery-events-main.json` (`MAIN_PROCESS_EVENTS_PATH`), which `MiscErrorReporter` merges; (c) the `/fields` list `ERR_ABORTED` noise is allowlisted (2026-10-09, see CHANGELOG); any other `ERR_ABORTED` family still needs the zero-correlation evidence bar first.
- **History:** [reporting-and-notifications.md](./known-issues/reporting-and-notifications.md).

---

## C. Code-quality debts (verified in the repo on the date above)

### KI-19 — The escalated sandbox run's formFields track ignores `--grep @regression`
- **Status:** open · **Since:** 2026-10-06
- **What:** Sandbox Build #186 reported 916 tests, not the 898 `@regression` count: core shards apply `--grep @regression`, each formFields shard runs both its spec files with no grep (417 vs 399 tagged, so 18 untagged tests run). 932 = 515 + 417; 916 = 499 + 417. `qa.yml`/`stage.yml`/`main.yml` use the same formFields command. Not a lost or double-counted test. Also: a manual re-run of failed jobs re-runs `merge-and-report` (Build #186: 7 attempts, 7 emails) and the "Verify all shards reported" check counts zips, so a stale blob still satisfies it. Per-shard arithmetic: [sharding-and-locks.md](./known-issues/sharding-and-locks.md).
- **Next check:** decide whether formFields should honor the tag filter; the one skipped test is the known `call-logs.spec.ts:568` `test.skip`.

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

### KI-27 — Dev-branch lint-fix drift (carried over; likely closed)
- **Status:** unverified · **What:** `CLAUDE.md` once recorded 3 lint-suppression hunks missing on `dev` but present on qa/stage/prod/main. Local remote-tracking refs (last fetched 2026-09-10) show **no** diff on those files between `origin/dev` and any of the four, and the files have since changed substantially. Re-check after a `git fetch` (rule 25); delete this entry if still clean.

### KI-43 — Staging search index not reflecting new records: sandbox 38582148420 (64 failed) and 38690038228 (55 failed)
- **Status:** open (staging environment problem, CONFIRMED by a live probe 2026-10-15; no test-code fix is possible; later run passed, recovery unconfirmed) · **Since:** 2026-10-14
- **What / evidence:** just-created deals/contacts/leads/companies never appeared in search lookups (react-select empty, `retryFind*` false, meeting 422 `01503001`, call-log 403); a created deal stayed absent from `GET /v1/search/deal/lookup` for 188 s (90 of 90 polls empty) on a live probe; green runs passed the same code. Cause on the Kylas side not established (HYPOTHESIS: indexing backlog).
- **Ask the Kylas dev team:** is the staging search indexer / event consumer stalled or backlogged since about 2026-10-14, and was there a staging deploy or reindex around 10-14 Oct?
- **Next check:** sandbox run 40279659288 (2026-10-26, `a9f5372`, staging) passed all 14 jobs, so the signatures did not appear. From the code its scope was the full `@regression` run (five selective shards exist only when `detect-tests.sh` returns `--grep @regression`; all 6 formFields jobs ran; that tag covers the Deals, Companies, Leads, Quotations, Call Logs, Meetings RBAC and Reports specs; test steps have no `continue-on-error`). That is evidence the index recovered, NOT proof: no probe was repeated and the Kylas team did not confirm. Repeat the lookup probe or ask the Kylas team before closing; if the signatures return with a healthy index, reopen as a framework issue.
- **History link:** full signatures, traces, probe and not-verified list: [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md) (entry "OPEN (KI-43)").

### KI-35 — React-select menu left open blocks the next click (QA only): fixed locally, not yet seen in CI; `b0c6b38` part 2 not ported
- **Status:** open for CI confirmation · **Since:** 2026-10-07
- **What:** `BasePage.ensureReactSelectMenuClosed()` ([ADR 0011](./adr/0011-react-select-menu-closed-contract.md)) is used by BasePage's helpers and 9 modules' pick sites (not `LeadsPage.ts`); Units passed in CI run 37778400646, DB27 and both Call Logs tests passed locally on QA (2026-10-08). Symptom, evidence and live results: [locators-and-timing.md](./known-issues/locators-and-timing.md). NOT verified: why QA differs from stage; which path (natural close vs Escape) closed the menu in DB27/Call Logs.
- **Part 2 (open):** `saveEditedProduct()` does no `blur()` + `networkidle` before Save; `b0c6b38` claims a wiped `customFieldValues` on the PUT. Current evidence does not involve it. See [products-and-services.md](./known-issues/products-and-services.md).

### KI-44 — `CompaniesPage.captureCompanyIdFromResponse()` matches a bare `includes('companies')` (rule 15)
- **Status:** latent, NOT reproduced (no failing run or trace is attributed to it) · **Since:** code comment dated 2026-07-16; recorded here 2026-10-27
- **What:** the predicate is `res.url().includes('companies') && !res.url().includes('/reports/') && POST && (200 || 201)` (`src/modules/companies/CompaniesPage.ts:424-445`), so it has no `/v1/<module>/` requirement, which standing rule 15 asks for; Deals, Leads, Contacts, Tasks and Meetings have it. The code comment says it was deliberate: "This method's bare `.includes('companies')` is even less specific (no version-prefix requirement at all) and is the same shape of bug, just not yet observed failing here — excluding `/reports/` only, not adding a `/v1/` requirement, since (unlike Deals) the exact real company create/clone endpoint hasn't been directly confirmed in this run's own logs; narrower and lower-risk than guessing the full path."
- **Risk:** the first 200/201 POST whose URL contains the substring `companies` anywhere (path or query string) outside `/reports/`, during the clone save window, is taken as the clone POST and its `id` (or `data.id`) is returned. Its only caller is `cloneCompany()` (`:1164`); a null id throws "Cloned company ID not captured after save" (fails loudly), but a wrong id would be returned as the clone's id and the next step opens that record by ID. The Deals analogue was confirmed live to match an unrelated `/v4/reports/deals` analytics POST (that one `/reports/` exclusion covers). From the code, no other matching POST is known: `GET /v1/companies/lookup`, the `has-duplicates` GETs and `/v1/search/company` (singular) do not match a POST predicate or the substring. The sibling `captureCompanyCreateOutcome()` (`:776-784`) already uses `/\/v1\/companies\/?(?:\?|$)/`.
- **Next check:** fix on a separate branch (not changed here): reuse that `/v1/companies/` regex; confirm the real clone POST path from a trace first (rule 10), and re-run Companies clone 3-5x (rule 8).

### KI-40 / KI-41 / KI-42 and the Call Logs re-open note: watch items in [reports-module.md](./known-issues/reports-module.md), [products-and-services.md](./known-issues/products-and-services.md) and [locators-and-timing.md](./known-issues/locators-and-timing.md).

---

## D. Accepted behavior / decisions needed

- **KI-30 — `deriveModuleFromFile()` display names** (`Call-logs`, `ProductsAndServices`, `login.spec.ts` counted under Dashboard) are deliberately unfixed: renaming would break trend continuity in `ci/reporting-history`. Read the code comment above the final name computation before touching it.
- **KI-31 — Lead `fillEditForm()` does not update Timezone/Country/Professional fields** (Contact's updates Timezone and Professional only). Create-only was the lower-risk choice; extending it is a maintainer decision.
- **KI-32 — Company Website validation has no negative test** (the custom `UrlField` does).
- **KI-33 — Quotation report entity type is deployed to QA only** (as of 2026-09-09; **UNVERIFIED**: `ReportsPage.ts` (~line 103) says Quotation reports were confirmed deployed to stage/prod 2026-09-03, its skip message (~line 929) says QA-only as of 2026-09-09, and nothing in the repo settles which holds today); the two tests that need it self-skip via a live presence check, so nothing to fix — re-verify the claim per environment ([ci-pipelines.md](./known-issues/ci-pipelines.md), [reports-module.md](./known-issues/reports-module.md)).
