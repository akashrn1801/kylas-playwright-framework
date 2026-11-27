// WHY one definition (2026-11-02): lead, contact and company creates each carried their own copy of
// "is this rejection transient", and all three treated a 400 whose message read "Something didn't work
// as expected" as retryable. A 400 is a definitive answer (staging KI-58: three identical 400s per
// create turned a backend outage into 3 h job timeouts). Only 429 and 5xx may be retried; a missing
// response (transport error) is handled by the callers' own catch branch.
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ADR 0017 (exception to ADR 0014 §1): the login endpoint answers 400 {"code":"000004","message":
// "Database error"} when many logins hit the backend at once (staging, sandbox run 42034935606: 10 jobs
// logging in together lost a 70-test job). Login only re-issues a token and writes nothing, so another
// attempt cannot double-submit. ONLY this exact answer on the login request qualifies; every other 4xx
// stays definitive. Callers allow at most 2 extra attempts with a short pause.
export function isLoginDatabaseError(status: number, body: string): boolean {
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    return parsed.code === '000004' && parsed.message === 'Database error';
  } catch {
    return false;
  }
}
