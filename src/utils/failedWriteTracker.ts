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
    if (READ_METHODS.has(method) || response.status() < 400) return;
    let pathname: string;
    try {
      pathname = new URL(response.url()).pathname;
    } catch (error) {
      logger.debug(`failedWriteTracker: unparsable url (${String(error)})`);
      return;
    }
    if (!API_PATH.test(pathname)) return;
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
