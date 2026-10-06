# ADR 0004 — Design B: UI file admin-only, RBAC file holds restricted tests

> **Purpose:** Records the split between UI and RBAC spec files for Form Field Limits (and the convention elsewhere).
> **Read when:** You are deciding which spec file a restricted-role test belongs in.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-09-28.

## Context
Form Field Limit coverage per entity needs admin configuration tests, restricted-user access-boundary tests, and dual-fixture tests (admin configures, restricted verifies). Mixing roles in one file blurred ownership of the shared field config and made lock classification (mutating vs read-only) harder to read.

## Decision
- `tests/ui/formFields/<entity>FieldLimits.spec.ts`: admin-role tests only, zero `restrictedPage` use.
- `tests/rbac/formFields/<entity>FieldLimits.rbac.spec.ts`: every restricted-role test, including purely single-role functional ones, plus the dual-fixture tests.
- Baseline RBAC shape per entity: three access-boundary tests (list visible, no "Add Field" button, row not clickable; never navigate to the individual edit URL, see [PATTERNS](../PATTERNS.md)) plus four admin-configures/restricted-verifies tests.
- Lead was built first with its own restricted tests in the UI file and retrofitted to this shape once the other five entities proved it.

## Consequences
- A reader can tell from the file name which roles a test uses; lock-wrapped (mutating) and plain (read-only) tests are classified per test inside each file.
- Both files for an entity share one dedicated-field set only if ADR 0001 is violated; keep them on separate fields.
- Cross-file ordering is not guaranteed; never rely on one file leaving state for the other.

## How to revert
Move restricted tests back into the UI file. Requires re-checking lock classification and shard co-location (ADR 0002 still applies).

## Commit(s)
`b9b88d7` (introduced, Lead retrofit noted in `tests/rbac/formFields/leadFieldLimits.rbac.spec.ts`).
