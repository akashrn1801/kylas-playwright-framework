import { expect } from '@playwright/test';
import { logger } from './logger';

// WHY (leads.spec.ts L54, sandbox run 45553181980; flaky in build #235 and run 45122485029, KI-43): a record is created by a
// 2xx and can still be missing from the search index that lists, lookups and duplicate "View" links read, for seconds to minutes.
// A test that opens a form or a list before the index has it fails far from the cause ("list shows []"). This polls the SAME
// request the screen will make, as the user who will see it (the caller passes an API client built from that user's page), with a
// named, bounded limit, and fails by name when the index never has the record.
export const SEARCHABLE_TIMEOUT_MS = 60000;
const SEARCHABLE_INTERVALS_MS = [1000, 2000, 3000, 5000];

export interface RecordSearchableOptions {
  entity: string;
  id: number;
  /** The request being polled, for the failure message. */
  request: string;
  /** Runs that request and returns the ids it lists. */
  search: () => Promise<number[]>;
  timeoutMs?: number;
}

export async function waitForRecordSearchable(options: RecordSearchableOptions): Promise<void> {
  const { entity, id, request, search, timeoutMs = SEARCHABLE_TIMEOUT_MS } = options;
  const startedAt = Date.now();
  try {
    await expect.poll(search, { timeout: timeoutMs, intervals: SEARCHABLE_INTERVALS_MS }).toContain(id);
  } catch {
    throw new Error(
      `${entity} created as id ${id} but not searchable after ${Math.round((Date.now() - startedAt) / 1000)} s (limit ${Math.round(timeoutMs / 1000)} s) in ${request}: search index lag, KI-43`
    );
  }
  logger.info(`${entity} ${id} searchable after ${Math.round((Date.now() - startedAt) / 1000)} s (${request})`);
}
