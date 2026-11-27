/**
 * Config used ONLY by the rerun shard's `npx playwright merge-reports --config=merge-json.config.ts <blob dir>`
 * (ADR 0015). Writes one JSON report whose path comes from PLAYWRIGHT_JSON_OUTPUT_NAME (checked 2026-11-03 on
 * Playwright 1.60.0: with no `outputFile` option here the env variable is honoured). Like merge.config.ts it is
 * deliberately minimal: merge-reports reads only `reporter` from it, and it must not load playwright.config.ts
 * (which needs the environment's secrets) or MiscErrorReporter.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [['json']],
});
