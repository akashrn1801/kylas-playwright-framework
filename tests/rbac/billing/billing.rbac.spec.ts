import { test, expect } from '../../../src/fixtures/index';
import { BillingApi } from '../../../src/modules/billing/BillingApi';
import { BillingPage } from '../../../src/modules/billing/BillingPage';
import { config } from '../../../config/config';
import { applyKnownBugVerdict } from '../../../src/utils/knownIssue';
import { logger } from '../../../src/utils/logger';

// Billing — restricted user (read-only: only page opens and GETs; nothing that changes a subscription).

test.describe('Billing (restricted user, read-only)', () => {
  // ── BLR1 ──────────────────────────────────────────────────
  // WHAT: the restricted user cannot open Usage Statistics or Subscription Details (the app's "Forbidden" page), and the
  //   API refuses GET /v1/tenants/subscription-details.
  // WHY: billing is an admin area; hidden in the UI and refused by the API.
  // Observed live on QA 2026-11-26: both pages "Forbidden"; subscription-details HTTP 400, code 001019.
  test('@regression @prodSafe restricted user cannot open the billing pages or read the subscription details', async ({ restrictedPage }) => {
    const billing = new BillingPage(restrictedPage);
    expect(await billing.openAndReadForbidden('usage-statistics'), 'usage-statistics shows "Forbidden"').toBe(true);
    expect(await billing.openAndReadForbidden('subscription-details'), 'subscription-details shows "Forbidden"').toBe(true);

    const api = await BillingApi.forPage(restrictedPage);
    try {
      const result = await api.getSubscriptionDetailsRaw();
      logger.info(`BLR1: restricted GET subscription-details -> HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 160)}`);
      expect(result.status, 'a 5xx is a backend error, not a permission answer').toBeLessThan(500);
      expect(result.status, 'restricted GET /v1/tenants/subscription-details must be refused').toBeGreaterThanOrEqual(400);
      logger.success('BLR1 passed');
    } finally {
      await api.dispose();
    }
  });

  // ── BLR2 ──────────────────────────────────────────────────
  // WHAT: the restricted user's GET /v1/tenants/usage is refused.
  // WHY: the UI hides the page, but the API answers 200 with the full payload (plan, limits, per-entity counts).
  // HOW: the admin's call is the control (the endpoint works, so a refusal below is down to the permission). The verdict then
  //   decides at run time (applyKnownBugVerdict in src/utils/knownIssue.ts): accepted = expected failure ("not fixed on <env>")
  //   plus a known-issue annotation; refused = pass plus an annotation "fix detected, add the env to the strict list".
  // KNOWN KYLAS BUG — KI-75 (not yet reported to Kylas; no ticket number). The assertion states the CORRECT behaviour and must
  //   not be weakened. Observed live on QA 2026-11-26: HTTP 200 with the full payload.
  test('@regression @prodSafe restricted user cannot read GET /v1/tenants/usage (known Kylas bug KI-75)', async ({
    adminPage,
    restrictedPage,
  }) => {
    const adminApi = await BillingApi.forPage(adminPage);
    const restrictedApi = await BillingApi.forPage(restrictedPage);
    try {
      const control = await adminApi.getUsageRaw();
      expect(control.status, 'Set-up control: the admin can read GET /v1/tenants/usage').toBe(200);

      const restricted = await restrictedApi.getUsageRaw();
      logger.info(`BLR2: restricted GET usage -> HTTP ${restricted.status} (body not logged: it is the account's plan data)`);
      applyKnownBugVerdict({
        bug: 'BILLING-USAGE:restricted-read',
        issueId: 'KI-75',
        what: 'restricted read of GET /v1/tenants/usage',
        env: config.env,
        response: { status: restricted.status, body: restricted.body },
      });
      logger.success('BLR2 passed');
    } finally {
      await adminApi.dispose();
      await restrictedApi.dispose();
    }
  });
});
