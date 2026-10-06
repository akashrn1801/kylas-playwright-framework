# Reports Module — Resolved History and Durable Findings

> **Purpose:** Confirmed findings and resolved incidents for the Reports module and its run-count verification.
> **Read when:** touching `ReportsPage.ts`, `reports*.spec.ts`, report-count verification, or considering Playwright project `dependencies`.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Real Kylas bugs found here (`removeDimension()` TypeError, non-functional "Report Name" sort, Meeting-report first-save HTTP 500) live in [../../APPLICATION_BUGS.md](../../APPLICATION_BUGS.md). The Quotation report-entity-type gap is in [ci-pipelines.md](./ci-pipelines.md). UI-shape patterns (draggable rows, dual react-select families, three-route pages, carousel error banner) are in [../PATTERNS.md](../PATTERNS.md).

## Durable facts

1. Total-count reads default to `span.update`, not `#totalRecords` — universal across all eight list modules.
2. Call Log's Date Filter has no "Created At"; its equivalent is "Logged At" (options: Logged At, Start Time, Date, Updated At, Date Time Picker). Never assume a date-filter list is identical across entities.
3. Run-count verification uses self-contained per-test windows, not a whole-suite design. `globalTeardown` was rejected: a failure there is invisible to the notification email (`ReportParser`/`NotificationService`/`EmailTemplate` never read it) and it gets no `Page`, fixtures, session recovery or `ErrorCollector`.
4. Report totals are read from the API, not the DOM: `POST /v3/reports/<plural>?...` returns dimension buckets whose `values[0]` sum equals the header total (irregular plural `calls` for Call Log). The separate `/v1/search/*` ground-truth check stays — it exists to catch a genuine report-engine bug.
5. The Custom Date Range is interpreted in Asia/Kolkata regardless of the runner's timezone.
6. A report with a correctly-zero match renders no header at all; `getReportTotalFromHeader()` races the metric-name locator against the no-data message.

## Incidents

### Playwright `dependencies` project silently bypasses `--grep` — 2026-08
- **Symptom:** a project that `dependencies:`-depends on another ran the whole dependency even with `--grep`, and invoking them in separate commands re-ran it twice.
- **Root cause:** a dependency project ignores `--grep` filtering even when co-selected on the same command line; there is no cross-invocation dedup.
- **Fix:** never use `dependencies` for "run after everything"; per-test self-contained verification instead. A dangling branch `feature/reports-module-20260817` (global creation ledger) was never merged — it carried the same flaw plus an incomplete ledger.
- **Revert:** n/a.
- **Commit:** unknown — see `git log -S'dependencies' -- playwright.config.ts`.

### Report-count test masked by concurrent Leads — 2026-08-25
- **Symptom:** R36/R64 (report count vs actual filtered Lead count) failed under load with "report undercounts".
- **Root cause:** two layers. `LeadsPage.deleteLead()` had no network confirmation after the confirm click (unlike `DealsPage.deleteDeal()`); and the report uses a coarse ±1-calendar-day window not scoped to the one entity, so other tests' Leads polluted it.
- **Fix:** mirror the delete confirmation; `verifyRunCountForEntity()` takes `filters?` so R36/R64 tag a uniquely-timestamped `lastName`; a ±5-minute `narrowWindow` for tests with no taggable field (R65). Default behavior byte-identical for existing callers (grep-verified).
- **Revert:** remove the `filters?`/`narrowWindow` parameters.
- **Commit:** `02fe0a2`

### Totals read from a DOM tooltip; filters ignored in the ground-truth count — 2026-08-26
- **Symptom:** intermittent count mismatches; R36 and a concurrent R65 each saw the other's Lead.
- **Root cause:** `reportTotal` came from a `data-original-title` DOM scrape; `getApiCountForWindow()` applied only `createdAt between [from, to]`, never the caller's `filters`.
- **Fix:** `armReportDataResponseCapture()`/`sumReportDataResponse()` replace the scrape for `verifyRunCountForEntity()`/`waitForReportTotalBelow()`; `getApiCountForWindow()` applies `filters` through a narrow field map, live-confirmed on staging. R36+R65 concurrent 2/2, R64 1/1.
- **Revert:** restore the DOM read in the two methods.
- **Commit:** `aefd527`, `0f46591`

### Narrow-window time computed in the runner's local timezone — 2026-08-26
- **Symptom:** invisible on an IST dev machine, ~13-hour window error on GitHub's UTC runners.
- **Root cause:** `fillTimeInPicker()` computed hour/minute/day from the process's local timezone while the app always interprets the range in Asia/Kolkata.
- **Fix:** `toIstWallClockDate()` conversion, scoped to the `narrowWindow` path; verified under `TZ=UTC` and real `--workers=2`.
- **Revert:** drop the conversion (breaks on UTC runners).
- **Commit:** `aefd527`

### Meeting report fails first Save with HTTP 500 — 2026-08-25
- **Symptom:** `safeWaitForURL` timeout inside `ReportsPage.createReport()` for Meeting reports only.
- **Root cause:** a Kylas backend `HTTP 500`, `code: "01403004"`, on 100% of first Save attempts for Meeting reports (immediate retry always succeeds; confirmed Meeting-specific across 20 cross-entity attempts) — app bug #4, not fixable here.
- **Fix:** a bounded (max 2 attempts) retry on that exact signature in `createReport()`, benefiting every caller.
- **Revert:** remove the retry branch.
- **Commit:** unknown — see `git log -S'01403004'`.

### Fixture-teardown `Test timeout` in a Meeting report test — 2026-08-25
- **Symptom:** a `Test timeout` hang inside fixture teardown on one occurrence (sandbox).
- **Root cause:** not established — ruled out the known fixture-timeout classes, 0/9 reproduced; no fix applied (no reproduction, high-blast-radius code).
- **Fix:** none; kept here so it is not re-investigated blind.
- **Revert:** n/a.
- **Commit:** n/a.

### Run-count test missing a Quotation entity type on stage/prod — 2026-09-09
- **Symptom:** the quotation report-count tests failed with `locator.waitFor: Timeout 10000ms exceeded` on the Entity Type option.
- **Root cause:** the Quotation report entity type was deployed to QA only (environment gap, not a flake).
- **Fix:** see [ci-pipelines.md](./ci-pipelines.md) — `ReportsPage.skipIfQuotationEntityTypeUnavailable()` live presence check.
- **Revert:** see that entry.
- **Commit:** `6184a11`
