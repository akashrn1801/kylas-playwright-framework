import { faker } from '@faker-js/faker';
import { randomFutureDateWithinOneMonth } from '../../utils/dateHelpers';

// ──────────────────────────────────────────────────────────────────────────
// Products & Services — data model
// ──────────────────────────────────────────────────────────────────────────
// WHY this factory looks different from every other module's factory: this
// module lives on the Settings page (not Sales), has no detail page, and its
// test data model is split between 3 fixtures — created FRESH every distinct
// test run (redesigned 2026-08-11, reversing the original "3 permanent
// fixtures, created once, reused forever" model; confirmed and approved) —
// and disposable data for the rare test that needs a throwaway product. See
// .claude/architecture.md's deviation note for the full rationale — do not
// "normalize" this file toward generateXxxData()/generateAdminXxxData()/
// generateSharedXxxData() being the only data source the way every other
// factory is.
//
// WHY `category` is typed 'Products' | 'Services' (not the design doc's
// original 'Product' | 'Services'): confirmed live on QA (2026-08-10) — the
// real react-select options are exactly "Products" and "Services" (plural).
// Per CLAUDE.md rule 4, the actual fill logic must always read these live
// from the DOM at runtime, never assume by index — this type exists only so
// a caller can't typo a value that doesn't exist, not as a substitute for a
// live lookup.
//
// WHY `customFields` is its own separate parameter on fill methods rather
// than a property on this interface (unlike Company/Deal/Quotation, which
// all embed `customFields: XxxCustomFieldData` directly): custom fields
// were deliberately deferred to last (explicit user instruction, 2026-08-10
// — "custom field for product will work on that at last") and added as a
// distinct follow-up once the core module was already built and stable.
// Bolting it on as a new required property here would force every existing
// caller (Batch 1-5's own code, already written and verified) to change —
// keeping it separate is purely additive. See `ProductsCustomFieldData`
// below for the actual shape, confirmed live (2026-08-10) against QA AND
// staging (both have identical fields; PROD confirmed live to have NONE
// yet — see the environment-aware skip mechanism in
// ProductsAndServicesPage.ts).
export interface ProductsAndServicesData {
  name: string; // for the 3 fixture roles: a realistic name + run-unique suffix, regenerated every run — see generateProductFixtureDefinitions()
  price: number;
  description: string; // rendered via CKEditor 5 — see BasePage/ProductsAndServicesPage's setDescriptionViaCkEditor()
  hsnSacCode: string; // must be unique — app-enforced, confirmed live via GET /v1/products/has-duplicates
  countryOfOrigin: string; // React Select, live-DOM options — 'India' is a safe, confirmed-existing default
  category: 'Products' | 'Services'; // confirmed live — exactly these two options exist, no others
  units: string; // DOM is a true multi-select (confirmed live); this module deliberately selects only ONE
  isActive: boolean; // confirmed live: defaults to false/unchecked unless explicitly set
}

export type ProductFixtureKey = 'adminActive' | 'restrictedActive' | 'inactive';

// WHY this lives here (not in globalSetup.ts, which originally defined it,
// or in the fixture-accessor file): this is the data model for "what a
// product fixture IS" — the same concern ProductFixtureKey already owns in
// this file. globalSetup.ts's ensureProductFixtures() (the writer) and
// productFixtureAccessor.ts's getProductFixture() (the reader) both import
// this single definition rather than each declaring their own, so the
// persisted-record shape can never silently drift between the two.
//
// WHY the 6 fields below price/description/hsnSacCode/countryOfOrigin/
// category/units were added 2026-08-11 (fresh-per-run fixture redesign,
// reversing the old "3 permanent fixtures" model): globalSetup.ts and each
// test worker are SEPARATE Node process invocations — a name/HSN code
// randomized independently in each would produce different values between
// the process that creates the fixture and the process that later reads it.
// This persisted record (written once by globalSetup, read via
// getProductFixture()) is now the single source of truth for a fixture's
// FULL canonical state, not just its id/name — e.g.
// productsAndServices.spec.ts's PS3 restores a mutated fixture to these
// exact values afterward, so they must be the real values actually sent at
// creation time, not separately recomputed and potentially different.
export interface ProductFixtureRecord {
  key: ProductFixtureKey;
  owner: 'admin' | 'restricted';
  name: string;
  id: string;
  isActive: boolean;
  price: number;
  description: string;
  hsnSacCode: string;
  countryOfOrigin: string;
  category: 'Products' | 'Services';
  units: string;
}

// ──────────────────────────────────────────────────────────────────────────
// The 3 fixture roles — fresh, realistic-named products every run
// ──────────────────────────────────────────────────────────────────────────
// WHY these are generated (faker-picked name + run-unique suffix), not
// literal hand-written values (redesigned 2026-08-11, reversing the
// original "3 permanent, hand-written, reused-forever" model — confirmed
// and approved): every distinct test run now creates its OWN fresh set of 3
// products, used by every test WITHIN that run; a different run creates a
// different new set. Products are never deleted, so this means real,
// permanent accumulation in the shared Products & Services picker over
// time — a deliberate, accepted tradeoff, not a concern. The realistic
// names (cars/bikes/laptops/mobiles) plus the unmistakable `[QA-Auto]` tag
// keep these recognizable as automation-generated by anyone looking at the
// real product list later — the realistic name alone would NOT signal
// that, hence the explicit tag. The run-unique suffix (role code +
// timestamp, mirroring generateAdminLeadData()'s `ADM<timestamp>`
// convention) satisfies the app's enforced name/HSN uniqueness constraint
// on every run, forever, without ever colliding with a prior run's
// still-existing records.
//
// WHY a FUNCTION, not a static array (replaces the old exported
// `PRODUCT_FIXTURES` const): must be called EXACTLY ONCE per run, from
// globalSetup.ts only. globalSetup and each test worker are separate Node
// process invocations — calling this a second time (e.g. from a worker
// process) would produce DIFFERENT random values than what globalSetup
// already created and persisted. Every other reader (tests, page objects)
// must go through getProductFixture() (productFixtureAccessor.ts), which
// reads the persisted, actually-created values — never call this function
// directly outside globalSetup.ts.
const CAR_NAMES = [
  'Tesla Model S',
  'Toyota Camry',
  'Honda Civic',
  'Ford Mustang',
  'BMW 3 Series',
  'Mercedes C-Class',
  'Audi A4',
  'Hyundai Elantra',
  'Mahindra Thar',
  'Tata Nexon',
];
const BIKE_NAMES = [
  'Royal Enfield Classic 350',
  'Harley-Davidson Iron 883',
  'Honda CB350',
  'Yamaha MT-15',
  'KTM Duke 200',
  'Bajaj Pulsar NS200',
  'TVS Apache RTR',
  'Kawasaki Ninja 300',
  'Ducati Monster',
  'Suzuki Gixxer',
];
const LAPTOP_NAMES = [
  'Dell XPS 13',
  'MacBook Pro 16',
  'Lenovo ThinkPad X1',
  'HP Spectre x360',
  'Asus ROG Zephyrus',
  'Microsoft Surface Laptop',
  'Acer Swift 5',
  'Razer Blade 15',
  'LG Gram 17',
  'MSI Prestige 14',
];
const MOBILE_NAMES = [
  'iPhone 15 Pro',
  'Samsung Galaxy S24',
  'Google Pixel 8',
  'OnePlus 12',
  'Xiaomi 14',
  'Motorola Edge 40',
  'Nothing Phone 2',
  'Sony Xperia 1',
  'Vivo X100',
  'Oppo Find X7',
];
// WHY one flat combined pool, not per-role category assignment: the design
// change only asked for "realistic real-world-sounding names," not a
// specific category-to-role mapping — picking independently at random from
// the full pool for each of the 3 roles is simpler and gives the same
// variety; a repeat category (or even name) across the 3 roles in one run
// is harmless since the run-unique suffix still keeps every persisted
// name/HSN code globally distinct.
const REALISTIC_PRODUCT_NAME_POOL = [...CAR_NAMES, ...BIKE_NAMES, ...LAPTOP_NAMES, ...MOBILE_NAMES];

const FIXTURE_ROLE_CODE: Record<ProductFixtureKey, string> = {
  adminActive: 'ADM',
  restrictedActive: 'RES',
  inactive: 'INA',
};

export function generateProductFixtureDefinitions(): Array<{
  key: ProductFixtureKey;
  owner: 'admin' | 'restricted';
  data: ProductsAndServicesData;
}> {
  const ts = Date.now();
  const buildName = (key: ProductFixtureKey): string =>
    `[QA-Auto] ${faker.helpers.arrayElement(REALISTIC_PRODUCT_NAME_POOL)} ${FIXTURE_ROLE_CODE[key]}${ts}`;
  const buildHsn = (key: ProductFixtureKey): string => `AUTOFIX-${FIXTURE_ROLE_CODE[key]}-${ts}`;

  return [
    {
      key: 'adminActive',
      owner: 'admin',
      data: {
        name: buildName('adminActive'),
        price: 25000,
        description:
          'Automation-generated ACTIVE product fixture (admin-owned), created fresh for this test run. Tagged [QA-Auto] — safe to ignore; never reused across runs, never deleted.',
        hsnSacCode: buildHsn('adminActive'),
        countryOfOrigin: 'India',
        category: 'Products',
        units: 'Pieces (p)',
        isActive: true,
      },
    },
    {
      key: 'restrictedActive',
      owner: 'restricted',
      data: {
        name: buildName('restrictedActive'),
        price: 15000,
        description:
          'Automation-generated ACTIVE product fixture (restricted-user-owned), created fresh for this test run. Tagged [QA-Auto] — safe to ignore; never reused across runs, never deleted.',
        hsnSacCode: buildHsn('restrictedActive'),
        countryOfOrigin: 'India',
        category: 'Products',
        units: 'Pieces (p)',
        isActive: true,
      },
    },
    {
      key: 'inactive',
      owner: 'admin',
      data: {
        name: buildName('inactive'),
        price: 5000,
        description:
          'Automation-generated INACTIVE product fixture (admin-owned), created fresh for this test run, used to verify inactive products are excluded from every picker regardless of role. Tagged [QA-Auto] — safe to ignore; never reused across runs, never deleted.',
        hsnSacCode: buildHsn('inactive'),
        countryOfOrigin: 'India',
        category: 'Services',
        units: 'Nights (n)',
        isActive: false,
      },
    },
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// Disposable, non-fixture data
// ──────────────────────────────────────────────────────────────────────────
// WHY this is NOT prefixed `AutoFixture ` (unlike the 3 permanent fixtures
// above): that prefix specifically marks a permanent, never-regenerated
// identifier — using it here for disposable, timestamp-suffixed data would
// blur the one distinguishing signal the permanent fixtures rely on to be
// recognized as such. Follows the same faker + timestamp-suffix convention
// as every other module's generateXxxData() (e.g. companyFactory.ts's
// `${faker.company.name()}-${Date.now()}`).
export function generateProductsAndServicesData(
  overrides: Partial<ProductsAndServicesData> = {}
): ProductsAndServicesData {
  const ts = Date.now();
  return {
    name: `${faker.commerce.productName()}-${ts}`,
    price: faker.number.int({ min: 100, max: 100000 }),
    description: faker.commerce.productDescription(),
    // WHY alphanumeric + timestamp: mirrors companyFactory.ts's uniqueText1/2
    // pattern — the closest existing "must be unique" field precedent in this
    // codebase (see PRODUCTS_AND_SERVICES_PROGRESS.md investigation notes).
    hsnSacCode: `${faker.string.alphanumeric(6).toUpperCase()}-${ts}`,
    // WHY 'India' (not randomized): confirmed live to exist as a real option
    // on this form; matches this codebase's own existing default-country
    // convention (leadFactory.ts). The fill method must still select it by
    // live exact-text match, never by assumed index.
    countryOfOrigin: 'India',
    category: faker.helpers.arrayElement(['Products', 'Services']),
    // WHY a fixed, confirmed-live option (not randomized across all 14):
    // this module deliberately selects only ONE unit despite the field being
    // a true multi-select (see ProductsAndServicesData.units' own comment) —
    // 'Pieces (p)' is a generic, confirmed-existing choice suitable for any
    // disposable product.
    units: 'Pieces (p)',
    isActive: true,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Products & Services — Custom Fields
// ──────────────────────────────────────────────────────────────────────────
// WHY: confirmed live (2026-08-10) — Products has 8 custom fields, mirroring
// Company/Deal's shape EXCEPT with no MultiPickList and no Lookup field
// (confirmed via `GET /v1/products/layout?view=create` on QA AND staging —
// both show the identical 8 fields below; PROD confirmed to have none of
// them yet). PRODUCTS_CUSTOM_FIELD_NAMES is its own single source of truth,
// per CLAUDE.md's Custom Fields pattern — never import
// COMPANY_CUSTOM_FIELD_NAMES/DEAL_CUSTOM_FIELD_NAMES here even though the
// values happen to be identical today: each module owns its own field-name
// constant so the two can diverge safely later.
export const PRODUCTS_CUSTOM_FIELD_NAMES = {
  textField: 'TextField',
  paragraphText: 'ParagraphText',
  number: 'Number',
  pickList: 'PickList',
  checkbox: 'Checkbox',
  date: 'Date',
  dateTimePicker: 'DateTimePicker',
  urlField: 'UrlField',
} as const;

export type ProductsCustomFieldKey = keyof typeof PRODUCTS_CUSTOM_FIELD_NAMES;

export interface ProductsCustomFieldData {
  textField: string;
  paragraphText: string;
  number: number;
  // WHY: PickList options only exist live in the DOM (never hardcode them) —
  // this starts as a placeholder and is overwritten in place by
  // ProductsAndServicesPage.fillProductsCustomFields() with whatever was
  // actually selected at fill time, so the same `data` object stays
  // accurate for later verification.
  pickList: string;
  checkbox: boolean;
  date: Date;
  dateTimePicker: Date;
  urlField: string;
}

export function generateProductsCustomFieldData(
  overrides: Partial<ProductsCustomFieldData> = {}
): ProductsCustomFieldData {
  return {
    textField: `CF-Text-${faker.string.alphanumeric(12)}`,
    paragraphText: faker.lorem.paragraph(),
    number: faker.number.int({ min: 1, max: 100000 }),
    pickList: '',
    checkbox: faker.datatype.boolean(),
    date: randomFutureDateWithinOneMonth(),
    dateTimePicker: randomFutureDateWithinOneMonth(),
    urlField: `https://example.com/${faker.string.alphanumeric(10)}`,
    ...overrides,
  };
}
