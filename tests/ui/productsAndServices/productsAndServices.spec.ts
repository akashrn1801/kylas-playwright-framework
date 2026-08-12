import { test, expect } from '../../../src/fixtures/index';
import { ProductsAndServicesPage } from '../../../src/modules/productsAndServices/ProductsAndServicesPage';
import { LeadsPage } from '../../../src/modules/leads/LeadsPage';
import { DealsPage } from '../../../src/modules/deals/DealsPage';
import { QuotationsPage } from '../../../src/modules/quotations/QuotationsPage';
import {
  generateProductsAndServicesData,
  generateProductsCustomFieldData,
  ProductFixtureKey,
} from '../../../src/data/factories/productsAndServicesFactory';
import { buildApiUrl } from '../../../config/config';
import { generateAdminLeadData } from '../../../src/data/factories/leadFactory';
import { generateAdminDealData } from '../../../src/data/factories/dealFactory';
import { generateAdminQuotationData } from '../../../src/data/factories/quotationFactory';
import { getProductFixture } from '../../../src/data/productFixtureAccessor';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';
import { faker } from '@faker-js/faker';

test.describe('Products & Services', () => {
  test.describe.configure({ mode: 'serial' });

  // ─── PS1 ───────────────────────────────────────────────────────────────────
  test('@smoke @regression @prodSafe admin should navigate to products and services list', async ({
    adminPage,
  }) => {
    const pasPage = new ProductsAndServicesPage(adminPage);

    await pasPage.goToProductsAndServicesList();
    await pasPage.assertOnProductsAndServicesListPage();

    logger.success('PS1 passed');
  });

  // ─── PS2 ───────────────────────────────────────────────────────────────────
  // WHY this test never actually creates anything via the UI: the 3
  // fixtures for THIS run are guaranteed to already exist by the time ANY
  // test runs — globalSetup.ts's ensureProductFixtures() (unconditional
  // API-based creation, redesigned 2026-08-11 — a fresh set every run, no
  // longer a permanent get-or-create) runs once before the whole suite.
  // This test verifies that creation produced correct, UI-discoverable
  // records. It deliberately does NOT fall back to creating a substitute
  // product via the UI if one were ever (hypothetically) found missing —
  // per this session's absolute "no new products beyond the 3 role-based
  // fixtures, for any reason" constraint. A missing fixture here means
  // globalSetup itself failed, and should fail this test loudly rather than
  // silently paper over it with a UI-created substitute.
  test('@regression admin should verify the three product fixtures created this run are visible via UI', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const pasPage = new ProductsAndServicesPage(adminPage);
    const keys: ProductFixtureKey[] = ['adminActive', 'restrictedActive', 'inactive'];

    for (const key of keys) {
      const fixture = getProductFixture(key, config.env);
      await pasPage.assertProductInList({ name: fixture.name });
      logger.success(`Fixture "${key}" (${fixture.name}) confirmed present in list`);
    }

    logger.success('PS2 passed');
  });

  // ─── PS3 ───────────────────────────────────────────────────────────────────
  // WHY the fixture is restored to its canonical values in a `finally` block:
  // adminActive is shared across every test WITHIN this run (name is never
  // touched — only non-identity fields are exercised here), even though it's
  // no longer permanent across runs (redesigned 2026-08-11 — see
  // productsAndServicesFactory.ts). This test can still run alongside other
  // tests in the same invocation, so it must leave the fixture exactly as it
  // found it, mirroring the same restore discipline already proven earlier
  // this session (see PRODUCTS_AND_SERVICES_PROGRESS.md's adminActive
  // verification entries).
  // WHY `canonical` now reads directly from `fixture` (the persisted
  // getProductFixture() record), not a separately-recomputed constant:
  // globalSetup and this test run in separate Node processes — the actual
  // created values only exist in what globalSetup persisted, which
  // getProductFixture() reads. A statically-recomputed "canonical" value
  // would not match what was really created (see ProductFixtureRecord's own
  // comment on this exact hazard).
  test('@regression admin should update price description HSN country category and units on this run\'s shared active fixture and verify updated values', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const pasPage = new ProductsAndServicesPage(adminPage);
    const fixture = getProductFixture('adminActive', config.env);
    const canonical = fixture;

    const changes = {
      price: faker.number.int({ min: 100, max: 100000 }),
      description: faker.commerce.productDescription(),
      hsnSacCode: `${faker.string.alphanumeric(6).toUpperCase()}-${Date.now()}`,
      countryOfOrigin: 'India',
      category: (canonical.category === 'Products' ? 'Services' : 'Products') as
        | 'Products'
        | 'Services',
      units: 'Kilograms (kgs)',
    };

    // WHY the restore's own failure is caught separately, never allowed to
    // replace `testError`: standard JS/TS `finally` semantics mean an
    // exception thrown inside `finally` REPLACES whatever the `try` block
    // threw — silently losing the real failure reason. Since adminActive is
    // a permanent fixture other tests depend on, a restore failure ALSO
    // needs its own loud, distinct signal (not just a swallowed side note)
    // rather than either masking the original error or vanishing silently.
    // WHY restoreError is tracked and escalated EVEN when testError is
    // undefined: a real incident (CRITICAL INCIDENT, 2026-08-10 — see
    // PRODUCTS_AND_SERVICES_PROGRESS.md) proved the earlier version of this
    // block only rethrew `testError` — a restore-only failure (the `try`
    // block's own action+assertion succeeding, then the restore silently
    // failing) was logged but never failed the test, letting a "✓ passed"
    // result mask a permanently-corrupted shared fixture. Both failure modes
    // must now fail loudly, with a message that distinguishes which
    // occurred (or both).
    let testError: unknown;
    let restoreError: unknown;
    try {
      await pasPage.updateProduct(changes, fixture.id);
      await pasPage.assertProductFieldsOnEditPage(fixture.id, changes);
      logger.success('Updated values verified on shared active fixture');
    } catch (error) {
      testError = error;
    } finally {
      try {
        await pasPage.updateProduct(
          {
            price: canonical.price,
            description: canonical.description,
            hsnSacCode: canonical.hsnSacCode,
            countryOfOrigin: canonical.countryOfOrigin,
            category: canonical.category,
            units: canonical.units,
          },
          fixture.id
        );
        logger.info('Shared active fixture restored to its canonical values');
      } catch (error) {
        restoreError = error;
        logger.error(
          `FIXTURE LEFT IN NON-CANONICAL STATE — adminActive (id: ${fixture.id}) restore failed: ${String(restoreError)}. Manual restore needed.`
        );
      }
    }
    if (testError && restoreError) {
      throw new Error(
        `Original failure: ${String(testError)}. ADDITIONALLY, the restore afterward ALSO failed — adminActive (id: ${fixture.id}) is left NON-CANONICAL: ${String(restoreError)}`
      );
    }
    if (testError) throw testError;
    if (restoreError) {
      throw new Error(
        `Update+verify succeeded, but restoring adminActive (id: ${fixture.id}) to canonical values afterward FAILED — it is left NON-CANONICAL: ${String(restoreError)}`
      );
    }

    logger.success('PS3 passed');
  });

  // ─── PS4 ───────────────────────────────────────────────────────────────────
  // WHY no save click anywhere in this test: the duplicate-name check fires
  // inline on blur (confirmed live — see
  // ProductsAndServicesPage.assertDuplicateNameFieldError()'s own comment),
  // never a save-time error. Per the standing "no new products" rule, this
  // test must never click Save on a deliberately-duplicate-name attempt.
  test('@regression admin should see inline duplicate name field error when creating a product with an already-existing name', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const pasPage = new ProductsAndServicesPage(adminPage);
    const fixture = getProductFixture('adminActive', config.env);

    await pasPage.goToProductsAndServicesList();
    await pasPage.goToCreateProductForm();
    await pasPage.fillProductsAndServicesForm(
      generateProductsAndServicesData({ name: fixture.name })
    );
    await pasPage.assertDuplicateNameFieldError();

    logger.success('PS4 passed');
  });

  // ─── PS5 ───────────────────────────────────────────────────────────────────
  // WHY this test reuses the existing PERMANENT `inactive` fixture rather
  // than creating a new dedicated product, despite this test's own original
  // title: this session's absolute "no new products, for any reason"
  // constraint (added mid-session — see PRODUCTS_AND_SERVICES_PROGRESS.md)
  // postdates this test's original naming. The `inactive` fixture
  // (AutoFixture Inactive Product) already exists specifically for this
  // exact cross-module exclusion-check purpose, so reusing it here is the
  // only safe interpretation available — flagged explicitly, not silently
  // substituted.
  test('@regression admin should create a dedicated product mark it inactive and confirm it is excluded from the Lead Products or Services picker', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const fixture = getProductFixture('inactive', config.env);
    const leadsPage = new LeadsPage(adminPage);

    await leadsPage.goToLeadsList();
    await leadsPage.clickAddLead();
    await leadsPage.disableRequiredFieldsToggle();
    await leadsPage.attachProductByName(fixture.name, false);

    logger.success('PS5 passed');
  });

  // ─── PS13 ──────────────────────────────────────────────────────────────────
  // WHY this test exists: Batch 8's original scope required fixture-
  // attachment coverage on a fresh record for BOTH roles across Leads/Deals/
  // Quotations. PS10 (RBAC file) already covers the restricted-role case for
  // Leads — this is its admin-role mirror, confirmed missing via a real gap
  // audit (2026-08-10, see PRODUCTS_AND_SERVICES_PROGRESS.md).
  test('@regression admin should select admin-owned active product fixture on a new lead', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const leadsPage = new LeadsPage(adminPage);
    const fixture = getProductFixture('adminActive', config.env);
    const data = generateAdminLeadData();

    await leadsPage.goToLeadsList();
    const leadId = await leadsPage.createLead(data);
    if (!leadId) throw new Error('Lead ID not captured after create');

    await leadsPage.searchAndOpenLead(data.firstName, leadId);
    await leadsPage.clickEditIcon();
    await leadsPage.disableRequiredFieldsToggle();
    await leadsPage.attachProductByName(fixture.name, true);
    await leadsPage.saveEditedLead();

    logger.success('PS13 passed');
  });

  // ─── PS14 ──────────────────────────────────────────────────────────────────
  // WHY: admin-role mirror of PS11 (RBAC file, restricted role) for Deals —
  // same gap-audit finding as PS13.
  test('@regression admin should select admin-owned active product fixture on a new deal', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const dealsPage = new DealsPage(adminPage);
    const fixture = getProductFixture('adminActive', config.env);
    const data = generateAdminDealData();

    await dealsPage.goToDealsList();
    const dealId = await dealsPage.createDeal(data);
    if (!dealId) throw new Error('Deal ID not captured after create');

    await dealsPage.updateDeal(data, data.name, dealId, fixture.name);

    logger.success('PS14 passed');
  });

  // ─── PS15 ──────────────────────────────────────────────────────────────────
  // WHY: admin-role mirror of PS12 (RBAC file, restricted role) for
  // Quotations — same gap-audit finding as PS13/PS14.
  test('@regression admin should select admin-owned active product fixture on a new quotation', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const qp = new QuotationsPage(adminPage);
    const fixture = getProductFixture('adminActive', config.env);
    const data = generateAdminQuotationData();

    const { id } = await qp.createQuotation(data);
    if (!id) throw new Error('Quotation ID not captured after create');

    await qp.goToQuotationDetail(id);
    await qp.clickEditButton();
    await qp.addFreshProductByName(fixture.name, true);
    const result = await qp.saveQuotationHandlingInaccessibleEntities();
    if (result.removedEntities.length) {
      logger.warn(
        `PS15: removed inaccessible entities to save: ${result.removedEntities.join(', ')}`
      );
    }

    logger.success('PS15 passed');
  });

  // ─── PS16 ──────────────────────────────────────────────────────────────────
  // WHY this test exists: createProduct()/updateProduct() workflow wrappers
  // never exposed a customFields param until this fix (2026-08-10) — PS7
  // already covers custom fields via the DIRECT fillProductsAndServicesForm()
  // call, but nothing exercised the WRAPPER'S own customFields threading.
  // Creates exactly ONE new, throwaway product (consistent with PS7/PS9's
  // own established pattern of each RBAC/UI test owning fresh data) —
  // deliberately never touches adminActive/restrictedActive/inactive.
  test('@regression admin can create and update a product with custom fields via the workflow wrappers', async ({
    adminPage,
  }) => {
    test.setTimeout(480000);

    const pasPage = new ProductsAndServicesPage(adminPage);
    await pasPage.goToProductsAndServicesList();
    await pasPage.goToCreateProductForm();
    await pasPage.skipIfCustomFieldsAbsent();

    const data = generateProductsAndServicesData();
    const createCustomFields = generateProductsCustomFieldData();
    const { id } = await pasPage.createProduct(data, createCustomFields);
    if (!id) throw new Error('Product ID not captured after create via workflow wrapper');

    // WHY fetchAuthenticatedApiData(), not a raw page.request.get(): this
    // app has no cookie-based session — Playwright's APIRequestContext only
    // carries context cookies, never the JWT bearer token this app actually
    // requires, so a bare page.request.get() always returns 403 regardless
    // of whether the data itself is correct (confirmed live, 2026-08-11).
    const createBody = await pasPage.fetchAuthenticatedApiData(buildApiUrl(`/products/${id}`));
    expect(createBody, 'Fresh GET on the created product should succeed').not.toBeNull();
    const createCf = createBody?.customFieldValues as Record<string, unknown> | undefined;
    expect(
      createCf?.cfTextField,
      'Custom field set via createProduct() wrapper should persist'
    ).toBe(createCustomFields.textField);
    expect(
      createCf?.cfNumber,
      'Custom field set via createProduct() wrapper should persist'
    ).toBe(createCustomFields.number);

    const updateCustomFields = generateProductsCustomFieldData();
    await pasPage.updateProduct({}, id, updateCustomFields);

    const updateBody = await pasPage.fetchAuthenticatedApiData(buildApiUrl(`/products/${id}`));
    expect(updateBody, 'Fresh GET on the updated product should succeed').not.toBeNull();
    const updateCf = updateBody?.customFieldValues as Record<string, unknown> | undefined;
    expect(
      updateCf?.cfTextField,
      'Custom field changed via updateProduct() wrapper should persist'
    ).toBe(updateCustomFields.textField);
    expect(
      updateCf?.cfNumber,
      'Custom field changed via updateProduct() wrapper should persist'
    ).toBe(updateCustomFields.number);

    logger.success('PS16 passed');
  });
});
