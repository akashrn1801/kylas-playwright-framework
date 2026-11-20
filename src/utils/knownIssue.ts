import { test } from '@playwright/test';
import { logger } from './logger';

/**
 * Records a known, tracked problem that a test observed but must not fail on: a warning in the log plus a
 * `known-issue` annotation on the running test (visible in the report). `id` is the KI number in
 * docs/KNOWN_ISSUES_ACTIVE.md. Outside a running test only the log line is written.
 */
export function recordKnownIssue(id: string, description: string): void {
  logger.warn(`Known issue ${id}: ${description}`);
  try {
    test.info().annotations.push({ type: 'known-issue', description: `${id}: ${description}` });
  } catch {
    /* test.info() throws outside a running test: the log line above is the record */
  }
}
