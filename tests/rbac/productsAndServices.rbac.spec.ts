import { test } from '../../src/fixtures/index';
import { ProductsAndServicesPage } from '../../src/modules/productsAndServices/ProductsAndServicesPage';
import { LeadsPage } from '../../src/modules/leads/LeadsPage';
import { DealsPage } from '../../src/modules/deals/DealsPage';
import { QuotationsPage } from '../../src/modules/quotations/QuotationsPage';
import {
  generateProductsAndServicesData,
  generateProductsCustomFieldData,
} from '../../src/data/factories/productsAndServicesFactory';
import { generateLeadData } from '../../src/data/factories/leadFactory';
import { generateDealData } from '../../src/data/factories/dealFactory';
import { generateRestrictedQuotationData } from '../../src/data/factories/quotationFactory';
import { getProductFixture } from '../../src/data/productFixtureAccessor';
import { config } from '../../config/config';
import { logger } from '../../src/utils/logger';
import { faker } from '@faker-js/faker';

test.describe('Products & Services RBAC', () => {
  // ─── PS6 ───────────────────────────────────────────────────────────────────
  test('@smoke @regression @prodSafe restricted user should navigate to products and services list', async ({
    restrictedPage,
  }) => {
    const pasPage = new ProductsAndServicesPage(restrictedPage);

    await pasPage.goToProductsAndServicesList();
    await pasPage.assertOnProductsAndServicesListPage();

    logger.success('PS6 passed');
  });

  // ─── PS7 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user should create own product with all fields', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const pasPage = new ProductsAndServicesPage(restrictedPage);

    await pasPage.goToProductsAndServicesList();
    await pasPage.goToCreateProductForm();
    await pasPage.skipIfCustomFieldsAbsent();

    const data = generateProductsAndServicesData();
    const customFields = generateProductsCustomFieldData();
    await pasPage.fillProductsAndServicesForm(data, customFields);
    const { id } = await pasPage.saveProduct();

    await pasPage.assertProductInList({ name: data.name });
    if (id) {
      await pasPage.assertProductFieldsOnEditPage(id, data);
    }

    logger.success('PS7 passed');
  });

  // ─── PS8 ───────────────────────────────────────────────────────────────────
  // WHY this test creates its OWN product rather than reusing PS7's: each
  // RBAC test in this codebase creates and owns its own data (matching the
  // established convention across every other RBAC spec file) — no
  // structural dependency on execution order.
  test('@regression restricted user should edit own product', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const pasPage = new ProductsAndServicesPage(restrictedPage);
    const data = generateProductsAndServicesData();
    const { id } = await pasPage.createProduct(data);
    if (!id) throw new Error('Product ID not captured after create');

    const changes = {
      price: faker.number.int({ min: 100, max: 100000 }),
      description: faker.commerce.productDescription(),
    };
    await pasPage.updateProduct(changes, id);
    await pasPage.assertProductFieldsOnEditPage(id, changes);

    logger.success('PS8 passed');
  });

  // ─── PS9 ───────────────────────────────────────────────────────────────────
  test('@regression restricted user cannot edit admin-owned product fixture via direct URL', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const pasPage = new ProductsAndServicesPage(restrictedPage);
    const fixture = getProductFixture('adminActive', config.env);

    await pasPage.assertForbiddenOnRestrictedEdit(fixture.id);

    logger.success('PS9 passed');
  });

  // ─── PS10 ──────────────────────────────────────────────────────────────────
  // WHY the lead's products are cleared before attaching the fixture (fixed
  // 2026-08-11, staging run investigation — Group B): this test's whole
  // point is proving a restricted user CAN select this specific
  // admin-owned fixture — not "select a second product without
  // duplicating a randomly-picked first one." `createLead()` still
  // exercises `fillLeadRequirement()`'s own established random
  // create-time pick undisturbed (untouched, shared logic other tests
  // depend on) — but that random pick can coincidentally already include
  // the exact fixture this test is about to attach (confirmed live via
  // headed-mode reproduction), at which point react-select correctly
  // excludes the already-selected option from its own search results,
  // making the later attach step find nothing to select. `clearAllProducts()`
  // (a thin wrapper around the newly-extracted, shared
  // `BasePage.clearAllChipsFromMultiSelect()`) guarantees the field is
  // empty before the deterministic, named attach — the fixture is always
  // genuinely available to select, regardless of what the random pick did.
  test('@regression restricted user can select admin-owned active product fixture on a new lead', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(restrictedPage);
    const fixture = getProductFixture('adminActive', config.env);
    const data = generateLeadData();

    // WHY this navigation is required: createLead() is NOT self-starting —
    // confirmed via its own body (BasePage.click() straight into
    // clickAddLead(), no navigateTo() anywhere) and every real Lead test's
    // own call pattern (leads.spec.ts always calls goToLeadsList() first).
    // Omitting this left the page sitting on /sales/home (the restrictedPage
    // fixture's own landing point) with clickAddLead() waiting 60s for an
    // "Add" button that page doesn't have — a real bug in this test, not an
    // environmental flake (found via live headed observation, 2026-08-10).
    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(data);
    if (!leadId) throw new Error('Lead ID not captured after create');

    await leadsPage.searchAndOpenLead(data.firstName, leadId);
    await leadsPage.clickEditIcon();
    await leadsPage.disableRequiredFieldsToggle();
    await leadsPage.clearAllProducts();
    await leadsPage.attachProductByName(fixture.name, true);
    await leadsPage.saveEditedLead();

    logger.success('PS10 passed');
  });

  // ─── PS11 ──────────────────────────────────────────────────────────────────
  // WHY updateDeal()'s own 4th param is used directly: this is the exact
  // capability built for this purpose in Batch 6 piece 1/3 — its internal
  // addProductRowAndSearchByName() call already asserts the product row's
  // control renders the fixture's name before returning success, so a
  // clean (non-throwing) call IS the proof this test needs.
  test('@regression restricted user can select admin-owned active product fixture on a new deal', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(restrictedPage);
    const fixture = getProductFixture('adminActive', config.env);
    const data = generateDealData();

    // WHY this navigation is required: same gap as the Lead test above —
    // createDeal() is NOT self-starting (straight into clickAddDeal(), no
    // navigateTo()), and every real Deal test calls goToDealsList() first.
    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(data);
    if (!dealId) throw new Error('Deal ID not captured after create');

    await dealsPage.updateDeal(data, data.name, dealId, fixture.name);

    logger.success('PS11 passed');
  });

  // ─── PS12 ──────────────────────────────────────────────────────────────────
  // WHY no dealName override on the generated data: config.deals.adminDealName
  // is confirmed stale this session (see PRODUCTS_AND_SERVICES_PROGRESS.md,
  // Batch 6 piece 2/3 investigation) — omitting it lets fillQuotationForm()
  // fall through to its own random-deal pick instead, avoiding that known
  // config risk entirely.
  test('@regression restricted user can select admin-owned active product fixture on a new quotation', async ({
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    const qp = new QuotationsPage(restrictedPage);
    const fixture = getProductFixture('adminActive', config.env);
    const data = generateRestrictedQuotationData();

    const { id } = await qp.createQuotation(data);
    if (!id) throw new Error('Quotation ID not captured after create');

    await qp.goToQuotationDetail(id);
    await qp.clickEditButton();
    await qp.addFreshProductByName(fixture.name, true);
    const result = await qp.saveQuotationHandlingInaccessibleEntities();
    if (result.removedEntities.length) {
      logger.warn(
        `PS12: removed inaccessible entities to save: ${result.removedEntities.join(', ')}`
      );
    }

    logger.success('PS12 passed');
  });
});
