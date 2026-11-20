# Known Issues — Watch Items (open, moved out of the active list)

> **Purpose:** Open or unverified items whose evidence is a one-time observation or a never-run CI/Jenkins path, moved verbatim from `docs/KNOWN_ISSUES_ACTIVE.md` on 2026-11-04 to keep that file under 80% of its budget. IDs are unchanged; each is still tracked and listed in the pointer table of the active file.
> **Read when:** you touch the code, workflow or Jenkinsfile an entry names, or a CI/report failure looks like one of them.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 4a85ad7

Entries are unchanged except relative links (rewritten for this folder). Closing one: move a ≤15-line summary to its resolved topic file and delete it here and from the pointer table. Unlike the other files in this folder, these are NOT resolved.

### KI-34 — Field-config reset job and concurrency groups: never run, GitHub behaviours unconfirmed
- **Status:** unverified (implemented 2026-10-06; only static checks done) · **Since:** 2026-10-06
- **What:** [ADR 0009](../adr/0009-field-config-reset-and-account-lock.md). 11 unconfirmed items (full list: [sharding-and-locks.md](./sharding-and-locks.md)): the tool ran against a real app only as one local dry-run (2026-10-23), never as a real reset; timeouts are guesses; GitHub behaviour of `continue-on-error`, approval-waiting runs, `always()` after cancel and a displaced pending `stage` push is unobserved.
- **Next check:** user dry-runs `npm run reset:field-config -- --env qa|staging|prod --dry-run` while no CI run is active on that account; first real CI run of each workflow after merge. Former KI-10 is closed in [sharding-and-locks.md](./sharding-and-locks.md) only as "guard added", not as proven.

### KI-36 — Sandbox formFields split never exercised in a real CI run
- **Status:** unverified (implemented 2026-10-07) · **Since:** 2026-10-07
- **What:** checked offline only (real `decide` script on synthetic file lists, actionlint, `--list`). Unobserved on GitHub: skipped-`run-tests` matrix behaviour; the 180-min scoped timeout is unmeasured. Full list: [sharding-and-locks.md](./sharding-and-locks.md).
- **Next check:** first sandbox push touching only formFields files; confirm 6 matrix jobs run, `playwright-selective` shows skipped, and the email lists 417 tests.

### KI-38 — Sandbox formFields entity selection: never exercised on GitHub
- **Status:** unverified (implemented 2026-10-08) · **Since:** 2026-10-08
- **What:** sandbox runs only the formFields entities `detect-tests.sh` selects (run 37753304635: a `ProductsAndServicesPage.ts`-only change moved all 417 tests). Offline only. Notable: the dependency rule is direct-import only (a transitively reached file selects nothing). Full list: [sharding-and-locks.md](./sharding-and-locks.md). Revert: 2026-10-08 amendment in [ADR 0002](../adr/0002-formfields-carve-out-from-sharding.md).
- **Next check:** first sandbox push touching one entity's files: expect one `playwright-formFields (<entity>)` job, `playwright-selective` per the scoped files, and a complete-run email.

### KI-37 — Install-step bound and incomplete-run handling: unproven by a real run's logs
- **Status:** partly confirmed (implemented 2026-10-08; mirror rewrite and a healthy install read in real CI 2026-10-28) · **Since:** 2026-10-07
- **What:** [ADR 0010](../adr/0010-incomplete-run-handling-and-bounded-install.md). Confirmed in sandbox run 40454948545 (shard 1): the apt mirror rewrite and a first-attempt install in 28 s (limit 300 s). Still stub-tested only: the retry, the leftover-`apt-get` kill and the 570 s budget (apt-stall cause, run 37669596623, unknown); `syncHistory` via pure functions. Full list: [sharding-and-locks.md](./sharding-and-locks.md).
- **Next check:** the first real install failure or retry (`Playwright browser install failed` annotation).

### KI-12 — Sequenced formFields-after-core is not yet proven by a real run
- **Status:** unverified · **Since:** 2026-10-06 (commit `1bd03cc`)
- **What:** `needs: run-tests` + `if: ${{ !cancelled() }}` on `run-formfields-tests`, the conditional product-fixture creation (`src/auth/productFixtureNeed.ts`) and the load-signal table are checked by actionlint and synthetic runs only. `main.yml`'s four non-`plan` jobs carry `environment: production`; required reviewers there would add an approval prompt (not knowable from the repo). Wall-clock roughly doubles by design ([ADR 0007](../adr/0007-sequence-formfields-after-core.md)).
- **Next check:** first real run: the three job-graph cases, the "Load Signals by Job" table, `main` approval behavior. Sandbox re-run gate: [ADR 0015](../adr/0015-skip-passed-formfields-on-rerun-and-rerun-shard.md).

### KI-13 — `globalSetup` product-reference-data HTTP 400 on staging
- **Status:** unverified · **Since:** 2026-09-04
- **What:** `GET /products/layout?view=create` once returned `HTTP 400` before any test started on staging (QA unaffected; reproduced 2/2 that day; fixture cache timestamps argued against a permanently broken endpoint). `withTransientRetry()` now retries only 429/5xx, so a 400 would still fail fast. Most likely staging backend contention after staging absorbed two heavy pipelines (2026-07-28); never root-caused.
- **Next check:** needs backend/infra access; replicate `globalSetup.ts`'s exact two-logins-then-API sequence under concurrent load. History: [rate-limits-and-error-pages.md](./rate-limits-and-error-pages.md).

### KI-14 — Jenkins changes not confirmed by a real execution
- **Status:** unverified · **Since:** 2026-09-04 / 2026-09-09
- **What:** the base `Jenkinsfile`'s per-stage timeouts, branch-to-test-selection fix and `github-credentials` binding for `history:sync`/`estimate-duration` were verified structurally only. Sharding: [KI-47](#ki-47--sharded-jenkins-two-core-lanes-at-once-still-unproven). Main builds #5-#14: only #8 ran tests; the rest were aborted at or before the approval gate.
- **Next check:** watch the first real run per branch: selection, stage timeouts enforcing, a new `runSource: "jenkins"` record in `history/<env>.jsonl` on `ci/reporting-history`. History: [ci-pipelines.md](./ci-pipelines.md).

### KI-45 — Host suspend stretches Jenkins timeouts (main #13 sat 3,773 min on a 24 h limit)
- **Status:** fix applied 2026-10-28 (sleep masked by the maintainer; not re-checked by Claude); stamps unconfirmed · **Since:** 2026-10-20
- **What:** #13 parked at the approval gate 2026-10-20 17:56Z; its 24 h timeout fired 2026-10-23 08:49Z; the journal shows 38.8 h of suspend in that window (#10, #12 fit too). Likely (unverified): JVM timers stop in suspend. Fix: sleep disabled 2026-10-28 ([RUNBOOK](../RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 1; keep the laptop plugged in); the approval step logs the real wall-clock age.
- **Next check:** the wall-clock stamps on the next real approval (age matches the Jenkins timeout). History: [ci-pipelines.md](./ci-pipelines.md).

### KI-46 — GitHub cannot see Jenkins runs
- **Status:** open (procedural only) · **Since:** 2026-10-28
- **What:** the Jenkins locks and guard keep a Jenkins run from overlapping Jenkins or GitHub runs, but the `kylas-*` concurrency groups only see GitHub runs ([ADR 0009](../adr/0009-field-config-reset-and-account-lock.md)); workflow edits are out of scope. Dispatching `main.yml`/`prod.yml` (or pushing `qa`/`stage`/`sandbox`) while Jenkins holds the account is not prevented, and the guard has a check-then-run window.
- **Next check:** check Jenkins for a running build on that environment before any manual dispatch ([RUNBOOK](../RUNBOOK.md#jenkins-sharded-runs-setup-and-operation)). A real fix needs a workflow-side check (maintainer decision).

### KI-47 — Sharded Jenkins: two core lanes at once still unproven
- **Status:** partly confirmed (live 2026-10-28) · **Since:** 2026-10-28
- **What:** [ADR 0012](../adr/0012-jenkins-sharded-runs-locks-and-guard.md). Live 2026-10-28: an unsharded sandbox build and a sharded QA build both passed (locks, guard Clear, "All 7 shards reported", merge, history, PARTIAL email). Unproven: 2 core lanes at once, script approvals, `finally` reset after an abort, speed/memory estimates, the guard's PAT. Detail: [sharding-and-locks.md](./sharding-and-locks.md).
- **Next check:** a full sharded QA run with the default 2 core lanes, compared with GitHub's `qa.yml` results ([RUNBOOK](../RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 6).

### KI-15 — Real GitHub Jobs API response shape for the "CI Job Stats" card
- **Status:** unverified · **Since:** 2026-09-29
- **What:** `src/notifications/JobStats.ts` assumes `started_at` / `completed_at` / `name` per job from GitHub's documented schema; never seen against a real run's response. The email section also depends on the formFields job-name template.
- **Next check:** first real sharded run — section renders, total is sane, only the notify job is `incomplete`.

### KI-18 — Unmeasured reporting pipeline gaps
- **Status:** open · **Since:** 2026-09-30 / 2026-10-06
- **What:** (a) `syncHistory.ts`, `notify.ts`, `src/reporters/MiscErrorReporter.ts` still use `console.*` instead of `logger` (11 / 1 / 28 call sites); (b) misc errors captured by `ErrorCollector` inside `globalSetup` go to a pid-named worker file that `MiscErrorReporter.onBegin()` deletes (pre-existing; recovery events use `recovery-events-main.json`); (c) the `/fields` list `ERR_ABORTED` noise is allowlisted; any other `ERR_ABORTED` family needs zero-correlation evidence first.
- **History:** [reporting-and-notifications.md](./reporting-and-notifications.md).

---

## C. Code-quality debts (verified in the repo on the date above)

### KI-19 — The escalated sandbox run's formFields track ignores `--grep @regression`
- **Status:** open · **Since:** 2026-10-06
- **What:** Sandbox Build #186 reported 916 tests, not the 898 `@regression` count: core shards apply `--grep @regression`, each formFields shard runs both its spec files with no grep (417 vs 399 tagged; 932 = 515 + 417, 916 = 499 + 417). Also: a manual re-run of failed jobs re-runs `merge-and-report` (Build #186: 7 attempts, 7 emails); "Verify all shards reported" counts zips, so a stale blob passes. Arithmetic: [sharding-and-locks.md](./sharding-and-locks.md).
- **Next check:** decide whether formFields should honor the tag filter; the one skipped test is the known `call-logs.spec.ts:568` `test.skip`.
