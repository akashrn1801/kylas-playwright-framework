/**
 * "Today" as the APP sees it. The date pickers and the form defaults use the account's time zone (Asia/Calcutta on every test
 * account), not the machine the test runs on. CI runners are UTC, so from 18:30 to 24:00 UTC the runner's calendar day is one behind
 * the app's: a test that computed "tomorrow" with `new Date()` then aimed at the app's TODAY, which is selectable
 * (sandbox run 45457800405, call-logs.spec.ts:216 "Tomorrow date should be blocked but is selectable", both attempts, shard 2 ran
 * 18:18-19:35 UTC). Reproduced on staging with TZ=America/New_York: the Log a call form showed Date "Nov 25, 2026" and Time
 * "8:53 am" (Calcutta) while the browser clock said Tue 24 Nov 22:23.
 *
 * `appToday(n)` returns a Date at local midnight whose calendar fields (year, month, day) are the app's day n days from now, so it
 * goes straight into the existing formatters (`formatDateForCalendarLabel` and friends), which read local fields.
 * Override the zone with APP_TIME_ZONE for an account that is not in Asia/Calcutta.
 */
export const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Calcutta';

export function appToday(offsetDays = 0, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const num = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const d = new Date(num('year'), num('month') - 1, num('day'));
  d.setDate(d.getDate() + offsetDays);
  return d;
}
