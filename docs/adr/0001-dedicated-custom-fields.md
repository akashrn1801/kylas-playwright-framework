# ADR 0001 — Dedicated custom field per consumer

> **Purpose:** Records why each Form Field Limit consumer gets its own custom field instead of sharing one.
> **Read when:** You are about to let two tests, files or entities configure the same account-wide field.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

## Status
Accepted — 2026-09-28.

## Context
Form Field Limit tests mutate a global, account-wide field configuration (min/max length, Regex format) through `src/modules/formFields/FormFieldsConfigPage.ts`. Originally several tests and both the UI and RBAC file of an entity configured the same `cf*` field. Under sharding, files land on different machines, so two tests mutated one field at once and read back each other's state (see [sharding-and-locks](../known-issues/sharding-and-locks.md)). A cross-process file lock cannot help across machines.

## Decision
Remove the shared resource. Each consumer (UI file, RBAC file, per entity) gets its own dedicated custom field, named in that entity's factory (`src/data/factories/<entity>Factory.ts`) and consumed by the matching page object. No coordination is then needed between consumers.

## Consequences
- Collisions between UI and RBAC files of one entity, and between entities, cannot occur by construction.
- Environments need the dedicated fields created by hand in the app (they are environment-conditional; page-object helpers presence-check and skip, never throw).
- The per-entity lock and the carve-out ([ADR 0002](0002-formfields-carve-out-from-sharding.md)) remain as defence for fields still shared inside one file.
- Custom field internal names are permanent; a deleted-and-recreated field breaks every locator built on the old name.

## How to revert
Point the factory constants back at the shared field name. Not recommended: it reintroduces the cross-shard race unless ADR 0002 is also fully enforced.

## Commit(s)
`ab06f5e` (dedicated fields). Feature origin: `b9b88d7`.
