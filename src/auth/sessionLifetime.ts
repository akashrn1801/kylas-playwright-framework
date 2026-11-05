import * as fs from 'fs';

// WHY this exists (2026-07-23, for AuthManager.ensureFreshSession()):
// confirmed live via real network capture that the JWT stored in
// localStorage.token embeds its own absolute expiry as a ms-epoch timestamp
// at payload.data.expiry (decoded from a real token: expiresIn 37569s
// [~10.4h], expiry a concrete ms-epoch value) — reading it costs nothing (no
// network call), which is what makes a cheap, unconditional proactive check
// at the start of every test practical.
export function getTokenRemainingMs(rawToken: string): number | null {
  try {
    const payloadSegment = rawToken.split('.')[1];
    if (!payloadSegment) return null;
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64').toString('utf-8')) as {
      data?: { expiry?: number };
    };
    const expiry = payload.data?.expiry;
    if (typeof expiry !== 'number') return null;
    return expiry - Date.now();
  } catch {
    return null;
  }
}

// ADR 0016 (session-expiry batch, 2026-11-05). The app (SPA) calls GET /v1/tokens/refresh/ about 10 minutes before
// the token expires and, when that call answers 400 (001002 "not able to recognize you", KI-16), signs the user out.
// Sandbox run 41825279669 (staging, token lifetime ~47 min, expiresIn is in the token itself): ensureFreshSession saw
// "604s remaining — no proactive refresh needed" at test start, the app's trigger fired seconds later mid-test, and
// the page went to /signIn. A refresh buffer equal to that trigger always loses the race, so the buffer is the
// app's trigger + the longest a test may run + a margin, and it is capped by the token's OWN lifetime (read from
// the token: data.expiresIn) so a short-lived token is not refreshed at every test.
export const APP_REFRESH_TRIGGER_MS = 10 * 60 * 1000;
const LONGEST_TEST_MS = 8 * 60 * 1000; // test.setTimeout(480000) is the largest per-test budget in the suite
const REFRESH_MARGIN_MS = 2 * 60 * 1000;
const MAX_BUFFER_SHARE_OF_LIFETIME = 0.5;

export function getTokenLifetimeMs(rawToken: string): number | null {
  try {
    const payloadSegment = rawToken.split('.')[1];
    if (!payloadSegment) return null;
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64').toString('utf-8')) as {
      data?: { expiresIn?: number };
    };
    const seconds = payload.data?.expiresIn;
    return typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * How much remaining lifetime a session needs to be safe to start a test with: the app's own refresh trigger,
 * plus a full-length test, plus a margin, but never more than half the token's lifetime (when known) and never
 * less than trigger + margin (below that a test cannot finish before the app signs the user out anyway).
 */
export function proactiveRefreshBufferMs(lifetimeMs: number | null): number {
  const wanted = APP_REFRESH_TRIGGER_MS + LONGEST_TEST_MS + REFRESH_MARGIN_MS;
  const floor = APP_REFRESH_TRIGGER_MS + REFRESH_MARGIN_MS;
  if (lifetimeMs === null) return wanted;
  return Math.max(floor, Math.min(wanted, Math.floor(lifetimeMs * MAX_BUFFER_SHARE_OF_LIFETIME)));
}

/** True when the saved session for `stateFile` is missing or has less lifetime left than a test needs. */
export function storedSessionNeedsRefresh(stateFile: string): boolean {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
      origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
    };
    for (const origin of state.origins ?? []) {
      const raw = origin.localStorage?.find((item) => item.name === 'token')?.value;
      if (!raw) continue;
      const remaining = getTokenRemainingMs(raw);
      if (remaining === null) return false;
      return remaining <= proactiveRefreshBufferMs(getTokenLifetimeMs(raw));
    }
    return true;
  } catch {
    return true;
  }
}
