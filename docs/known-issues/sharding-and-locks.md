# Sharding, Cross-Process Locks and `.serial` — Resolved History

> **Purpose:** Resolved incidents behind how CI splits the suite (6h ceiling, file-atomic planner, formFields carve-out/sequencing) and how shared account-wide config is protected.
> **Read when:** Changing a workflow's shard/`needs:` structure, `scripts/plan-shards.ts`, `config/sharedConfigSuites.json`, `tests/ui/formFields/formFieldLockFactory.ts`, or adding a test that depends on order or on shared config.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-08 @ 2fa56be

Open follow-ups (non-scaling formFields matrix, missing `concurrency:` guard) are in `docs/KNOWN_ISSUES_ACTIVE.md`. The decisions are summarised in `docs/adr/`.

### GitHub-hosted jobs have a hard 6-hour ceiling — 2026-09-08/09
- **Symptom:** qa, stage and escalated sandbox runs were killed at 6h01–6h02m with "The job has exceeded the maximum execution time of 6h0m0s", even where `timeout-minutes: 480` was set.
- **Root cause:** GitHub-hosted runners enforce a non-configurable 6h per-job maximum; raising `timeout-minutes` past 360 does nothing (an earlier "fix" to 480 was wrong). Suite growth plus `detect-tests.sh` correctly escalating sandbox to full `@regression` crossed it. Not concurrency cancellation, not manual cancel.
- **Fix:** Split execution into a matrix with a `merge-and-report` job using `npx playwright merge-reports` (one report, one email); `allure-playwright` is excluded from the merge (`merge.config.ts`; its `AllureReporter.onConfigure` throws a non-fatal `TypeError` on `outputDir` under merge). Chosen over `--workers` tuning and a self-hosted runner. Shard count is planned, not hand-set (next entries).
- **Revert:** Restore single-job `run-tests` in `qa.yml`/`stage.yml`/`main.yml`/`sandbox.yml` — it will be killed again once the suite exceeds the ceiling.
- **Commit:** `cd22b91`; dynamic counts `8e96dc8`.

### Killed run reported "PASSED" for zero executed tests — 2026-09-09
- **Symptom:** A cancelled sandbox run's notify step headlined "PASSED" for 0 of the discovered tests.
- **Root cause:** The notify step read a stale degenerate `results.json` left by the script's own `--list` probe (every listed test is `skipped`).
- **Fix:** `ReportParser.ts` emits `no-tests-executed` when `total > 0` and passed=failed=flaky=0; `AutomationHealth.computeOverallVerdict()` checks it first; `EmailTemplate.subject()` reuses the same verdict fallback as the body.
- **Revert:** Revert the verdict check in `AutomationHealth.ts` / `ReportParser.ts`.
- **Commit:** `cd22b91`.

### `fullyParallel: true` gives no file-boundary guarantee under sharding — 2026-09-09
- **Symptom:** None yet — audit run before trusting sharding.
- **Root cause (durable fact, confirmed in Playwright's own `createTestGroups()`/`filterForShard()`):** With `fullyParallel: true`, tests of one spec file are independent distribution groups and can land on different shards; a `beforeAll` block without serial mode can be chunked across shards; **only `test.describe.configure({ mode: 'serial' })` keeps a block atomic**, and a file boundary gives zero protection. No genuine order dependency existed in the suite at audit time. Two Reports describe blocks carried a stale comment ("always runs `--workers=1`", "declaration order") — safe only because they assert `toBeGreaterThanOrEqual`; the comment's justification is false.
- **Fix:** Documentation only; rule recorded in `docs/PATTERNS.md`. Any new order-dependent pair must be wrapped in `.serial`.
- **Revert:** n/a — doc only. (Stale Reports comments: correct them next time `reports.spec.ts`/`reports.rbac.spec.ts` are edited.)
- **Commit:** `6184a11`.

### Serial mode retries the WHOLE block — 2026-09-09
- **Symptom:** A run reported far more retries than failures (3 flaky + 2 failed, ~22 retries).
- **Root cause:** Playwright serial mode skips the rest of a block after one failure, then reruns the entire block (including already-passed tests) on retry. `quotations.spec.ts` is one 24-test serial block (QA-server load, `0271e76`): one failing test produced 24 two-result entries. Sharding and the merge step were not at fault — the merge is a faithful sum.
- **Fix:** Understanding only; reports split genuine retries from swept re-runs (`totalRetries` / `retriesFromNonCleanTests` / `retriesFromCleanSweeps` in `ReportParser`, per module too). Scope `.serial` to the smallest block that needs atomicity.
- **Revert:** n/a.
- **Commit:** `1091c4b` (retry breakdown).

### formFields cross-shard config race — 2026-09-29
- **Symptom:** Six formFields failures (`FFD15`, `FFTK38`, `FFRPS24`, `FFRTK7`, `FFRTK9`…) plus most of that run's flakes: a disabled Min-Length input, `regexLabel: expected "No Regex", got "Email"`, an `HTTP 400` naming `cfFormFieldLimitText`.
- **Root cause:** `formFieldLockFactory.ts`/`formFieldsTestLock.ts` use an `fs.mkdirSync` lock on ONE runner's disk, but each GitHub shard is a separate VM. Two shards each held "their own" exclusive lock while mutating the SAME account-wide field configuration. Removing `.serial` earlier (reasoning "the lock prevents concurrency") was true only for one filesystem. **Durable rule: a local-disk lock only protects workers on the same filesystem; any suite relying on one must be structurally kept on one shard.**
- **Fix:** (1) `run-formfields-tests`: a fixed matrix, one job per entity, each running that entity's UI+RBAC pair together by explicit file path — never Playwright's count-based `--shard`; (2) `.serial` restored per field-mutating sub-block (UI files), and per category in RBAC files (read-only lock-free blocks stay plain); (3) later, dedicated custom fields per consumer (`ab06f5e`) remove the shared resource itself — the strongest fix.
- **Revert:** Delete the `run-formfields-tests` jobs and the planner exclusion — reintroduces the race.
- **Commit:** `6ec6e3f` (carve-out), `ab06f5e` (dedicated fields).

### Shared test infrastructure masquerading as one test's flake (`FFL36` lesson) — 2026-09-21/22
- **Symptom:** `FFL36` failed repeatedly under `--workers=2` with `TransientLeadSaveError`/"no response captured within 60s", then the same 8-minute hang moved to `FFL34`, `FFL52`, `FFL54`, `FFL1`, `FFL22`, `FFL9`, `FFL4`, `FFL19` as each cause was fixed.
- **Root cause:** Network capture proved the create-lead endpoint answers in ~239ms, so not the backend. Compounding defects in the hand-rolled lock/fixture code: `afterAll` mutating config with no lock; stale-recovery comparing a waiter's local polling counter instead of the lock's real age; blind `fs.rmSync` of a stale lock racing a new legitimate holder; staleness threshold miscalibrated (once above the test timeout, so one hung test starved all waiters); 18 tests with no `test.setTimeout`; no fairness (first `mkdirSync` wins); fairness tickets never refreshed while a waiter polled. **Lesson: before blaming one test, check whether it shares custom cross-process coordination with tests that show the same symptom.**
- **Fix:** Heartbeat-based staleness (holder rewrites `heartbeatAtMs` every 10s; waiters judge abandonment by silence, not age), FIFO ticket queue refreshed while polling, atomic stale-claim, explicit timeouts. Implemented in `tests/ui/formFields/formFieldLockFactory.ts` (`createFormFieldLock()` per entity key); Lead's original `formFieldsTestLock.ts` left untouched.
- **Revert:** n/a — reverting restores the starvation modes above.
- **Commit:** `b9b88d7` (introduced with the feature), refined in `bf32201`/`9e35fc1`.

### Dynamic file-atomic shard planner — 2026-09-29
- **Symptom:** Blind `--shard=N/M` could split a module's UI+RBAC pair (the formFields root cause) and nothing stopped the next shared-state feature needing another one-off carve-out.
- **Root cause:** Playwright's splitter slices by test count with no file awareness.
- **Fix:** `scripts/plan-shards.ts` discovers via `npx playwright test --list --reporter=json`, excludes every directory named in `config/sharedConfigSuites.json` (a config file, not a CLI flag, so no workflow edit can leak files back), then bin-packs whole files first-fit-decreasing into a tests-per-shard budget derived from measured throughput. Workflows consume `matrix.shard.files`. `sandbox.yml`'s small-selective branch deliberately skips the planner (it can legitimately select formFields paths directly); empty `files` falls back to `$TARGET` + `--shard=1/1`. A dotenv banner containing `{ override: true }` once broke JSON extraction; `extractJson()` now requires `{` at start or line start.
- **Revert:** Restore `--shard=${{ matrix.shard }}/N` in `qa.yml`/`stage.yml`/`main.yml`/`sandbox.yml`.
- **Commit:** `bf32201`; config-file generalisation `3d58073`.

### formFields starts only after the core shards — 2026-10-06
- **Symptom:** Core shards and the formFields shards all started at once (many concurrent `globalSetup` logins/fixture creations against one backend) and produced the 429 / error-boundary failures.
- **Root cause:** Peak concurrent jobs per workflow was too high for the shared staging/QA backend.
- **Fix:** `run-formfields-tests` gets `needs: [run-tests]` (sandbox: `[detect, run-tests]`) plus `if: ${{ !cancelled() }}` — `needs` alone would skip formFields after any core failure. Product fixtures are created only when the invocation may run a Products & Services spec (`src/auth/productFixtureNeed.ts`; ambiguous → create; stale fixture file deleted on skip). A `max-parallel` cap was evaluated and not added. Cost: wall-clock roughly doubles for the sharded pipelines. `main.yml` caveat: all jobs carry `environment: production`, so required reviewers could produce a second approval prompt.
- **Revert:** Delete the `needs`/`if` lines on `run-formfields-tests` in the four workflows; replace the `selectionNeedsProductFixtures` block in `globalSetup.ts` with a bare `await ensureProductFixtures();`.
- **Commit:** `1bd03cc`.

### Sandbox selective run put all formFields tests on one shard — 2026-10-07
- **Symptom:** sandbox run 37658909999 changed only `src/modules/formFields/FormFieldsConfigPage.ts`. `detect-tests.sh` logged "Module detected: formFields", did not escalate; `detect` set `run_formfields_track=false`, `shard_total=1`. One job, `playwright-selective (shard 1/1)`, ran all 417 formFields tests on one machine (timeout 180); the 6-entity `run-formfields-tests` matrix never ran.
- **Root cause:** the selective branch of the `detect` step deliberately passed formFields paths through `$TARGET` unchanged, on the assumption that a 1-shard run is race-free and "finishes in minutes". The race was indeed absent, but the duration assumption was false (the per-entity matrix exists because one entity takes ~80-110 min at workers=2) and the carve-out was bypassed.
- **Fix:** `.github/scripts/split-formfields-target.sh` removes formFields paths from the scoped target by the `config/sharedConfigSuites.json` path prefixes (same rule as `plan-shards.ts`); `run_formfields_track=true` whenever any were selected (all 6 entities); `run-tests` is skipped via the new `run_scoped_tests` output when nothing else is left; a count check (formFields + scoped == original) fails the step on any lost/duplicated test. Verified only by running the real `decide` script locally on synthetic changed-file lists, actionlint and `--list` counts; no CI run. Open: [KI-34](../KNOWN_ISSUES_ACTIVE.md).
- **Revert:** restore the pre-change `else` branch of the `decide` step in `sandbox.yml`, remove the `run_scoped_tests` output and the `if` on `run-tests`, delete `split-formfields-target.sh`.
- **Commit:** not committed yet. See [ADR 0002](../adr/0002-formfields-carve-out-from-sharding.md) amendment.
