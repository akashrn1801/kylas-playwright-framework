# Known Issues — Resolved History Index

> **Purpose:** Index of the resolved-incident topic files — one place to find "has this broken before, and what fixed it?" without loading all of them.
> **Read when:** a failure looks familiar, before re-investigating a flake, or before changing code a past incident touched. Read only the topic you need.
> **Size budget:** 6k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Open problems are NOT here — see [../KNOWN_ISSUES_ACTIVE.md](../KNOWN_ISSUES_ACTIVE.md). Each topic file uses the incident template in [../CONTRIBUTING_TESTS.md](../CONTRIBUTING_TESTS.md#size-policy) (symptom, root cause, fix, revert, commit) and rotates by period at 70% of its budget.

| Topic file | Covers | Read when |
|---|---|---|
| [session-expiry-and-auth.md](./session-expiry-and-auth.md) | session-expiry recovery architecture, URL normalization, credential leakage, cross-worker credential-file race | auth/`/signIn`/Forbidden symptoms, touching `AuthManager`/fixtures |
| [rate-limits-and-error-pages.md](./rate-limits-and-error-pages.md) | HTTP 429 "Too many requests" page, "Something is broken here" error boundary, `globalSetup` 429 retry | a screen replaced by an app error page mid-test |
| [sharding-and-locks.md](./sharding-and-locks.md) | 6-hour job ceiling and sharding, order-dependency audit, file-atomic planner, formFields cross-shard race, heartbeat lock, serial-block retry semantics, sequencing | CI shard/lock/concurrency questions |
| [ci-pipelines.md](./ci-pipelines.md) | Jenkins timeouts and branch selection, duration estimate, `wrongPage` landing, ellipsis toggle, Quotation report entity gap | a pipeline-shaped failure |
| [reporting-and-notifications.md](./reporting-and-notifications.md) | history ledger, suite drift, verdicts, email correctness, load signals | an email or history figure looks wrong |
| [locators-and-timing.md](./locators-and-timing.md) | navigation drift, random-option hangs, locator collisions, ID capture, sandbox build batches | a timeout/locator failure in a page object |
| [products-and-services.md](./products-and-services.md) | Products & Services quirks, deliberate deviations, fixtures, CKEditor, Units | anything under `/setup/products-services` |
| [reports-module.md](./reports-module.md) | Reports run-count verification, API-based totals, IST window | `ReportsPage`, report-count tests |
| [dashboard-module.md](./dashboard-module.md) | dashlet wizard, disposable dashboards, primary dashboard rules | `DashboardPage`, dashboard specs |
| [form-fields.md](./form-fields.md) | Form Field Limit rollout, shared config helpers, minimal-fill, layoutCache | formFields specs, `FormFieldsConfigPage` |
| [rbac-and-test-isolation.md](./rbac-and-test-isolation.md) | RBAC isolation incidents, retracted app bugs, Hide-Empty-Fields per-module table | RBAC test design or a surprising permission result |

`src/notifications/KnownIssuesIndex.ts` reads every file in this folder (except this index) to attach "Related history" links to failures in the CI email — keep exact short error strings and `Class.method()` names in backticks.
