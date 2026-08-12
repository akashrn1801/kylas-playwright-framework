import * as fs from 'fs';
import * as path from 'path';
import { ProductFixtureKey, ProductFixtureRecord } from './factories/productsAndServicesFactory';

// WHY this file exists, separate from the generated data it reads: mirrors
// the exact precedent already established by src/auth/authManager.ts reading
// src/auth/storageStates/<env>/<role>.json — the generated, gitignored JSON
// lives in its own directory (src/data/productFixtures/<env>.json, written by
// globalSetup.ts's ensureProductFixtures()), while the CODE that reads it is
// a sibling source file, not colocated inside the generated-data directory
// itself.
const PRODUCT_FIXTURES_DIR = path.join(__dirname, 'productFixtures');

/**
 * Single accessor for a permanent Products & Services fixture record.
 *
 * WHY this is the ONLY sanctioned way to read a fixture: per the design
 * doc's guardrail #8 — "one function, one place to change if the storage
 * mechanism evolves (JSON → API → anything else)." No spec file should ever
 * call `fs.readFileSync()` on `src/data/productFixtures/<env>.json`
 * directly — always go through this function.
 *
 * @param key Which permanent fixture to read (`'adminActive'`,
 *            `'restrictedActive'`, or `'inactive'`).
 * @param env The environment whose fixture file to read (e.g. `config.env`).
 * @throws If the fixture file for `env` doesn't exist yet, or exists but is
 *         missing this specific `key` — both cases mean
 *         `ensureProductFixtures()` (globalSetup.ts) has not successfully
 *         run for this environment yet, which is a hard-stop setup problem,
 *         not something a caller should silently work around.
 */
export function getProductFixture(key: ProductFixtureKey, env: string): ProductFixtureRecord {
  const filePath = path.join(PRODUCT_FIXTURES_DIR, `${env}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `getProductFixture: no fixture file found for ENV=${env} at ${filePath} — has ` +
        `globalSetup's ensureProductFixtures() run successfully for this environment yet?`
    );
  }
  const records = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<
    Record<ProductFixtureKey, ProductFixtureRecord>
  >;
  const record = records[key];
  if (!record) {
    throw new Error(
      `getProductFixture: fixture "${key}" not found in ${filePath} (expected keys: ` +
        `adminActive, restrictedActive, inactive). Has ensureProductFixtures() run ` +
        `successfully for ENV=${env}, and does it still cover this key?`
    );
  }
  return record;
}
