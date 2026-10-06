# ADR 0005 — Heartbeat-based cross-process lock with FIFO fairness

> **Purpose:** Records how the formFields cross-process lock judges abandonment and orders waiters.
> **Read when:** You are touching formFieldLockFactory.ts or adding another cross-process coordination mechanism.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-09-29.

## Context
Tests that mutate the shared field config must not run concurrently on one machine (`tests/ui/formFields/formFieldLockFactory.ts`, per-entity scope). Early versions failed in several ways: staleness measured from a waiter's own polling counter instead of the lock's age, blind removal letting two waiters destroy each other's acquisition, a threshold set above the test timeout so one hung test starved the rest, and no fairness so quick tests out-raced a waiter indefinitely. See [sharding-and-locks](../known-issues/sharding-and-locks.md).

## Decision
- The holder rewrites a `heartbeatAtMs` timestamp every 10 s; a waiter treats the lock as abandoned only when the heartbeat itself stops for the stale window (90 s), never because the lock is merely old.
- Waiters take a FIFO queue ticket and only the front ticket may acquire; tickets are refreshed while waiting and pruned after 30 s without refresh, via an atomic rename-claim.
- The lock is an `auto: true`, test-scoped fixture wrapping the test body, acquired only by tests that mutate the config (read-only tests use the plain fixture).

## Consequences
- A slow but live test is never evicted; a crashed holder is recovered within the stale window.
- The lock protects workers on the same filesystem only. Cross-machine safety comes from ADR 0001 and ADR 0002.
- `afterAll` hooks cannot receive test-scoped fixtures, so config mutation in `afterAll` is unprotected; keep it out.

## How to revert
Not advised. A fixed-age check was tried and is the origin of the starvation incidents.

## Commit(s)
`b9b88d7` (lock factory with heartbeat and tickets). Scoping to mutating tests: `bf32201`.
