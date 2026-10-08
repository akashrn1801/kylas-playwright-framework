# Known Issues — Active

> **Purpose:** The only list of OPEN problems in this repo — one short entry each. Resolved history lives in [known-issues/](./known-issues/README.md); real Kylas product bugs live in [APPLICATION_BUGS.md](../APPLICATION_BUGS.md).
> **Read when:** triaging a failure ("is this already known?"), picking up follow-up work, or closing/adding an issue at the end of a task (Definition of Done step 3).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-08 @ 2576128

**Rules for this file.** Open items only. Entry ≤ 8 lines: Status · Since · What · Evidence / next check · History link. IDs (`KI-nn`) are stable — never renumber. When an item is closed, move a ≤15-line incident summary to its topic file (template in [CONTRIBUTING_TESTS.md](./CONTRIBUTING_TESTS.md#size-policy)) and delete the entry here. Status words: **open** (confirmed, not fixed) · **inconclusive** (investigated, no root cause; do not re-close without new evidence) · **unverified** (carried over, not re-checked against the repo on the date above).

---

## A. Failing / flaky tests

### KI-01 — FFPS5: stable across re-testing, root cause unconfirmed
- **Status:** inconclusive (currently stable; original symptom never reproduced) · **Since:** 2026-09-23 (re-investigated 2026-09-28)
- **What:** `FFPS5 admin should confirm typing exactly the minimum allowed characters in the Text field is accepted when creating a product` (`tests/ui/formFields/productsAndServicesFieldLimits.spec.ts`). Originally read as a backend dropping the custom-field value; an operator then watched it in headed mode and saw the field never typed into and the edit page reload repeatedly — a different (fill/locator) symptom. Six independent conditions (single worker, forced 3-way concurrency on QA and staging, real code path with DOM/POST/GET/edit-page evidence layers, alongside the core suite, FFPS1–5 in sequence) reproduced neither shape. Full write-up: [APPLICATION_BUGS.md](../APPLICATION_BUGS.md) entry 6 (reclassified: not a confirmed app bug).
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
- **What:** (a) Deals "log a Call on a shared deal" permission failure; (b) `quotations.rbac.spec.ts` ~8-minute timeout in `openCreateForm()`; (c) `call-logs.spec.ts` company live-search "no options"; (d) `meetings.spec.ts` reschedule failure (3× HTTP 500 on invitee lookup); (e) `tasks.rbac.spec.ts` edit-modal hang (hardened, 0/5 reproductions); (f) HTTP 500 on meeting creation and Deals RBAC Task-permission timeout (pass in isolation, fail in suite).
- **Evidence:** each was one occurrence or unreproducible locally; rule 21 forbids dismissing load-dependent flakes. Line numbers drift — search by test title. Detail: [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md), [locators-and-timing.md](./known-issues/locators-and-timing.md).

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
- **Status:** unverified (implemented 2026-10-06, uncommitted; only static checks done: `tsc`, `eslint`, actionlint with no new findings, `check:test-counts` unchanged) · **Since:** 2026-10-06
- **What:** [ADR 0009](./adr/0009-field-config-reset-and-account-lock.md). Open items, none of them confirmed: (1) the tool has never run against a real app and its `FormFieldsConfigPage` selectors were not re-confirmed live; (2) a field absent in an env counts as a failure (exit 1), check on the first dry-run, esp. staging/prod; (3) entity tab labels/URL slugs were copied from the specs' `*_ENTITY` constants; (4) retry/deadline values come from `globalSetup`, a full 18-field pass was never timed, the 25-min step / 35-min job timeouts are guesses; (5) whether job-level `continue-on-error` protects the run conclusion when the job times out; (6) whether a run waiting for environment approval holds its concurrency group; (7) whether one approval covers the new `main.yml` job or it needs its own (if unapproved, `merge-and-report` and the email wait); (8) behaviour of `always()` jobs after a normal cancel vs force-cancel; (9) one pending run per group: a pending `stage` push can be displaced by a `sandbox` push (no `workflow_dispatch` on sandbox); (10) Jenkins jobs and `staging-promotion-gate.yml` are outside the groups; (11) the email section was typechecked, never viewed rendered.
- **Next check:** user dry-runs `npm run reset:field-config -- --env qa|staging|prod --dry-run` while no CI run is active on that account; first real CI run of each workflow after merge. Former KI-10 (no `concurrency:` guard) is closed in [sharding-and-locks.md](./known-issues/sharding-and-locks.md) only as "guard added", not as proven.

### KI-36 — Sandbox formFields split never exercised in a real CI run
- **Status:** unverified (implemented 2026-10-07, uncommitted) · **Since:** 2026-10-07
- **What:** [sharding-and-locks.md](./known-issues/sharding-and-locks.md) 2026-10-07 entry. Checked offline only (real `decide` script on synthetic file lists, actionlint, `--list` counts). Open: (1) a skipped `run-tests` (`if` false) with `needs: detect` should not expand its matrix, and `run-formfields-tests` (`!cancelled()`) / `merge-and-report` (`always()`) should still run; not observed on GitHub; (2) `--grep @smoke` still includes 18 `@smoke` formFields tests in one scoped shard (accepted, unchanged); (3) the 180-min scoped timeout is unmeasured; (4) 3 new shellcheck info/style findings in the `decide` script (SC2086 on the intentionally word-split path lists, SC2129), same classes as the pre-existing ones.
- **Next check:** first sandbox push that touches only formFields files; confirm 6 matrix jobs run, `playwright-selective` shows skipped, and the email lists 417 tests.

### KI-38 — Sandbox formFields entity selection: never exercised on GitHub
- **Status:** unverified (implemented 2026-10-08, uncommitted) · **Since:** 2026-10-08
- **What:** sandbox runs only the formFields entities `detect-tests.sh` selects (run 37753304635: a `ProductsAndServicesPage.ts`-only change moved all 417 tests). Checked offline only: the real `decide` step on synthetic file lists (1/2/6 entities, escalated, none), actionlint, shellcheck. Open: (1) GitHub behaviour with a one-entity matrix, with `run-tests` skipped, and the blob-count check in a real run are unobserved; (2) the dependency rule is direct-import only: a changed file that an entity's formFields spec reaches only transitively (or imports from outside `src/modules`/`src/data/factories`) selects nothing; (3) `--grep @smoke` fallback still pulls the 18 `@smoke` formFields tests into the scoped shard (unchanged by design); (4) `reset-field-config` still resets all 18 fields (the script has no per-entity flag); (5) the `ShardCompleteness.ts` comment still says "the 6 formFields entities" (behaviour does not depend on it).
- **Revert:** see the 2026-10-08 amendment in [ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md).
- **Next check:** first sandbox push touching one entity's files: expect one `playwright-formFields (<entity>)` job, `playwright-selective` per the scoped files, and a complete-run email.

### KI-37 — Install-step bound and incomplete-run handling: unproven; build #189 ledger record still unmarked
- **Status:** unverified (implemented 2026-10-08, uncommitted) · **Since:** 2026-10-07
- **What:** [sharding-and-locks.md](./known-issues/sharding-and-locks.md) 2026-10-07 entry. Open: (1) cause of the apt stall in run 37669596623 is unknown, and the apt `Acquire::*::Timeout` options plus `timeout -k` are untested on a real runner (the retry/timeout logic was exercised locally with substitute commands only); whether `timeout` also reaps apt's child processes is unconfirmed (run 37753304635: attempt 1 stalled at 180 s during apt downloads, attempts 2-3 hit `Could not get lock /var/lib/dpkg/lock-frontend`, held by the same apt-get pid 2708; leftover-apt-get is the likely explanation but unproven, and the stall cause is unknown; 2026-10-08 the script now terminates leftover apt-get after a timed-out attempt, sets `DPkg::Lock::Timeout 60` and enforces a 570 s total budget — tested locally with stub commands and a fake `apt-get`, never on a runner, and `sudo kill` was not exercised); (2) the 180 s per-attempt limit is 1.4x the slowest healthy install seen (129 s), so a slow-but-healthy runner could burn an attempt; (3) `syncHistory` was exercised through its pure functions, never end to end against a ledger; (4) a missing/garbled `shard-completeness.json` means "no information" and renders as before (green); (5) qa/stage/main got a new completeness step and `plan` in `merge-and-report`'s `needs`, run only through actionlint; (6) history record for sandbox build #189 (`history/staging.jsonl` on `ci/reporting-history`) still holds 277 tests as a normal run. Handle it by adding `"incomplete":{"expected":6,"reported":4}` to that JSON line (readers then ignore it), deleting the line, or re-running the failed jobs of run 37669596623 before its blob artifacts expire (retention 3 days, so by 2026-10-10): a complete re-run replaces the record because history keeps one record per build.
- **Next check:** user marks or removes the #189 line; first real sandbox/qa run after merge shows the new steps; first real install failure shows the `Playwright browser install failed` annotation.

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
- **What:** (a) `syncHistory.ts`, `notify.ts`, `src/reporters/MiscErrorReporter.ts` still use `console.*` instead of `logger` (verified: 11 / 1 / 28 call sites); (b) `ErrorCollector` events captured inside `globalSetup` are written to a pid-named worker file that `MiscErrorReporter.onBegin()` deletes (pre-existing); (c) five background `ERR_ABORTED` URL families on `.../fields?entityType=...` are not yet in `errorFilters.ts`'s navigation-abort list — needs the usual zero-correlation evidence bar first.
- **History:** [reporting-and-notifications.md](./known-issues/reporting-and-notifications.md).

---

## C. Code-quality debts (verified in the repo on the date above)

### KI-19 — The escalated sandbox run's formFields track ignores `--grep @regression`
- **Status:** open · **Since:** 2026-10-06
- **What:** Sandbox Build #186 reported 916 tests, not the 898 `@regression` count. The core shards (499 tests) apply `--grep @regression`; each formFields shard runs both of its spec files with no grep (70+70+70+67+70+70 = 417 vs 399 tagged), so 18 untagged formFields tests also run. 932 = 515 (core) + 417; 916 = 499 + 417; the missing 16 are untagged core tests. `qa.yml`/`stage.yml`/`main.yml` use the same formFields command. Not a lost or double-counted test: merged total = sum of the 11 shards' own "Running N tests".
- **Also seen:** a manual re-run of failed jobs re-runs `merge-and-report` (Build #186: 7 attempts, 7 emails). The "Verify all shards reported" check counts zips, so a stale blob from an earlier attempt still satisfies it (`download-artifact` takes the latest artifact per name).
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
- **Status:** open · **What:** `.env.example` is gitignored and never committed, so a fresh clone has no credential template (the README lists the real required variables; the local file only holds dead `*_DEAL_NAME` entries); `.eslintrc.json` is a legacy config never read by `npm run lint` (`eslint.config.js` is active); pre-existing prettier drift in `QuotationsPage.ts`, `LeadsPage.ts`, `BasePage.ts`; `.claude/settings.json` carries an inert `agent_delegation` / `investigation_log` block whose `INVESTIGATION_LOG.md` does not exist. <!-- ref-ok -->

### KI-27 — Dev-branch lint-fix drift (carried over; likely closed)
- **Status:** unverified · **What:** `CLAUDE.md` once recorded 3 lint-suppression hunks missing on `dev` but present on qa/stage/prod/main. Local remote-tracking refs (last fetched 2026-09-10) show **no** diff on those files between `origin/dev` and any of the four, and the files have since changed substantially. Re-check after a `git fetch` (rule 25); delete this entry if still clean.

### KI-35 — Products & Services Units menu stays open; `b0c6b38` part 2 not ported
- **Status:** part 1 ported 2026-10-08 (uncommitted), **not verified on QA**; part 2 open, not ported · **Since:** 2026-10-07
- **Symptom:** `productsAndServices.rbac.spec.ts` :46 and :75 fail on both attempts: `locator.click` timed out on `label[for="0_88_input_isActive"]` (`setIsActive()`), log says `<div class="css-1dsbpcp">` intercepts pointer events (QA run 37733648349 shard 5/5; also run 37508203253). The trace shows that div is the react-select menu's full-viewport overlay (`position: fixed; inset: 0`, first child of `div.is-invalid__menu`); the screenshot shows the Units list open with "Pieces (p)" selected, the Units input focused. `selectFromReactSelect()` swallowed the hidden-wait timeout with `.catch(() => {})`.
- **Fix (part 1 of `b0c6b38`, ported by hand):** after a pick, if `.is-invalid__menu` is still visible, press Escape once and wait for hidden (`timeouts.expect`); still visible, throw an error naming the field. Single-selects (Country, Category) are already hidden, so the branch is skipped.
- **Revert:** restore the bare `.waitFor({ state: 'hidden' }).catch(() => {})` in `selectFromReactSelect()` (`ProductsAndServicesPage.ts`).
- **NOT verified:** that this fixes QA (no live run was made); that Escape alone closes the menu; why QA differs from other environments (only the user's word that they pass).
- **Part 2 (open):** `saveEditedProduct()` does no `blur()` + `networkidle` before Save; `b0c6b38` claims a wiped `customFieldValues` on the PUT. The current evidence (the failure above) does not involve it; unported pending a decision. See [products-and-services.md](./known-issues/products-and-services.md).

---

## D. Accepted behavior / decisions needed

- **KI-30 — `deriveModuleFromFile()` display names** (`Call-logs`, `ProductsAndServices`, `login.spec.ts` counted under Dashboard) are deliberately unfixed: renaming would break trend continuity in `ci/reporting-history`. Read the code comment above the final name computation before touching it.
- **KI-31 — Lead `fillEditForm()` does not update Timezone/Country/Professional fields** (Contact's does). Create-only was the lower-risk choice; extending it is a maintainer decision.
- **KI-32 — Company Website validation has no negative test** (the custom `UrlField` does).
- **KI-33 — Quotation report entity type is deployed to QA only** (as of 2026-09-09); the two tests that need it self-skip via a live presence check, so nothing to fix — re-verify the claim when stage/prod change ([ci-pipelines.md](./known-issues/ci-pipelines.md)).
