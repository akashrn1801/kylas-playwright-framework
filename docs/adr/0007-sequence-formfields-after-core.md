# ADR 0007 — Run formFields after the core shards

> **Purpose:** Records why the formFields track starts only after the core shards finish.
> **Read when:** You are changing job ordering or concurrency in qa/stage/main/sandbox workflows.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-10-06.

## Context
The carve-out ([ADR 0002](0002-formfields-carve-out-from-sharding.md)) made core shards and the six formFields shards start together, so about ten jobs each ran `globalSetup` (two logins plus product-fixture creation) against one backend within seconds; one job got HTTP 429 before any test ran. A bounded retry now absorbs that, but peak concurrency was still the driver of 429 and app error-page failures ([ADR 0008](0008-error-page-recovery.md)).

## Decision
`run-formfields-tests` declares `needs: [run-tests]` (sandbox: `[detect, run-tests]`) and `if: ${{ !cancelled() }}`. `needs` alone would apply the implicit `success()` and skip formFields after any core failure; `!cancelled()` runs it after run-tests ends in any result. Sandbox keeps its `run_formfields_track == 'true'` gate. `merge-and-report` already needs both jobs. In the same commit, product fixtures are created in `globalSetup` only when the invocation may run a Products & Services spec (`src/auth/productFixtureNeed.ts`), and per-shard load signals are recorded for the email.

## Consequences
- Wall-clock is roughly the sum of both tracks instead of the max (about 1.75-2x for qa/stage/main/escalated sandbox); per-job timeouts are unaffected since waiting on `needs` is not counted.
- `main.yml` jobs carry `environment: production`; if that environment has required reviewers, formFields now raises a second approval prompt after core finishes.
- Cross-workflow overlap is untouched (no `concurrency:` guards; see [KNOWN_ISSUES_ACTIVE](../KNOWN_ISSUES_ACTIVE.md)).
- Not verified by a real run; `actionlint` validates syntax only.

## How to revert
Delete the `needs` and `if` lines (and their WHY comments) from `run-formfields-tests` in `qa.yml`, `stage.yml`, `main.yml`, `sandbox.yml`.

## Commit(s)
`1bd03cc`.
