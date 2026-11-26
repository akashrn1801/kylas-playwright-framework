/**
 * Comparing the usage page with the API while the account is shared (2026-11-26): other shards create records between two reads, so a count read
 * at one instant can differ from one read at another. The page's numbers are read BETWEEN two API reads ("before" and "after"); limits cannot move
 * in that time, a count can only be anywhere between the two.
 *
 *  - Total (the limit): the page, "before" and "after" must be exactly equal.
 *  - Used: the page's value lies between the "before" and "after" values, inclusive (either may be the larger: records can also be deleted).
 *  - Remaining: exactly Total minus the page's own Used (the page computes it from the same reading).
 * `decimals` rounds both sides the way the page does (0 for counts, 2 for GB), and a Remaining difference of one unit of the last shown digit is
 * the page's own rounding.
 */
import { Quota } from './BillingApi';
import { UsageSectionNumbers } from './BillingPage';

export function bracketViolations(card: string, ui: UsageSectionNumbers, before: Quota, after: Quota, decimals = 0): string[] {
  const factor = 10 ** decimals;
  const round = (n: number): number => Math.round(n * factor) / factor;
  const out: string[] = [];
  const bad = (what: string): void => void out.push(`${card}: ${what}`);
  if (round(before.total) !== round(after.total)) bad(`the limit changed during the test (API before ${before.total}, after ${after.total}): the plan or add-ons changed mid-run`);
  if (ui.total !== round(before.total) || ui.total !== round(after.total)) bad(`Total: page ${ui.total}, API before ${before.total}, after ${after.total}: the limit must match exactly`);
  const lo = round(Math.min(before.used, after.used));
  const hi = round(Math.max(before.used, after.used));
  if (ui.used < lo || ui.used > hi) bad(`Used: page ${ui.used} is outside the API's before ${before.used} and after ${after.used} (${lo} to ${hi})`);
  if (ui.remaining !== null && Math.abs(ui.remaining - round(ui.total - ui.used)) > 1 / factor + 1e-9) bad(`Remaining: page ${ui.remaining} is not Total ${ui.total} - Used ${ui.used}`);
  return out;
}
