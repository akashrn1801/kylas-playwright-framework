# ADR 0015 — A re-run skips formFields jobs that already passed; rerun shard for failed and flaky tests

> **Purpose:** Records how a re-run of one failed core shard avoids repeating the formFields jobs (sandbox first), and the rerun-shard design that later steps build on.
> **Read when:** Editing `.github/scripts/formfields-attempt-gate.sh`, the gate steps or `overwrite: true` uploads in `sandbox.yml`, or starting the rerun-shard work.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-11-25 @ c12c85c

## Status
Proposed — 2026-11-03. Amended 2026-11-24 (a test that passes on the rerun counts as Passed; Final result column) and 2026-11-25 (colour by results only); history in [0015-amendments.md](./0015-amendments.md).

## Context
- formFields jobs `needs` the core shards, so GitHub's "Re-run failed jobs" / "Re-run job" on one failed core shard also re-runs the dependent formFields matrix jobs (about 80-110 min each), the reset and the merge. A job that passed in an earlier attempt of the same run has nothing to prove again; its artifacts stay in the run.
- A transient failure should read as "passed on rerun", not as a red test. (Before the 2026-11-24 amendment a rerun pass counted as Flaky, never Passed; build #235's email then said "Passed 932" next to "2 recovered", and the headline disagreed with the rerun table's own meaning. Now Passed counts the rerun passes; "Passed first time" and the history keep the first attempt, and a test that failed every first attempt still keeps the verdict amber.)

## Decision
- **Attempt gate** (`.github/scripts/formfields-attempt-gate.sh ff|reset`, token `PIPELINE_TOKEN` else `github.token`, `actions: read`): writes `skip=true|false`, always exits 0, never skips on doubt. A formFields job skips every step after checkout when `run_attempt > 1`, the same job name concluded success earlier with its test step succeeded and its `blob-report-sandbox-formfields-<entity>` artifact not expired ("formFields <entity> already passed in attempt N — skipped"). `reset-field-config` skips when no formFields job ran tests in this attempt. "Re-run all jobs" (detect re-ran) skips nothing. All `sandbox.yml` uploads use `overwrite: true`.
- **Rerun shard** (`rerun-failed`, job name `playwright-rerun (failed+flaky)`, `needs: [detect, run-tests]`, runs only when repo variable `RERUN_SHARD == 'on'`; `RERUN_MAX_TESTS` default 60, `RERUN_RETRIES` default 0, `RERUN_INCLUDE_FLAKY` default false since 2026-11-25, see the third amendment). It merges the core blobs (`blob-report-sandbox-[0-9]*`) with `merge-json.config.ts`, `scripts/rerun-select.ts` picks, from the blobs (never `.last-run.json`): if the first run has ANY failed, timed-out, cut-off or "did not run" test (a failed formFields test counts) only those are rerun and the flaky ones are not; if it has none, the flaky tests are rerun, targets `file:line` or the whole file for serial files, never formFields tests, nothing above the cap (a mass failure is an outage). It reruns once with `--workers=2 --retries=$RERUN_RETRIES` and always exits 0. Artifacts `rerun-manifest-sandbox` (always, with run id + attempt), `rerun-blob-sandbox`, `rerun-misc-errors-sandbox`, `rerun-test-results-sandbox`: none matches `blob-report-sandbox-*` or `misc-errors-sandbox-*`, so shard completeness (core + formFields) is unaffected. formFields `needs` it with `!cancelled()`; a re-run of a core shard re-runs it (it re-selects from the latest blobs).
- **Combine** (`scripts/combine-rerun.ts`, in `merge-and-report`): rerun results are appended to the first-run test rows (one report, one email); a rerun pass is Passed after the rerun, a rerun failure stays failed, a dependent that never ran becomes Passed or failed. Full rules: [0015-amendments.md](./0015-amendments.md).
- **One email**: the summary table compares First run with Final result, and per test first run → rerun → final ("Passed on rerun"). Details: [REPORTING.md](../REPORTING.md), [0015-amendments.md](./0015-amendments.md).
- **Manual rerun** (`.github/workflows/rerun-failed.yml`, `workflow_dispatch`: `run_id`, `env` qa|staging, `include_flaky`): group `kylas-<env>`, no formFields, reads the run's 14-day `playwright-report-*` and `run-meta-*` artifacts (sandbox runs only for now), checks out a ref whose `tests/ src/ config/` equal the run's commit, then selects, reruns, combines, syncs history under the ORIGINAL build number (replaces that record) and sends the one email.
- Run conclusion stays red if any shard failed (option A); the email shows what recovered.

## Second amendment 2026-11-24: Final result
The rerun table's second column is **Final result**: every test that ultimately passed is Passed (clean + after an in-job retry + after the rerun); instability stays visible as a signal inside Passed (First run column, "Passed first time", Flaky tile, history first-run counts). Full text and the bugs the scenario matrix found: [0015-amendments.md](./0015-amendments.md).

## Consequences
- Re-running a failed core shard costs that shard, the rerun job and seconds for passed formFields jobs. The rerun job re-selects every failed/flaky core test again, including those of shards that were not re-run.
- Limits: the merged HTML report stays the first run (`results.json` is combined); the rerun job's misc errors are merged since 2026-11-24 (`misc-errors-sandbox-rerun`, label `sandbox-rerun`); a whole-file rerun of a serial file ignores the shard's `--grep`; formFields tests are never rerun (v1); JobStats shows the latest attempt only.
- **UNVERIFIED (no GitHub doc found; prove on sandbox):** (1) a later attempt's `merge-and-report` downloads artifacts uploaded in an earlier attempt of the same run; (2) how `attempts/N/jobs` lists a job that was not re-run; (3) `overwrite: true` replaces the earlier artifact on re-upload; (4) `PIPELINE_TOKEN` can read the attempts-jobs and artifacts endpoints; (5) `.path` of a run in the runs API is the plain workflow path; (6) `blob-report-sandbox-[0-9]*` matches as a glob in `download-artifact`; (7) `spec.line` is the same in the first run and the rerun. If (1) fails the email says INCOMPLETE (honest, not green).
- Tested offline only: `npm run check:rerun` (unit + 21 end-to-end scenarios; the gate's own check is `check:formfields-gate`), `check:build235` (build #235 replayed from a fixture), `check:failure-labels`, actionlint.

## How to revert
Switch off without a code change: set the variable `RERUN_SHARD` to anything but `on` (the attempt gate stays). Full revert: delete the `rerun-failed` job, its `needs` entries, the download/combine/`run-meta-sandbox` steps and the two `gate` steps with their `if` conditions, `actions: read` and `overwrite: true` lines in `sandbox.yml`; delete `rerun-failed.yml`, `formfields-attempt-gate.sh`, `merge-json.config.ts`, `scripts/rerun-select.ts`, `scripts/combine-rerun.ts`, `scripts/check-rerun.ts`, `src/notifications/RerunResults.ts` and `RerunSummary.ts` and their uses in `EmailTemplate.ts`, `NotificationService.ts`, `syncHistory.ts`, `RunHistory.ts`.

## Third amendment 2026-11-25: colour by results only
Green when everything passed in the end, flaky <= `FLAKY_BUDGET` (3) and nothing failed every attempt; amber above the budget, for a test that passed only on the rerun, or tests that did not run; red for any failure. `RERUN_INCLUDE_FLAKY` defaults to off (failed tests are still rerun). Full text: [0015-amendments.md](./0015-amendments.md).

## Commit(s)
Not committed yet (pending the maintainer's review).
