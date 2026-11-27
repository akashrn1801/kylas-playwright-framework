# Build #239 fixture

Sandbox build #239 (GitHub Actions run 45553181980, 2026-11-25) as a small committed fixture, so the email can be replayed and tested offline without
the run's report artifact. Same idea as [build-235](../build-235/README.md); the replay is `scripts/lib/build239Fixture.ts` (parameterised
`scripts/lib/build235Fixture.ts`), the renderer `scripts/render-build239.ts`, the checks `npm run check:build239`.

| File | What it is | Real or synthetic |
|---|---|---|
| `tests.json` | the 943 tests: per module its total (34 modules, from the run's history record, spec file per module from the build-235 fixture), plus 26 named tests: DB14 (flaky), leads.spec.ts:904 (failed both first attempts, passed on the rerun), the 3 Leads RBAC known-bug tests (`test.fail()`: reported `expected`, attempt `failed`), the skipped call-log test, and the run's 20 slowest tests | module totals, named tests, titles, durations and the two errors (message and code frame from the run's email): **real**. The other tests are **synthetic fillers** (`<module> check NN`, passed, 10 s). Spec lines of the 3 known-bug tests are the current file's; for 5 of the 20 slowest tests (no match in the build-235 fixture) the file and line are **reconstructed**. |
| `misc-errors.json` | the run's `misc-errors.json` (158 errors, 11 shard entries with 690 `api-429` events) | real, with the non-production hosts replaced by `api.example.test` / `app.example.test` and the Sentry organisation and project ids by `o1` / `1` (`check:public-safe`). The top-level `recoveryEvents` (a duplicate of `recoveryByShard`) and each event's test title are dropped to keep the file small. Stored with the collector's classification of that day; `loadFixture239()` applies the current known-noise rules (the "no pipeline attached" rule, 2026-11-25) so a replay shows what the next run's email will show. |
| `rerun-summary.real.json` | the run's own `rerun-summary.json` | real; the replay must reproduce its first-run (940 / 1 / 1 / 1) and after-rerun (942 / 0 / 0 / 1) counts |
| `shard-completeness.json`, `field-config-reset.json` | as written by the run | real |
| `history-tail.jsonl` | the last 15 lines of `history/staging.jsonl` (builds 224-239, including the stage build 214) | real. The history record of #239 itself is the pre-fix one (Leads RBAC "3 failed", 937 / 4 / 1); the replay builds its own record from the replayed report and excludes #239 from the history it compares against |

Not in the fixture, by design: the real email (it is the "before" in `~/build239-render/before.html`, kept outside the repo), job logs and traces.

Known differences from the real email: job windows are to the minute (the email's Load Signals times minus 5 h 30 min); the commit shown is
**sample text** (the run's commit was the sandbox merge `f3dee9ed`; the fixture has no git history, so the feature head's subject and author are placeholders);
the 429 counts are the real 690 events, all `POST` calls to Sentry ingest (third-party browser telemetry, not the Kylas API). Nothing in the fixture is a secret,
an e-mail address or a customer record.
