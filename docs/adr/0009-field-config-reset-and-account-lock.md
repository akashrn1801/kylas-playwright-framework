# ADR 0009 — Post-run dedicated-field reset and per-account workflow lock

> **Purpose:** Records why CI now resets the dedicated form-field limits after each run and serialises workflows per Kylas account.
> **Read when:** Touching `scripts/reset-field-config.ts`, the `reset-field-config` job, the `concurrency:` blocks, or the email's field-reset line.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-07 @ 2fa56be

## Status
Accepted — 2026-10-06. Implemented, never run against a real app or a real CI run; see the open items in [KI-34](../KNOWN_ISSUES_ACTIVE.md#ki-34--field-config-reset-job-and-concurrency-groups-never-run-github-behaviours-unconfirmed).

## Context
- formFields tests mutate account-wide field config. A killed/cancelled run or a failed `afterAll` can leave limits on the dedicated fields (`cfFormFieldLimit{Text,Number,Paragraph}` x 6 entities = 18 fields). Stale limits break the *next* formFields run ([RUNBOOK](../RUNBOOK.md) row "no create request was observed").
- Grep scope check (2026-10-06): the old shared fields (`cfTextField`, `cfNumber`, `cfParagraphText`) are never passed to any limit/regex mutator; every mutator call takes a `*_FIELD_INTERNAL_NAME` built from a `*_FORM_FIELD_LIMIT_NAMES` constant, and all 12 importers of those six constants are under `tests/{ui,rbac}/formFields/`. Core tests therefore cannot be affected by leftovers.
- Workflows of one account could overlap (old KI-10: no `concurrency:` on any workflow), and the local file lock only coordinates processes on one machine ([ADR 0005](0005-heartbeat-based-lock.md)).

## Decision
- `scripts/reset-field-config.ts` (`npm run reset:field-config -- --env <env> [--dry-run] [--confirm-prod]`): resets only the 18 dedicated fields via `FormFieldsConfigPage.clearFieldConfiguration()`, verifies each from a fresh page load, writes `reports/<env>/field-config-reset.json`. Exit 1 = a field could not be reset/verified; 2 = usage error. `--dry-run` is read-only.
- CI job `reset-field-config` in `qa.yml`, `stage.yml`, `main.yml`, `sandbox.yml`: `needs` both test tracks, `if: always()`, job- and step-level `continue-on-error`, step always exits 0, artifact `field-config-reset-<env>`. `merge-and-report` needs it.
- Workflow-level `concurrency:` per account, `cancel-in-progress: false`: `kylas-qa` (`qa.yml`), `kylas-staging` (`stage.yml`, `sandbox.yml`), `kylas-prod` (`main.yml`, `prod.yml`). `dev.yml` untouched.
- The email gets one informational line (`FieldConfigReset.ts`, `buildFieldConfigResetSection`). It never changes verdict, health score or counts.

## Consequences
- Good: a bad end state is restored and reported; overlapping runs on one account queue instead of interleaving.
- Cost: `merge-and-report` (so the email) waits for the reset job, up to the 35-minute job timeout if it hangs. Timeouts (25-minute step, 35-minute job) and the retry values inherited from `globalSetup` are guesses, not measured.
- Cost: GitHub keeps one pending run per group; a newer pending run cancels it. A pending `stage` push can be displaced by a `sandbox` push (`sandbox.yml` has no `workflow_dispatch`).
- Not covered: Jenkins jobs on the same accounts; `staging-promotion-gate.yml` (not inspected, in no group).
- A field absent in an environment is reported as a failure, not skipped (to be checked on the first dry-run).

## How to revert
Delete the `reset-field-config` job and its `needs` entry/download step in `merge-and-report` in the four workflows, the `concurrency:` blocks in five, `src/notifications/FieldConfigReset.ts` plus its use in `NotificationService.ts`/`EmailTemplate.ts`, the `reset:field-config` script in `package.json` and `scripts/reset-field-config.ts`. `NO_REGEX_OPTION_LABEL` in `FormFieldsConfigPage.ts` can stay exported.

## Commit(s)
Not committed yet (branch `feature/dedicated-field-reset-20261006`).
