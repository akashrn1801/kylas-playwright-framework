# ADR 0006 — Serial mode per sub-block, not per file

> **Purpose:** Records where test.describe.configure serial is used in formFields specs and why it is scoped narrowly.
> **Read when:** You are adding .serial to a describe block or wondering why a serial block reran passing tests.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-10-05. Refines decisions of 2026-09-29.

## Context
Playwright serial mode retries the whole block from the top when any test fails, re-running tests that already passed, and skips every remaining test after a failure. A whole-file serial block was removed once (skip cascade, honest retry counts), then restored the same day when the cross-shard race proved the lock alone insufficient: `.serial` is the only thing keeping a block in one shard-distribution group. A single whole-file block still made one failure cascade across unrelated fields.

## Decision
Use `test.describe.configure({ mode: 'serial' })` on each field-mutating sub-block: per field-type/category (Text, Number, Paragraph, Regex, dual-fixture, Cache, Cleanup) in the UI files and per-category in the RBAC files. The read-only, lock-free block stays parallel. `.serial` is defence in depth; the structural guarantee is ADR 0002.

## Consequences
- A failure retries and skips only its own sub-block; reported retry counts are inflated by swept tests (the parser splits genuine from swept retries, see [reporting-and-notifications](../known-issues/reporting-and-notifications.md)).
- Any new order-dependent tests must be wrapped in `.serial`; the file boundary gives no protection under sharding.

## How to revert
Remove the per-block `configure` calls. Without ADR 0002 enforced, doing so allows UI and RBAC files to interleave.

## Commit(s)
`9e35fc1` (removed whole-file), `6ec6e3f` (restored), `b90a885` (per-category RBAC blocks).
