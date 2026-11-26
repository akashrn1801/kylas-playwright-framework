/**
 * Live per-entity totals (2026-11-26): what the account holds RIGHT NOW, read from each entity's own list search.
 *
 * WHY (new fact, 2026-11-26): the billing record count updates at once only on deletes; creates are counted at Kylas' nightly refresh. The
 * difference of two billing readings (post minus pre) therefore shows only deletions, never what a run created. The same entity's live search
 * total, read at the gate and at the teardown, does show creates, so "created during this run" is the live total after minus the live total before.
 *
 * The totals are NOT comparable with the billing figures themselves (observed on QA 2026-11-26: tasks, meetings, call logs and quotations equal
 * the billing counts; leads, deals, contacts and companies, read through the search index, were 410, 1, 36 and 40 lower; notes count differently:
 * 2,805 against 561). Only the difference between two live readings of the SAME entity is used, and the search index can lag, so the number can
 * be lower than what was created. Keys are the billing entity names, so the email lines the two up.
 */
import { BillingApi } from './BillingApi';

export interface LiveEndpoint {
  entity: string;
  path: string;
  /** First page index: the meetings and call-logs lists start at 1, the others at 0 (ReportsPage's own table). */
  startPage: number;
}

/** One entry per billing entity (`entityCounts`), paths proven live on QA 2026-11-26. */
export const LIVE_ENDPOINTS: readonly LiveEndpoint[] = [
  { entity: 'LEAD', path: '/search/lead', startPage: 0 },
  { entity: 'DEAL', path: '/search/deal', startPage: 0 },
  { entity: 'CONTACT', path: '/search/contact', startPage: 0 },
  { entity: 'COMPANY', path: '/search/company', startPage: 0 },
  { entity: 'TASK', path: '/tasks/search', startPage: 0 },
  { entity: 'MEETING', path: '/meetings/search', startPage: 1 },
  { entity: 'CALL', path: '/call-logs/search', startPage: 1 },
  { entity: 'QUOTATION', path: '/quotations/search', startPage: 0 },
  { entity: 'NOTE', path: '/notes/search', startPage: 0 },
];

export interface LiveCounts {
  capturedAt: string;
  /** null = that entity's total could not be read. */
  counts: Record<string, number | null>;
  /** True when a 429 or 5xx stopped the remaining reads (they are null): better a partial reading than hammering a throttled API. */
  incomplete: boolean;
}

/** Sequential on purpose (nine small requests, about 2 s in all); never throws. */
export async function readLiveCounts(api: Pick<BillingApi, 'searchTotal'>, now: Date): Promise<LiveCounts> {
  const counts: Record<string, number | null> = {};
  let incomplete = false;
  for (const e of LIVE_ENDPOINTS) {
    if (incomplete) {
      counts[e.entity] = null;
      continue;
    }
    try {
      const r = await api.searchTotal(e.path, e.startPage);
      if (r.status === 429 || r.status >= 500) incomplete = true;
      counts[e.entity] = r.ok && typeof r.body?.totalElements === 'number' ? r.body.totalElements : null;
    } catch {
      counts[e.entity] = null;
    }
  }
  return { capturedAt: now.toISOString(), counts, incomplete };
}

/** Created during the run per entity = live after minus live before; null when either reading is missing; never negative (deletes are not "created"). */
export function createdPerEntity(pre: LiveCounts | null | undefined, post: LiveCounts | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const e of LIVE_ENDPOINTS) {
    const a = pre?.counts[e.entity];
    const b = post?.counts[e.entity];
    out[e.entity] = typeof a === 'number' && typeof b === 'number' ? Math.max(0, b - a) : null;
  }
  return out;
}
