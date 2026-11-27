# ADR 0019 — Capacity gate: read the account's limits once before any test, stop at 0 records left

> **Purpose:** Records why the run reads `GET /v1/tenants/usage` in `globalSetup`, what stops a run and what only warns, and why the plan and the records pool are judged as they are.
> **Read when:** Changing `src/modules/billing/capacity.ts`, the gate's call in `src/auth/globalSetup.ts`, or the "Account capacity" figures in the run email.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-11-26 @ 3c48a02

## Status
Accepted — 2026-11-26 (owner decision). In the code; proven on QA (live gate "ok", snapshot written) and offline (`npm run check:capacity-gate`, 35 checks). Stop and warn paths are proven offline only.

## Rule
Before any test, `globalSetup` makes ONE read-only `GET /v1/tenants/usage` as admin (429/5xx retried, a real 4xx is not) and saves a snapshot to `test-results/<env>/capacity/capacity-pre-run.json` (`test-results/capacity/` on CI).

## Decisions
- **Stop** the run when `records.remaining <= 0`, or when the call fails. An unknown capacity is not "fine"; at 0 Kylas answers every create with its "Upgrade your plan" modal (KI-76), which once failed 57 tests far from the cause.
- **Warn** (loud log lines and the snapshot, the run goes on) for: records under the per-environment threshold (`config.billing.recordsWarnBelow`, 10,000), Custom Fields under 10 left (never stops), a plan other than `config.billing.expectedPlan` (Elevate on every environment; shown with its record limit).
- **Records are one shared pool** (`records.used` = sum of `entityCounts`, one total); there is no per-entity limit, so the gate has no per-entity floor.
- **A run that only reads warns instead of stopping** (amendment 2026-11-26), both at 0 records left and when the usage call fails: the snapshot says `readOnlyRun`, a failed call leaves `capacity-gate-error.json`. "Only reads" is decided from the command line (`selectionIsReadOnly`): `--grep @prodSafe` exactly (prod.yml, Jenkinsfile.prod), or every file filter a billing spec. Anything else, including an ambiguous command line, keeps the stop.
- The gate runs **before the product fixtures**, which create records, so a full account stops before anything is created.
- The rules are pure (`evaluateCapacity`, `capacityColour`) so the email reuses the same green, yellow and red rule.

## The email (amendment 2026-11-26, piece 3)
- Each shard writes its pre-run snapshot (gate), a post-run reading (`src/auth/globalTeardown.ts`, never fails a run) and, if the call failed, an error marker, to `test-results/capacity/`, uploaded as the small artifact `capacity-<env>-<shard>` (3 days). `merge-and-report` downloads them into `reports/<env>/capacity/`; no admin credentials reach that job. dev and prod are single-job runs and read `test-results/capacity/` directly.
- The email takes the EARLIEST pre-run snapshot and the LATEST post-run reading: plan name, billing period and renewal with days left (yellow within 14 days, red when past or when the plan is not the expected one), the records pool, Custom Fields and Storage as coloured bars (Storage yellow under 10% left), used records per entity, and the change during the run, labelled as possibly including other activity. The warnings sit near the top.
- A gate stop makes the email BLOCKED (verdict, subject, no health score), also when no report exists; a missing snapshot renders one "capacity data unavailable" line.
- The plan **price is left out**: it is not in the API and the gate opens no browser. Period and currency come from `GET /v1/tenants/subscription-details` (one more read-only call per shard, never fatal).

## Billing figures lag creates (amendment 2026-11-26)
- Kylas counts a **delete** in the billing record count at once but a **create** only at its nightly refresh, so post minus pre of `GET /v1/tenants/usage` shows deletions only. The email therefore labels every billing figure "as of the last refresh" and no longer shows a billing "change during the run".
- **Created during the run** = the live total after minus the live total before, per entity, from one small list search per entity (`src/modules/billing/liveCounts.ts`: lead, deal, contact, company, task, meeting, call log, quotation, note), read by the gate and the teardown and saved in the same snapshots. Nine sequential read-only POST searches of size 1 (about 1.5 s) each time; a 429 or 5xx stops the rest. Skipped on a read-only run. The live totals are not comparable with the billing counts (see KI-77), only with themselves; the search index can lag, so the figure is labelled as possibly including other activity or missing records still being indexed.
- "Expected after the next refresh: about N" = records left (billing) minus created; "at most" when some entities could not be read.
- The refresh time shown is `usage.updatedAt` only when it can be one (not after the reading and not equal to `renewalAt`); on QA it equals `renewalAt`, so the label carries no time (KI-77).
- The gate's stop stays on the **billing** figures: that is what Kylas enforces.

## Consequences
A run that creates records on a full or unreadable account stops at globalSetup; the read-only prod selection only warns. Each CI shard runs the gate and the teardown once: three read-only GETs plus 18 small searches (9 at each end) on a run that creates records; 3 GETs on a read-only run; a few KB of artifact.
