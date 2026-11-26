/**
 * Billing API helper — read-only (Setup → Billing → Usage Statistics / Subscription Details).
 *
 * WHY this exists (2026-11-26, Billing exploration, QA): the usage numbers, the plan and the renewal date are the
 * account's capacity — a run on an account with no records left fails in confusing ways far from the cause. Both
 * endpoints below are GET only; nothing in this file can change a subscription, plan, seat or payment.
 *
 * Shapes proven live on QA (2026-11-26, admin): GET /v1/tenants/usage and GET /v1/tenants/subscription-details.
 *  - Counts arrive as floats (`78311.0`). "Unlimited" is a huge number (users.total ≈ 9.2e15, dashboards.total ≈ 1.8e308),
 *    mapped to Infinity by parseUsage().
 *  - Records are ONE shared pool: `records.used` equals the sum of `entityCounts`, against a single `records.total`.
 *    There is no per-entity limit.
 *  - `storage` is in GB, `storageCounts` in bytes.
 */
import { Page } from '@playwright/test';
import { ApiClient, ApiResult, readAccessToken } from '../../utils/apiClient';

export type { ApiResult };

/** Any total at or above this is the backend's encoding of "unlimited" (the smallest seen is 9.2e15). */
export const UNLIMITED_THRESHOLD = 1e15;

export interface RawQuota {
  used: number;
  total: number;
}

export interface RawEntityCount {
  entity: string;
  count: number;
}

/** Raw GET /v1/tenants/usage body: every `{used,total}` block is read by name, the rest is kept as sent. */
export interface RawUsage {
  planName: string;
  plan: { id: string; name: string };
  renewalAt: string;
  updatedAt: string;
  records: RawQuota;
  storage: RawQuota;
  customFields: RawQuota;
  entityCounts: RawEntityCount[];
  addons: Array<{ displayName: string; totalCount: number; totalCost: number; id: string }>;
  [quota: string]: unknown;
}

export interface Quota {
  used: number;
  /** Infinity when the plan has no limit. */
  total: number;
  /** total - used, never negative; Infinity when unlimited. */
  remaining: number;
  unlimited: boolean;
}

export interface Usage {
  planName: string;
  planId: string;
  /** Renewal instant as sent (ISO string). */
  renewalAt: string;
  records: Quota;
  storage: Quota;
  customFields: Quota;
  /** Used records per entity, e.g. { LEAD: 15382, DEAL: 12496 }. */
  entityCounts: Record<string, number>;
  /** Every other `{used,total}` block by its API name (workflows, layouts, scoringRules, …). */
  quotas: Record<string, Quota>;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  renewalAt: string | null;
  active: boolean;
}

export interface SubscriptionDetails {
  plans: SubscriptionPlan[];
  period: string;
  currency: string;
}

export function toQuota(raw: RawQuota): Quota {
  const unlimited = raw.total >= UNLIMITED_THRESHOLD;
  const total = unlimited ? Infinity : raw.total;
  return { used: raw.used, total, remaining: unlimited ? Infinity : Math.max(0, raw.total - raw.used), unlimited };
}

function isQuotaShape(value: unknown): value is RawQuota {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.used === 'number' && typeof v.total === 'number';
}

/** Turns the raw body into the typed shape; throws by name when a field this suite relies on is missing or mistyped. */
export function parseUsage(raw: RawUsage): Usage {
  for (const key of ['records', 'storage', 'customFields'] as const) {
    if (!isQuotaShape(raw[key])) {
      throw new Error(`GET /v1/tenants/usage: "${key}" is not {used:number,total:number}: ${JSON.stringify(raw[key])}`);
    }
  }
  if (!Array.isArray(raw.entityCounts)) {
    throw new Error('GET /v1/tenants/usage: "entityCounts" is not an array');
  }
  const quotas: Record<string, Quota> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isQuotaShape(value)) quotas[key] = toQuota(value);
  }
  return {
    planName: raw.planName,
    planId: raw.plan?.id,
    renewalAt: raw.renewalAt,
    records: toQuota(raw.records),
    storage: toQuota(raw.storage),
    customFields: toQuota(raw.customFields),
    entityCounts: Object.fromEntries(raw.entityCounts.map((e) => [e.entity, e.count])),
    quotas,
  };
}

/** Records left in the shared pool (the number the pre-run gate and the capacity check use). */
export function recordsRemaining(usage: Usage): number {
  return usage.records.remaining;
}

/** The plan with `active: true`; null when none is (the caller fails by name, nothing is guessed). */
export function activePlan(details: SubscriptionDetails): SubscriptionPlan | null {
  return details.plans.find((p) => p.active) ?? null;
}

export class BillingApi extends ApiClient {
  static async forToken(token: string): Promise<BillingApi> {
    return new BillingApi(await ApiClient.createContext(token));
  }

  static async forPage(page: Page): Promise<BillingApi> {
    return BillingApi.forToken(await readAccessToken(page));
  }

  /** Raw status and body — the RBAC tests need the refusal itself, so nothing is thrown here. */
  async getUsageRaw(): Promise<ApiResult<RawUsage>> {
    return this.send<RawUsage>('GET', '/tenants/usage');
  }

  async getSubscriptionDetailsRaw(): Promise<ApiResult<SubscriptionDetails>> {
    return this.send<SubscriptionDetails>('GET', '/tenants/subscription-details');
  }

  /** Parsed usage; throws with the status and body when the call is not 2xx. */
  async getUsage(): Promise<Usage> {
    return parseUsage(await this.sendOrThrow<RawUsage>('GET /v1/tenants/usage', 'GET', '/tenants/usage'));
  }

  async getSubscriptionDetails(): Promise<SubscriptionDetails> {
    return this.sendOrThrow<SubscriptionDetails>(
      'GET /v1/tenants/subscription-details',
      'GET',
      '/tenants/subscription-details'
    );
  }
}
