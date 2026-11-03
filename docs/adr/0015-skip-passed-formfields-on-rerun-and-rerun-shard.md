# ADR 0015 — A re-run skips formFields jobs that already passed; rerun-shard design

> **Purpose:** Records how a re-run of one failed core shard avoids repeating the formFields jobs (sandbox first), and the rerun-shard design that later steps build on.
> **Read when:** Editing `.github/scripts/formfields-attempt-gate.sh`, the gate steps or `overwrite: true` uploads in `sandbox.yml`, or starting the rerun-shard work.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-11-03 @ fdf15d2

## Status
Proposed — 2026-11-03. **Step 1 implemented in `sandbox.yml` only; not run on GitHub.** The job order stays as in [ADR 0007](0007-sequence-formfields-after-core.md) (detect → core shards → formFields → reset → merge); an earlier 2026-11-03 draft that reversed it was dropped. qa/stage/main unchanged. Steps 2-3 (rerun shard, manual rerun, email) are design only.

## Context
- formFields jobs `needs` the core shards, so GitHub's "Re-run failed jobs" / "Re-run job" on one failed core shard also re-runs the dependent formFields matrix jobs (about 80-110 min each), the reset and the merge.
- A job that passed in an earlier attempt of the same run has nothing to prove again; its artifacts stay in the run.

## Decision (step 1)
- `.github/scripts/formfields-attempt-gate.sh ff|reset` (needs `actions: read`; token `PIPELINE_TOKEN`, else `github.token`) writes `skip=true|false`; it always exits 0 and never skips on doubt (API error, missing artifact, unexpected data = run normally).
- **formFields job** (`sandbox.yml`): after checkout a gate step (`id: gate`, `continue-on-error`) skips every later step (setup, install, tests, uploads) when `run_attempt > 1` and the same job name concluded success in an earlier attempt, with its test step succeeded and its `blob-report-sandbox-formfields-<entity>` artifact not expired. Log: "formFields <entity> already passed in attempt N — skipped". A job that failed or did not run earlier runs normally. The skipped job uploads nothing.
- **reset-field-config**: skips (same pattern) when no formFields job ran tests in this attempt; runs as today in attempt 1 and whenever one ran.
- **"Re-run all jobs"**: detect re-runs (its job entry has `run_attempt` == current), so nothing is skipped.
- **Every upload in `sandbox.yml`** (core shards, formFields, reset, merge) gets `overwrite: true` (names unchanged), so a re-run job replaces its own earlier artifact instead of failing on "already exists". With unique names `download-artifact` has one artifact per name: latest attempt for re-run jobs, the earlier attempt for skipped jobs.
- merge/notify, `verify-shard-completeness` (core + formFields) and JobStats are unchanged. The skipped jobs' attempt-1 blobs keep the run complete.
- Later steps (decided 2026-11-03): one `playwright-rerun` job after the core shards reading failed/flaky tests from the shard blobs (not `.last-run.json`; a serial file reruns whole), formFields tests excluded in v1, test-count cap, `--retries=0`, kill switch variable `RERUN_SHARD`, own overlay of first-run and rerun results (merging both blob sets duplicates rows), run stays red if any shard failed, ONE email with "First run" / "After rerun" and per test first → rerun → final, manual `workflow_dispatch` rerun from the 14-day merged JSON (qa, staging).

## Consequences
- Re-running a failed core shard costs that shard plus seconds for passed formFields jobs.
- **UNVERIFIED (no GitHub doc found that states them; prove on sandbox):** (1) a later attempt's `merge-and-report` can download artifacts uploaded in an earlier attempt of the same run (upload-artifact v4 reports names as taken "on the workflow run", so run scope is likely); (2) the job list of attempt N for a job that was not re-run; (3) `overwrite: true` replaces the earlier artifact when a job re-uploads; (4) `GET /actions/runs/{id}/attempts/{n}/jobs` with `PIPELINE_TOKEN`. If (1) fails the email is marked INCOMPLETE (honest, not green).
- JobStats lists the skipped jobs as short `playwright-formFields` rows (latest attempt only). History keeps one record per build number, so the latest attempt replaces the earlier one (existing behavior).
- `.github/scripts/formfields-attempt-gate.sh` and the step name prefix "Run formFields tests for " are coupled to the workflow; offline-tested with a stubbed `gh` (11 cases), not on GitHub.

## How to revert
Delete the two `gate` steps, every `if: ... steps.gate.outputs.skip != 'true'` condition, the `actions: read` permissions and the `overwrite: true` lines in `sandbox.yml`, and delete `.github/scripts/formfields-attempt-gate.sh`.

## Commit(s)
Not committed yet (pending the maintainer's review).
