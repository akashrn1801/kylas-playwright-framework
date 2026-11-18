import type { Page } from '@playwright/test';
import * as fs from 'fs';

// ADR 0017 (2026-11-16): a saved session is only worth saving when it is a whole one. reauthenticatePage() used to
// set just `token` in a live page and save the context; when that page was signed out the file lost the app's user
// keys and every test after it saw a UI without its permission-derived menu items (leads.rbac.spec:762 12/12,
// KI-69). `token` alone is not a session: the app also needs these keys.
export const REQUIRED_SESSION_KEYS = ['token', 'userId', 'tenantId', 'userName', 'slingApp'] as const;

interface SessionKeyReadout {
  missing: string[];
  url: string;
}

async function readSessionKeys(page: Page): Promise<SessionKeyReadout> {
  return page.evaluate((keys) => {
    return {
      missing: keys.filter((key) => !window.localStorage.getItem(key)),
      url: window.location.href,
    };
  }, [...REQUIRED_SESSION_KEYS]);
}

/**
 * Saves `page`'s context storage state to `stateFile` (temp file, then atomic rename) only when the page is not
 * signed out and holds every key in REQUIRED_SESSION_KEYS. Otherwise nothing is written (the old file stays) and
 * the result names what is missing. `waitMs` bounds how long the app may take to write its keys after the
 * redirect (a real condition wait, not a pause); 0 checks once.
 */
export async function saveGuardedStorageState(
  page: Page,
  stateFile: string,
  label: string,
  waitMs: number
): Promise<{ saved: true } | { saved: false; reason: string }> {
  let readout: SessionKeyReadout;
  try {
    if (waitMs > 0) {
      await page
        .waitForFunction(
          (keys) => keys.every((key) => !!window.localStorage.getItem(key)) && !/\/signIn/.test(window.location.pathname),
          [...REQUIRED_SESSION_KEYS],
          { timeout: waitMs }
        )
        .catch(() => undefined);
    }
    readout = await readSessionKeys(page);
  } catch (error) {
    return { saved: false, reason: `the page could not be read (${String(error).slice(0, 120)})` };
  }
  const signedOut = /\/signIn/.test(new URL(readout.url).pathname);
  if (signedOut || readout.missing.length > 0) {
    const parts = [
      signedOut ? 'the page is on /signIn' : null,
      readout.missing.length > 0 ? `missing localStorage keys: ${readout.missing.join(', ')}` : null,
    ].filter(Boolean);
    return { saved: false, reason: `${parts.join('; ')} (${label})` };
  }
  const tmpStateFile = `${stateFile}.tmp.${process.pid}`;
  await page.context().storageState({ path: tmpStateFile });
  fs.renameSync(tmpStateFile, stateFile);
  return { saved: true };
}

/** Same as saveGuardedStorageState() but a refusal throws, naming the role and what is missing. */
export async function saveGuardedStorageStateOrThrow(
  page: Page,
  stateFile: string,
  label: string,
  waitMs: number
): Promise<void> {
  const result = await saveGuardedStorageState(page, stateFile, label, waitMs);
  if (!result.saved) {
    throw new Error(`[auth] Not saving the session state for ${label}: ${result.reason}. The previous state file was kept.`);
  }
}

/**
 * File-side twin of the save guard: the names of the REQUIRED_SESSION_KEYS a saved state file does not hold
 * (all of them when the file is missing or unreadable). Used by globalSetup: a state whose token the API accepts
 * but which lacks the app's user keys is not a usable session (the corrupted restricted.json of 2026-11-16).
 */
export function missingKeysInStateFile(stateFile: string): string[] {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    for (const origin of state.origins ?? []) {
      const names = new Set((origin.localStorage ?? []).filter((item) => item.value).map((item) => item.name));
      if (names.has('token')) return REQUIRED_SESSION_KEYS.filter((key) => !names.has(key));
    }
  } catch {
    /* missing or unreadable file: treated as holding nothing */
  }
  return [...REQUIRED_SESSION_KEYS];
}

/** The values of REQUIRED_SESSION_KEYS other than `token` held by a saved state file (the user's id, tenant, name and app flag are stable per user). */
function userKeyValuesFromStateFile(stateFile: string): Record<string, string> {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    for (const origin of state.origins ?? []) {
      const items = origin.localStorage ?? [];
      if (!items.some((item) => item.name === 'token')) continue;
      const values: Record<string, string> = {};
      for (const key of REQUIRED_SESSION_KEYS) {
        const value = items.find((item) => item.name === key)?.value;
        if (key !== 'token' && value) values[key] = value;
      }
      return values;
    }
  } catch {
    /* missing or unreadable file: nothing to restore from */
  }
  return {};
}

/**
 * Puts a whole session into `page`: `token`, plus every other key of REQUIRED_SESSION_KEYS the page no longer has
 * (a page the app signed out loses them), restored from the good saved state. Then re-reads the keys and throws,
 * naming what is missing, when the page still is not a whole session (ADR 0017).
 */
export async function putSessionIntoPage(page: Page, storedToken: string, goodStateFile: string, label: string): Promise<void> {
  const restore = userKeyValuesFromStateFile(goodStateFile);
  await page.evaluate(
    ({ token, values }) => {
      window.localStorage.setItem('token', token);
      for (const [key, value] of Object.entries(values)) {
        if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
      }
    },
    { token: storedToken, values: restore }
  );
  const { missing } = await readSessionKeys(page);
  if (missing.length > 0) {
    throw new Error(
      `[auth] Session for ${label} is not whole after the token swap: missing localStorage keys ${missing.join(', ')} ` +
        `and the saved state could not supply them.`
    );
  }
}
