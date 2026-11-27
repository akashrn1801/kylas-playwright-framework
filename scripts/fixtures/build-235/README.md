# Build #235 fixture

Sandbox build #235 (GitHub Actions run 45122485029, 2026-11-23) as a small, committed fixture, so the email can be replayed and
tested offline without the 948 MB report artifact (mostly traces, expires after 7 days).

Used by `scripts/lib/build235Fixture.ts` (the replay), `scripts/render-build235.ts` (writes the HTML and prints its size) and
`npm run check:build235`.

| File | What it is | Real or synthetic |
|---|---|---|
| `tests.json` | the 943 tests: per module its total (34 modules), plus the 108 named tests: the 10 failed/flaky tests with their real errors, code frames, stacks and attachment paths, the 97 slowest-per-module tests with their real durations, the 1 skipped test | module totals, named tests, errors, durations: **real** (from the run's email). The other 835 tests are **synthetic fillers** (`<module> check NN`, passed, 10 s). Line numbers of 6 of the 10 cards, per-attempt durations of the failing attempts and the spec file of each module are reconstructed. |
| `misc-errors.json` | the run's `misc-errors.json` (158 errors, 11 shard entries) | real; the non-production host names are replaced by `api.example.test` / `app.example.test` (`check:public-safe`) |
| `rerun-summary.original.json` | the run's own `rerun-summary.json`, as written by the code before the 2026-11-24 amendment | real; used to prove the fixture reproduces the run's first-run counts and rerun rows |
| `shard-completeness.json`, `field-config-reset.json` | as written by the run | real |
| `history-tail.jsonl` | the last 15 lines of `history/staging.jsonl` (builds 222-233, the `stage` build 214, 235 and 236) | real |

What the replay builds from them: a first-run and a rerun Playwright report, `selectRerun` and `combineRerun` (the real ones), the
history record and trends (`computeHistoryDeltaOutput`), job windows (to the minute, from the Load Signals table), and
`NotificationService.buildContext` + `EmailTemplate`. The replay reproduces the real email's subject, health score (74/100), tiles,
trend deltas, rerun table and misc-error counts.

Known differences from the real email: the history tail has no build 221 and only 6 comparable runs before #235 (the real email
said "last 10"), so stability and series figures cover fewer runs; job totals differ by a minute or two (windows are minute-level);
the 2 recovered tests list in a different order. Nothing in the fixture is a secret, an e-mail address or a customer record.

`buildWorstCaseFixture()` (same module) is a synthetic bad day (60 failed, 80 flaky, 790 background errors) for the email size check.
