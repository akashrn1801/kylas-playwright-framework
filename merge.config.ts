/**
 * Config used ONLY by `npx playwright merge-reports` (sharded CI, added
 * 2026-09-09 to fix the GitHub Actions 6-hour job-timeout cancellations on
 * qa/stage/sandbox — see .claude/known-issues.md's dated entry). merge-reports
 * reads only the `reporter` field from whatever config it's pointed at via
 * `-c` — everything else here is ignored, so this is deliberately minimal
 * rather than importing/extending playwright.config.ts.
 *
 * WHY a separate file, not playwright.config.ts itself: that file's reporter
 * array also includes MiscErrorReporter, which must NOT run during a merge —
 * its data comes from per-worker temp files written live on the shard's own
 * runner filesystem during actual test execution, not from the replayed blob
 * data merge-reports reconstructs. Including it here would silently produce
 * an empty/wrong misc-errors.json on the merge job's own fresh runner (which
 * never had any of those temp files). See scripts/merge-misc-errors.ts for
 * how misc-errors.json is actually aggregated instead, from each shard's own
 * already-correct output.
 *
 * html/json ARE safe here — merge-reports replays each test's full result
 * (including attachments: traces, screenshots, videos, which the blob format
 * embeds) through the standard Reporter API, so these two produce the same
 * output shape as an unsharded run would have. Paths below intentionally
 * match playwright.config.ts's own CI paths exactly, so no downstream
 * consumer (notify.ts, syncHistory.ts, artifact upload) needs to know
 * sharding exists at all.
 *
 * WHY allure-playwright is deliberately EXCLUDED here (confirmed live,
 * 2026-09-09, Playwright 1.60.0): tested a real 2-shard merge and got a
 * reproducible `TypeError: Cannot read properties of undefined (reading
 * 'outputDir')` thrown from AllureReporter.onConfigure on every invocation —
 * allure-playwright's onConfigure hook expects a FullConfig shape that
 * merge-reports's replay doesn't fully reconstruct. It doesn't fail the
 * merge (exit code 0, html/json still correct), and reports/allure-results/
 * still gets populated despite the error, but shipping a reporter with a
 * confirmed, reproducible internal error into CI — for a directory that none
 * of qa.yml/stage.yml/sandbox.yml currently upload, generate, or otherwise
 * consume anyway (verified via grep: no `allure` step exists in any of the
 * 3 GitHub Actions workflows this fix touches; only the Jenkins pipelines'
 * own `allure(...)` step reads it, and Jenkins isn't sharded by this change)
 * — is not worth it for zero current functional benefit. If allure output
 * from sharded CI is ever genuinely needed, re-test against whatever
 * Playwright version is current then; this may be a version-specific bug
 * that gets fixed upstream rather than a permanent limitation.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['html', { outputFolder: 'reports/playwright-report', open: 'never' }],
    ['json', { outputFile: 'reports/playwright-report/results.json' }],
  ],
});
