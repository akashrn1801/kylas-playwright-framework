# Architecture Decision Records — index

> **Purpose:** Index of ADRs and the template to write a new one.
> **Read when:** You made or reversed a design decision (Definition of Done step 4).
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-08 @ 4d0794a

One page per decision, max about 3.5k chars. Never edit an accepted ADR's decision silently: add a new ADR and mark the old one Superseded.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-dedicated-custom-fields.md) | Dedicated custom field per consumer | Accepted |
| [0002](0002-formfields-carve-out-from-sharding.md) | formFields carved out of count-based sharding | Accepted |
| [0003](0003-file-atomic-shard-planner.md) | File-atomic shard planner | Accepted |
| [0004](0004-design-b-rbac-split.md) | UI file admin-only, RBAC file holds restricted tests | Accepted |
| [0005](0005-heartbeat-based-lock.md) | Heartbeat + FIFO cross-process lock | Accepted |
| [0006](0006-serial-sub-blocks.md) | Serial mode per sub-block | Accepted |
| [0007](0007-sequence-formfields-after-core.md) | formFields runs after core shards | Accepted |
| [0008](0008-error-page-recovery.md) | Error-page recovery at call sites (+ proposed centralization) | Accepted / Proposed |
| [0009](0009-field-config-reset-and-account-lock.md) | Post-run dedicated-field reset + per-account workflow lock | Accepted (never run) |
| [0010](0010-incomplete-run-handling-and-bounded-install.md) | Incomplete runs never green; bounded browser install | Accepted (never run) |

## Template
```
# ADR NNNN — <title>
(header block: Purpose / Read when / Size budget / Last verified)
## Status        Accepted | Superseded by NNNN | Proposed — <date>
## Context       the forces and evidence, citing real files
## Decision      what was chosen
## Consequences  good and bad, including what it costs
## How to revert exact steps
## Commit(s)     hashes
```
