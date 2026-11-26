/**
 * The email's "Account capacity" content (2026-11-26, ADR 0019), as plain data: EmailTemplate only renders it. No fs, no clock of its
 * own: `now` is the moment the email is generated.
 *
 * Source: the EARLIEST pre-run snapshot and the LATEST post-run reading across the shards (loadCapacityData). Records are ONE shared
 * pool; Custom Fields and Storage have their own totals. The colour rule is the gate's: red at 0 left, yellow under the threshold,
 * green otherwise (Custom Fields: under 10 left; Storage: under 10% of its total). The change during the run is post minus pre
 * and is labelled as possibly including other activity: the account is shared, so a number this run did not create can be in it.
 * The plan price is not shown: it is not in the API.
 */
import { CapacityColour, CapacityData, CapacitySnapshot, QuotaSnapshot, capacityColour } from '../modules/billing/capacity';

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
  /** post minus pre; null when there is no post-run reading. */
  change: number | null;
  /** Plain words next to the bar: "plenty left", "low", "none left". */
  state: string;
}

export interface CapacityEntityRow {
  entity: string;
  used: number;
  change: number | null;
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
  rows: CapacityRow[];
  entities: CapacityEntityRow[];
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
  const round = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    key,
    label,
    unit,
    used: q.used,
    total: q.total,
    remaining,
    colour,
    usedPct,
    change: post ? round(post.used - pre.used) : null,
    state: colour === 'red' ? 'none left' : colour === 'yellow' ? 'low' : 'plenty left',
  };
}

function warningColour(text: string): 'yellow' | 'red' {
  return /^PLAN:|none left/.test(text) ? 'red' : 'yellow';
}

/** Turns what the shards left behind into the section's data. `now` = the email's generation time (ISO or ms). */
export function buildCapacityView(data: CapacityData | null | undefined, now: string | number): CapacityView {
  const empty: CapacityView = { available: false, unavailableReason: '', plan: null, warnings: [], rows: [], entities: [], postMissing: false, preCount: 0, postCount: 0, blocked: null };
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

  const entityNames = [...new Set([...Object.keys(pre.entityCounts), ...Object.keys(post?.entityCounts ?? {})])];
  const entities = entityNames
    .map((entity) => ({ entity, used: (post ?? pre).entityCounts[entity] ?? 0, change: post ? (post.entityCounts[entity] ?? 0) - (pre.entityCounts[entity] ?? 0) : null }))
    .sort((a, b) => b.used - a.used);

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
    rows,
    entities,
    postMissing: !post,
    preCount: data.preCount,
    postCount: data.postCount,
    blocked,
  };
}
