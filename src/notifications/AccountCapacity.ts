/**
 * The email's "Account capacity" content (2026-11-26, ADR 0019), as plain data: EmailTemplate only renders it. No fs, no clock of its
 * own: `now` is the moment the email is generated.
 *
 * Source: the EARLIEST pre-run snapshot and the LATEST post-run reading across the shards (loadCapacityData). Records are ONE shared
 * pool; Custom Fields and Storage have their own totals. The colour rule is the gate's: red at 0 left, yellow under the threshold,
 * green otherwise (Custom Fields: under 10 left; Storage: under 10% of its total).
 *
 * The billing figures are "as of the last refresh" (2026-11-26: Kylas counts a delete at once but a create only at its nightly refresh), so post
 * minus pre of the billing figures shows deletions only. What a run CREATED is the difference of the LIVE per-entity totals (liveCounts.ts) read at
 * the gate and at the teardown, and "expected after the next refresh" is the records left minus that. Both are labelled: the account is shared, so
 * the created figure can include other activity, and the search index behind it can lag.
 * The plan price is not shown: it is not in the API.
 */
import { CapacityColour, CapacityData, CapacitySnapshot, QuotaSnapshot, capacityColour } from '../modules/billing/capacity';
import { LIVE_ENDPOINTS, createdPerEntity } from '../modules/billing/liveCounts';

export const RENEWAL_WARN_DAYS = 14;
/** Storage turns yellow when less than this share of its total is left. */
export const STORAGE_WARN_FRACTION = 0.1;

export interface CapacityBlock {
  kind: 'no-records' | 'unreadable';
  /** One sentence for the verdict headline and the BLOCKED email. */
  message: string;
}

export interface CapacityRow {
  key: 'records' | 'customFields' | 'storage';
  label: string;
  unit: string;
  used: number;
  /** null = unlimited. */
  total: number | null;
  remaining: number | null;
  colour: CapacityColour;
  /** 0..100, the filled part of the bar (always 0 for an unlimited quota). */
  usedPct: number;
  /** Plain words next to the bar: "plenty left", "low", "none left". */
  state: string;
}

export interface CapacityEntityRow {
  entity: string;
  /** Billing figure, as of the last refresh. */
  used: number;
  /** Created during the run: live total after minus live total before; null when either reading is missing. */
  created: number | null;
}

export interface CapacityCreated {
  /** Sum over the entities that have a figure; null when none has. */
  total: number | null;
  /** Why there is no (complete) figure, empty when every entity has one. */
  reason: string;
  /** Records left now (billing, latest reading) minus `total`: what the billing figure should show after the next refresh. null when unknown or unlimited. */
  expectedLeft: number | null;
  expectedColour: CapacityColour | null;
  /** True when some entities could not be read: `total` is then a lower bound and the estimate is "at most". */
  partial: boolean;
}

export interface CapacityWarning {
  colour: 'yellow' | 'red';
  text: string;
}

export interface CapacityPlanView {
  name: string;
  period: string | null;
  currency: string | null;
  renewalAt: string | null;
  /** Whole days from `now` to the renewal (negative = past); null when the plan has no renewal. */
  daysLeft: number | null;
  colour: 'green' | 'yellow' | 'red';
  /** Why the header is yellow or red, empty when green. */
  note: string;
  expectedPlan: string;
  planIsExpected: boolean;
}

export interface CapacityView {
  available: boolean;
  /** When not available: why, in a short line. */
  unavailableReason: string;
  plan: CapacityPlanView | null;
  warnings: CapacityWarning[];
  /** "as of the last refresh: <IST>" when Kylas sent a plausible time, else the label without one. */
  refreshLabel: string;
  rows: CapacityRow[];
  entities: CapacityEntityRow[];
  created: CapacityCreated;
  /** True when there is a pre-run snapshot but no post-run reading (the "change" cells then say so). */
  postMissing: boolean;
  preCount: number;
  postCount: number;
  blocked: CapacityBlock | null;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

/** A gate stop that is not a read-only run's warning, or an unreadable capacity on a run that creates records. */
export function capacityBlock(data: CapacityData | null | undefined): CapacityBlock | null {
  if (!data) return null;
  if (data.pre?.level === 'stop' && !data.pre.readOnlyRun) {
    const s = data.pre;
    return {
      kind: 'no-records',
      message: `no records left on ${s.env}: ${fmt(s.records.used)} used of ${s.records.total === null ? 'unlimited' : fmt(s.records.total)} (plan ${s.planName}); the capacity gate stopped the run before any test`,
    };
  }
  const stopped = data.errors.find((e) => !e.readOnlyRun);
  if (stopped && !data.pre) {
    return { kind: 'unreadable', message: `the capacity gate could not read the account's usage, so the run was stopped before any test (${stopped.message.replace(/\s+/g, ' ').slice(0, 160)})` };
  }
  return null;
}

function row(key: CapacityRow['key'], label: string, unit: string, pre: QuotaSnapshot, post: QuotaSnapshot | null, warnBelow: (q: QuotaSnapshot) => number): CapacityRow {
  const q = post ?? pre; // the latest reading is the account as it is now
  const remaining = q.remaining;
  const colour: CapacityColour = remaining === null ? 'green' : capacityColour(remaining, warnBelow(q));
  const usedPct = q.total === null || q.total <= 0 ? 0 : Math.min(100, Math.max(q.used > 0 ? 1 : 0, Math.round((q.used / q.total) * 100)));
  return {
    key,
    label,
    unit,
    used: q.used,
    total: q.total,
    remaining,
    colour,
    usedPct,
    state: colour === 'red' ? 'none left' : colour === 'yellow' ? 'low' : 'plenty left',
  };
}

/**
 * "as of the last refresh: <time in IST>" only when `updatedAt` can be a refresh time: not after the moment it was read and not equal to the
 * renewal (observed on QA 2026-11-26: usage.updatedAt EQUALS renewalAt, 21 May 2027, a future date). Otherwise the label says the same without
 * inventing a time. If Kylas ever sends a real refresh time, it shows here with no code change.
 */
export function refreshLabel(snapshot: CapacitySnapshot): string {
  const at = snapshot.usageUpdatedAt ? Date.parse(snapshot.usageUpdatedAt) : NaN;
  const plausible = Number.isFinite(at) && at <= Date.parse(snapshot.capturedAt) && snapshot.usageUpdatedAt !== snapshot.renewalAt;
  if (!plausible) return 'as of the last refresh (Kylas sends no refresh time)';
  return `as of the last refresh: ${new Date(at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeZoneName: 'short' })}`;
}

function warningColour(text: string): 'yellow' | 'red' {
  return /^PLAN:|none left/.test(text) ? 'red' : 'yellow';
}

/** Turns what the shards left behind into the section's data. `now` = the email's generation time (ISO or ms). */
export function buildCapacityView(data: CapacityData | null | undefined, now: string | number): CapacityView {
  const empty: CapacityView = { available: false, unavailableReason: '', plan: null, warnings: [], refreshLabel: '', rows: [], entities: [], created: { total: null, reason: '', expectedLeft: null, expectedColour: null, partial: false }, postMissing: false, preCount: 0, postCount: 0, blocked: null };
  const blocked = capacityBlock(data);
  if (!data || !data.pre) {
    const why = data?.errors.length ? `the capacity gate could not read the account's usage (${data.errors[0].message.replace(/\s+/g, ' ').slice(0, 140)})` : 'no pre-run snapshot reached this report (the gate did not run, or its artifact was not downloaded)';
    return { ...empty, unavailableReason: why, blocked };
  }
  const pre: CapacitySnapshot = data.pre;
  const post = data.post;
  const latest = post ?? pre;
  const nowMs = typeof now === 'number' ? now : Date.parse(now);

  const rows = [
    row('records', 'Records (shared pool)', '', pre.records, post?.records ?? null, () => pre.thresholds.recordsWarnBelow),
    row('customFields', 'Custom Fields', '', pre.customFields, post?.customFields ?? null, () => pre.thresholds.customFieldsWarnBelow),
    row('storage', 'File Storage', ' GB', pre.storage, post?.storage ?? null, (q) => (q.total === null ? 0 : q.total * STORAGE_WARN_FRACTION)),
  ];

  const created = createdPerEntity(pre.live, post?.live);
  const entityNames = [...new Set([...Object.keys(pre.entityCounts), ...Object.keys(post?.entityCounts ?? {})])];
  const entities = entityNames
    .map((entity) => ({ entity, used: (post ?? pre).entityCounts[entity] ?? 0, created: created[entity] ?? null }))
    .sort((a, b) => b.used - a.used);
  const known = LIVE_ENDPOINTS.map((e) => created[e.entity]).filter((n): n is number => typeof n === 'number');
  const createdTotal = known.length > 0 ? known.reduce((a, b) => a + b, 0) : null;
  const liveReason = pre.readOnlyRun || latest.readOnlyRun
    ? 'this run only reads, so it creates no records'
    : !pre.live
      ? 'no live per-entity counts were taken at the start of the run'
      : !post
        ? 'no post-run reading reached this report'
        : !post.live
          ? 'no live per-entity counts were taken after the run'
          : known.length < LIVE_ENDPOINTS.length || pre.live.incomplete || post.live.incomplete
            ? `${LIVE_ENDPOINTS.length - known.length} of ${LIVE_ENDPOINTS.length} entities could not be read (a throttled or failing search stopped the rest)`
            : '';
  const left = latest.records.remaining;
  const expectedLeft = createdTotal !== null && left !== null ? left - createdTotal : null;

  const renewalMs = latest.renewalAt ? Date.parse(latest.renewalAt) : NaN;
  const daysLeft = Number.isFinite(renewalMs) ? Math.floor((renewalMs - nowMs) / 86_400_000) : null;
  const expectedPlan = pre.thresholds.expectedPlan;
  const planIsExpected = !expectedPlan || latest.planName === expectedPlan;
  let colour: CapacityPlanView['colour'] = 'green';
  const notes: string[] = [];
  if (!planIsExpected) {
    colour = 'red';
    notes.push(`expected plan "${expectedPlan}", found "${latest.planName}"`);
  }
  if (daysLeft !== null && daysLeft < 0) {
    colour = 'red';
    notes.push(`renewal date passed ${-daysLeft} ${-daysLeft === 1 ? 'day' : 'days'} ago`);
  } else if (daysLeft !== null && daysLeft <= RENEWAL_WARN_DAYS) {
    if (colour === 'green') colour = 'yellow';
    notes.push(`renews in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} (under ${RENEWAL_WARN_DAYS + 1} days)`);
  }

  // warnings of the latest reading (the gate's own wording, so the email, the log and the snapshot agree), then the renewal notes
  const warnings: CapacityWarning[] = latest.warnings.map((text) => ({ colour: warningColour(text), text }));
  if (post && pre.warnings.length > 0) {
    for (const text of pre.warnings) if (!latest.warnings.includes(text) && !/^PLAN:/.test(text)) warnings.push({ colour: warningColour(text), text: `${text} (at the start of the run)` });
  }
  if (expectedLeft !== null && createdTotal! > 0 && expectedLeft < pre.thresholds.recordsWarnBelow) {
    warnings.push({ colour: expectedLeft <= 0 ? 'red' : 'yellow', text: `ESTIMATE: ${known.length < LIVE_ENDPOINTS.length ? 'at most ' : ''}about ${expectedLeft <= 0 ? `none left (over by ${(-expectedLeft).toLocaleString('en-US')})` : `${expectedLeft.toLocaleString('en-US')} records left`} after the next refresh (warn under ${pre.thresholds.recordsWarnBelow.toLocaleString('en-US')}); this run created ${createdTotal!.toLocaleString('en-US')}` });
  }
  if (daysLeft !== null && daysLeft <= RENEWAL_WARN_DAYS) warnings.push({ colour: daysLeft < 0 ? 'red' : 'yellow', text: `RENEWAL: ${notes[notes.length - 1]}` });

  return {
    available: true,
    unavailableReason: '',
    plan: {
      name: latest.planName,
      period: latest.billing?.period ?? pre.billing?.period ?? null,
      currency: latest.billing?.currency ?? pre.billing?.currency ?? null,
      renewalAt: latest.renewalAt,
      daysLeft,
      colour,
      note: notes.join('; '),
      expectedPlan,
      planIsExpected,
    },
    warnings,
    refreshLabel: refreshLabel(latest),
    rows,
    entities,
    created: { total: createdTotal, reason: liveReason, expectedLeft, expectedColour: expectedLeft === null ? null : capacityColour(expectedLeft, pre.thresholds.recordsWarnBelow), partial: known.length < LIVE_ENDPOINTS.length },
    postMissing: !post,
    preCount: data.preCount,
    postCount: data.postCount,
    blocked,
  };
}
