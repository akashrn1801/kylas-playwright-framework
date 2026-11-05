import { request as apiRequest } from '@playwright/test';
import * as fs from 'fs';
import { buildApiUrl } from '../../config/config';
import { isRetryableHttpStatus } from '../utils/retryableStatus';
import { logger } from '../utils/logger';

// ADR 0016 (S1) / ADR 0017 (B5): the one way to ask the backend whether an access token is still accepted,
// shared by globalSetup (validation once per role) and AuthManager (before a 401 clears the shared state).

/** The API access token (JWT payload `data.accessToken`) inside the app's stored `token` value, or null. */
export function accessTokenFromStoredToken(storedToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(storedToken.split('.')[1], 'base64').toString('utf8')) as {
      data?: { accessToken?: string };
    };
    return payload?.data?.accessToken ?? null;
  } catch {
    return null;
  }
}

/** The API access token stored in a saved storage-state file, or null. */
export function readAccessTokenFromStateFile(stateFile: string): string | null {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    for (const origin of state.origins ?? []) {
      const entry = origin.localStorage?.find((item) => item.name === 'token');
      const accessToken = entry ? accessTokenFromStoredToken(entry.value) : null;
      if (accessToken) return accessToken;
    }
  } catch {
    /* missing or unreadable file */
  }
  return null;
}

// One authenticated, read-only API call per role. Only a transport error, 429 or 5xx is retried (ADR 0014 §1,
// bounded, 3 tries); 401/403 means the session is not usable; any other 4xx is reported with status and body.
export async function tokenAcceptedByApi(role: string, token: string): Promise<boolean> {
  const url = buildApiUrl('/products/layout?view=create');
  const apiContext = await apiRequest.newContext();
  try {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let status: number | null = null;
      let body = '';
      try {
        const response = await apiContext.get(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        status = response.status();
        body = (await response.text()).slice(0, 300);
      } catch (error) {
        if (attempt === attempts) {
          throw new Error(`[globalSetup] Session check for ${role}: no response from ${url} after ${attempts} attempts (${String(error)})`);
        }
        logger.warn(`[globalSetup] Session check for ${role}: no response (${String(error)}) — retry ${attempt}/${attempts - 1}`);
        continue;
      }
      if (status >= 200 && status < 300) return true;
      if (status === 401 || status === 403) return false;
      if (isRetryableHttpStatus(status) && attempt < attempts) {
        logger.warn(`[globalSetup] Session check for ${role}: HTTP ${status} — retry ${attempt}/${attempts - 1}`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        continue;
      }
      throw new Error(`[globalSetup] Session check for ${role}: HTTP ${status} from ${url}. Response: ${body}`);
    }
    return false;
  } finally {
    await apiContext.dispose();
  }
}
