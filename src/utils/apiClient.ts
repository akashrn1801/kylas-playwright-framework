/**
 * Shared base for the API helpers (2026-10-30, Leads coverage work): one place for the Bearer token,
 * the standalone request context and the request/error handling, so each entity helper only holds its
 * own endpoints.
 *
 * WHY the token is read from the live page's localStorage and the requests use their own context: the
 * Bearer value is the JWT payload's `data.accessToken` (the same source BasePage.fetchAuthenticatedApiData()
 * reads — a GET-only helper). Reading it from the page means no extra login (KI-51: logins can
 * invalidate the other session of the same account), and a standalone context means a teardown still
 * works after the page crashed. The token is never logged (standing rule 22).
 */
import { APIRequestContext, Page, request as playwrightRequest } from '@playwright/test';
import { buildApiUrl } from '../../config/config';
import { logger } from './logger';

export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  ok: boolean;
  body: T;
}

export type ApiJsonRule = Record<string, unknown>;

/** Read the Bearer value (JWT payload `data.accessToken`) from the page's localStorage. */
export async function readAccessToken(page: Page): Promise<string> {
  const accessToken = await page.evaluate(() => {
    const raw = localStorage.getItem('token');
    if (!raw) return null;
    try {
      const payload = JSON.parse(atob(raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return (payload?.data?.accessToken as string | undefined) ?? null;
    } catch {
      return null;
    }
  });
  if (!accessToken) {
    throw new Error(
      'readAccessToken: no usable accessToken in the page localStorage — is the page logged in and on the app origin?'
    );
  }
  return accessToken;
}

// WHY (standing rule 22): Playwright's transport errors print the request headers in their call log,
// and every request here carries `Authorization: Bearer <token>`. Anything thrown or logged from this
// layer goes through redactTokens() first.
export function redactTokens(text: string): string {
  return text.replace(/(authorization:\s*bearer\s+)\S+/gi, '$1[redacted]');
}

export abstract class ApiClient {
  protected constructor(private readonly context: APIRequestContext) {}

  protected static async createContext(token: string): Promise<APIRequestContext> {
    return playwrightRequest.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  async dispose(): Promise<void> {
    await this.context.dispose();
  }

  // WHY no default Content-Type header: an object passed as `data` is sent as JSON with the right header
  // automatically, and a `multipart` body (call logs) needs its own boundary header, which a fixed
  // application/json header would break.
  protected async send<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown,
    multipart?: Record<string, string>
  ): Promise<ApiResult<T>> {
    // WHY a retry here, and only for GET/PUT/DELETE: a transport failure (the connection dropped before
    // ANY response — seen ONCE live: "socket hang up" on a fresh request context in a stage read-back)
    // says nothing about the app. Those three methods are safe to repeat; POST (create, share, note,
    // search…) is NEVER retried, so a retry cannot create a duplicate record. Cause: not from our side —
    // 360 calls with a fresh context per call, one shared context, 10 in parallel and idle reuse up to
    // 70 s produced no hang-up (2026-10-30), so the one occurrence is unexplained. Every retry is
    // logged with its URL; any HTTP status, error code or body is returned untouched; a second
    // transport failure is thrown.
    const idempotent = method !== 'POST';
    let response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await this.context.fetch(buildApiUrl(path), multipart ? { method, multipart } : { method, data });
        break;
      } catch (error) {
        if (!idempotent || attempt >= 2 || !/socket hang up|ECONNRESET|ETIMEDOUT/i.test(String(error))) {
          throw new Error(redactTokens(String(error)));
        }
        logger.warn(
          `API ${method} ${buildApiUrl(path)}: connection dropped before a response (attempt ${attempt}/2) — retrying once`
        );
      }
    }
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      /* non-JSON body is kept as text */
    }
    return { status: response.status(), ok: response.ok(), body: body as T };
  }

  protected async sendOrThrow<T>(
    label: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: unknown
  ): Promise<T> {
    const result = await this.send<T>(method, path, data);
    if (!result.ok) {
      // WHY the full status/code/message in the error: failures must explain themselves
      // (the same rule the UI create path follows — see LeadsPage.appendCreateDetail()).
      throw new Error(`${label} failed: HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 400)}`);
    }
    return result.body;
  }

  /** A single-rule `jsonRule` (the shape every list filter sends). */
  static rule(field: string, operator: 'equal' | 'contains' | 'in', value: string, type = 'string'): ApiJsonRule {
    return { rules: [{ operator, id: field, field, type, value }], condition: 'AND', valid: true };
  }
}
