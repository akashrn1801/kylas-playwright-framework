/**
 * Offline check of the pre-run capacity gate (src/modules/billing/capacity.ts): synthetic usage readings shaped like the
 * real GET /v1/tenants/usage body (QA, 2026-11-26), no network, no login.
 *
 *   npm run check:capacity-gate
 *
 * Scenarios: plenty left, under the threshold, at 0 (stops), unlimited, custom fields (warn only), the expected plan,
 * Embark found, an erroring call (stops, loud), and the snapshot (round trip, no secrets). Exit 1 on any failed check.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Quota, parseUsage, RawUsage, Usage } from '../src/modules/billing/BillingApi';
import { UsageSectionNumbers } from '../src/modules/billing/BillingPage';
import { bracketViolations } from '../src/modules/billing/bracket';
import { LIVE_ENDPOINTS, LiveCounts, createdPerEntity, readLiveCounts } from '../src/modules/billing/liveCounts';
import {
  CapacityThresholds,
  GATE_ERROR_FILE,
  PRE_RUN_SNAPSHOT_FILE,
  capacityColour,
  evaluateCapacity,
  readSnapshot,
  runCapacityGate,
  selectionIsReadOnly,
} from '../src/modules/billing/capacity';

let failures = 0;
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const check = (ok: boolean, what: string, detail = ''): void => {
  if (!ok) failures += 1;
  out(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail ? `  -> ${detail}` : ''}`);
};

const NOW = new Date('2026-11-26T06:00:00.000Z');
const TH: CapacityThresholds = { recordsWarnBelow: 10000, customFieldsWarnBelow: 10, expectedPlan: 'Elevate' };
const UNLIMITED = 9.223372036854776e15;

const raw = (over: { planName?: string; records?: [number, number]; customFields?: [number, number] } = {}): RawUsage => {
  const [ru, rt] = over.records ?? [78311, 300000];
  const [cu, ct] = over.customFields ?? [96, 125];
  return {
    planName: over.planName ?? 'Elevate',
    plan: { id: 'elevate-annual', name: over.planName ?? 'Elevate' },
    renewalAt: '2027-05-21T11:04:37.000+0000',
    updatedAt: '2027-05-21T11:04:37.000+0000',
    records: { used: ru, total: rt },
    storage: { used: 0.01, total: 1 },
    customFields: { used: cu, total: ct },
    entityCounts: [
      { entity: 'LEAD', count: ru - 62929 },
      { entity: 'DEAL', count: 62929 },
    ],
    addons: [],
  };
};
const usage = (over?: Parameters<typeof raw>[0]): Usage => parseUsage(raw(over));

async function main(): Promise<void> {
  // colour rule
  check(capacityColour(221689, 10000) === 'green' && capacityColour(10000, 10000) === 'green', 'colour: plenty left and exactly the threshold are green');
  check(capacityColour(9999, 10000) === 'yellow' && capacityColour(1, 10000) === 'yellow', 'colour: under the threshold is yellow');
  check(capacityColour(0, 10000) === 'red' && capacityColour(-5, 10000) === 'red', 'colour: 0 left is red');

  // plenty left
  let v = evaluateCapacity(usage(), 'qa', TH, NOW);
  check(v.level === 'ok' && v.warnings.length === 0 && !v.stopMessage, 'plenty left (221,689): ok, no warning');

  // under the threshold
  v = evaluateCapacity(usage({ records: [295000, 300000] }), 'qa', TH, NOW);
  check(v.level === 'warn' && v.warnings.length === 1 && /RECORDS: only 5,000 left of 300,000 \(warn under 10,000\)/.test(v.warnings[0]) && !v.stopMessage, 'under the threshold (5,000 left): warns, does not stop', JSON.stringify(v.warnings));
  v = evaluateCapacity(usage({ records: [290001, 300000] }), 'qa', TH, NOW);
  check(v.level === 'warn', '9,999 left: warns');
  v = evaluateCapacity(usage({ records: [290000, 300000] }), 'qa', TH, NOW);
  check(v.level === 'ok', 'exactly 10,000 left: ok (the threshold is "under")');

  // at 0
  v = evaluateCapacity(usage({ records: [300000, 300000] }), 'qa', TH, NOW);
  check(v.level === 'stop' && /No records left on qa: 300,000 used of 300,000 \(plan Elevate\)/.test(v.stopMessage ?? ''), 'at 0 left: stop, message names used, total and plan', v.stopMessage);
  v = evaluateCapacity(usage({ records: [310000, 300000] }), 'qa', TH, NOW);
  check(v.level === 'stop', 'used above total: still stop (remaining never negative)');
  check(evaluateCapacity(usage({ records: [999, 1000], planName: 'Embark' }), 'qa', TH, NOW).level === 'warn', 'Embark 999 of 1,000: warn (plan + records), not stop');

  // unlimited
  v = evaluateCapacity(usage({ records: [78311, UNLIMITED] }), 'qa', TH, NOW);
  check(v.level === 'ok' && v.snapshot.records.total === null && v.snapshot.records.remaining === null, 'unlimited records: ok, snapshot stores null (JSON cannot hold Infinity)');

  // custom fields: warn only
  v = evaluateCapacity(usage({ customFields: [120, 125] }), 'qa', TH, NOW);
  check(v.level === 'warn' && /CUSTOM FIELDS: only 5 left of 125 \(warn under 10\)/.test(v.warnings[0]) && !v.stopMessage, '5 custom fields left: warns');
  v = evaluateCapacity(usage({ customFields: [125, 125] }), 'qa', TH, NOW);
  check(v.level === 'warn' && !v.stopMessage, '0 custom fields left: warns, NEVER stops');

  // plan
  v = evaluateCapacity(usage(), 'qa', TH, NOW);
  check(!v.warnings.some((w) => w.startsWith('PLAN')), 'Elevate as expected: no plan warning');
  v = evaluateCapacity(usage({ planName: 'Embark', records: [100, 1000] }), 'qa', TH, NOW);
  check(v.level === 'warn' && /^PLAN: expected "Elevate", found "Embark" \(record limit 1,000\)/.test(v.warnings[0]), 'Embark found: loud plan warning with the record limit', JSON.stringify(v.warnings));
  v = evaluateCapacity(usage({ planName: 'Embark' }), 'qa', { ...TH, expectedPlan: '' }, NOW);
  check(!v.warnings.some((w) => w.startsWith('PLAN')), 'no expected plan configured: no plan check');

  // the gate itself: stops, errors, snapshot
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capacity-gate-'));
  const logs: string[] = [];
  const warns: string[] = [];
  const deps = (fetchUsage: () => Promise<Usage>) => ({ fetchUsage, env: 'qa', thresholds: TH, dir, now: NOW, log: (l: string) => logs.push(l), warn: (l: string) => warns.push(l) });

  const ok = await runCapacityGate(deps(async () => usage()));
  check(ok?.level === 'ok' && logs.some((l) => /Capacity gate: ok — plan Elevate, records 78311 used \/ 300000 \(221689 left\)/.test(l)) && warns.length === 0, 'gate: plenty left logs one line and does not warn');
  const snap = readSnapshot(dir);
  check(!!snap && snap.records.used === 78311 && snap.entityCounts.DEAL === 62929 && snap.capturedAt === NOW.toISOString() && snap.level === 'ok', 'snapshot round trip: records, per-entity counts, time, level');
  const text = fs.readFileSync(path.join(dir, PRE_RUN_SNAPSHOT_FILE), 'utf8');
  check(!/token|bearer|authorization|cookie|password|@/i.test(text), 'snapshot holds no token, header, cookie, password or e-mail');

  warns.length = 0;
  const low = await runCapacityGate(deps(async () => usage({ records: [295000, 300000] })));
  check(low?.level === 'warn' && warns.length === 1 && /!!! CAPACITY WARNING — RECORDS/.test(warns[0]) && readSnapshot(dir)?.level === 'warn', 'gate: under the threshold warns loudly, run continues, snapshot says warn');

  warns.length = 0;
  let stopped = '';
  try {
    await runCapacityGate(deps(async () => usage({ records: [300000, 300000] })));
  } catch (error) {
    stopped = String(error);
  }
  check(/CAPACITY GATE: No records left on qa/.test(stopped) && readSnapshot(dir)?.level === 'stop', 'gate: 0 left throws before any test and saves the snapshot (level stop)', stopped);

  let errored = '';
  try {
    await runCapacityGate(deps(async () => {
      throw new Error('GET /v1/tenants/usage failed: HTTP 403 {"code":"001019"}');
    }));
  } catch (error) {
    errored = String(error);
  }
  check(/CAPACITY GATE: could not read GET \/v1\/tenants\/usage on qa, so the account's capacity is unknown\..*HTTP 403.*The run is stopped\./.test(errored), 'gate: a failing call stops the run loudly and keeps the reason', errored);

  warns.length = 0;
  await runCapacityGate(deps(async () => usage({ planName: 'Embark', records: [100, 1000] })));
  check(warns.some((w) => /CAPACITY WARNING — PLAN: expected "Elevate", found "Embark" \(record limit 1,000\)/.test(w)), 'gate: Embark warns loudly and does not stop');

  // billing period and currency (one more GET, never fatal)
  await runCapacityGate({ ...deps(async () => usage()), fetchBilling: async () => ({ period: 'ANNUAL', currency: 'INR' }) });
  check(readSnapshot(dir)?.billing?.period === 'ANNUAL' && readSnapshot(dir)?.billing?.currency === 'INR', 'gate: the snapshot carries the billing period and currency');
  const noBilling = await runCapacityGate({ ...deps(async () => usage()), fetchBilling: async () => { throw new Error('HTTP 500'); } });
  check(noBilling?.level === 'ok' && readSnapshot(dir)?.billing?.period === null, 'gate: a failing billing read never fails the gate (period stays null)');

  // read-only runs (decided from the command line) warn instead of stopping
  const ro = (...args: string[]): boolean => selectionIsReadOnly(['test', ...args]).readOnly;
  check(ro('--project=chromium', '--grep', '@prodSafe', '--workers=2', '--timeout=90000'), 'selection: prod.yml\'s `--grep @prodSafe` is read-only');
  check(ro('--grep=@prodSafe') && ro('-g', '@prodSafe'), 'selection: `--grep=@prodSafe` and `-g @prodSafe` are read-only');
  check(ro('tests/ui/billing', 'tests/rbac/billing', '--project=chromium'), 'selection: only billing specs are read-only');
  check(ro('tests/ui/billing/billing.spec.ts', '--grep', '@regression'), 'selection: a billing spec file is read-only whatever the grep');
  check(!ro('--project=chromium'), 'selection: the whole suite is NOT read-only');
  check(!ro('--grep', '@smoke') && !ro('--grep', '@prodSafe|@smoke') && !ro('--grep', '@prodSafe', '--grep', '@smoke'), 'selection: any grep that is not exactly @prodSafe is NOT read-only');
  check(!ro('tests/ui/billing', 'tests/ui/leads') && !ro('tests/ui/leads/leads.spec.ts'), 'selection: billing plus any other spec is NOT read-only');
  check(selectionIsReadOnly(['--grep', '@prodSafe']).readOnly && !selectionIsReadOnly([]).readOnly, 'selection: a bare `--grep @prodSafe` is read-only; an empty command line is not');

  const roDeps = (fetchUsage: () => Promise<Usage>) => ({ ...deps(fetchUsage), readOnlyRun: selectionIsReadOnly(['test', '--grep', '@prodSafe']) });
  warns.length = 0;
  const roZero = await runCapacityGate(roDeps(async () => usage({ records: [300000, 300000] })));
  const roSnap = readSnapshot(dir);
  check(!!roZero && roZero.level === 'stop' && warns.some((w) => /RECORDS: none left, but the run only reads/.test(w)) && roSnap?.readOnlyRun === true, 'read-only run at 0 left: warns loudly and CONTINUES (no throw), snapshot says readOnlyRun', JSON.stringify(warns));

  fs.rmSync(path.join(dir, GATE_ERROR_FILE), { force: true });
  warns.length = 0;
  const roFail = await runCapacityGate(roDeps(async () => {
    throw new Error('GET /v1/tenants/usage failed: HTTP 500 {}');
  }));
  const errFile = JSON.parse(fs.readFileSync(path.join(dir, GATE_ERROR_FILE), 'utf8')) as { readOnlyRun: boolean; message: string };
  check(roFail === null && warns.some((w) => /capacity is unknown.*The run only reads.*so it continues/.test(w)) && errFile.readOnlyRun === true, 'read-only run, usage call fails: warns loudly and continues, error marker written (readOnlyRun true)', JSON.stringify(warns));

  // a creating run keeps both stops
  fs.rmSync(path.join(dir, GATE_ERROR_FILE), { force: true });
  let creatingFail = '';
  try {
    await runCapacityGate({ ...deps(async () => { throw new Error('HTTP 500'); }), readOnlyRun: selectionIsReadOnly(['test', '--project=chromium']) });
  } catch (error) {
    creatingFail = String(error);
  }
  const creatingErr = JSON.parse(fs.readFileSync(path.join(dir, GATE_ERROR_FILE), 'utf8')) as { readOnlyRun: boolean };
  check(/CAPACITY GATE: could not read.*The run is stopped\./.test(creatingFail) && creatingErr.readOnlyRun === false, 'a run that creates records still stops when the usage call fails (error marker readOnlyRun false)', creatingFail);
  let creatingZero = '';
  try {
    await runCapacityGate({ ...deps(async () => usage({ records: [300000, 300000] })), readOnlyRun: selectionIsReadOnly(['test', '--grep', '@smoke']) });
  } catch (error) {
    creatingZero = String(error);
  }
  check(/No records left on qa/.test(creatingZero), 'a run that creates records still stops at 0 records left');

  // BL3's bracketed comparison (src/modules/billing/bracket.ts): the page is read between two API reads while other shards create records
  const q = (used: number, total: number): Quota => ({ used, total, remaining: Math.max(0, total - used), unlimited: false });
  const pg = (total: number, remaining: number, used: number): UsageSectionNumbers => ({ total, remaining, used });
  const br = (ui: UsageSectionNumbers, before: Quota, after: Quota, d = 0): string[] => bracketViolations('Records Count', ui, before, after, d);
  check(br(pg(300000, 221689, 78311), q(78311, 300000), q(78311, 300000)).length === 0, 'bracket: a quiet account (before = page = after) passes');
  check(br(pg(300000, 221000, 79000), q(78311, 300000), q(79560, 300000)).length === 0, 'bracket: records created meanwhile (page Used between before and after) passes');
  check(br(pg(300000, 221689, 78311), q(78311, 300000), q(79560, 300000)).length === 0 && br(pg(300000, 220440, 79560), q(78311, 300000), q(79560, 300000)).length === 0, 'bracket: the page Used equal to either bound passes (inclusive)');
  check(br(pg(300000, 222000, 78000), q(78311, 300000), q(79560, 300000)).some((m) => /Used: page 78000 is outside/.test(m)), 'bracket (red): a page Used below the API before value is reported');
  check(br(pg(300000, 220000, 80000), q(78311, 300000), q(79560, 300000)).some((m) => /Used: page 80000 is outside/.test(m)), 'bracket (red): a page Used above the API after value is reported');
  check(br(pg(300000, 221000, 79000), q(79560, 300000), q(78311, 300000)).length === 0, 'bracket: records deleted meanwhile (after < before) passes');
  check(br(pg(300000, 221689, 78311), q(78311, 300000), q(78311, 500000)).some((m) => /the limit changed during the test/.test(m)), 'bracket (red): a limit that changed between the reads is reported');
  check(br(pg(100000, 21689, 78311), q(78311, 300000), q(78311, 300000)).some((m) => /Total: page 100000/.test(m)), 'bracket (red): a page Total that differs from the API is reported');
  check(br(pg(300000, 200000, 78311), q(78311, 300000), q(78311, 300000)).some((m) => /Remaining: page 200000 is not Total 300000 - Used 78311/.test(m)), 'bracket (red): a Remaining that is not Total minus the page Used is reported');
  check(br(pg(1, 0.99, 0.01), q(0.01, 1), q(0.0104, 1), 2).length === 0 && br(pg(1, 0.98, 0.02), q(0.01, 1), q(0.0104, 1), 2).length > 0, 'bracket: storage in GB is compared at the two decimals the page shows (0.0104 shows as 0.01; 0.02 is outside)');
  check(br(pg(1, 0.99, 0.01), q(0.01, 1), q(0.01, 1), 2).length === 0 && br(pg(1, 0.98, 0.01), q(0.01, 1), q(0.01, 1), 2).length === 0, 'bracket: storage Remaining may differ from Total - Used by the page\'s own last-digit rounding only');

  // live per-entity totals (what a run created: billing counts creates only at its nightly refresh)
  const fakeApi = (answer: (path: string, call: number) => { status: number; totalElements?: number }) => {
    const calls: string[] = [];
    return { calls, api: { searchTotal: async (path: string): Promise<{ status: number; ok: boolean; body: { totalElements?: number } }> => { calls.push(path); const a = answer(path, calls.length); return { status: a.status, ok: a.status < 300, body: a.totalElements === undefined ? {} : { totalElements: a.totalElements } }; } } };
  };
  const all = fakeApi((_p, n) => ({ status: 200, totalElements: 1000 + n }));
  const liveAll = await readLiveCounts(all.api, NOW);
  check(all.calls.length === 9 && all.calls.length === LIVE_ENDPOINTS.length && Object.values(liveAll.counts).every((n) => typeof n === 'number') && !liveAll.incomplete, 'live counts: nine sequential searches, one per billing entity, every total read');
  check(['/search/lead', '/search/deal', '/search/contact', '/search/company', '/tasks/search', '/meetings/search', '/call-logs/search', '/quotations/search', '/notes/search'].every((p2, i) => all.calls[i] === p2), 'live counts: the endpoints are the proven ones, in order');
  const throttled = fakeApi((_p, n) => (n >= 4 ? { status: 429 } : { status: 200, totalElements: 5 }));
  const liveThrottled = await readLiveCounts(throttled.api, NOW);
  check(throttled.calls.length === 4 && liveThrottled.incomplete && liveThrottled.counts.LEAD === 5 && liveThrottled.counts.TASK === null && liveThrottled.counts.NOTE === null, 'live counts: a 429 stops the remaining searches at once (4 calls, not 9) and marks the reading incomplete');
  const oneBad = fakeApi((_p, n) => (n === 2 ? { status: 404 } : { status: 200, totalElements: 7 }));
  const liveOneBad = await readLiveCounts(oneBad.api, NOW);
  check(oneBad.calls.length === 9 && liveOneBad.counts.DEAL === null && liveOneBad.counts.LEAD === 7 && !liveOneBad.incomplete, 'live counts: a 404 on one entity leaves only that entity unread (all nine are still tried, the reading is not "incomplete")');
  const mk = (c: Record<string, number | null>): LiveCounts => ({ capturedAt: NOW.toISOString(), counts: c, incomplete: false });
  const cr = createdPerEntity(mk({ LEAD: 100, DEAL: 50, CONTACT: 10, COMPANY: null }), mk({ LEAD: 130, DEAL: 40, CONTACT: 10, COMPANY: 3 }));
  check(cr.LEAD === 30 && cr.DEAL === 0 && cr.CONTACT === 0 && cr.COMPANY === null && cr.TASK === null, 'created = live after minus before per entity; a drop is 0 (deletes are not created); a missing reading is null');
  check(createdPerEntity(null, mk({ LEAD: 5 })).LEAD === null && createdPerEntity(mk({ LEAD: 5 }), null).LEAD === null, 'created: no pre-run or no post-run live reading gives null');
  let liveCalls = 0;
  const liveDeps = (readOnly: boolean) => ({ ...deps(async () => usage()), readOnlyRun: selectionIsReadOnly(readOnly ? ['test', '--grep', '@prodSafe'] : ['test', '--project=chromium']), fetchLive: async () => { liveCalls++; return mk({ LEAD: 9 }); } });
  await runCapacityGate(liveDeps(false));
  check(liveCalls === 1 && readSnapshot(dir)?.live?.counts.LEAD === 9 && readSnapshot(dir)?.usageUpdatedAt === '2027-05-21T11:04:37.000+0000', 'gate: a run that creates records saves the live counts and the usage updatedAt in the snapshot');
  await runCapacityGate(liveDeps(true));
  check(liveCalls === 1 && readSnapshot(dir)?.live === undefined, 'gate: a read-only run takes no live counts (nothing to count, nine requests saved)');
  const liveFails = await runCapacityGate({ ...liveDeps(false), fetchLive: async () => { throw new Error('HTTP 500'); } });
  check(liveFails?.level === 'ok' && readSnapshot(dir)?.live === undefined, 'gate: a failing live reading never fails the gate (the email says "created: not available")');
  const stopsOnBilling = await runCapacityGate({ ...liveDeps(false), fetchLive: async () => mk({ LEAD: 1 }) }).then(() => 'ran');
  check(stopsOnBilling === 'ran', 'gate: live counts do not change the verdict');
  let stoppedBilling = '';
  try {
    await runCapacityGate({ ...liveDeps(false), fetchUsage: async () => usage({ records: [300000, 300000] }), fetchLive: async () => mk({ LEAD: 10 ** 9 }) });
  } catch (error) {
    stoppedBilling = String(error);
  }
  check(/No records left on qa/.test(stoppedBilling), 'gate: the stop stays on the BILLING figures (what Kylas enforces), whatever the live counts say');

  fs.rmSync(dir, { recursive: true, force: true });
  out(failures === 0 ? '\ncheck:capacity-gate — all checks passed' : `\ncheck:capacity-gate — ${failures} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  out(`check:capacity-gate crashed: ${String(error)}`);
  process.exitCode = 1;
});
