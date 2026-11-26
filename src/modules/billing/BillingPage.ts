import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { config } from '../../../config/config';
import { logger } from '../../utils/logger';

// WHY this module exists (2026-11-26, Billing exploration, QA): Setup → Billing shows the account's capacity
// (records, storage, custom fields, …) and its plan. This page object only READS. It has no method that clicks
// "Manage Subscription", "Upgrade", "Purchase … Addon", a plan card or anything in a payment flow, and none may be
// added: a billing click can change the subscription. Locators are the page's own stable class names (confirmed
// live on QA 2026-11-26): `.usage-card` per resource, `.billing-header` for plan and renewal, `.plan` per plan card.
// Section titles are display text (the card has no internal name); they are matched exactly and passed in by the
// spec, never hardcoded counts.

export interface UsageSectionNumbers {
  total: number;
  /** null when the card shows no "Remaining" (API Request Count shows only Total and Used). */
  remaining: number | null;
  used: number;
}

export interface PlanCard {
  name: string;
  /** e.g. "INR 12,999" */
  price: string;
  /** e.g. "/month" */
  duration: string;
  /** This card shows the "Next renewal on …" line (a paid plan's current card; the free plan has none). */
  showsRenewal: boolean;
}

export class BillingPage extends BasePage {
  // ──────────────────────────────────────────────────────────
  // Locators
  // ──────────────────────────────────────────────────────────

  private readonly usageCards = (): Locator => this.page.locator('.usage-card');

  // exact title match: "Custom Fields" must not also match "Custom Layouts"
  private readonly usageCard = (title: string): Locator =>
    this.usageCards()
      .filter({ has: this.page.locator('.usage-card__title').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(title)}\\s*$`) }) })
      .first();

  private readonly cardTotal = (card: Locator): Locator => card.locator('.usage-card__graph-stats .number');

  // Remaining is the stat whose name has the `remaining` class; Used has `consumed`
  private readonly cardRemaining = (card: Locator): Locator =>
    card.locator('.usage-card__stats-in-number:has(.usage-card__stat-name.remaining) .usage-card__stat');

  private readonly cardUsed = (card: Locator): Locator =>
    card.locator('.usage-card__stats-in-number:has(.usage-card__stat-name.consumed) .usage-card__stat.consumed');

  private readonly headerPlanName = (): Locator => this.page.locator('.billing-header .plan-name');

  private readonly headerRenewal = (): Locator =>
    this.page.locator('.billing-header .updates .update').filter({ hasText: 'Next renewal date' }).locator('strong');

  // `.subscription-plan` wraps one plan card (name, price) and, on a paid CURRENT plan, the renewal line and the Manage
  // button (confirmed live on QA 2026-11-26: Elevate current, Embark not). The check icon is on EVERY card, so neither
  // marks the current plan; which plan is current comes from the API (`active: true`), and the usage page header shows it.
  private readonly planCards = (): Locator => this.page.locator('.subscription-plan');

  // ──────────────────────────────────────────────────────────
  // Constructor
  // ──────────────────────────────────────────────────────────

  constructor(page: Page) {
    super(page);
  }

  // ──────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────

  async goToUsageStatistics(): Promise<void> {
    logger.info('Navigating to Billing → Usage Statistics');
    await this.navigateTo(`${config.appUrl}/setup/billing/usage-statistics`);
    await this.withSessionExpiryRecovery(() =>
      expect(this.usageCards().first()).toBeVisible({ timeout: config.timeouts.navigation })
    );
    // the numbers are filled in by the usage call: wait until the first card has its Total
    await this.withSessionExpiryRecovery(() =>
      expect(this.cardTotal(this.usageCard('Records Count'))).toHaveText(/\d/, { timeout: config.timeouts.navigation })
    );
    logger.success('On Billing → Usage Statistics');
  }

  async goToSubscriptionDetails(): Promise<void> {
    logger.info('Navigating to Billing → Subscription Details');
    await this.navigateTo(`${config.appUrl}/setup/billing/subscription-details`);
    await this.withSessionExpiryRecovery(() =>
      expect(this.planCards().first()).toBeVisible({ timeout: config.timeouts.navigation })
    );
    logger.success('On Billing → Subscription Details');
  }

  /**
   * RBAC: open a billing URL as a user who must NOT have it and report whether the app's "Forbidden" page is shown.
   *
   * WHY a plain goto and a boolean, not navigateTo() + withSessionExpiryRecovery(): "Forbidden" is also what an
   * invalid session renders, so those combinators would try to "recover" from the very page this test expects
   * (the same collision FormFieldsConfigPage documents for its RBAC checks). The caller asserts the boolean.
   */
  async openAndReadForbidden(path: 'usage-statistics' | 'subscription-details'): Promise<boolean> {
    logger.info(`Opening Billing → ${path} without permission`);
    await this.page.goto(`${config.appUrl}/setup/billing/${path}`, { waitUntil: 'domcontentloaded' });
    // a plain div beside a "Home" button, not a heading (page snapshot, QA 2026-11-26)
    const forbidden = this.page.getByText('Forbidden', { exact: true });
    const content = this.usageCards().or(this.planCards());
    await forbidden.or(content).first().waitFor({ state: 'visible', timeout: config.timeouts.navigation });
    return forbidden.isVisible();
  }

  // ──────────────────────────────────────────────────────────
  // Reading (Usage Statistics)
  // ──────────────────────────────────────────────────────────

  async readUsageSection(title: string): Promise<UsageSectionNumbers> {
    const card = this.usageCard(title);
    await card.waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const remaining = this.cardRemaining(card);
    return {
      total: parseCardNumber(await this.cardTotal(card).innerText()),
      remaining: (await remaining.count()) ? parseCardNumber(await remaining.innerText()) : null,
      used: parseCardNumber(await this.cardUsed(card).innerText()),
    };
  }

  /** The header's plan name and "Next renewal date" text (e.g. "May 21, 2027"). */
  async readUsageHeader(): Promise<{ planName: string; renewalText: string }> {
    return {
      planName: (await this.headerPlanName().innerText()).trim(),
      // absent on a plan without a renewal: read it only when present (a bare innerText() waits 30 s)
      renewalText: await optionalText(this.headerRenewal()),
    };
  }

  // ──────────────────────────────────────────────────────────
  // Reading (Subscription Details)
  // ──────────────────────────────────────────────────────────

  async readPlanCards(): Promise<PlanCard[]> {
    const cards = this.planCards();
    const count = await cards.count();
    const result: PlanCard[] = [];
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      result.push({
        name: (await card.locator('.plan-name span').first().innerText()).trim(),
        price: await optionalText(card.locator('.plan-description__price')),
        // the free plan card has no duration: read optional parts only when present (a bare innerText() waits 30 s)
        duration: await optionalText(card.locator('.plan-description__duration')),
        showsRenewal: /Next renewal on/.test(await card.innerText()),
      });
    }
    return result;
  }

  /** "Next renewal on May 21, 2027" text on the Subscription Details page, null when absent (e.g. the free plan). */
  async readSubscriptionRenewalText(): Promise<string | null> {
    const text = this.page.getByText(/Next renewal on/);
    return (await text.count()) ? (await text.first().innerText()).trim() : null;
  }
}

async function optionalText(locator: Locator): Promise<string> {
  return (await locator.count()) ? (await locator.first().innerText()).trim() : '';
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "300000 ", "0.99 GB", "1 GB" → the number; throws by name on anything else. */
export function parseCardNumber(text: string): number {
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) throw new Error(`Billing card: no number in "${text}"`);
  return Number(match[0]);
}
