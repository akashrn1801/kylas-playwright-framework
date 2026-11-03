# ADR 0015 — formFields and reset before the core shards (sandbox first); rerun shard design

> **Purpose:** Records the job-order change that lets a core shard be re-run without re-running the formFields jobs, and the design of the rerun shard that later steps will build on it.
> **Read when:** Changing job ordering or `needs`/`if` in `sandbox.yml` (later qa/stage/main), the reset position, or starting the rerun-shard work.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-11-03 @ fdf15d2

## Status
Proposed — 2026-11-03. **Step 1 (order change) implemented in `sandbox.yml` only; not yet run.** Steps 2-3 (rerun shard, manual rerun, email/history) are design only. qa/stage/main still use the order of [ADR 0007](0007-sequence-formfields-after-core.md). Supersedes ADR 0007's order for `sandbox.yml` only.

## Context
- `run-formfields-tests` `needs` the core shards ([ADR 0007](0007-sequence-formfields-after-core.md)), so GitHub's "Re-run failed jobs" on one failed core shard also re-runs every dependent: the six formFields jobs (about 80-110 min each), reset and merge.
- Planned rerun shard (collect failed and flaky tests of all shards, rerun them once in one job, then one merge and one email) needs the formFields jobs to be upstream of the core shards, or it would re-trigger them too.
- ADR 0009: core tests never touch the dedicated form-field limits, so the reset can sit before the core shards.

## Decision
- Step 1, `sandbox.yml`: `detect -> run-formfields-tests -> reset-field-config -> run-tests -> merge-and-report`. `run-formfields-tests` `needs: [detect]` (gate `run_formfields_track == 'true'` kept). `reset-field-config` `needs: [detect, run-formfields-tests]` (`always()` and its gate unchanged). `run-tests` `needs: [detect, reset-field-config]` with `if: !cancelled() && needs.detect.result == 'success' && run_scoped_tests == 'true'`: never the implicit `success()`, so a failed or skipped formFields/reset job cannot suppress the core shards; a failed `detect` still runs nothing. `merge-and-report` is unchanged.
- Peak concurrency is unchanged (one track at a time); the core shards start only after reset finished, so formFields and core never overlap on the account.
- Later steps (design, decided 2026-11-03): one `playwright-rerun` job after the core shards, candidates read from the shard blobs (never `.last-run.json`, which misses flaky and serial-skipped tests; a serial file is rerun whole), formFields tests excluded in v1, cap on test count, `--retries=0`, kill switch repo variable `RERUN_SHARD`; first-run and rerun results are overlaid by our own script (merging both blob sets duplicates rows); run stays red if any shard failed (Option A); ONE email with a "First run" / "After rerun" table plus per test first -> rerun -> final; history counts first-attempt failures and recovered tests as flaky; manual `workflow_dispatch` rerun from the 14-day merged JSON (qa and staging).

## Consequences
- Re-running one failed core shard re-runs only that shard and `merge-and-report`.
- Wall-clock is unchanged (the tracks were already sequential). A formFields failure no longer delays a core failure, but a hung formFields/reset job (up to 180/35 min) now delays the core shards instead of the merge.
- **Not proven by a real run.** Four shapes to check on sandbox: selective one shard, escalated, formFields-only (core skipped), nothing to run (all skipped, merge still runs); plus a forced formFields failure that must not stop the core shards.

## How to revert
In `sandbox.yml`: `run-formfields-tests` back to `needs: [detect, run-tests]` and `if: ${{ !cancelled() && needs.detect.outputs.run_formfields_track == 'true' }}`; `reset-field-config` `needs: [detect, run-tests, run-formfields-tests]`; `run-tests` `needs: detect` and `if: ${{ needs.detect.outputs.run_scoped_tests == 'true' }}`.

## Commit(s)
Not committed yet (pending the maintainer's review).
