# Reporting and Notifications — Resolved History

> **Purpose:** Resolved incidents and durable findings for the email/notification pipeline, the `ci/reporting-history` ledger, suite-drift detection and the reporting-phase enhancements.
> **Read when:** changing anything under `src/notifications/`, `src/reporters/`, `scripts/merge-misc-errors.ts`; an email shows a wrong delta, a false "Suite Drift", a "No Tests Executed" verdict or an empty trend.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

How the system works: [../REPORTING.md](../REPORTING.md). Open reporting items: [../KNOWN_ISSUES_ACTIVE.md](../KNOWN_ISSUES_ACTIVE.md) (KI-18). Template: [../CONTRIBUTING_TESTS.md](../CONTRIBUTING_TESTS.md#size-policy).

### History ledger never received data: the push was anonymous — 2026-08-25
- **Symptom:** `ci/reporting-history` had no history branch after weeks of runs; the email's trend, recurring-flaky and regression features ran against empty history. The log said "rejected (concurrent update)".
- **Root cause:** `syncHistory.ts` clones into its own temp directory; `actions/checkout`'s `token:` only authenticates the original workspace, so every push was anonymous and always failed. The handler logged "rejected (concurrent update)" without reading the real git stderr, which hid this through two earlier fixes (fixed delay, then bounded backoff) aimed at a race that never existed. Lesson: a log message is not evidence — read the real error text.
- **Fix:** `gitAuthEnv()` injects the same Basic-auth header `actions/checkout` uses via `GIT_CONFIG_*` env vars (never a URL); all logging routes through a redactor that scrubs the token; `classifyGitFailure()` replaces the unconditional guess with ordered named classes and an honest `unclassified` (never retried). All workflows invoking `history:sync` have `permissions: contents: write` and a credentialed checkout. Confirmed live later: real records, including Jenkins entries, exist on the ledger branch.
- **Revert:** restore the previous catch block in `syncHistory.ts` (not advised) — the auth injection is additive.
- **Commit:** `4477e0f`

### Suite Drift / "+449 passed" compared unrelated runs — 2026-09-09
- **Symptom:** a clean 33-test dev run showed "Suite Drift Detected" (red) and a qa run's delta read `+449 passed`.
- **Root cause:** `computeDelta()`/`computeSuiteDrift()` compared against whatever record ran immediately before in `history/<env>.jsonl`, keyed by app environment, not branch — dev's `@smoke` runs and qa's `@regression` runs share `history/qa.jsonl`. An earlier carve-out only handled `sandbox:reset` runs.
- **Fix:** comparisons require the same branch AND the same normalized scope; `deriveTestScope(rawTitles, modules)` derives scope from the run itself (the one `@tag` shared by every executed test → else the sorted contributing-module set → `empty-report`), never configured per workflow. Drift fires only on a decrease within the same scope; the banner tone for a 0-failed drift run is amber while the verdict stays `blocked`. Old records lack `scope` and never match, so the first run per branch+scope is the baseline. This also closes the previously open "run-history delta isn't scope-filtered" item.
- **Revert:** drop the `scope`/`branch` conditions in `computeDelta()`/`computeSuiteDrift()` and `bannerTone` back to `danger`.
- **Commit:** `7910c7e`

### Killed run reported "PASSED" for zero executed tests — 2026-09-09
- **Symptom:** a run killed by GitHub's job ceiling sent a "✅ PASSED" email for 0 of N executed tests.
- **Root cause:** the notify step read a stale degenerate `results.json` written by the script's own `--list` probe (the JSON reporter marks every listed test `skipped`).
- **Fix:** `ReportParser.ts` emits `'no-tests-executed'` when `total > 0` and passed, failed and flaky are all zero; `AutomationHealth.computeOverallVerdict()` checks it first ("🚫 No Tests Executed", `blocked`); `EmailTemplate.subject()` reuses the same `ctx.health`/`ctx.verdict` fallback as the body.
- **Revert:** remove the `no-tests-executed` branch in `computeOverallVerdict()`.
- **Commit:** `d7de24c`

### Retry count looked 4× too high — serial blocks re-run whole — 2026-09-09
- **Symptom:** a run with 3 flaky and 2 failed reported far more retried tests than 5.
- **Root cause:** Playwright `serial` mode re-runs the entire block from the top when one test fails, including tests that already passed; each rerun adds a second result record. Not a merge-step or sharding bug.
- **Fix:** `ReportParser` splits retries into genuine (from non-clean tests) vs swept (already-passed tests re-run by a serial block) at whole-run and per-module level; the KPI tile and Module Analytics "Retries" column show both.
- **Revert:** n/a — reporting only.
- **Commit:** `9e35fc1`

### Email showed a days-old report as current — 2026-07-14
- **Symptom:** two sent emails contained report content several days older than the send date.
- **Root cause:** `notify.ts` silently reused whatever `reports/<env>/latest/playwright-report/results.json` was on disk; nothing checked its age.
- **Fix:** `NotificationService.checkReportFreshness()` compares `report.endTime` to `Date.now()` (passed in, so it stays pure); beyond `STALE_REPORT_THRESHOLD_HOURS` (default 4, env-overridable) the email gets a top banner, a subject prefix and a large health-score penalty.
- **Revert:** n/a — additive.
- **Commit:** `f224a5c`

### Wrong duration, wrong trace link, lost error detail — 2026-07-14
- **Symptom:** email duration double-counted under parallel workers; a flaky test's trace link pointed at the passing retry; error text carried raw ANSI escapes; the real cause was sometimes only in `errors[1]`.
- **Root cause:** durations were summed per test (overlapping time counted repeatedly) and the JSON report has no top-level `startTime`; `lastResult` for a flaky test is the passing retry, which has no `retain-on-failure` trace; Playwright's singular `error` is only `errors[0]`.
- **Fix:** `ReportParser.ts` reads `raw.stats.duration`/`raw.stats.startTime`, takes the trace from the last non-passing attempt, strips ANSI, extracts `error.stack`/`error.location`, and reads the full `errors[]` array (last entry is closest to the real give-up).
- **Revert:** n/a — parser corrections.
- **Commit:** `e2c4e1d`

### Plaintext password written into every `login.spec.ts` log — 2026-07-20
- **Symptom:** real QA admin/restricted passwords appeared verbatim in local log files.
- **Root cause:** a generic `BasePage.fill()` logged every filled value; `LoginPage.loginWithCredentials()` passed real passwords through it.
- **Fix:** `BasePage.isSensitiveFieldDescription()` (`SENSITIVE_FIELD_PATTERN` matches `password|passwd|pwd|secret|token|api[_-]?key`, description-based, not DOM `type`) → logs `[REDACTED]`. Verified: a re-run's log held zero real-password occurrences. Credential rotation was recommended but is not tracked as done.
- **Revert:** n/a — do not revert.
- **Commit:** `a1d8291`

### Module Analytics showed one entity as two modules — 2026-09-28
- **Symptom:** Form Field Limit specs appeared as a separate module instead of grouping under their entity (e.g. Leads).
- **Root cause:** `deriveModuleFromFile()` derives the name from the directory, but specs are named with the singular (`leadFieldLimits.spec.ts`) while directories are plural.
- **Fix:** `SINGULAR_TO_CANONICAL_MODULE_NAME` map in `src/notifications/ReportParser.ts` (needed by five entities; Products & Services' filename already matches).
- **Revert:** remove the map entries (modules split again).
- **Commit:** `253afc3`

### Module display-name quirks deliberately NOT fixed — 2026-09-30
- **Symptom:** `deriveModuleFromFile()` renders `Call-logs` and `ProductsAndServices`, and counts `login.spec.ts` under Dashboard.
- **Root cause:** it capitalizes only the first letter of the directory name and cannot tell login from dashboard (same directory).
- **Fix:** none, deliberate — module names are persisted in `ci/reporting-history`, so renaming would silently break trend continuity. The rationale is in the code comment above the final display-name computation in `ReportParser.ts`; read it before touching.
- **Revert:** n/a.
- **Commit:** unknown — see `git log -S'deriveModuleFromFile' -- src/notifications/ReportParser.ts`.

### Notification pipeline: enrichment convention and phantom briefs — 2026-08-24
- **Symptom:** a redesign brief described a "Reports Verified" email section; nothing like it existed.
- **Root cause:** the brief conflated the Reports UI module with an abandoned branch; no code verification preceded it. (Standing lesson: grep before building on a described feature.)
- **Fix:** none needed. Convention worth reusing: `FailureDetailBuilder.ts` keeps raw fs access in a small loader, keeps derivation pure, and lets the caller wire loader output into the pure function — the same split as `RunHistory.ts` / `FailureAnalyzer.ts`.
- **Revert:** n/a.
- **Commit:** `30e8870`

### Reporting phase 3: slowest tests per module, stability trend, job stats, retry split, overlap detection — 2026-09-29
- **Symptom:** (enhancement batch) the email lacked per-module slow tests, a multi-run module trend, per-job CI time and cross-shard overlap.
- **Root cause:** n/a — capability gaps; each was built reusing already-captured data.
- **Fix:** `ModuleStats.slowestTests` (top 3 per module) + a per-module "Slowest" card; `computeModuleStabilityTrend()` (older-half vs newer-half fail+flaky rate, margin `MODULE_STABILITY_TREND_MARGIN_POINTS`, needs ≥4 matching runs, branch+scope aware); `JobStats.ts` (`fetchGitHubJobs`/`computeJobStats`, GitHub-only, `null` on any failure, uses `PIPELINE_TOKEN`); `detectJobOverlaps()` + `deriveModuleTag()` (tags only formFields jobs; same-tag overlap is the live self-check for the carve-out); per-module genuine-vs-swept retries. Known v2 gap: rest-of-suite shards carry no module attribution. `computeRecurringFlaky()`/`computeRecurringFailures()`/`computeModuleTrend()` still lack the branch+scope filter the new function has.
- **Revert:** remove the corresponding `buildXxx()` section calls in `EmailTemplate.ts`; the pure functions are harmless unused.
- **Commit:** `bf32201` (items 3, 5), `1091c4b` (items 1, 2, 4a, 6)

### Per-shard load signals — 2026-10-06
- **Symptom:** no way to tell whether sequencing the formFields track reduced 429 / error-boundary recoveries.
- **Root cause:** n/a — measurement gap. `globalSetup` runs before `MiscErrorReporter.onBegin()` deletes worker files, so main-process events could not reuse the worker-file path.
- **Fix:** `ErrorCollector.recordRecoveryEvent()` → per-worker file → `MiscErrorReporter` merge → `merge-misc-errors.ts` attributes events per shard (artifact directory name) → `JobStats.buildJobRecoveryRows()` → "Load Signals by Job" in the CI Job Stats card; main-process events use `recovery-events-main.json`, truncated by `globalSetup`, merged and removed by `onEnd`. All report fields optional.
- **Revert:** remove the three `recordRecoveryEvent` call sites and `resetMainProcessRecoveryEvents()`; the section then renders nothing.
- **Commit:** `1bd03cc`

### "Related history" links broke when the issue log was split — 2026-10-06
- **Symptom:** (preventive) the email's link to history pointed at the retired single known-issues file, and the index matched against it.
- **Root cause:** `loadKnownIssuesIndex()` read one hard-coded file and the email appended `#L<line>` to a fixed URL.
- **Fix:** candidates now carry `file`; `loadKnownIssuesIndex(repoRoot)` reads `docs/KNOWN_ISSUES_ACTIVE.md` + `docs/known-issues/*.md` (missing files skipped); the email links `blob/<sha>/<file>#L<line>`. Source change in `KnownIssuesIndex.ts`, `NotificationService.ts`, `EmailTemplate.ts`.
- **Revert:** restore the single-file loader and URL (those three files).
- **Commit:** uncommitted at time of writing — see the docs-restructure commit.

### `getDestinationListTotalCount()`-style reads should use `span.update` — 2026-08
- **Symptom:** list-total reads intermittently found no `#totalRecords`.
- **Root cause:** `#totalRecords` is not reliably present; `span.update` is universal across Lead/Deal/Contact/Company/Task/Meeting/Quotation/Call Log.
- **Fix:** default to `span.update`.
- **Revert:** n/a.
- **Commit:** unknown — see `git log -S'span.update'`.
