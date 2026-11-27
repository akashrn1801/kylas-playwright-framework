// "sent 12s ago" for a diagnostic line (2026-11-25, build #240: "sent 1795618370s ago"): Playwright's request.timing().startTime is an epoch time in
// milliseconds, but it is 0 or -1 for a request that never got as far as a start (aborted before it was sent, a request seen only as failed). Subtracting
// that from now printed 56 years. A missing time is said as unknown, never computed as an age.
export function describeRequestAge(nowMs: number, startTimeMs: number | undefined): string {
  if (typeof startTimeMs !== 'number' || !Number.isFinite(startTimeMs) || startTimeMs <= 0) return 'at an unknown time';
  const seconds = Math.max(0, Math.round((nowMs - startTimeMs) / 1000));
  return `${seconds}s ago`;
}
