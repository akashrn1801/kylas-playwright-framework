/** `npm run check:app-time`: appToday() gives the app's calendar day whatever the machine's zone is (no browser, no network). */
import { appToday } from '../src/utils/appTime';

let failed = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail}`}\n`);
  if (!ok) failed++;
};
const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 2026-11-24T19:00:00Z = 2026-11-25 00:30 in Calcutta: the runner (UTC) is still on the 24th, the app is on the 25th
const lateUtc = new Date('2026-11-24T19:00:00Z');
check(ymd(appToday(0, lateUtc)) === '2026-11-25', 'after 18:30 UTC the app is already on the next day', ymd(appToday(0, lateUtc)));
check(ymd(appToday(1, lateUtc)) === '2026-11-26', 'tomorrow is the app\'s next day, not the runner\'s "today"', ymd(appToday(1, lateUtc)));
const earlyUtc = new Date('2026-11-24T18:00:00Z'); // 23:30 in Calcutta: same day
check(ymd(appToday(0, earlyUtc)) === '2026-11-24', 'before 18:30 UTC both are on the same day', ymd(appToday(0, earlyUtc)));
check(ymd(appToday(1, new Date('2026-11-30T19:00:00Z'))) === '2026-12-02', 'month end rolls over', ymd(appToday(1, new Date('2026-11-30T19:00:00Z'))));
const mid = appToday(0, lateUtc);
check(mid.getHours() === 0 && mid.getMinutes() === 0, 'local midnight, so the label formatters read the right day', mid.toString());

process.stdout.write(failed === 0 ? '\ncheck:app-time — all checks passed\n' : `\ncheck:app-time — ${failed} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
