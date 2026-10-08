# ADR 0002 — Carve formFields out of count-based sharding

> **Purpose:** Records why formFields tests run in a fixed per-entity matrix, never through the generic shard split.
> **Read when:** You are changing shard planning, a sharded workflow, or adding a shared-config feature.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-08 @ 2576128

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

## Amendment — 2026-10-07 (sandbox selective runs)
The carve-out originally covered only the escalated run (planner exclusion). A selective sandbox run that selected formFields paths still ran them as one job (run 37658909999: 417 tests, one machine). The carve-out now applies to every way formFields is selected: `split-formfields-target.sh` strips the same path prefixes from the scoped target and the per-entity matrix runs all 6 entities; `run-tests` is skipped if nothing else is selected. Detail: [sharding-and-locks.md](../known-issues/sharding-and-locks.md). Revert: see that entry.

## Amendment — 2026-10-08 (sandbox runs only the selected entities)
Run 37753304635 changed only `ProductsAndServicesPage.ts` yet moved all 417 formFields tests to the 6-entity matrix. Sandbox now selects entities: `detect-tests.sh` maps entity spec/lock files to their entity, and page objects/factories to the entities whose formFields specs import them (derived from the real imports, Option B); shared files and escalated runs select all. The matrix and the expected blob count use the selected list; each shard still runs its entity's UI + RBAC pair together, and the lock is per entity with dedicated fields, so a subset only removes concurrent participants. `qa.yml`, `stage.yml` and `main.yml` keep the fixed 6-entity matrix (their zero-latency hardcoded design is unchanged). The `@smoke` fallback still pulls 18 formFields tests into the scoped shard. Revert: restore the `sharedConfig` step and `formfields_entities_json: ${{ steps.sharedConfig... }}` in `sandbox.yml` and `FORMFIELDS_SHARDS=6`.
