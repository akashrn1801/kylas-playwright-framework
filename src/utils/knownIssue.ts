import { test, expect } from '@playwright/test';
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

/**
 * Where a Kylas fix is CONFIRMED (a live run proved the refusal there). Only these environments are strict: an
 * accepted request fails red as a regression. Everywhere else the fix is detected at run time, so it can reach
 * staging and prod later without anyone editing a condition first. When a test annotates "fix detected on <env>", add
 * <env> to the matching entry (key = `<ticket>:<what>`), which turns the strict check on for it.
 */
export const KNOWN_BUG_FIX_CONFIRMED_ENVS: Record<string, readonly string[]> = {
  'SD-32157:add-note': ['qa'], // confirmed 2026-11-18: HTTP 401, code 000004
  'SD-32157:delete-admins-note': [],
  'SD-32158:add-task': [],
};

export interface KnownBugVerdict {
  /** Key of KNOWN_BUG_FIX_CONFIRMED_ENVS, e.g. 'SD-32157:add-note'. */
  bug: keyof typeof KNOWN_BUG_FIX_CONFIRMED_ENVS;
  /** The KI entry in docs/KNOWN_ISSUES_ACTIVE.md. */
  issueId: string;
  /** Plain words for messages, e.g. 'add note on a read-only share'. */
  what: string;
  env: string;
  /** The answer to the request that must be refused. */
  response: { status: number; body: unknown };
  /** The exact refusal seen where the fix was confirmed; asserted only on a strict environment. */
  confirmedRefusal?: { status: number; code: string };
}

/**
 * Decides what an API answer to a request that MUST be refused means, without a fixed list of environments to fail on:
 *  - refused (4xx) -> a normal pass. On a strict environment the confirmed status and code are asserted too; elsewhere
 *    a known-issue annotation says "fix detected on <env>, add it to the strict list".
 *  - accepted on a strict environment -> fails red (a regression of a confirmed fix).
 *  - accepted elsewhere -> `test.fail()` at run time ("not fixed on <env>") plus a known-issue annotation, then the
 *    refusal is asserted, so the run shows an expected failure and not red.
 *  - a 5xx says nothing about permissions -> fails by name ("check inconclusive: server returned 5xx"), never skipped.
 * Call it right after the request, after every set-up assertion (test.fail() must not hide a set-up problem).
 */
export function applyKnownBugVerdict(v: KnownBugVerdict): void {
  const { status } = v.response;
  const ticket = v.bug.split(':')[0];
  const strict = KNOWN_BUG_FIX_CONFIRMED_ENVS[v.bug].includes(v.env);
  if (status >= 500) {
    // A skip would hide a backend error, so this fails by name (and, set before any test.fail(), it is red, not expected).
    throw new Error(
      `${ticket} check inconclusive: server returned ${status} on ${v.env} for ${v.what}; this is a backend error, not a permission answer`
    );
  }
  const refused = status >= 400;
  if (refused) {
    if (strict && v.confirmedRefusal) {
      expect(status, `${ticket}: ${v.what} must be refused with HTTP ${v.confirmedRefusal.status} on ${v.env}`).toBe(
        v.confirmedRefusal.status
      );
      expect((v.response.body as { code?: string } | null)?.code, `${ticket}: ${v.what}: refusal code`).toBe(
        v.confirmedRefusal.code
      );
    } else if (!strict) {
      recordKnownIssue(
        v.issueId,
        `${ticket} fix detected on ${v.env} (${v.what} refused, HTTP ${status}): add ${v.env} to the strict list for ${v.bug} in src/utils/knownIssue.ts`
      );
    }
    return;
  }
  if (strict) {
    throw new Error(`${ticket}: regression on ${v.env}: ${v.what} accepted (HTTP ${status}) although the fix is confirmed there`);
  }
  test.fail(true, `${ticket} not fixed on ${v.env}: ${v.what} was accepted (HTTP ${status})`);
  recordKnownIssue(v.issueId, `${ticket} not fixed on ${v.env}: ${v.what} accepted (HTTP ${status}), expected failure`);
  expect(status, `${ticket}: ${v.what} must be refused`).toBeGreaterThanOrEqual(400);
}
