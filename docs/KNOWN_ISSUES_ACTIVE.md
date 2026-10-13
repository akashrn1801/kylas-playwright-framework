# Known Issues — Active

> **Purpose:** The only list of OPEN problems in this repo — one short entry each. Resolved history lives in [known-issues/](./known-issues/README.md); real Kylas product bugs live in [APPLICATION_BUGS.md](../APPLICATION_BUGS.md).
> **Read when:** triaging a failure ("is this already known?"), picking up follow-up work, or closing/adding an issue at the end of a task (Definition of Done step 3).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-09 @ cbfdbd1

**Rules for this file.** Open items only. Entry ≤ 8 lines: Status · Since · What · Evidence / next check · History link. IDs (`KI-nn`) are stable — never renumber. When an item is closed, move a ≤15-line incident summary to its topic file (template in [CONTRIBUTING_TESTS.md](./CONTRIBUTING_TESTS.md#size-policy)) and delete the entry here. Status words: **open** (confirmed, not fixed) · **inconclusive** (investigated, no root cause; do not re-close without new evidence) · **unverified** (carried over, not re-checked against the repo on the date above).

---

## A. Failing / flaky tests

### KI-01 — FFPS5: stable across re-testing, root cause unconfirmed
- **Status:** inconclusive (currently stable; original symptom never reproduced) · **Since:** 2026-09-23 (re-investigated 2026-09-28)
- **What:** `FFPS5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a product` (`tests/ui/formFields/productsAndServicesFieldLimits.spec.ts`). Originally read as a backend dropping the custom-field value; a headed-mode watch showed a different (fill/locator) symptom. Six independent conditions reproduced neither shape. Write-up: [APPLICATION_BUGS.md](../APPLICATION_BUGS.md) entry 6 and [form-fields.md](./known-issues/form-fields.md) (conditions list).
- **Next check:** if it fails again, capture the failing run's `trace.zip` or a screen recording *at that moment* — the one evidence type never obtained; do not re-argue from theory. Existing bounded retries in `productsAndServicesFieldLimits.spec.ts` and `ProductsAndServicesPage.assertCustomFieldValueOnEditPage()` stay as labeled hardening (rule 10).

### KI-02 — FFRPS8 is a load-dependent flake with no prior record
- **Status:** inconclusive · **Since:** 2026-10-06 CI results (reported by the repo owner)
- **What:** `FFRPS8 restricted user should confirm typing too few characters in the Text field is rejected when creating a product` (`tests/rbac/formFields/productsAndServicesFieldLimits.rbac.spec.ts`) — fails intermittently under concurrent CI load; nothing in git history or the old issue log mentions it.
- **Next check:** per rule 21 a clean isolated run proves nothing; look for the same symptom on sibling tests sharing the Products & Services lock ([sharding-and-locks.md](./known-issues/sharding-and-locks.md)) before treating it as test-specific. Possibly related to KI-01 (same entity, same Text field) — unconfirmed.

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

---

## B. Infrastructure and CI

### KI-34 — Field-config reset job and concurrency groups: never run, GitHub behaviours unconfirmed
- **Status:** unverified (implemented 2026-10-06; only static checks done) · **Since:** 2026-10-06
- **What:** [ADR 0009](./adr/0009-field-config-reset-and-account-lock.md). 11 unconfirmed items (full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md)): the tool never ran against a real app; timeouts are guesses; GitHub behaviour of `continue-on-error`, approval-waiting runs, `always()` after cancel and a displaced pending `stage` push is unobserved.
- **Next check:** user dry-runs `npm run reset:field-config -- --env qa|staging|prod --dry-run` while no CI run is active on that account; first real CI run of each workflow after merge. Former KI-10 is closed in [sharding-and-locks.md](./known-issues/sharding-and-locks.md) only as "guard added", not as proven.

### KI-36 — Sandbox formFields split never exercised in a real CI run
- **Status:** unverified (implemented 2026-10-07) · **Since:** 2026-10-07
- **What:** checked offline only (real `decide` script on synthetic file lists, actionlint, `--list`). Unobserved on GitHub: skipped-`run-tests` matrix behaviour; the 180-min scoped timeout is unmeasured. Full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md).
- **Next check:** first sandbox push touching only formFields files; confirm 6 matrix jobs run, `playwright-selective` shows skipped, and the email lists 417 tests.

### KI-38 — Sandbox formFields entity selection: never exercised on GitHub
- **Status:** unverified (implemented 2026-10-08) · **Since:** 2026-10-08
- **What:** sandbox runs only the formFields entities `detect-tests.sh` selects (run 37753304635: a `ProductsAndServicesPage.ts`-only change moved all 417 tests). Offline only. Notable: the dependency rule is direct-import only (a transitively reached file selects nothing). Full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md). Revert: 2026-10-08 amendment in [ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md).
- **Next check:** first sandbox push touching one entity's files: expect one `playwright-formFields (<entity>)` job, `playwright-selective` per the scoped files, and a complete-run email.

### KI-37 — Install-step bound and incomplete-run handling: unproven; build #189 ledger record still unmarked
- **Status:** unverified (implemented 2026-10-08) · **Since:** 2026-10-07
- **What:** [ADR 0010](./adr/0010-incomplete-run-handling-and-bounded-install.md). Install bound, leftover-`apt-get` kill and 570 s budget were tested only with stubs (apt-stall cause in run 37669596623 unknown); `syncHistory` only via pure functions. Full list: [sharding-and-locks.md](./known-issues/sharding-and-locks.md). **Pending, user action:** the `history/staging.jsonl` record for sandbox build #189 (on `ci/reporting-history`) holds 277 tests as a normal run — add `"incomplete":{"expected":6,"reported":4}`, delete the line, or re-run failed jobs of run 37669596623 (blobs expire by 2026-10-10).
- **Next check:** user marks or removes the #189 line; first real sandbox/qa run shows the new steps; first real install failure shows the `Playwright browser install failed` annotation.

### KI-11 — The formFields shard matrix does not scale with test growth
- **Status:** open · **Since:** 2026-09-29
- **What:** `run-formfields-tests` is a fixed one-job-per-entity matrix (deliberate, [ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md)), so growth can only lengthen an entity's own job. The slowest entity (Lead) measured about 110 min against a 180-minute `timeout-minutes` (~1.6× margin) when the matrix still ran alongside the core shards.
- **Next check:** re-measure that entity's real shard duration before merging any large formFields addition; if near the ceiling, split that entity's UI and RBAC files into two sequenced jobs (the proven constraint is "never split a pair across *concurrent* machines").

### KI-12 — Sequenced formFields-after-core is not yet proven by a real run
- **Status:** unverified · **Since:** 2026-10-06 (commit `1bd03cc`)
- **What:** `needs: run-tests` + `if: ${{ !cancelled() }}` on `run-formfields-tests`, the conditional product-fixture creation (`src/auth/productFixtureNeed.ts`) and the load-signal table are checked by actionlint and synthetic runs only. `main.yml`'s jobs all carry `environment: production`; if that environment has required reviewers a second approval prompt appears (not knowable from the repo). Wall-clock roughly doubles for the sharded workflows by design ([ADR 0007](./adr/0007-sequence-formfields-after-core.md)).
- **Next check:** first real run — confirm all three job-graph cases, the "Load Signals by Job" table, and (on `main`) the approval behavior.

### KI-13 — `globalSetup` product-reference-data HTTP 400 on staging
- **Status:** unverified · **Since:** 2026-09-04
- **What:** `GET /products/layout?view=create` once returned `HTTP 400` before any test started on staging (QA unaffected; reproduced 2/2 that day; fixture cache timestamps argued against a permanently broken endpoint). `withTransientRetry()` now retries only 429/5xx, so a 400 would still fail fast. Most likely staging backend contention after staging absorbed two heavy pipelines (2026-07-28); never root-caused.
- **Next check:** needs backend/infra access; replicate `globalSetup.ts`'s exact two-logins-then-API sequence under concurrent load. History: [session-expiry-and-auth.md](./known-issues/session-expiry-and-auth.md).

### KI-14 — Jenkins changes not confirmed by a real execution
- **Status:** unverified · **Since:** 2026-09-04 / 2026-09-09
- **What:** the per-stage timeouts in the base `Jenkinsfile`, its branch-to-test-selection fix, the `github-credentials` binding for `history:sync`/`estimate-duration`, and whether to shard Jenkins at all were verified structurally (lint + read-through) only.
- **Next check:** watch the first real run per branch — correct `--grep` per branch, each stage timeout enforcing, a new `runSource: "jenkins"` record in `history/<env>.jsonl` on `ci/reporting-history`. A failure here is a hotfix on `dev`, not a "known issue". History: [ci-pipelines.md](./known-issues/ci-pipelines.md).

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
- **What:** (a) `syncHistory.ts`, `notify.ts`, `src/reporters/MiscErrorReporter.ts` still use `console.*` instead of `logger` (verified: 11 / 1 / 28 call sites); (b) `ErrorCollector` events captured inside `globalSetup` are written to a pid-named worker file that `MiscErrorReporter.onBegin()` deletes (pre-existing); (c) the `/fields` list `ERR_ABORTED` noise is allowlisted (2026-10-09, see CHANGELOG); any other `ERR_ABORTED` family still needs the zero-correlation evidence bar first.
- **History:** [reporting-and-notifications.md](./known-issues/reporting-and-notifications.md).

---

## C. Code-quality debts (verified in the repo on the date above)

### KI-19 — The escalated sandbox run's formFields track ignores `--grep @regression`
- **Status:** open · **Since:** 2026-10-06
- **What:** Sandbox Build #186 reported 916 tests, not the 898 `@regression` count: core shards apply `--grep @regression`, each formFields shard runs both its spec files with no grep (417 vs 399 tagged, so 18 untagged tests run). 932 = 515 + 417; 916 = 499 + 417. `qa.yml`/`stage.yml`/`main.yml` use the same formFields command. Not a lost or double-counted test. Also: a manual re-run of failed jobs re-runs `merge-and-report` (Build #186: 7 attempts, 7 emails) and the "Verify all shards reported" check counts zips, so a stale blob still satisfies it. Per-shard arithmetic: [sharding-and-locks.md](./known-issues/sharding-and-locks.md).
- **Next check:** decide whether formFields should honor the tag filter; the one skipped test is the known `call-logs.spec.ts:568` `test.skip`.

### KI-20 — `waitForTimeout(500)` left in `openUserShareTypeSearch()` catch backoff
- **Status:** open (verified: `CompaniesPage.ts` and `LeadsPage.ts`, after the `Escape` keypress) · **Since:** 2026-08-09
- **Fix when touched:** replace with the condition-based wait on `.is-invalid__menu` hidden that `QuotationsPage.fillOwner()` already uses. (The pre-commit hook only blocks *newly added* lines, so old ones persist.)

### KI-21 — Unbounded random-option clicks remain in Leads and Quotations
- **Status:** unverified (carried over; not re-read this session) · **Since:** 2026-07
- **What:** `LeadsPage.ts` close-reason radio and convert-to-deal product selection, and several `QuotationsPage.ts` random-option pickers use a raw unbounded `.click()`. `QuotationsPage.fillOwner()` was fixed. Pattern to apply: `BasePage.selectRandomOptionWithRetry()` ([PATTERNS.md](./PATTERNS.md)).

### KI-22 — `ContactsPage.saveEditedContact()` has no network confirmation
- **Status:** open (verified: clicks Save, asserts no form errors, waits for the modal to hide) · **Since:** 2026-08-25
- **What:** the same gap `saveEditedCompany()` / Leads had; fix is the ~15-line "await the PUT response" pattern already used there. Two real call sites exercise it.

### KI-23 — `assertQuotationInList()` can false-positive on the never-cleaned QA dataset
- **Status:** open (verified: delegates to `retryFindInList()` and checks the search term appears in a row) · **Since:** 2026-08-17
- **What:** `/v1/quotations/search` is fuzzy OR-word matching capped at 10 results and the target need not be among them. Affects every test using this assertion.

### KI-24 — Four private `selectDateInPicker()` copies; the month-jump control is unused
- **Status:** open (verified: `QuotationsPage`, `CallLogsPage`, `DealsPage`, `ReportsPage`) · **Since:** 2026-08-10
- **What:** native date pickers are independently maintained, unlike the shared custom-field version; a `.custom-month-year-dropdown` direct-jump control (~41% faster for distant months) is adopted nowhere.

### KI-25 — Stale "always runs `--workers=1`" comments in Reports specs
- **Status:** open, doc-only (verified at `tests/ui/reports/reports.spec.ts` ~L127/L152 and `tests/rbac/reports.rbac.spec.ts` ~L114) · **Since:** 2026-09-09
- **What:** the comments justify plain `test.describe()` (not `.serial`) by single-worker, declaration-order execution; sharding makes both false. The blocks are still safe because the assertion is `toBeGreaterThanOrEqual`. Correct the comment when either file is next edited.

### KI-26 — Repo hygiene
- **Status:** open · **What:** no committed `.env.example` (gitignored); legacy `.eslintrc.json` never read by `npm run lint`; prettier drift in `QuotationsPage.ts`, `LeadsPage.ts`, `BasePage.ts`; inert `agent_delegation` / `investigation_log` block in `.claude/settings.json`. Detail: [ci-pipelines.md](./known-issues/ci-pipelines.md). <!-- ref-ok -->

### KI-27 — Dev-branch lint-fix drift (carried over; likely closed)
- **Status:** unverified · **What:** `CLAUDE.md` once recorded 3 lint-suppression hunks missing on `dev` but present on qa/stage/prod/main. Local remote-tracking refs (last fetched 2026-09-10) show **no** diff on those files between `origin/dev` and any of the four, and the files have since changed substantially. Re-check after a `git fetch` (rule 25); delete this entry if still clean.

### KI-35 — React-select menu left open blocks the next click (QA only): fixed locally, not yet seen in CI; `b0c6b38` part 2 not ported
- **Status:** open for CI confirmation · **Since:** 2026-10-07
- **What:** `BasePage.ensureReactSelectMenuClosed()` ([ADR 0011](./adr/0011-react-select-menu-closed-contract.md)) is used by every site; Units passed in CI run 37778400646, DB27 and both Call Logs tests passed locally on QA (2026-10-08). Symptom, evidence and live results: [locators-and-timing.md](./known-issues/locators-and-timing.md). NOT verified: why QA differs from stage; which path (natural close vs Escape) closed the menu in DB27/Call Logs.
- **Part 2 (open):** `saveEditedProduct()` does no `blur()` + `networkidle` before Save; `b0c6b38` claims a wiped `customFieldValues` on the PUT. Current evidence does not involve it. See [products-and-services.md](./known-issues/products-and-services.md).

### KI-40 / KI-41 / KI-42 and the Call Logs re-open note — moved to watch items
Low priority (qa 37897275025 and stage 37897319452 showed no failure; main 37919166296 had not finished). Entries: KI-40 → [reports-module.md](./known-issues/reports-module.md); KI-41, KI-42 → [products-and-services.md](./known-issues/products-and-services.md); Call Logs `mousedown` → [locators-and-timing.md](./known-issues/locators-and-timing.md).

---

## D. Accepted behavior / decisions needed

- **KI-30 — `deriveModuleFromFile()` display names** (`Call-logs`, `ProductsAndServices`, `login.spec.ts` counted under Dashboard) are deliberately unfixed: renaming would break trend continuity in `ci/reporting-history`. Read the code comment above the final name computation before touching it.
- **KI-31 — Lead `fillEditForm()` does not update Timezone/Country/Professional fields** (Contact's does). Create-only was the lower-risk choice; extending it is a maintainer decision.
- **KI-32 — Company Website validation has no negative test** (the custom `UrlField` does).
- **KI-33 — Quotation report entity type is deployed to QA only** (as of 2026-09-09); the two tests that need it self-skip via a live presence check, so nothing to fix — re-verify the claim when stage/prod change ([ci-pipelines.md](./known-issues/ci-pipelines.md)).
