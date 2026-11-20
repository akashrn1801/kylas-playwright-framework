/**
 * Offline checks for src/auth/runWindow.ts (ADR 0017): the session run window scales with the selected tests for
 * local runs, stays at the full window for whole-suite, CI, explicit-override and uncountable selections.
 * Run: npm run check:run-window
 */
import { effectiveRunWindow, scaledRunWindowMs, selectionArgs, countListedTests, listSelectedTests, RUN_WINDOW_FLOOR_MS } from '../src/auth/runWindow';

let failed = 0;
const check = (ok: boolean, name: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};
const FULL = 4 * 60 * 60 * 1000;
const min = (ms: number): number => Math.round(ms / 60000);
const base = { workers: 4, fullWindowMs: FULL, explicit: false, isCI: false };
const run = (cliArgs: string[], count: number | null, extra: Partial<Parameters<typeof effectiveRunWindow>[0]> = {}) =>
  effectiveRunWindow({ ...base, cliArgs, count: () => count, ...extra });

check(min(scaledRunWindowMs(20, 4, FULL)) === 48, 'scaling: 20 tests on 4 workers = 18 min of work + 30 min margin = 48 min');
check(scaledRunWindowMs(1, 4, FULL) === RUN_WINDOW_FLOOR_MS, 'scaling: one test is never below the 45 min floor');
check(scaledRunWindowMs(957, 4, FULL) === FULL, 'scaling: a whole suite is capped at the full window');
check(scaledRunWindowMs(5, 4, FULL) <= scaledRunWindowMs(50, 4, FULL), 'scaling: more tests never shrink the window');

const node = ['/usr/bin/node', '/x/playwright', 'test'];
check(run([...node, 'tests/ui/tasks/tasks.spec.ts', '--workers=4', '--max-failures=1'], 34).windowMs === scaledRunWindowMs(34, 4, FULL), 'a file filter is scaled to its count');
check(run([...node, '--grep', 'admin should add a task', '--project=chromium'], 3).windowMs < FULL, 'a --grep alone is scaled');
check(run([...node, '--project=chromium', '--workers=4'], 957).windowMs === FULL, 'no file/grep filter (whole suite) keeps the full window');
check(run([...node, 'tests/ui/tasks/tasks.spec.ts'], 34, { isCI: true }).windowMs === FULL, 'CI keeps the full window');
check(run([...node, 'tests/ui/tasks/tasks.spec.ts'], 34, { explicit: true }).windowMs === FULL, 'an explicit SESSION_MIN_REMAINING_FOR_RUN_MS wins (the setup uses its value as the full window)');
check(run([...node, 'tests/ui/tasks/tasks.spec.ts'], null).windowMs === FULL, 'a selection that cannot be counted keeps the full window');
check(run([...node, 'tests/ui/tasks/tasks.spec.ts'], 0).windowMs === FULL, 'an empty selection keeps the full window');
check(run(['/usr/bin/node', '/x/playwright', 'show-report'], 5).windowMs === FULL, 'a command that is not `test` keeps the full window');

const sel = selectionArgs([...node, 'a.spec.ts', '--workers', '4', '-j', '2', '--grep=foo', '--repeat-each', '3', '--max-failures=1', '--retries=0', '--reporter=list']);
check(JSON.stringify(sel?.args) === JSON.stringify(['a.spec.ts', '--grep=foo', '--repeat-each', '3']), 'selectionArgs keeps filters, --grep and --repeat-each; drops workers/retries/reporter and their values');
check(selectionArgs([...node, '--workers', '4'])?.hasFilter === false, 'selectionArgs: a separate flag value is never read as a file filter');
check(countListedTests('[dotenv] banner {x}\n{"suites":[{"suites":[{"specs":[{"tests":[1,2]},{"tests":[3]}]}]}]}') === 3, 'countListedTests sums tests, tolerating a banner before the JSON');

// --repeat-each and --project reach the count (both spellings), so the window follows what really runs.
const flagsA = selectionArgs([...node, 'a.spec.ts', '--repeat-each', '3', '--project', 'firefox'])?.args;
const flagsB = selectionArgs([...node, 'a.spec.ts', '--repeat-each=3', '--project=firefox'])?.args;
check(JSON.stringify(flagsA) === JSON.stringify(['a.spec.ts', '--repeat-each', '3', '--project', 'firefox']), 'selectionArgs keeps "--repeat-each 3" and "--project firefox" (separate value tokens)');
check(JSON.stringify(flagsB) === JSON.stringify(['a.spec.ts', '--repeat-each=3', '--project=firefox']), 'selectionArgs keeps "--repeat-each=3" and "--project=firefox" (inline values)');
let seen: string[] = [];
effectiveRunWindow({ ...base, cliArgs: [...node, 'a.spec.ts', '--repeat-each=3', '--project=chromium', '--workers=4'], count: (a) => ((seen = a), 10) });
check(seen.includes('--repeat-each=3') && seen.includes('--project=chromium') && !seen.includes('--workers=4'), 'effectiveRunWindow hands --repeat-each and --project (not --workers) to the counter');
check(run([...node, 'a.spec.ts', '--repeat-each=3'], 90).windowMs > run([...node, 'a.spec.ts'], 30).windowMs, 'a repeated selection (3x the count) gets a longer window');
check(countListedTests('{ quiet: true }\n{\n  "suites": [{"specs":[{"tests":[1,2]}]}]\n}') === 2, 'countListedTests skips a banner line that itself starts with a brace');

// Real `--list` on one spec file: the count follows --repeat-each and --project.
const spec = 'tests/ui/tasks/tasks.spec.ts';
const one = listSelectedTests([spec, '--project=chromium']);
const three = listSelectedTests([spec, '--project=chromium', '--repeat-each=3']);
const all = listSelectedTests([spec]);
check(one !== null && one > 0 && three === one * 3, `real --list: --repeat-each=3 triples the count (${one} -> ${three})`);
check(one !== null && all !== null && all >= one, `real --list: no --project counts every configured project (${all} >= ${one} for chromium)`);

if (failed > 0) {
  console.log(`\ncheck:run-window — ${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\ncheck:run-window — all checks passed');
