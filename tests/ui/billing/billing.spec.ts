import { test, expect } from '../../../src/fixtures/index';
import { BillingApi, activePlan, recordsRemaining, Usage } from '../../../src/modules/billing/BillingApi';
import { BillingPage } from '../../../src/modules/billing/BillingPage';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

// Billing — admin, READ ONLY (Setup → Billing → Usage Statistics / Subscription Details).
// Every test only reads; nothing here clicks Manage Subscription, an upgrade, a purchase or a payment control,
// so all of them are @prodSafe. Limits are read live from the API, never hardcoded (the account's plan changes:
// QA went from 100,000 to 300,000 records on 2026-11-26).

const UNLIMITED_ENCODING_NOTE = 'unlimited totals are mapped to Infinity';

// "Data" cards the UI shows with Total / Remaining / Used, by the card title and the API block that feeds them.
const CARD_TO_QUOTA: Array<{ title: string; quota: (u: Usage) => { total: number; remaining: number; used: number } }> = [
  { title: 'Records Count', quota: (u) => u.records },
  { title: 'File Storage', quota: (u) => u.storage },
  { title: 'Custom Fields', quota: (u) => u.customFields },
  { title: 'Workflows', quota: (u) => u.quotas.workflows },
];

test.describe('Billing (admin, read-only)', () => {
  // ── BL1 ───────────────────────────────────────────────────
  // WHAT: GET /v1/tenants/usage answers 200 with the fields this suite relies on, typed as proven live.
  // WHY: every other billing check (and the pre-run gate) reads this body; a renamed or retyped field must fail here, by name.
  test('@smoke @prodSafe admin: GET /v1/tenants/usage has the expected shape', async ({ adminPage }) => {
    const api = await BillingApi.forPage(adminPage);
    try {
      const result = await api.getUsageRaw();
      expect(result.status, `GET /v1/tenants/usage: ${JSON.stringify(result.body).slice(0, 200)}`).toBe(200);
      const body = result.body;
      expect(typeof body.planName).toBe('string');
      expect(typeof body.plan?.id).toBe('string');
      expect(typeof body.plan?.name).toBe('string');
      expect(Number.isNaN(Date.parse(body.renewalAt)), 'renewalAt must be a date').toBe(false);
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
  // WHAT: the Usage Statistics numbers (Total / Remaining / Used) equal the API for Records, Storage, Custom Fields, Workflows.
  // WHY: the page and the API come from one backend value, but a rendering or units bug would show a wrong capacity.
  // HOW: page first, then the API, so the page cannot be newer than the API it is compared with. A mismatch fails by
  //   name: the numbers move only when other activity creates records between the two reads.
  test('@regression @prodSafe admin: usage statistics page numbers match the API', async ({ adminPage }) => {
    const api = await BillingApi.forPage(adminPage);
    const billing = new BillingPage(adminPage);
    try {
      await billing.goToUsageStatistics();
      const usage = await api.getUsage();
      for (const { title, quota } of CARD_TO_QUOTA) {
        const ui = await billing.readUsageSection(title);
        const expected = quota(usage);
        expect(ui.total, `${title}: Total`).toBe(expected.total);
        expect(ui.used, `${title}: Used`).toBe(expected.used);
        expect(ui.remaining, `${title}: Remaining`).toBe(expected.remaining);
      }
      logger.success('BL3 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BL4 ───────────────────────────────────────────────────
  // WHAT: plan, price card and renewal date are consistent across both pages and both endpoints.
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
      expect(active[0].renewalAt, 'active plan renewalAt vs usage renewalAt').not.toBeNull();
      expect(Date.parse(active[0].renewalAt as string), 'renewal instants').toBe(Date.parse(usage.renewalAt));

      await billing.goToSubscriptionDetails();
      const cards = await billing.readPlanCards();
      const uiActive = cards.filter((c) => c.active);
      expect(uiActive.map((c) => c.name), 'the page marks the API-active plan as the current one').toEqual([usage.planName]);
      expect(uiActive[0].price, 'active plan card shows a price').toMatch(/\d/);

      await billing.goToUsageStatistics();
      const header = await billing.readUsageHeader();
      expect(header.planName, 'usage page header plan name').toBe(usage.planName);
      const shown = Date.parse(`${header.renewalText} 12:00:00 UTC`);
      const apiDay = Date.parse(usage.renewalAt);
      expect(Math.abs(shown - apiDay), `renewal "${header.renewalText}" vs API ${usage.renewalAt} (within one day)`).toBeLessThanOrEqual(
        24 * 60 * 60 * 1000
      );
      logger.success('BL4 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BL5 ───────────────────────────────────────────────────
  // WHAT: capacity check. Records left: under the per-env threshold = warning + annotation, 0 = FAIL.
  //   Custom Fields left: under the threshold = warning + annotation, never a failure.
  // WHY: a run on an account with no records left fails far from the cause; this names it first.
  test('@smoke @prodSafe admin: account has records left (warns under the threshold, fails at 0)', async ({ adminPage }) => {
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
