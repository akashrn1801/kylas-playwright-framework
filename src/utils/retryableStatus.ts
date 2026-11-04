// WHY one definition (2026-11-02): lead, contact and company creates each carried their own copy of
// "is this rejection transient", and all three treated a 400 whose message read "Something didn't work
// as expected" as retryable. A 400 is a definitive answer (staging KI-58: three identical 400s per
// create turned a backend outage into 3 h job timeouts). Only 429 and 5xx may be retried; a missing
// response (transport error) is handled by the callers' own catch branch.
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
