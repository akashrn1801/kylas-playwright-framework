import { Page, Response } from '@playwright/test';
import { logger } from './logger';

// WHY this exists (2026-10-21, main run 39534804354): a save that the backend
// rejects (PUT /products/{id} 500 00903002, PUT /leads/{id} 400 000000,
// POST /contacts/ 400 000000) surfaced only as the toast text the page shows
// ("Validation errors found ... Something went wrong"), so a backend failure
// read like a form problem. This remembers the most recent failed write per
// page so assertNoFormErrors() can state METHOD path -> status code instead.
// It only reads responses; it never retries, hides or changes a failure.

interface FailedWrite {
  summary: string;
  at: number;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const API_PATH = /^\/v\d+\//;
const lastFailedWrite = new WeakMap<Page, FailedWrite>();
// Reads the page needs to render (layouts, record GETs): see recentFailedRead().
const lastFailedRead = new WeakMap<Page, FailedWrite>();
// 400 (the backend's "Connection prematurely closed" shape), 429 (rate limit) and 5xx. 401/403/404 are normal
// answers on this app (permission checks, a deal with no pipeline) and never count.
const isServerSideReadFailure = (status: number): boolean => status === 400 || status === 429 || status >= 500;
const tracked = new WeakSet<Page>();

// Ids and long numbers become {id} so the line reads like a route, not a record.
function normalizePath(pathname: string): string {
  return pathname.replace(/\/\d+(?=\/|$)/g, '/{id}');
}

async function readApiCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { code?: unknown; errorCode?: unknown } | null;
    const code = body?.code ?? body?.errorCode;
    return typeof code === 'string' || typeof code === 'number' ? String(code) : 'no-code';
  } catch (error) {
    logger.debug(`failedWriteTracker: response body not readable (${String(error)})`);
    return 'no-code';
  }
}

export function trackFailedWrites(page: Page): void {
  if (tracked.has(page)) return;
  tracked.add(page);
  page.on('response', (response) => {
    const method = response.request().method().toUpperCase();
    if (READ_METHODS.has(method) && isServerSideReadFailure(response.status())) {
      try {
        const readPath = new URL(response.url()).pathname;
        if (API_PATH.test(readPath)) {
          lastFailedRead.set(page, { summary: `${method} ${normalizePath(readPath)} -> ${response.status()}`, at: Date.now() });
        }
      } catch {
        /* unparsable url: not an API call we can name */
      }
    }
    if (READ_METHODS.has(method) || response.status() < 400) return;
    let pathname: string;
    try {
      pathname = new URL(response.url()).pathname;
    } catch (error) {
      logger.debug(`failedWriteTracker: unparsable url (${String(error)})`);
      return;
    }
    if (!API_PATH.test(pathname)) return;
    // /reports/ calls are POSTed READS (dashboards, Related Deals widgets): a failing one is not a rejected save
    // (seen 2026-10-30: a transient `POST /v4/reports/deals` 400 000000 was reported as the company clone's failure)
    if (/\/reports\//.test(pathname)) return;
    const status = response.status();
    void readApiCode(response).then((code) => {
      lastFailedWrite.set(page, {
        summary: `${method} ${normalizePath(pathname)} -> ${status} ${code}`,
        at: Date.now(),
      });
    });
  });
}

// Most recent failed write within `withinMs`, or null.
export function recentFailedWrite(page: Page, withinMs = 20000): string | null {
  const entry = lastFailedWrite.get(page);
  return entry && Date.now() - entry.at <= withinMs ? entry.summary : null;
}

/**
 * The last failed API READ (HTTP 400/429/5xx on a GET) seen on this page, with when it happened, or null if none in
 * the last `withinMs`. WHY (2026-11-04, sandbox run of 2026-11-03): a form whose data GET answered 429/500/400 stays
 * a grey skeleton forever (deal edit modal after `GET /v1/deals/{id}` 429, Add Deal "Product or Services" after
 * `GET /v1/products/layout` 500), and the tests then waited 120 s (or the whole 480 s test timeout) for a control
 * that could never appear. BasePage.waitForRendered() uses this to fail within seconds and name the request.
 */
export function recentFailedRead(page: Page, withinMs: number): { summary: string; at: number } | null {
  const entry = lastFailedRead.get(page);
  return entry && Date.now() - entry.at <= withinMs ? entry : null;
}
