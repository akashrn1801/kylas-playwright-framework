/**
 * Aggregates each shard's own reports/<env>/misc-errors.json (added
 * 2026-09-09 as part of the qa/stage/sandbox sharding fix — see
 * .claude/known-issues.md's dated entry) into the single final
 * reports/<env>/misc-errors.json that NotificationService.ts reads.
 *
 * WHY this can't just be MiscErrorReporter.ts running again in the merge
 * job: that reporter's data comes from live per-worker temp files written on
 * the runner that actually executed tests — a merge job's runner never had
 * any of those, so re-running it there would silently produce an EMPTY
 * report instead of a real one (a correctness trap, not just a missed
 * optimization — see merge.config.ts's own WHY comment for the same
 * reasoning applied to why MiscErrorReporter is deliberately excluded from
 * that config). This script instead reads each shard's ALREADY-CORRECT
 * output (each shard already ran MiscErrorReporter.onEnd() for real, on its
 * own workers, and uploaded the result as its own artifact) and concatenates
 * the errors arrays / recomputes counts — mirroring
 * MiscErrorReporter.mergeWorkerReports()'s own shape one level up (shards
 * instead of workers within one shard).
 *
 * Usage: ts-node scripts/merge-misc-errors.ts <env> <shard-misc-errors-dir>
 * <shard-misc-errors-dir> is expected to contain one misc-errors.json per
 * shard (however the caller names/nests them after downloading each shard's
 * artifact) — every *.json file found anywhere under it is read.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  MiscError,
  MiscErrorReport,
  RecoveryEvent,
  ShardRecoveryEvents,
} from '../src/error-collector/ErrorCollector';
import { logger } from '../src/utils/logger';

function findJsonFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findJsonFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      found.push(full);
    }
  }
  return found;
}

// WHY the shard label comes from the artifact directory name: download-artifact
// (without merge-multiple) puts each shard's misc-errors.json in a directory
// named after its artifact (`misc-errors-qa-3`, `misc-errors-qa-formfields-lead`)
// — the ONLY place shard identity survives once reports are concatenated.
// Returns e.g. "qa-3"; falls back to the file's parent directory name.
export function shardLabelFromPath(file: string, root: string): string {
  const segments = path.relative(root, file).split(path.sep);
  const dir = segments.find((seg) => seg.startsWith('misc-errors-')) ?? segments[0] ?? 'unknown';
  return dir.replace(/^misc-errors-/, '').replace(/\.json$/, '');
}

function main(): void {
  const env = process.argv[2];
  const shardDir = process.argv[3];

  if (!env || !shardDir) {
    logger.error('Usage: ts-node scripts/merge-misc-errors.ts <env> <shard-misc-errors-dir>');
    process.exit(1);
  }

  const outputPath = path.resolve(process.cwd(), 'reports', env, 'misc-errors.json');
  const mergedErrors: MiscError[] = [];
  const allRecoveryEvents: RecoveryEvent[] = [];
  const recoveryByShard: ShardRecoveryEvents[] = [];

  if (fs.existsSync(shardDir)) {
    const files = findJsonFiles(shardDir);
    for (const file of files) {
      try {
        const shardReport = JSON.parse(fs.readFileSync(file, 'utf-8')) as MiscErrorReport;
        if (Array.isArray(shardReport.errors)) {
          mergedErrors.push(...shardReport.errors);
        }
        // WHY every readable shard is listed, even with zero events: the email's
        // per-job table must be able to tell "this shard reported and was
        // clean" apart from "no report from this shard at all".
        const shardEvents = Array.isArray(shardReport.recoveryEvents) ? shardReport.recoveryEvents : [];
        allRecoveryEvents.push(...shardEvents);
        recoveryByShard.push({ shard: shardLabelFromPath(file, shardDir), events: shardEvents });
      } catch (err) {
        logger.warn(`[merge-misc-errors] Skipping unreadable shard file ${file}:`, err);
      }
    }
    logger.info(`[merge-misc-errors] Read ${files.length} shard misc-errors file(s) from ${shardDir}`);
  } else {
    logger.warn(`[merge-misc-errors] No shard misc-errors directory found at ${shardDir} — writing an empty report`);
  }

  const byType: Record<string, number> = {};
  for (const e of mergedErrors) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  const merged: MiscErrorReport = {
    capturedAt: new Date().toISOString(),
    totalErrors: mergedErrors.length,
    unexpectedErrors: mergedErrors.filter((e) => !e.expectedReason).length,
    expectedRbacErrors: mergedErrors.filter((e) => e.expectedReason === 'rbac').length,
    expectedBackgroundNoiseErrors: mergedErrors.filter((e) => e.expectedReason === 'background-noise').length,
    byType,
    errors: mergedErrors,
    recoveryEvents: allRecoveryEvents,
    recoveryByShard,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');
  logger.info(`[merge-misc-errors] Wrote ${mergedErrors.length} aggregated error(s) across all shards to ${outputPath}`);
}

main();
