/**
 * Account capacity: the pure rules behind the pre-run gate (globalSetup) and, in the next piece, the run email's
 * "Account capacity" section. No network, no clock of its own and no fs except the two snapshot helpers at the end.
 *
 * WHY (2026-11-26): when an account reaches its record limit Kylas answers the next create with its "Upgrade your plan"
 * modal and every test that creates data fails far from the cause (57 tests on one run). The gate reads
 * GET /v1/tenants/usage once before any test, stops the run at 0 records left and warns before that.
 *
 * Records are ONE shared pool (records.used = sum of entityCounts, one total). Custom Fields have their own count and
 * only ever warn.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Quota, Usage } from './BillingApi';
import { extractFileFilters } from '../../auth/productFixtureNeed';

export type CapacityLevel = 'ok' | 'warn' | 'stop';

/** Colour the email bar uses; the same rule everywhere: red at 0, yellow under the threshold, green otherwise. */
export type CapacityColour = 'green' | 'yellow' | 'red';

export interface CapacityThresholds {
  /** Records left under which the gate warns (the run still goes ahead). */
  recordsWarnBelow: number;
  /** Custom fields left under which the gate warns; it never stops a run. */
  customFieldsWarnBelow: number;
  /** Plan name this environment is expected to be on; empty = no plan check. */
  expectedPlan: string;
}

export interface QuotaSnapshot {
  used: number;
  /** null = unlimited (JSON cannot hold Infinity). */
  total: number | null;
  remaining: number | null;
}

export interface CapacitySnapshot {
  version: 1;
  env: string;
  capturedAt: string;
  planName: string;
  planId: string;
  renewalAt: string | null;
  records: QuotaSnapshot;
  customFields: QuotaSnapshot;
  storage: QuotaSnapshot;
  /** Used records per entity at capture time, e.g. { LEAD: 15382 }. */
  entityCounts: Record<string, number>;
  thresholds: CapacityThresholds;
  level: CapacityLevel;
  /** Human-readable warnings, in the order they were found (the email shows them). */
  warnings: string[];
  /** True when the run only reads (selection decided): "stop" was then downgraded to a warning and the run went on. */
  readOnlyRun?: boolean;
}

export interface CapacityVerdict {
  level: CapacityLevel;
  warnings: string[];
  /** Set when level is "stop": the message the run fails with. */
  stopMessage?: string;
  snapshot: CapacitySnapshot;
}

/** 0 left (or fewer) is red; under the threshold is yellow; unlimited is always green. */
export function capacityColour(remaining: number, warnBelow: number): CapacityColour {
  if (remaining <= 0) return 'red';
  return remaining < warnBelow ? 'yellow' : 'green';
}

function snapshotOf(q: Quota): QuotaSnapshot {
  return {
    used: q.used,
    total: q.unlimited ? null : q.total,
    remaining: q.unlimited ? null : q.remaining,
  };
}

const fmt = (n: number): string => n.toLocaleString('en-US');

/**
 * Judges one usage reading. `stop` only for the records pool at 0 left; everything else is a warning.
 * `now` is passed in (the check script pins it); the plan check is skipped when no expected plan is configured.
 */
export function evaluateCapacity(usage: Usage, env: string, thresholds: CapacityThresholds, now: Date): CapacityVerdict {
  const warnings: string[] = [];
  const recordsLeft = usage.records.remaining;
  const recordsTotal = usage.records.unlimited ? 'unlimited' : fmt(usage.records.total);

  if (thresholds.expectedPlan && usage.planName !== thresholds.expectedPlan) {
    warnings.push(
      `PLAN: expected "${thresholds.expectedPlan}", found "${usage.planName}" (record limit ${recordsTotal}) on ${env}: the account is not on its expected plan, so limits differ from what the suite was sized for`
    );
  }
  if (recordsLeft > 0 && recordsLeft < thresholds.recordsWarnBelow) {
    warnings.push(
      `RECORDS: only ${fmt(recordsLeft)} left of ${recordsTotal} (warn under ${fmt(thresholds.recordsWarnBelow)}) on ${env}; ${fmt(usage.records.used)} used`
    );
  }
  const cfLeft = usage.customFields.remaining;
  if (cfLeft < thresholds.customFieldsWarnBelow) {
    warnings.push(
      `CUSTOM FIELDS: only ${fmt(cfLeft)} left of ${usage.customFields.unlimited ? 'unlimited' : fmt(usage.customFields.total)} (warn under ${thresholds.customFieldsWarnBelow}) on ${env}; this never stops a run`
    );
  }

  const stop = recordsLeft <= 0;
  const stopMessage = stop
    ? `No records left on ${env}: ${fmt(usage.records.used)} used of ${recordsTotal} (plan ${usage.planName}). Kylas answers a create at the limit with its "Upgrade your plan" modal, so every test that creates data would fail. The run is stopped before any test.`
    : undefined;
  const level: CapacityLevel = stop ? 'stop' : warnings.length ? 'warn' : 'ok';
  return {
    level,
    warnings,
    ...(stopMessage ? { stopMessage } : {}),
    snapshot: {
      version: 1,
      env,
      capturedAt: now.toISOString(),
      planName: usage.planName,
      planId: usage.planId,
      renewalAt: usage.renewalAt,
      records: snapshotOf(usage.records),
      customFields: snapshotOf(usage.customFields),
      storage: snapshotOf(usage.storage),
      entityCounts: usage.entityCounts,
      thresholds,
      level,
      warnings,
    },
  };
}

export const PRE_RUN_SNAPSHOT_FILE = 'capacity-pre-run.json';
/** Written when the usage call failed, so the email can say "capacity unknown" instead of saying nothing. */
export const GATE_ERROR_FILE = 'capacity-gate-error.json';

export interface ReadOnlyRun {
  readOnly: boolean;
  reason: string;
}

const READ_ONLY_PATH = /(^|[\\/])billing([\\/]|$)/;

/**
 * Does this Playwright invocation create no records? Decided from the command line (process.argv, the only place the
 * selection is visible to globalSetup — see productFixtureNeed.ts). Read-only only when it can be PROVEN:
 *  - `--grep @prodSafe` exactly (prod.yml, Jenkinsfile.prod): every selected test is tagged @prodSafe, which means read-only
 *    (check:conventions enforces the tag's meaning); or
 *  - every file filter is a billing spec (tests/ui/billing, tests/rbac/billing), which only read.
 * Anything else, including an ambiguous command line, is NOT read-only: the safe direction is the stop.
 */
export function selectionIsReadOnly(cliArgs: string[]): ReadOnlyRun {
  const greps: string[] = [];
  for (let i = 0; i < cliArgs.length; i++) {
    const a = cliArgs[i];
    if ((a === '--grep' || a === '-g') && i + 1 < cliArgs.length) greps.push(cliArgs[++i]);
    else if (a.startsWith('--grep=')) greps.push(a.slice('--grep='.length));
  }
  if (greps.length > 0 && greps.every((g) => g.trim() === '@prodSafe')) {
    return { readOnly: true, reason: '--grep @prodSafe selects only read-only tests' };
  }
  const { filters, ambiguous } = extractFileFilters(cliArgs);
  if (!ambiguous && filters.length > 0 && filters.every((f) => READ_ONLY_PATH.test(f))) {
    return { readOnly: true, reason: `only billing specs are selected (${filters.join(', ')}), which only read` };
  }
  return { readOnly: false, reason: 'the selection may create records' };
}

export function writeGateError(dir: string, entry: { env: string; capturedAt: string; message: string; readOnlyRun: boolean }): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, GATE_ERROR_FILE);
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, ...entry }, null, 2)}\n`);
  return file;
}

export function writeSnapshot(dir: string, snapshot: CapacitySnapshot): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, PRE_RUN_SNAPSHOT_FILE);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  return file;
}

/** null when there is no snapshot or it is not this version/shape (the email then simply has no "added by this run"). */
export function readSnapshot(dir: string): CapacitySnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, PRE_RUN_SNAPSHOT_FILE), 'utf8')) as Partial<CapacitySnapshot>;
    return parsed.version === 1 && parsed.records && parsed.entityCounts ? (parsed as CapacitySnapshot) : null;
  } catch {
    return null;
  }
}

export interface CapacityGateDeps {
  /** One reading of GET /v1/tenants/usage (globalSetup wraps it in its transient retry). */
  fetchUsage: () => Promise<Usage>;
  env: string;
  thresholds: CapacityThresholds;
  /** Where the pre-run snapshot is written. */
  dir: string;
  now: Date;
  log: (line: string) => void;
  warn: (line: string) => void;
  /** From selectionIsReadOnly(process.argv): a run that only reads warns instead of stopping. Absent = stops. */
  readOnlyRun?: ReadOnlyRun;
}

/**
 * The pre-run gate. Reads usage once, saves the snapshot, warns loudly for each warning, and THROWS when no records are
 * left or the reading failed (an unknown capacity is not "fine"), unless the run only reads: then both become loud
 * warnings and the run goes on (nothing it does can hit the limit). Returns the verdict, or null when the reading failed
 * on a read-only run.
 */
export async function runCapacityGate(deps: CapacityGateDeps): Promise<CapacityVerdict | null> {
  const readOnly = deps.readOnlyRun?.readOnly === true;
  const why = deps.readOnlyRun?.reason ?? '';
  let usage: Usage;
  try {
    usage = await deps.fetchUsage();
  } catch (error) {
    const message = `could not read GET /v1/tenants/usage on ${deps.env}, so the account's capacity is unknown. ${String(error)}`;
    writeGateError(deps.dir, { env: deps.env, capturedAt: deps.now.toISOString(), message, readOnlyRun: readOnly });
    if (readOnly) {
      deps.warn(`[globalSetup] !!! CAPACITY WARNING — ${message} The run only reads (${why}), so it continues.`);
      return null;
    }
    throw new Error(`[globalSetup] CAPACITY GATE: ${message} The run is stopped.`);
  }
  const verdict = evaluateCapacity(usage, deps.env, deps.thresholds, deps.now);
  if (readOnly) {
    verdict.snapshot.readOnlyRun = true;
    if (verdict.level === 'stop') {
      verdict.warnings.unshift(`RECORDS: none left, but the run only reads (${why}), so it continues`);
      verdict.snapshot.warnings = verdict.warnings;
    }
  }
  const file = writeSnapshot(deps.dir, verdict.snapshot);
  for (const warning of verdict.warnings) deps.warn(`[globalSetup] !!! CAPACITY WARNING — ${warning}`);
  if (verdict.level === 'stop' && !readOnly) throw new Error(`[globalSetup] CAPACITY GATE: ${verdict.stopMessage}`);
  const s = verdict.snapshot;
  deps.log(
    `[globalSetup] Capacity gate: ${verdict.level}${readOnly ? ' (read-only run, never stops)' : ''} — plan ${s.planName}, records ${s.records.used} used / ${s.records.total ?? 'unlimited'} (${s.records.remaining ?? 'unlimited'} left), snapshot ${file}`
  );
  return verdict;
}
