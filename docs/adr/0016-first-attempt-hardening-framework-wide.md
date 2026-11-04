# ADR 0016 — First-attempt hardening: measure first, real ready signals, no hidden retries

> **Purpose:** Records the decisions of the 2026-11 framework-hardening work (batches B0–B8) so each batch adds to one place; extends [ADR 0014](0014-definitive-errors-and-ready-signals.md) without changing it.
> **Read when:** Changing waits, retries, login/session handling or the measurement settings listed below.
> **Size budget:** 12k chars (hard cap 60k)
> **Last verified:** 2026-11-04 @ 4c10d24

## Status
Proposed — 2026-11-04. Batch B0 (measurement) done locally; the rest are listed in "Planned" and not implemented.

## Decisions (B0)
- **A test that passes on retry or on the rerun shard is a framework/test problem** until a network log proves a backend error on the exact request; even then the load is reduced, the failure is not hidden.
- **`RETRY_COUNT=0` is honoured** (`config/config.ts`). Before, `|| 1` turned 0 into 1, so a first-attempt baseline could not be measured. Unset or invalid still gives 1; CI never sets 0, so CI behaviour is unchanged.
- **Waits name themselves.** A response-wait timeout in `armResponseWaitWithRecovery` now says what it awaited, how long it waited and the limit; `waitForListReady` logs which signal ended the wait (`list response`, `list table visible`, `rate-limit page`) and after how many ms. Messages and logs only: no timeout, retry or outcome changed.
- **The staging baseline is the sandbox run** (10 workers, `--retries=0`). QA did not reproduce the failures (37 of 37 first-attempt passes before the local run was stopped), so no local staging or throttle run is made.

## Planned (decided in the plan, not yet implemented; each moves to Decisions when done)
- S1 session validated by one API call per role in globalSetup only; S2 login semaphore (≤2 per env), a login 400 "Database error" is definitive; S3 staggered formFields/core starts (workflow change, needs the owner's OK).
- New retries only for reads/idempotent calls and only per ADR 0014 §1 (transport, 429, 5xx; never 400); the three existing create retries stay.
- `saveAndAwait` and `clickWhenReady` helpers; fixed sleeps replaced by the app's own signal; CO12 as in the plan (no reload workaround, fail fast with the app error).
