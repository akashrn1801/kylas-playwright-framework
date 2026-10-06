# ADR 0002 — Carve formFields out of count-based sharding

> **Purpose:** Records why formFields tests run in a fixed per-entity matrix, never through the generic shard split.
> **Read when:** You are changing shard planning, a sharded workflow, or adding a shared-config feature.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-09-29.

## Context
A cross-process file lock (`tests/ui/formFields/formFieldLockFactory.ts`, `fs.mkdirSync`-based) only coordinates workers on one filesystem. Each GitHub Actions shard is its own VM. With Playwright's count-based `--shard=N/M`, an entity's UI and RBAC files landed on different shards and mutated the same account-wide config concurrently, producing genuine failures (not flakes). `fullyParallel: true` also gives no same-file shard guarantee; only `.serial` keeps a block atomic. Details: [sharding-and-locks](../known-issues/sharding-and-locks.md).

## Decision
- formFields files are excluded from the generic planner ([ADR 0003](0003-file-atomic-shard-planner.md)) by reading `config/sharedConfigSuites.json` (never a CLI flag).
- Every sharded workflow (`qa.yml`, `stage.yml`, `main.yml`, `sandbox.yml`) runs a separate `run-formfields-tests` job with a fixed matrix: one shard per entity, running that entity's UI and RBAC files together.
- `scripts/check-formfields-matrix-sync.ts` fails if a workflow matrix disagrees with `config/sharedConfigSuites.json` (kept as a check, not a dynamic `needs: plan`, to avoid adding latency).
- Execution order of the two tracks: [ADR 0007](0007-sequence-formfields-after-core.md).

## Consequences
- The pair can never be split across machines, regardless of shard count.
- The matrix does not self-scale: a larger entity can only be relieved by splitting that entity's shard by hand (open item in [KNOWN_ISSUES_ACTIVE](../KNOWN_ISSUES_ACTIVE.md)).
- A new shared-config feature must be registered in `config/sharedConfigSuites.json` and in each workflow matrix.

## How to revert
Empty `config/sharedConfigSuites.json`, delete `run-formfields-tests` from the four workflows. Reverting without ADR 0001 restores the race.

## Commit(s)
`6ec6e3f` (carve-out). Config + sync check: `3d58073`.
