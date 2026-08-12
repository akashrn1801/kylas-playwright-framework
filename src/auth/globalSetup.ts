import { chromium, FullConfig, request as apiRequest, APIRequestContext } from '@playwright/test';
import { ErrorCollector } from '../error-collector/ErrorCollector';
import { config, buildApiUrl } from '../../config/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  generateProductFixtureDefinitions,
  ProductFixtureKey,
  ProductFixtureRecord,
} from '../data/factories/productsAndServicesFactory';

const STORAGE_STATE_DIR = path.join(__dirname, 'storageStates', config.env);

// WHY: added 2026-07-19 — playwright.config.ts's `trace: 'retain-on-failure'`
// only applies to the standard per-test fixture lifecycle. globalSetup runs
// its own browser/context/page entirely outside that mechanism, so a
// globalSetup hang (like the Staging waitUntil:'load' hang this was added
// alongside) produced zero trace/HAR artifact — nothing to inspect after the
// fact. Mirrors the same outputDir convention playwright.config.ts already
// uses (CI vs local split) so these land in a predictable, already-gitignored
// location, not a new one-off path.
const GLOBAL_SETUP_TRACE_DIR = path.join(
  process.env.CI ? 'test-results' : `test-results/${config.env}`,
  'global-setup-traces'
);

async function globalSetup(_playwrightConfig: FullConfig): Promise<void> {
  ErrorCollector.attachNodeListeners();
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_SETUP_TRACE_DIR, { recursive: true });

  // WHY: Remove any stale advisory-lock directories left behind by a crashed
  // previous run — otherwise AuthManager.withFileLock() would make every
  // worker wait the full 30s timeout before proceeding with login.
  for (const role of ['admin', 'restricted'] as const) {
    const lockPath = path.join(STORAGE_STATE_DIR, `${role}.lock`);
    try {
      fs.rmdirSync(lockPath);
    } catch {
      /* not present */
    }
  }

  // WHY: --no-sandbox is required inside Docker/Jenkins containers
  // Without it Chromium cannot create a sandbox process and times out
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    await setupRole('admin', browser);
    await setupRole('restricted', browser);
    // WHY here, not inside setupRole() or a separate script: both roles are
    // now guaranteed authenticated (their storageState files exist and are
    // fresh — see getAccessTokenForRole() below, which reads them directly),
    // and `browser` is still open — though this function doesn't actually
    // need a browser at all, only a standalone API request context.
    await ensureProductFixtures();
  } finally {
    await browser.close();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Products & Services — fresh-per-run fixture creation
// ──────────────────────────────────────────────────────────────────────────
// WHY this is unconditional creation, not get-or-create (redesigned
// 2026-08-11, reversing the original "3 permanent fixtures, created once,
// reused forever" model): confirmed and approved design change — every
// distinct test run now creates its OWN fresh set of 3 products (realistic
// name + run-unique suffix + a "[QA-Auto]" tag, see
// generateProductFixtureDefinitions() in productsAndServicesFactory.ts),
// used by every test WITHIN that run. Products are never deleted, so this
// means real, permanent accumulation in the shared Products & Services
// picker over time — a deliberate, accepted tradeoff, not a defect. The
// old search-first/found-or-create/active-state-drift-check logic existed
// specifically to protect a permanent shared record, which no longer
// applies — removed entirely. No search step remains at all: the create
// response itself returns the new record's id directly, so there's nothing
// left to look up afterward.
//
// WHY a standalone Playwright APIRequestContext (request.newContext()), not a
// browser page: every create here is a pure API call — no DOM interaction
// needed. The access token is read directly out of the storageState JSON
// setupRole() just saved (see getAccessTokenForRole()), mirroring
// authManager.ts's loginHeadless() "page.request + buildApiUrl()" shape,
// without the overhead of a real browser page.
const PRODUCT_FIXTURES_DIR = path.join(__dirname, '..', 'data', 'productFixtures');
const PRODUCT_FIXTURES_FILE = path.join(PRODUCT_FIXTURES_DIR, `${config.env}.json`);

// Shape of one entry in the Products layout's per-field `pickLists` array —
// confirmed live (2026-08-10) via GET /v1/products/layout?view=create.
interface ProductPickListOption {
  id: number;
  name: string;
  displayName: string;
  disabled: boolean;
}

interface ProductLayoutField {
  name: string;
  pickLists: ProductPickListOption[] | null;
}

interface ProductLayoutResponse {
  sections: Array<{ fields: ProductLayoutField[] }>;
}

interface CurrencyOption {
  id: number;
  name: string; // e.g. "INR"
  displayName: string;
}

// WHY this exists at all — the real, confirmed CREATE request body requires
// numeric ids for countryOfOrigin/category/units (each `{id, name, ...}` or,
// for units, an array of them) and price.currencyId, NOT plain display
// strings. These ids are per-environment reference data (confirmed live:
// qa's "Products" category id is 469184, "India" is 175, "Pieces (p)" is
// 469198, "INR" currency is 431) — hardcoding any of them would silently
// break on staging/prod, where the same reference rows almost certainly have
// different auto-increment ids. Resolving every id LIVE, by exact
// `displayName` match, from GET /v1/products/layout?view=create (country/
// category/units) and GET /v1/currencies (currency) is the only way to
// create a fixture correctly on every environment without guessing —
// mirrors this codebase's own standing rule (CLAUDE.md rule 4: read live
// options, never hardcode) applied to a create-payload id instead of a UI
// click.
interface ProductReferenceData {
  categoryIdByName: Map<string, number>;
  countryIdByName: Map<string, number>;
  unitsIdByName: Map<string, number>;
  currencyIdByName: Map<string, number>;
}

async function loadProductReferenceData(
  apiContext: APIRequestContext,
  adminToken: string
): Promise<ProductReferenceData> {
  const authHeaders = { Authorization: `Bearer ${adminToken}`, Accept: 'application/json' };

  const layoutResponse = await apiContext.get(buildApiUrl('/products/layout?view=create'), {
    headers: authHeaders,
  });
  if (!layoutResponse.ok()) {
    throw new Error(
      `[globalSetup] Could not load product reference data — GET /products/layout?view=create ` +
        `returned HTTP ${layoutResponse.status()}`
    );
  }
  const layout = (await layoutResponse.json()) as ProductLayoutResponse;
  const fields = layout.sections.flatMap((s) => s.fields);
  const byName = (fieldName: string): Map<string, number> => {
    const field = fields.find((f) => f.name === fieldName);
    const map = new Map<string, number>();
    for (const option of field?.pickLists ?? []) {
      map.set(option.displayName, option.id);
    }
    return map;
  };

  const currencyResponse = await apiContext.get(buildApiUrl('/currencies'), {
    headers: authHeaders,
  });
  if (!currencyResponse.ok()) {
    throw new Error(
      `[globalSetup] Could not load currency reference data — GET /currencies returned ` +
        `HTTP ${currencyResponse.status()}`
    );
  }
  const currencies = (await currencyResponse.json()) as CurrencyOption[];
  const currencyIdByName = new Map(currencies.map((c) => [c.name, c.id]));

  return {
    categoryIdByName: byName('category'),
    countryIdByName: byName('countryOfOrigin'),
    unitsIdByName: byName('units'),
    currencyIdByName,
  };
}

function resolveRefId(map: Map<string, number>, name: string, fieldLabel: string): number {
  const id = map.get(name);
  if (id === undefined) {
    throw new Error(
      `[globalSetup] Fixture creation failed: "${name}" is not a valid live option for ${fieldLabel} ` +
        `on ENV=${config.env}. Valid options: ${Array.from(map.keys()).join(', ')}`
    );
  }
  return id;
}

// WHY manual JWT decode, not a library: mirrors authManager.ts's own
// documented mechanism exactly — the real accessToken lives inside the JWT's
// own payload (`payload.data.accessToken`), not the raw token string itself.
// Confirmed live via the identical decode during this module's own
// investigation (see PRODUCTS_AND_SERVICES_PROGRESS.md).
async function getAccessTokenForRole(role: 'admin' | 'restricted'): Promise<string> {
  const stateFile = path.join(STORAGE_STATE_DIR, `${role}.json`);
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as {
    origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
  };
  for (const origin of state.origins ?? []) {
    const tokenEntry = origin.localStorage?.find((item) => item.name === 'token');
    if (tokenEntry) {
      const payloadJson = Buffer.from(tokenEntry.value.split('.')[1], 'base64').toString('utf8');
      const payload = JSON.parse(payloadJson) as { data?: { accessToken?: string } };
      if (payload?.data?.accessToken) {
        return payload.data.accessToken;
      }
    }
  }
  throw new Error(
    `[globalSetup] Could not extract an access token from the saved storage state for role: ${role}`
  );
}

// WHY failure here is the SAME severity as a login failure (hard stop, not a
// caught-and-continue): per the design doc's guardrail #4 — a silently
// missing/wrong fixture would otherwise surface many specs later as a
// confusing "product not found" error with no obvious connection to its real
// cause.
async function ensureProductFixtures(): Promise<void> {
  fs.mkdirSync(PRODUCT_FIXTURES_DIR, { recursive: true });

  const adminToken = await getAccessTokenForRole('admin');
  const apiContext = await apiRequest.newContext();
  try {
    const referenceData = await loadProductReferenceData(apiContext, adminToken);
    const records: Partial<Record<ProductFixtureKey, ProductFixtureRecord>> = {};
    // WHY generated exactly once per run, here: this is the ONE call site —
    // globalSetup runs in its own process, separate from every test worker,
    // so calling this again from a worker process would produce DIFFERENT
    // random values. Every other reader must go through the persisted JSON
    // file (getProductFixture()), never call the generator directly.
    const fixtureDefinitions = generateProductFixtureDefinitions();

    for (const fixture of fixtureDefinitions) {
      console.log(
        `[globalSetup] Creating fresh product fixture: ${fixture.key} ("${fixture.data.name}")`
      );
      records[fixture.key] = await createOneProductFixture(
        apiContext,
        adminToken,
        fixture,
        referenceData
      );
    }

    fs.writeFileSync(PRODUCT_FIXTURES_FILE, JSON.stringify(records, null, 2));
    console.log(`[globalSetup] Product fixtures persisted: ${PRODUCT_FIXTURES_FILE}`);
  } finally {
    await apiContext.dispose();
  }
}

async function createOneProductFixture(
  apiContext: APIRequestContext,
  adminToken: string,
  fixture: ReturnType<typeof generateProductFixtureDefinitions>[number],
  referenceData: ProductReferenceData
): Promise<ProductFixtureRecord> {
  // Create it, authenticated as its owning role, so the record's real
  // createdBy/ownership matches `fixture.owner` (confirmed live: Kylas
  // records createdBy from whichever token made the POST — not always
  // admin).
  const ownerToken =
    fixture.owner === 'admin' ? adminToken : await getAccessTokenForRole('restricted');

  // WHY this exact body shape, field by field: network-captured live
  // (2026-08-10) from a real UI Save click — see
  // PRODUCTS_AND_SERVICES_PROGRESS.md's investigation notes. Not derived
  // from the response shape (which differs in small ways, e.g. `disabled`
  // appears on countryOfOrigin/category's response objects but was absent
  // from the real request's `units` entries) — this is the literal request
  // body, not a guess.
  const createResponse = await apiContext.post(buildApiUrl('/products'), {
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    data: {
      name: fixture.data.name,
      price: {
        currencyId: resolveRefId(referenceData.currencyIdByName, 'INR', 'currency'),
        value: fixture.data.price,
      },
      description: `<div>${fixture.data.description}</div>`,
      hsnSacCode: fixture.data.hsnSacCode,
      countryOfOrigin: {
        id: resolveRefId(
          referenceData.countryIdByName,
          fixture.data.countryOfOrigin,
          'countryOfOrigin'
        ),
        name: fixture.data.countryOfOrigin,
        disabled: false,
      },
      category: {
        id: resolveRefId(referenceData.categoryIdByName, fixture.data.category, 'category'),
        name: fixture.data.category,
        disabled: false,
      },
      units: [
        {
          id: resolveRefId(referenceData.unitsIdByName, fixture.data.units, 'units'),
          name: fixture.data.units,
        },
      ],
      isActive: fixture.data.isActive,
      customFieldValues: {},
    },
  });
  if (!createResponse.ok()) {
    const errorBody = await createResponse.text().catch(() => '');
    throw new Error(
      `[globalSetup] Fixture "${fixture.key}" ("${fixture.data.name}") could not be created: ` +
        `HTTP ${createResponse.status()} — ${errorBody}`
    );
  }
  const createdBody = (await createResponse.json()) as { id: number | string };
  console.log(`[globalSetup] Created product fixture: ${fixture.key} (id: ${createdBody.id})`);
  return {
    key: fixture.key,
    owner: fixture.owner,
    name: fixture.data.name,
    id: String(createdBody.id),
    isActive: fixture.data.isActive,
    price: fixture.data.price,
    description: fixture.data.description,
    hsnSacCode: fixture.data.hsnSacCode,
    countryOfOrigin: fixture.data.countryOfOrigin,
    category: fixture.data.category,
    units: fixture.data.units,
  };
}

async function setupRole(
  role: 'admin' | 'restricted',
  browser: import('@playwright/test').Browser
): Promise<void> {
  const stateFile = path.join(STORAGE_STATE_DIR, `${role}.json`);
  const credentials = config.users[role];

  // WHY: in CI always force fresh login — cached state from previous
  // builds may be expired or from a different environment
  if (fs.existsSync(stateFile) && !process.env.CI) {
    const age = Date.now() - fs.statSync(stateFile).mtimeMs;
    if (age < 1 * 60 * 60 * 1000) {
      console.log(`[globalSetup] Reusing fresh state for: ${role}`);
      return;
    }
  }

  // WHY: A single failed page.goto()/login-click here aborts the ENTIRE suite
  // run with zero retry, unlike authManager.ts's runtime re-login path which
  // already retries navigation 3x. Mirror that same 3-attempt/backoff pattern
  // for this one-time, most-consequential login.
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`[globalSetup] Logging in as: ${role} (attempt ${attempt}/${maxAttempts})`);
    const context = await browser.newContext();
    // WHY: retain-on-failure, same convention as playwright.config.ts's own
    // test-level tracing — start unconditionally (cheap), only save the
    // trace to disk if this attempt actually fails, so a green CI run never
    // accumulates trace zips for a login that worked fine.
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    let capturedUserName = '';
    let succeeded = false;

    // Intercept /v1/users/me response to capture display name
    page.on('response', async (r) => {
      if (r.url().includes('/v1/users/me') && r.status() === 200) {
        const body = await r.json().catch(() => null);
        const n = body?.name || body?.fullName || body?.firstName || '';
        if (n) capturedUserName = n;
      }
    });

    try {
      // WHY: Jenkins server is slower than local — 30s default is not enough
      // for the initial page load on a memory-constrained CI server
      // WHY: "commit" fires on first byte received — more reliable than
      // "domcontentloaded" in headless Docker where JS may hang on load
      await page.goto(config.appUrl, { waitUntil: 'commit', timeout: 60000 });
      await page.locator('#input_email').waitFor({ state: 'visible', timeout: 60000 });
      await page.locator('#input_email').fill(credentials.email);
      await page.locator('#input_password').fill(credentials.password);
      await page.locator('#loginBtn').click();
      // WHY: fixed 2026-07-19 — this bare waitForURL() had no explicit
      // waitUntil, so it defaulted to Playwright's 'load', which waits for
      // EVERY resource on the page (analytics, chat widgets, tracking
      // pixels) to finish, not just the URL changing — the exact same
      // mechanism BasePage.waitForUrl() was already hardened against
      // (2026-07-07, see that method's own comment). Two consecutive
      // stage.yml runs hung the full 120000ms here, 3/3 attempts each run,
      // while a manual Staging login succeeds in ~2s — consistent with a
      // headless/extension-free CI context never firing 'load' for some
      // third-party resource the app waits on. This line pre-dates this
      // fix by ~2 months (introduced 2026-05-22, briefly swapped to
      // 'networkidle' and reverted the same day in early June) and was
      // never brought in line with the domcontentloaded convention
      // established elsewhere. Bringing it in line here, matching the one
      // proven fix already in this codebase rather than guessing a new one.
      await page.waitForURL(/sales\//, {
        timeout: config.timeouts.navigation,
        waitUntil: 'domcontentloaded',
      });

      // WHY: validate we actually landed on the app not redirected back to login
      const currentUrl = page.url();
      if (currentUrl.includes('signIn') || currentUrl.includes('login')) {
        throw new Error(
          `[globalSetup] Login failed for ${role} — redirected to ${currentUrl}. Check credentials for ENV=${config.env}`
        );
      }

      try {
        const dismissBtn = page.locator('#cancel[data-dismiss="modal"]');
        await dismissBtn.waitFor({ state: 'visible', timeout: 5000 });
        await dismissBtn.click();
        await dismissBtn.waitFor({ state: 'hidden', timeout: 5000 });
        console.log(`[globalSetup] Dismissed popup for: ${role}`);
      } catch {
        // No popup — continue
      }

      await context.storageState({ path: stateFile });
      console.log(`[globalSetup] State saved for: ${role}`);

      // Save captured display name to userNames.json
      await page.waitForTimeout(2000);
      if (capturedUserName) {
        const namesFile = path.join(STORAGE_STATE_DIR, 'userNames.json');
        const existing = fs.existsSync(namesFile)
          ? JSON.parse(fs.readFileSync(namesFile, 'utf8'))
          : {};
        existing[role] = capturedUserName.trim();
        fs.writeFileSync(namesFile, JSON.stringify(existing, null, 2));
        console.log(`[globalSetup] Display name saved for ${role}: ${capturedUserName.trim()}`);
      } else {
        console.warn(`[globalSetup] Could not capture display name for ${role}`);
      }

      succeeded = true;
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `[globalSetup] Login attempt ${attempt}/${maxAttempts} failed for ${role}: ${String(error)}`
      );
      if (attempt < maxAttempts) {
        console.log('[globalSetup] Retrying in 5 seconds...');
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    } finally {
      if (succeeded) {
        // WHY: discard — nothing went wrong, no point keeping the trace
        await context.tracing.stop().catch(() => null);
      } else {
        const tracePath = path.join(
          GLOBAL_SETUP_TRACE_DIR,
          `${role}-attempt${attempt}-${Date.now()}.zip`
        );
        await context.tracing
          .stop({ path: tracePath })
          .then(() => console.log(`[globalSetup] Trace saved: ${tracePath}`))
          .catch((traceError) =>
            console.warn(`[globalSetup] Could not save trace for ${role}: ${String(traceError)}`)
          );
      }
      await context.close();
    }
  }

  throw new Error(
    `GlobalSetup failed after 3 attempts — environment may be unreachable. ` +
      `Role: ${role}, ENV: ${config.env}. Last error: ${String(lastError)}`
  );
}

export default globalSetup;
