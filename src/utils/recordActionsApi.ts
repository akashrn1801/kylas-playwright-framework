import { Page } from '@playwright/test';
import { config } from '../../config/config';
import { ApiClient, readAccessToken } from './apiClient';
import { logger } from './logger';

// Backend answer for a token that tokens/refresh (or a newer session rule) has revoked, ADR 0017.
const REVOKED_TOKEN_CODE = '001002';

/** The fatal text for a revoked-token answer (400 001002), else undefined; for fetchActions callbacks of pollRecordActions. */
export function revokedTokenFatal(status: number, body: unknown): string | undefined {
  const code = (body as { code?: string } | undefined)?.code;
  return status === 400 && code === REVOKED_TOKEN_CODE
    ? `HTTP 400 ${REVOKED_TOKEN_CODE} "not able to recognize you": the acting user's token was revoked (another session refreshed it); waiting cannot fix this`
    : undefined;
}

export type RightsEntity = 'leads' | 'contacts' | 'deals' | 'companies';

export interface RecordWithActions {
  recordActions?: Record<string, boolean>;
  company?: { id: number; name?: string } | null;
  associatedContacts?: Array<{ id: number; name?: string }>;
}

export interface RecordActionsRead {
  status: number;
  actions: Record<string, boolean>;
  /** Set when polling cannot succeed whatever the wait (e.g. the token was revoked): the poll fails at once, by name. */
  fatal?: string;
}

const POLL_INTERVALS_MS = [500, 1000, 1000, 2000, 4000];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  let rateLimitLogged = false;
  for (let attempt = 0; ; attempt++) {
    const { status, actions, fatal } = await fetchActions();
    // A revoked token never recovers by waiting (backend rule, ADR 0017): fail now, naming the cause.
    if (fatal) throw new Error(`${message}: ${fatal}`);
    if (status === 429 && !rateLimitLogged) {
      // ADR 0014: 429 is retryable, with a log line. Staging answered 16 of 16 polls with a bare 429 (no body,
      // no Retry-After) for 31 s in one full lead run (leads.rbac.spec:698); the interval tail below slows down
      rateLimitLogged = true;
      logger.warn('Rights poll: the API answered 429 (rate limited), polling continues at a slower interval');
    }
    const outstanding =
      status !== 200
        ? `HTTP ${status}`
        : Object.keys(expected)
            .filter((action) => (actions[action] === true) !== expected[action])
            .join(',');
    if (outstanding === '') break;
    if (Date.now() - started >= timeout) {
      throw new Error(`${message}: still not as expected after ${timeout} ms (not yet applied: ${outstanding})`);
    }
    await sleep(POLL_INTERVALS_MS[Math.min(attempt, POLL_INTERVALS_MS.length - 1)]);
  }
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
  let last: RecordWithActions = {};
  // The token is read from the live page on EVERY attempt: the app (or a re-authentication) may replace it while
  // we poll, and a token read once keeps answering 400 001002 for the whole timeout (leads.rbac.spec:698).
  const took = await pollRecordActions(
    async () => {
      const api = await RecordRightsApi.forPage(actingPage);
      try {
        const result = await api.getRecord(entity, id);
        last = result.ok ? result.body : {};
        return {
          status: result.status,
          actions: last.recordActions ?? {},
          fatal: revokedTokenFatal(result.status, result.body),
        };
      } finally {
        await api.dispose();
      }
    },
    { [action]: true },
    `The acting user should be allowed "${action}" on ${entity}/${id}`
  );
  logger.info(`${entity}/${id}: "${action}" allowed for the acting user after ${took} ms`);
  return last;
}
