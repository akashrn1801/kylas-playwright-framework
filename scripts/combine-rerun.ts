/**
 * Lays the rerun shard's results over the first-run JSON report and writes the rerun summary (ADR 0015).
 *
 *   npx ts-node scripts/combine-rerun.ts --first reports/playwright-report/results.json \
 *     --rerun reports/rerun/rerun-run.json --list reports/rerun/rerun-list.json \
 *     --summary reports/<env>/rerun-summary.json [--previous-summary <file>] [--backup <file>]
 *
 * Env: GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT (a list written by an EARLIER attempt is ignored: its blobs are not the
 * ones merged now), RERUN_OF_RUN_ID / RERUN_OF_RUN_NUMBER (manual rerun of an older run).
 *
 * Fail-safe: with no list, an unusable list or any error, NOTHING is written and the report stays the first run
 * exactly as before (exit 0). The first-run report is kept next to it as results.first-run.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';
import { CombineMeta, JsonReport, RerunList, combineRerun } from '../src/notifications/RerunResults';
import { parseRerunSummary } from '../src/notifications/RerunSummary';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const firstPath = arg('first');
  const rerunPath = arg('rerun');
  const listPath = arg('list');
  const summaryPath = arg('summary');
  if (!firstPath || !listPath || !summaryPath) {
    logger.error('[combine-rerun] usage: --first <results.json> [--rerun <rerun-run.json>] --list <rerun-list.json> --summary <rerun-summary.json>');
    process.exitCode = 2;
    return;
  }
  try {
    if (!fs.existsSync(listPath)) {
      logger.info(`[combine-rerun] no rerun list at ${listPath} (rerun shard off or skipped): report unchanged`);
      return;
    }
    const list = JSON.parse(fs.readFileSync(listPath, 'utf-8')) as RerunList;
    const attempt = Number(process.env.GITHUB_RUN_ATTEMPT);
    if (
      (list.runId && process.env.GITHUB_RUN_ID && list.runId !== process.env.GITHUB_RUN_ID) ||
      (list.runAttempt !== undefined && Number.isInteger(attempt) && list.runAttempt !== attempt)
    ) {
      logger.warn(`[combine-rerun] rerun list belongs to run ${list.runId} attempt ${list.runAttempt}, this is ${process.env.GITHUB_RUN_ID} attempt ${attempt}: ignored, report unchanged`);
      return;
    }
    const first = JSON.parse(fs.readFileSync(firstPath, 'utf-8')) as JsonReport;
    const rerun = rerunPath && fs.existsSync(rerunPath) ? (JSON.parse(fs.readFileSync(rerunPath, 'utf-8')) as JsonReport) : null;
    const previousPath = arg('previous-summary');
    const meta: CombineMeta = {
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: Number.isInteger(attempt) ? attempt : undefined,
      previous: previousPath && fs.existsSync(previousPath) ? parseRerunSummary(fs.readFileSync(previousPath, 'utf-8')) : null,
      ...(process.env.RERUN_OF_RUN_ID ? { rerunOf: { runId: process.env.RERUN_OF_RUN_ID, runNumber: process.env.RERUN_OF_RUN_NUMBER } } : {}),
    };
    const { combined, summary } = combineRerun(first, rerun, list, meta);

    const backup = arg('backup') ?? path.join(path.dirname(firstPath), 'results.first-run.json');
    if (!fs.existsSync(backup)) fs.copyFileSync(firstPath, backup);
    const tmp = `${firstPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(combined));
    fs.renameSync(tmp, firstPath);
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    logger.info(
      `[combine-rerun] ${summary.ran ? `rerun combined: ${summary.rows.length} test(s), ${summary.recovered} recovered, ${summary.stillFailing} still failing` : `no rerun (${summary.reason})`}; ` +
        `first run ${JSON.stringify(summary.firstRun)} -> after rerun ${JSON.stringify(summary.afterRerun)}`
    );
  } catch (err) {
    logger.warn(`[combine-rerun] failed (${(err as Error).message}): report left as the first run`);
  }
}

main();
