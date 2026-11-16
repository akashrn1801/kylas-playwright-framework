import { expect, Page } from '@playwright/test';
import { config } from '../../config/config';
import { ApiClient, readAccessToken } from './apiClient';
import { logger } from './logger';

export type RightsEntity = 'leads' | 'contacts' | 'deals' | 'companies';

export interface RecordWithActions {
  recordActions?: Record<string, boolean>;
  company?: { id: number; name?: string } | null;
  associatedContacts?: Array<{ id: number; name?: string }>;
}

export interface RecordActionsRead {
  status: number;
  actions: Record<string, boolean>;
}

/**
 * The ONE polling core for "has this access change applied yet": polls what the server reports for a record
 * (`recordActions`, the same answer the app uses to show or hide Call Logs / Edit / Share) until every
 * action in `expected` is exactly as expected. No sleeps: bounded polling on the server's own answer.
 * Returns how long the change took to apply. Used by the lead share-rule tests (all eight actions, both
 * directions) and by waitForRecordAction() below (one action allowed).
 */
export async function pollRecordActions(
  fetchActions: () => Promise<RecordActionsRead>,
  expected: Record<string, boolean>,
  message: string,
  timeout: number = config.timeouts.navigation
): Promise<number> {
  const started = Date.now();
  await expect
    .poll(
      async () => {
        const { status, actions } = await fetchActions();
        if (status !== 200) return `HTTP ${status}`;
        return Object.keys(expected)
          .filter((action) => (actions[action] === true) !== expected[action])
          .join(',');
      },
      { timeout, intervals: [500, 1000, 1000, 2000], message }
    )
    .toBe('');
  return Date.now() - started;
}

/**
 * GET /v1/<entity>/<id> as the user whose page is given. The token is read from the live page and never
 * logged (standing rule 22).
 */
class RecordRightsApi extends ApiClient {
  static async forPage(page: Page): Promise<RecordRightsApi> {
    return new RecordRightsApi(await ApiClient.createContext(await readAccessToken(page)));
  }

  getRecord(entity: RightsEntity, id: number) {
    return this.send<RecordWithActions>('GET', `/${entity}/${id}`);
  }
}

/**
 * Polls until `action` (default `call`) is allowed on the record for the user whose `actingPage` is given,
 * and returns the record as that user last saw it. Call it BEFORE that user opens a form that needs the
 * right (e.g. Log a call right after a share). It replaces the pause and the "retry the refused save" that
 * used to cover a share that had not applied yet (B6, CallLogs).
 */
export async function waitForRecordAction(
  actingPage: Page,
  entity: RightsEntity,
  id: number,
  action = 'call'
): Promise<RecordWithActions> {
  const api = await RecordRightsApi.forPage(actingPage);
  let last: RecordWithActions = {};
  try {
    const took = await pollRecordActions(
      async () => {
        const result = await api.getRecord(entity, id);
        last = result.ok ? result.body : {};
        return { status: result.status, actions: last.recordActions ?? {} };
      },
      { [action]: true },
      `The acting user should be allowed "${action}" on ${entity}/${id}`
    );
    logger.info(`${entity}/${id}: "${action}" allowed for the acting user after ${took} ms`);
    return last;
  } finally {
    await api.dispose();
  }
}
