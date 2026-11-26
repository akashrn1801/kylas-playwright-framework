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
import { LiveCounts } from './liveCounts';

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
  /** Billing period and currency from GET /v1/tenants/subscription-details (no price: it is not in the API). null = could not be read. */
  billing?: { period: string | null; currency: string | null };
  /** `updatedAt` of GET /v1/tenants/usage as sent (on QA it equals renewalAt: not a refresh time, see AccountCapacity.refreshLabel). */
  usageUpdatedAt?: string | null;
  /** Live per-entity totals at this moment (src/modules/billing/liveCounts.ts); absent on a run that only reads. */
  live?: LiveCounts;
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
      usageUpdatedAt: usage.updatedAt,
    },
  };
}

export const PRE_RUN_SNAPSHOT_FILE = 'capacity-pre-run.json';
/** The reading each shard takes after its last test (src/auth/globalTeardown.ts). */
export const POST_RUN_SNAPSHOT_FILE = 'capacity-post-run.json';

/** Where a shard writes its capacity files: next to its other artifacts, same convention as the global-setup traces. */
export function capacityDir(env: string): string {
  return path.join(process.env.CI ? 'test-results' : `test-results/${env}`, 'capacity');
}
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

export function writeSnapshot(dir: string, snapshot: CapacitySnapshot, fileName: string = PRE_RUN_SNAPSHOT_FILE): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileName);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  return file;
}

/** null when there is no snapshot or it is not this version/shape (the email then simply has no "added by this run"). */
export function readSnapshot(dir: string, fileName: string = PRE_RUN_SNAPSHOT_FILE): CapacitySnapshot | null {
  return parseSnapshot(path.join(dir, fileName));
}

function parseSnapshot(file: string): CapacitySnapshot | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CapacitySnapshot>;
    return parsed.version === 1 && parsed.records && parsed.entityCounts && typeof parsed.capturedAt === 'string' ? (parsed as CapacitySnapshot) : null;
  } catch {
    return null;
  }
}

export interface GateError {
  env: string;
  capturedAt: string;
  message: string;
  readOnlyRun: boolean;
}

/** Everything the email needs, from every shard that reported: the EARLIEST pre-run snapshot and the LATEST post-run reading. */
export interface CapacityData {
  pre: CapacitySnapshot | null;
  post: CapacitySnapshot | null;
  /** How many shard snapshots were found (for the "from N shards" note). */
  preCount: number;
  postCount: number;
  errors: GateError[];
}

function filesNamed(dir: string, name: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) filesNamed(full, name, out);
    else if (e.name === name) out.push(full);
  }
  return out;
}

/**
 * Reads the capacity files wherever the shards left them: `reports/<env>/capacity/<artifact>/` (the merge job downloads one artifact
 * per shard there) and, for a single-job run (dev, prod, local), the run's own `test-results/capacity/`. The earliest pre-run
 * snapshot is the account as the run found it; the latest post-run reading is the account as the last shard left it. A file that
 * is missing or unreadable is simply absent: the email says "capacity data unavailable", never a made-up number.
 */
export function loadCapacityData(env: string, cwd: string = process.cwd()): CapacityData {
  const roots = [path.join(cwd, 'reports', env, 'capacity'), path.join(cwd, 'test-results', 'capacity'), path.join(cwd, 'test-results', env, 'capacity')];
  const collect = (name: string): CapacitySnapshot[] =>
    roots
      .flatMap((r) => filesNamed(r, name))
      .map(parseSnapshot)
      .filter((x): x is CapacitySnapshot => x !== null && x.env === env);
  const pres = collect(PRE_RUN_SNAPSHOT_FILE).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const posts = collect(POST_RUN_SNAPSHOT_FILE).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
  const errors = roots
    .flatMap((r) => filesNamed(r, GATE_ERROR_FILE))
    .flatMap((f) => {
      try {
        const e = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<GateError>;
        return typeof e.message === 'string' && e.env === env ? [{ env: e.env, capturedAt: String(e.capturedAt ?? ''), message: e.message, readOnlyRun: e.readOnlyRun === true }] : [];
      } catch {
        return [];
      }
    });
  return { pre: pres[0] ?? null, post: posts[0] ?? null, preCount: pres.length, postCount: posts.length, errors };
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
  /** The live per-entity totals (nine small searches); skipped on a read-only run, never fatal. */
  fetchLive?: () => Promise<LiveCounts>;
  /** Billing period and currency (one more read-only GET); never fatal: a failure leaves them null. */
  fetchBilling?: () => Promise<{ period: string | null; currency: string | null }>;
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
  try {
    verdict.snapshot.billing = deps.fetchBilling ? await deps.fetchBilling() : { period: null, currency: null };
  } catch {
    verdict.snapshot.billing = { period: null, currency: null };
  }
  // WHY not on a read-only run: it creates nothing, so there is nothing to count (and nine requests per shard are saved)
  if (!readOnly && deps.fetchLive) {
    try {
      verdict.snapshot.live = await deps.fetchLive();
    } catch {
      /* the email then says "created: not available" */
    }
  }
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
