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
import { parseUsage, RawUsage, Usage } from '../src/modules/billing/BillingApi';
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

  fs.rmSync(dir, { recursive: true, force: true });
  out(failures === 0 ? '\ncheck:capacity-gate — all checks passed' : `\ncheck:capacity-gate — ${failures} check(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  out(`check:capacity-gate crashed: ${String(error)}`);
  process.exitCode = 1;
});
