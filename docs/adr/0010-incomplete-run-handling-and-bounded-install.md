# ADR 0010 — Incomplete runs are never green; browser install is time-bounded

> **Purpose:** Records how a run that merged fewer shard reports than expected is surfaced, and why the browser-install step is bounded.
> **Read when:** Changing `verify-shard-completeness.sh`, `ShardCompleteness.ts`, the verdict for missing shards, history exclusion of partial runs, or `install-playwright-browsers.sh`.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-08 @ 4d0794a

## Status
Accepted — 2026-10-08. Implemented, not yet exercised on a real CI run ([KI-37](../KNOWN_ISSUES_ACTIVE.md)).

## Context
Run 37669596623: two of six formFields jobs hung 3 h in `playwright install --with-deps` (zero tests) and were cancelled by the job timeout. The workflow's shard check only annotated, so the email read `PASSED / Excellent / 277 tests` and history recorded build #189 as a normal run. Evidence: [sharding-and-locks.md](../known-issues/sharding-and-locks.md) 2026-10-07 entry.

## Decision
- The completeness check writes `reports/<env>/shard-completeness.json` and always exits 0. Failing the step would skip the merge, leaving only a "report not available" email, and would not help the reset or notify path. Visibility comes from the annotation, the email and history.
- Verdict: `reported < expected` forces `blocked`/danger "Incomplete Run — N of M shards reported" (checked before every other verdict), a top-of-email banner, and `INCOMPLETE RUN` in the subject.
- History: the record is written but marked `incomplete`; readers exclude it and the email gets an empty delta file. Chosen over skipping the write so the ledger keeps an audit line.
- Absent/garbled JSON = no information, not "complete".
- Install: `install-playwright-browsers.sh` (3 x 180 s attempts, backoff, apt connection timeouts) under a 10-minute step timeout, in every workflow with the step. `timeout-minutes` of the jobs is unchanged.

## Consequences
- A partial run is loud in three places and cannot pollute trends or recurring counts.
- Health score and counts are still displayed for the shards that reported.
- A slow-but-healthy install over 180 s costs an attempt; three such attempts fail the job (measured healthy maximum: 129 s).
- qa/stage/main gained a `plan` dependency in `merge-and-report`.

## How to revert
See the Revert line of the 2026-10-07 entry in `sharding-and-locks.md`.

## Commit(s)
Not committed yet.
