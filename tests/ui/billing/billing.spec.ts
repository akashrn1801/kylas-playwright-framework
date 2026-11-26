import { test, expect } from '../../../src/fixtures/index';
import { BillingApi, Quota, activePlan, recordsRemaining, Usage } from '../../../src/modules/billing/BillingApi';
import { bracketViolations } from '../../../src/modules/billing/bracket';
import { BillingPage } from '../../../src/modules/billing/BillingPage';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

// Billing — admin, READ ONLY (Setup → Billing → Usage Statistics / Subscription Details).
// Every test only reads; nothing here clicks Manage Subscription, an upgrade, a purchase or a payment control,
// so all of them are @prodSafe. Limits are read live from the API, never hardcoded (the account's plan changes:
// QA went from 100,000 to 300,000 records on 2026-11-26).

const UNLIMITED_ENCODING_NOTE = 'unlimited totals are mapped to Infinity';

// "Data" cards the UI shows with Total / Remaining / Used, by the card title and the API block that feeds them.
const CARD_TO_QUOTA: Array<{ title: string; quota: (u: Usage) => Quota; decimals: number }> = [
  { title: 'Records Count', quota: (u) => u.records, decimals: 0 },
  // storage is in GB and the page shows two decimals
  { title: 'File Storage', quota: (u) => u.storage, decimals: 2 },
  { title: 'Custom Fields', quota: (u) => u.customFields, decimals: 0 },
  { title: 'Workflows', quota: (u) => u.quotas.workflows, decimals: 0 },
];

test.describe('Billing (admin, read-only)', () => {
  // ── BL1 ───────────────────────────────────────────────────
  // WHAT: GET /v1/tenants/usage answers 200 with the fields this suite relies on, typed as proven live.
  // WHY: every other billing check (and the pre-run gate) reads this body; a renamed or retyped field must fail here, by name.
  test('@smoke @regression @prodSafe admin: GET /v1/tenants/usage has the expected shape', async ({ adminPage }) => {
    const api = await BillingApi.forPage(adminPage);
    try {
      const result = await api.getUsageRaw();
      expect(result.status, `GET /v1/tenants/usage: ${JSON.stringify(result.body).slice(0, 200)}`).toBe(200);
      const body = result.body;
      expect(typeof body.planName).toBe('string');
      expect(typeof body.plan?.id).toBe('string');
      expect(typeof body.plan?.name).toBe('string');
      if (body.renewalAt !== null) expect(Number.isNaN(Date.parse(body.renewalAt)), 'renewalAt must be a date').toBe(false);
      const usage = await api.getUsage(); // parseUsage() throws by name on a missing or mistyped {used,total} block
      for (const [name, q] of Object.entries({ records: usage.records, storage: usage.storage, customFields: usage.customFields, ...usage.quotas })) {
        expect(q.used, `${name}.used`).toBeGreaterThanOrEqual(0);
        expect(q.total, `${name}.total`).toBeGreaterThanOrEqual(0);
        expect(q.used, `${name}.used must not exceed its total (${UNLIMITED_ENCODING_NOTE})`).toBeLessThanOrEqual(q.total);
      }
      expect(body.entityCounts.length, 'entityCounts must list the entities').toBeGreaterThan(0);
      for (const e of body.entityCounts) {
        expect(typeof e.entity).toBe('string');
        expect(e.count, `entityCounts ${e.entity}`).toBeGreaterThanOrEqual(0);
      }
      logger.success('BL1 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BL2 ───────────────────────────────────────────────────
  // WHAT: records.used equals the sum of entityCounts (records are one shared pool, no per-entity limit).
  // WHY: the email's per-entity figures and the pool figure must agree; proven equal live (78,311 on QA, 2026-11-26).
  test('@regression @prodSafe admin: records used equals the sum of the per-entity counts', async ({ adminPage }) => {
    const api = await BillingApi.forPage(adminPage);
    try {
      const usage = await api.getUsage();
      const sum = Object.values(usage.entityCounts).reduce((a, b) => a + b, 0);
      expect(usage.records.used, `records.used vs sum of entityCounts ${JSON.stringify(usage.entityCounts)}`).toBe(sum);
      logger.success('BL2 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BL3 ───────────────────────────────────────────────────
  // WHAT: the Usage Statistics numbers (Total / Remaining / Used) agree with the API for Records, Storage, Custom Fields, Workflows.
  // WHY: the page and the API come from one backend value, but a rendering or units bug would show a wrong capacity.
  // HOW (bracketed): the account is shared and other shards create records while this runs, so a count read at two instants can differ. The API
  //   is read BEFORE and AFTER the page: Total (the limit) must equal exactly across all three, the page's Used must lie between the two API
  //   values (inclusive) and Remaining must equal Total minus the page's own Used (src/modules/billing/bracket.ts).
  test('@regression @prodSafe admin: usage statistics page numbers match the API (bracketed)', async ({ adminPage }) => {
    const api = await BillingApi.forPage(adminPage);
    const billing = new BillingPage(adminPage);
    try {
      const before = await api.getUsage();
      await billing.goToUsageStatistics();
      const onPage = new Map<string, Awaited<ReturnType<BillingPage['readUsageSection']>>>();
      for (const { title } of CARD_TO_QUOTA) onPage.set(title, await billing.readUsageSection(title));
      const after = await api.getUsage();
      for (const { title, quota, decimals } of CARD_TO_QUOTA) {
        const problems = bracketViolations(title, onPage.get(title)!, quota(before), quota(after), decimals);
        expect(problems, `${title}: page vs the API read before and after it`).toEqual([]);
      }
      logger.success('BL3 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BL4 ───────────────────────────────────────────────────
  // WHAT: plan, price card and renewal date are consistent across both pages and both endpoints. The current plan is the one
  //   with active:true in GET /v1/tenants/subscription-details; the page must show THAT plan as current (usage header, plan card).
  // WHY: one plan name and one renewal date must appear everywhere; exactly one plan in subscription-details is active.
  // HOW: the UI date is compared to the API date within one day (the page formats in the account timezone, the API sends UTC).
  test('@regression @prodSafe admin: subscription details are consistent with the usage data', async ({ adminPage }) => {
    const api = await BillingApi.forPage(adminPage);
    const billing = new BillingPage(adminPage);
    try {
      const usage = await api.getUsage();
      const details = await api.getSubscriptionDetails();
      const active = details.plans.filter((p) => p.active);
      expect(active.length, `exactly one active plan; found ${JSON.stringify(active.map((p) => p.id))}`).toBe(1);
      expect(active[0].name, 'active plan name (subscription-details) vs planName (usage)').toBe(usage.planName);
      expect(active[0].id, 'active plan id vs usage plan id').toBe(usage.planId);
      // a free plan (Embark) has no renewal: the API decides whether one must exist and agree
      const hasRenewal = active[0].renewalAt !== null;
      if (hasRenewal) {
        expect(Date.parse(active[0].renewalAt as string), 'renewal instants (subscription-details vs usage)').toBe(Date.parse(usage.renewalAt as string));
      } else {
        expect(usage.renewalAt, 'no renewal on the active plan, so none in usage either').toBeNull();
      }

      await billing.goToSubscriptionDetails();
      const cards = await billing.readPlanCards();
      const activeCards = cards.filter((c) => c.name === active[0].name);
      expect(activeCards.length, `the page lists the API-active plan "${active[0].name}" (cards: ${cards.map((c) => c.name).join(', ')})`).toBe(1);
      expect(activeCards[0].price, 'the active plan card shows a price').not.toBe('');
      // WHY the renewal line is conditional: a free plan (Embark) has no renewal, so the API's renewalAt decides whether the page must show one
      expect(activeCards[0].showsRenewal, `renewal line on the active plan card (API renewalAt ${active[0].renewalAt})`).toBe(hasRenewal);

      await billing.goToUsageStatistics();
      const header = await billing.readUsageHeader();
      expect(header.planName, 'usage page header plan name').toBe(usage.planName);
      if (hasRenewal) {
        const shown = Date.parse(`${header.renewalText} 12:00:00 UTC`);
        const apiDay = Date.parse(usage.renewalAt as string);
        expect(Math.abs(shown - apiDay), `renewal "${header.renewalText}" vs API ${usage.renewalAt} (within one day)`).toBeLessThanOrEqual(
          24 * 60 * 60 * 1000
        );
      } else {
        expect(header.renewalText, 'no renewal date on the usage page header').toBe('');
      }
      logger.success('BL4 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BL5 ───────────────────────────────────────────────────
  // WHAT: capacity check. Records left: under the per-env threshold = warning + annotation, 0 = FAIL.
  //   Custom Fields left: under the threshold = warning + annotation, never a failure.
  // WHY: a run on an account with no records left fails far from the cause; this names it first.
  test('@smoke @regression @prodSafe admin: account has records left (warns under the threshold, fails at 0)', async ({ adminPage }) => {
    const api = await BillingApi.forPage(adminPage);
    try {
      const usage = await api.getUsage();
      const left = recordsRemaining(usage);
      const warnBelow = config.billing.recordsWarnBelow[config.env];
      logger.info(`Records: ${usage.records.used} used of ${usage.records.total}, ${left} left (warn under ${warnBelow})`);
      if (left > 0 && left < warnBelow) {
        const message = `Only ${left} records left (warn under ${warnBelow}) on ${config.env}`;
        logger.warn(message);
        test.info().annotations.push({ type: 'capacity-warning', description: message });
      }
      const cfLeft = usage.customFields.remaining;
      if (cfLeft < config.billing.customFieldsWarnBelow) {
        const message = `Only ${cfLeft} custom fields left (warn under ${config.billing.customFieldsWarnBelow}) on ${config.env}`;
        logger.warn(message);
        test.info().annotations.push({ type: 'capacity-warning', description: message });
      }
      expect(left, `No records left on ${config.env}: ${usage.records.used} used of ${usage.records.total}`).toBeGreaterThan(0);
      logger.success('BL5 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BL8 ───────────────────────────────────────────────────
  // WHAT: the active plan (subscription-details, the plan with active:true) and planName (usage) agree and equal the
  //   plan this environment is expected to be on (config.billing.expectedPlan).
  // WHY: QA was moved to a plan with different limits before; a downgrade to Embark (free, 1,000 records) breaks the suite
  //   by capacity, not by a product bug, so it is named here: "Plan changed: expected X, found Y" plus the record limit.
  // HOW: prod's expected plan comes from PROD_EXPECTED_PLAN; unset = skipped with a log line, never guessed.
  test('@regression @prodSafe admin: the account is on the expected plan', async ({ adminPage }) => {
    const expected = config.billing.expectedPlan[config.env];
    if (!expected) {
      logger.warn(`No expected plan configured for ${config.env} (PROD_EXPECTED_PLAN unset): plan check skipped`);
      test.skip(true, `No expected plan configured for ${config.env}`);
    }
    const api = await BillingApi.forPage(adminPage);
    try {
      const usage = await api.getUsage();
      const details = await api.getSubscriptionDetails();
      const active = activePlan(details);
      expect(active, 'subscription-details has no active plan').not.toBeNull();
      expect(active?.name, `plan from subscription-details (${active?.id}) vs planName from usage (${usage.planName})`).toBe(usage.planName);
      expect(
        usage.planName,
        `Plan changed: expected ${expected}, found ${usage.planName} (record limit ${usage.records.total})`
      ).toBe(expected);
      logger.success('BL8 passed');
    } finally {
      await api.dispose();
    }
  });
});
