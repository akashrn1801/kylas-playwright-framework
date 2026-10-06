# Glossary

> **Purpose:** One-line definitions of terms used across the docs, with a pointer to where each is explained.
> **Read when:** A doc or log uses a term you do not recognise.
> **Size budget:** 15k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

| Term | Meaning |
|---|---|
| **ADM / SHR** | Factory data prefixes + timestamp: `ADM` = admin-only record (restricted user must not see it); `SHR` = record created to be shared. [ARCHITECTURE §7](./ARCHITECTURE.md) |
| **adminPage / restrictedPage** | Fixtures giving an authenticated page for the full-access ("Playwright Automation") or limited ("User 1") user. [ARCHITECTURE §4](./ARCHITECTURE.md) |
| **armResponseWaitWithRecovery()** | `BasePage` helper that arms a `waitForResponse()` before a click with session-expiry-aware recovery. [PATTERNS P14](./PATTERNS.md) |
| **baseTest** | Plain `test` from `src/fixtures/index.ts`, used by lock-free read-only formFields tests (vs the lock-wrapped `test`). |
| **Design B** | RBAC split convention: UI spec admin-only; all restricted-role tests in the RBAC spec. [ADR-0004](./adr/0004-design-b-rbac-split.md) |
| **ErrorCollector buckets** | Noise (dropped), Expected RBAC, Known background noise; anything else is "unexpected". [ARCHITECTURE §9](./ARCHITECTURE.md) |
| **Expected RBAC** | An error the CRM raises when correctly denying the restricted user (422/`029003`, Products 403/`00902001`). Counted, never a regression. |
| **file-atomic planner** | `scripts/plan-shards.ts`: bin-packs whole spec files into shards, never splitting a file. [ADR-0003](./adr/0003-file-atomic-shard-planner.md) |
| **formFields track / matrix** | The Form Field Limit suites, run in a fixed one-shard-per-entity CI job separate from the planner's shards. [ADR-0002](./adr/0002-formfields-carve-out-from-sharding.md) |
| **Form Field Limits** | Admin-configurable min/max length and Regex format on custom fields (`/setup/fields/<entity>/list`) — shared, account-wide config. |
| **heartbeat lock** | Cross-process lock whose staleness is judged by the holder's refreshed heartbeat timestamp, with FIFO fairness tickets. [ADR-0005](./adr/0005-heartbeat-based-lock.md) |
| **Internal name vs label** | Custom-field `cfTextField` (immutable) vs display text (admin-editable); locators use the internal name. [PATTERNS P21](./PATTERNS.md) |
| **Known background noise** | Narrow, live-confirmed list of background endpoints whose 4xx/5xx never correlates with a failure. |
| **minimal-fill** | `{ minimal, onlyCustomField }` form-fill options isolating one field's validation. [PATTERNS P43](./PATTERNS.md) |
| **NavOutcome** | Fixture landing classification: `sales`, `signIn`, `wrongPage`, `timeout`. [ARCHITECTURE §4](./ARCHITECTURE.md) |
| **@prodSafe / @smoke / @regression** | Tags. `@prodSafe` = read-only, safe on production; `@smoke` = navigation/happy path; `@regression` = full functional + RBAC. |
| **promote branch** | Per-hop branch (`feature/promote-…-to-<env>-…`) cut from the previous promote branch to PR into the next environment branch. [README](../README.md) |
| **sandbox** | Pre-PR branch whose workflow runs only what a change plausibly affects (`detect-tests.sh`), escalating to full `@regression` for core changes. [CI_PIPELINES](./CI_PIPELINES.md) |
| **scope** | Normalized run category (`regression`, `smoke`, or `modules:…`) derived from a run's own tests; history comparisons require same branch + scope. [REPORTING](./REPORTING.md) |
| **serial block** | `test.describe.configure({ mode: 'serial' })`: ordered, atomic under sharding; one failure re-runs the whole block. [ADR-0006](./adr/0006-serial-sub-blocks.md) |
| **shard** | One parallel CI job running a subset of spec files. Core shards come from the planner; formFields shards are fixed. |
| **shared-config suite** | A suite mutating one account-wide config; registered in `config/sharedConfigSuites.json`, excluded from the planner. |
| **stability window** | After opening a react-select menu, require it to survive a short period before trusting it. [PATTERNS P13](./PATTERNS.md) |
| **storage state** | `src/auth/storageStates/<env>/<role>.json` — saved login (JWT in `localStorage`). |
| **Suite Drift** | Email alert when a run has fewer tests than the previous comparable (same branch+scope) run. [REPORTING](./REPORTING.md) |
| **swept retry** | A test that already passed but re-ran because its serial block retried; counted separately from genuine retries. |
| **withRateLimitRecovery()** | Combinator recovering from the app's 429 page and error-boundary page by reload-and-retry once. [ARCHITECTURE §6](./ARCHITECTURE.md) |
| **withSessionExpiryRecovery() / withSessionExpiryRetry()** | Combinators recovering a single assertion / a whole workflow from an expired session. [ARCHITECTURE §6](./ARCHITECTURE.md) |
| **withTransientRetry()** | `globalSetup.ts` helper retrying 429/5xx only. |
