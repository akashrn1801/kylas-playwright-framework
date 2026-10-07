# ADR 0003 — File-atomic shard planner

> **Purpose:** Records why rest-of-suite shards come from scripts/plan-shards.ts instead of Playwright's --shard.
> **Read when:** You are changing how tests are split across CI shards.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-09-29. Supersedes the fixed 4-way `--shard` split of 2026-09-09.

## Context
GitHub-hosted jobs are killed at a hard 6-hour limit; the full suite at `--workers=2` exceeded it, so sharding was required. Playwright's `--shard=N/M` slices the discovered test list by count with no awareness of file boundaries, so one spec file could straddle shards and the shard count was a hand-typed constant.

## Decision
`scripts/plan-shards.ts` runs `playwright test --list`, drops shared-config files (ADR 0002), and bin-packs whole spec files first-fit-decreasing into bins of a tests-per-shard budget derived from measured throughput. It emits `shard_total` / `shards_json` / `test_count`; workflows consume `matrix.shard.files` and run exactly those files. Shard count therefore scales with suite size. In `sandbox.yml` only the escalated `--grep @regression` path calls the planner; small selective runs keep a single job.

## Consequences
- A file is never split; shard count is computed, not typed. Current plan is generated into [CI_PIPELINES](../CI_PIPELINES.md).
- Two files that must co-locate are not guaranteed to (hence ADR 0002 for the shared-config case).
- The planner needs `--list` to succeed in the `plan` job; a failure there skips the core shards.

## How to revert
Replace the `matrix.shard.files` consumption with `--shard=${{ matrix.shard.shardId }}/${{ needs.plan.outputs.shard_total }}` and restore a fixed shard list. Accepts the file-splitting risk.

## Commit(s)
`bf32201` (planner). Earlier fixed sharding: `cd22b91`, `8e96dc8`.
