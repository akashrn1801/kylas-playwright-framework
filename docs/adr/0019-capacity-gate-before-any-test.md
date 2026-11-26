# ADR 0019 — Capacity gate: read the account's limits once before any test, stop at 0 records left

> **Purpose:** Records why the run reads `GET /v1/tenants/usage` in `globalSetup`, what stops a run and what only warns, and why the plan and the records pool are judged as they are.
> **Read when:** Changing `src/modules/billing/capacity.ts`, the gate's call in `src/auth/globalSetup.ts`, or the "Account capacity" figures in the run email.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-11-26 @ bfc345c

## Status
Accepted — 2026-11-26 (owner decision). In the code; proven on QA (live gate "ok", snapshot written) and offline (`npm run check:capacity-gate`, 23 checks). Stop and warn paths are proven offline only.

## Rule
Before any test, `globalSetup` makes ONE read-only `GET /v1/tenants/usage` as admin (429/5xx retried, a real 4xx is not) and saves a snapshot to `test-results/<env>/capacity/capacity-pre-run.json` (`test-results/capacity/` on CI).

## Decisions
- **Stop** the run when `records.remaining <= 0`, or when the call fails. An unknown capacity is not "fine"; at 0 Kylas answers every create with its "Upgrade your plan" modal (KI-76), which once failed 57 tests far from the cause.
- **Warn** (loud log lines and the snapshot, the run goes on) for: records under the per-environment threshold (`config.billing.recordsWarnBelow`, 10,000), Custom Fields under 10 left (never stops), a plan other than `config.billing.expectedPlan` (Elevate on every environment; shown with its record limit).
- **Records are one shared pool** (`records.used` = sum of `entityCounts`, one total); there is no per-entity limit, so the gate has no per-entity floor.
- The gate runs **before the product fixtures**, which create records, so a full account stops before anything is created.
- The rules are pure (`evaluateCapacity`, `capacityColour`) so the email reuses the same green, yellow and red rule.

## Consequences
A run on a full or unreadable account stops at globalSetup, prod included. Each CI shard runs the gate once, so a sharded run makes one extra GET per shard and writes one snapshot per shard; the email step takes the earliest.
