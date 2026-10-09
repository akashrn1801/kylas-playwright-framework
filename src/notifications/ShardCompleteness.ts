/**
 * How many of the run's expected shard blob reports actually arrived, written
 * by .github/scripts/verify-shard-completeness.sh in `merge-and-report` and
 * read by notify and history sync.
 *
 * WHY a file in reports/<env>/, read the same optional/graceful way
 * misc-errors.json, history-delta.json and field-config-reset.json are: the
 * count is only known to the workflow (expected = planned shards + the 6
 * formFields entities; reported = blob zips downloaded), and a missing/garbled
 * file must mean "no information" — never "complete" and never "incomplete".
 * Run 37669596623 (sandbox build #189): 2 of 6 formFields jobs hung in the
 * browser install and were cancelled; the workflow only printed an ::error::
 * annotation, so the email said "PASSED 277/277 Excellent" and the history
 * ledger recorded a partial run as a normal one. See docs/known-issues/
 * sharding-and-locks.md.
 */
import * as fs from 'fs';
import * as path from 'path';

export interface ShardCompleteness {
  expected: number;
  reported: number;
}

export function getShardCompletenessPath(env: string): string {
  return path.resolve(process.cwd(), 'reports', env, 'shard-completeness.json');
}

export function parseShardCompleteness(raw: string): ShardCompleteness | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ShardCompleteness>;
    const { expected, reported } = parsed;
    if (
      typeof expected !== 'number' ||
      typeof reported !== 'number' ||
      !Number.isInteger(expected) ||
      !Number.isInteger(reported) ||
      expected <= 0 ||
      reported < 0
    ) {
      return null;
    }
    return { expected, reported };
  } catch {
    return null;
  }
}

export function loadShardCompleteness(env: string): ShardCompleteness | null {
  try {
    const file = getShardCompletenessPath(env);
    if (!fs.existsSync(file)) return null;
    return parseShardCompleteness(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

export function isIncompleteRun(c: ShardCompleteness | null | undefined): c is ShardCompleteness {
  return !!c && c.reported < c.expected;
}
