# Build #240 fixture

Sandbox build #240 (GitHub Actions run 45630312674, 2026-11-25; 0 failed, 942 passed, 8 flaky, 1 skipped; the Playwright container on), rebuilt for the
offline replay (`scripts/lib/build240Fixture.ts`, parameterised `scripts/lib/build235Fixture.ts`; checks: `npm run check:build240`). **Only the run's email
was available** (no results.json, no run-meta), so unlike build-239 this fixture is reconstructed from the email.

| File | What it is | Real or reconstructed |
|---|---|---|
| `tests.json` | the 943 tests (module totals and spec files from build-239: the suite is the same), the 8 flaky tests with their errors and code frames, the skipped call-log test, the 5 slowest tests | titles, files, lines, error text, durations of the slowest five: **real** (from the email; DB22's card had no code frame, none is invented). The other tests are synthetic fillers. |
| `misc-errors.json` | background errors and 429 events | **reconstructed to the email's counts**: 209 = 72 unexpected (61 app-level, 11 infra 5xx) + 28 expected RBAC + 109 known noise; the groups follow the email's top eight (POST /v3/reports 500 x9, POST /v1/rules/triggers x5, ...); the 429 events per shard are the email's counts (99, 74, 74, 72, 13, 60, 55, 69, 52, 70, 61), all Sentry POSTs as in build #239 (the email cannot say the host). Hosts are the sanitised `*.example.test`. |
| `rerun-summary.real.json` | what the rerun step wrote: nothing rerun (no failed test, `RERUN_INCLUDE_FLAKY` off), the 8 flaky tests excluded | reconstructed from the email |
| `history-tail.jsonl`, `shard-completeness.json`, `field-config-reset.json` | copied from build-239 (the history ends at #239; the replay builds #240's own record) | real (history) / adapted |

Known differences from the real email: the feature head commit text is **sample text** (the fixture has no git history); job windows are to the minute
(IST minus 5 h 30 min); the by-module slowest lists use synthetic fillers beyond the top five. Nothing here is a secret or a customer record.
