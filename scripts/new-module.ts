/**
 * Scaffolds a new module: factory, 10-section BasePage-extending page
 * object, and UI + RBAC spec skeletons with correct naming/tags — see
 * docs/CONTRIBUTING_TESTS.md §B for the full checklist this automates the
 * mechanical first half of. Prints the remaining MANUAL checklist items on
 * completion (this script cannot know your entity's real fields, RBAC
 * boundaries, or detect-tests.sh singular/plural mapping needs — those are
 * real judgment calls, not something to fake with a placeholder).
 *
 * Usage: npx ts-node scripts/new-module.ts <moduleDirName> <EntityClassName>
 *   e.g. npx ts-node scripts/new-module.ts widgets Widget
 *
 * WHY two explicit args, not one name the script tries to pluralize/
 * singularize itself (2026-09-30): docs/CONTRIBUTING_TESTS.md §B.3 already
 * documents a real, live singular<->plural mapping table in
 * .github/scripts/detect-tests.sh with irregular cases (company->companies)
 * a generic trailing-"s" rule gets wrong — guessing here would risk
 * generating a module whose own naming is already wrong on day one. Explicit
 * is safer than clever for a one-time scaffold.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

const REPO_ROOT = path.join(__dirname, '..');

function fail(message: string): never {
  logger.error(`[new-module] ${message}`);
  process.exit(1);
}

function writeIfAbsent(relPath: string, content: string): void {
  const abs = path.join(REPO_ROOT, relPath);
  if (fs.existsSync(abs)) {
    fail(`${relPath} already exists — refusing to overwrite. Delete it first if you really want to regenerate.`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  logger.success(`[new-module] Created ${relPath}`);
}

function factoryTemplate(entity: string): string {
  return `import { faker } from '@faker-js/faker';

// WHY the ADM/SHR prefix+timestamp convention — see
// .claude/architecture.md's "Test Data Factories" section: this codebase's
// QA/staging datasets never get cleaned up, so a distinguishing prefix is
// the only reliable way to make an RBAC negative-assertion trustworthy.
// TODO: replace this placeholder shape with the real ${entity} fields —
// confirm each field's real API name (not its UI label) via live DOM
// inspection before naming these properties (docs/CONTRIBUTING_TESTS.md §B.1).
export interface ${entity}Data {
  name: string;
  country: string; // TODO: confirm this entity actually has a Country field before keeping this
}

export function generate${entity}Data(overrides: Partial<${entity}Data> = {}): ${entity}Data {
  return {
    name: faker.company.name(),
    country: 'India',
    ...overrides,
  };
}

export function generateAdmin${entity}Data(overrides: Partial<${entity}Data> = {}): ${entity}Data {
  return generate${entity}Data({ name: \`ADM\${Date.now()}-\${faker.company.name()}\`, ...overrides });
}

export function generateShared${entity}Data(overrides: Partial<${entity}Data> = {}): ${entity}Data {
  return generate${entity}Data({ name: \`SHR\${Date.now()}-\${faker.company.name()}\`, ...overrides });
}
`;
}

function pageObjectTemplate(entity: string, moduleDir: string): string {
  return `import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../core/BasePage';
import { ${entity}Data } from '../../data/factories/${entity.charAt(0).toLowerCase() + entity.slice(1)}Factory';
import { logger } from '../../utils/logger';

// WHY this exact 10-section order — see .claude/architecture.md's "Page
// Object Structure" section: a fixed order means anyone can jump into an
// unfamiliar page object already knowing where to look. Keep every section
// header even if a section starts empty — a future edit adds to the RIGHT
// section instead of guessing.
export class ${entity}Page extends BasePage {
  // ─── 1. Retry Config ──────────────────────────────────────────────────
  // (e.g. \`private readonly retryConfig = config.searchRetry;\` — only if this module needs one)

  // ─── 2. Locators ───────────────────────────────────────────────────────
  // WHY lazily-evaluated arrow functions, never captured eagerly at
  // construction time — the DOM element a locator resolves to may not exist
  // yet when the page object is instantiated.
  private readonly addButton = (): Locator => this.page.locator('TODO-real-selector');
  private readonly nameInput = (): Locator => this.page.locator('TODO-real-selector');

  // ─── 3. Constructor ─────────────────────────────────────────────────────
  constructor(page: Page) {
    super(page);
  }

  // ─── 4. Private Helpers ─────────────────────────────────────────────────

  // ─── 5. Navigation ──────────────────────────────────────────────────────
  async goTo${entity}List(): Promise<void> {
    // TODO: real navigateTo(...) + waitForEntityListPage(...) call
  }

  // ─── 6. Form Actions ────────────────────────────────────────────────────
  async fill${entity}Form(data: ${entity}Data): Promise<void> {
    await this.fill(this.nameInput(), data.name, '${entity.toLowerCase()} name');
  }

  // ─── 7. Search & Open ───────────────────────────────────────────────────

  // ─── 8. Edit Actions ────────────────────────────────────────────────────

  // ─── 9. Assertions ──────────────────────────────────────────────────────

  // ─── 10. Workflow Wrappers ──────────────────────────────────────────────
  async create${entity}(data: ${entity}Data): Promise<number | null> {
    return this.withSessionExpiryRetry(async () => {
      await this.click(this.addButton(), 'add ${moduleDir} button');
      await this.fill${entity}Form(data);
      // TODO: real save + ID-capture (versioned-path response predicate —
      // CLAUDE.md rule 15, never a bare substring match)
      logger.success('${entity} created (TODO: real ID capture)');
      return null;
    }, 'create${entity}');
  }
}
`;
}

function uiSpecTemplate(entity: string, moduleDir: string): string {
  return `import { test, expect } from '../../../src/fixtures/index';
import { ${entity}Page } from '../../../src/modules/${moduleDir}/${entity}Page';
import { generate${entity}Data } from '../../../src/data/factories/${entity.charAt(0).toLowerCase() + entity.slice(1)}Factory';

// TODO: real per-module letter prefix for test labels (CLAUDE.md/
// .claude/reference-patterns.md §13) — grep this file's own future sibling
// files for the next free number before picking one.
test.describe('${entity} ', () => {
  test('@smoke admin should create a ${entity.toLowerCase()}', async ({ adminPage }) => {
    test.setTimeout(480000);
    const ${moduleDir}Page = new ${entity}Page(adminPage);
    const data = generate${entity}Data();
    const id = await ${moduleDir}Page.create${entity}(data);
    expect(id, 'Expected a real ${entity.toLowerCase()} ID to be captured').not.toBeNull();
  });
});
`;
}

function rbacSpecTemplate(entity: string, moduleDir: string): string {
  return `import { test, expect } from '../../src/fixtures/index';
import { ${entity}Page } from '../../src/modules/${moduleDir}/${entity}Page';
import { generate${entity}Data } from '../../src/data/factories/${entity.charAt(0).toLowerCase() + entity.slice(1)}Factory';

// See README.md §9 (RBAC Testing Philosophy) for the negative-assertion/
// share/reassign patterns this file should follow — this is a skeleton
// starting point, not a complete RBAC suite.
test.describe('${entity} RBAC', () => {
  test('@regression restricted user should create their own ${entity.toLowerCase()}', async ({ restrictedPage }) => {
    test.setTimeout(480000);
    const ${moduleDir}Page = new ${entity}Page(restrictedPage);
    const data = generate${entity}Data();
    const id = await ${moduleDir}Page.create${entity}(data);
    expect(id, 'Expected a real ${entity.toLowerCase()} ID to be captured').not.toBeNull();
  });
});
`;
}

function printRemainingChecklist(entity: string, moduleDir: string): void {
  logger.info(`
[new-module] Scaffold generated. Remaining MANUAL checklist (docs/CONTRIBUTING_TESTS.md §B):

1. Replace every TODO in the generated files with real selectors/fields/flows.
2. Confirm ${entity}Data's field names match the REAL API field names, not UI labels
   (live DOM inspection of the create form's name/id attributes — §B.1).
3. Fill in every one of the 10 page-object sections that applies to this module.
4. Confirm .github/scripts/detect-tests.sh's singular->plural mapping covers
   "${moduleDir}" — if it doesn't pluralize with a trailing "s" the generic
   way, add it to that script's own case statement (§B.3).
5. If this module ever becomes a Form-Field-Limit-style consumer, add a
   SINGULAR_TO_CANONICAL_MODULE_NAME entry in
   src/notifications/ReportParser.ts's deriveModuleFromFile() (§B.4).
6. Add a "test:${moduleDir}" script to package.json, following the existing
   pattern (§B.5).
7. Regenerate config/expected-test-counts.json:
   npx ts-node scripts/generate-expected-test-counts.ts
8. Run npm run check:conventions — the scaffolded files should already pass
   (tags, no @playwright/test import, correct naming) but re-check after your
   own edits.
9. Add this module to README.md's Project Overview / module-count table.
10. Add a known-issues.md entry — even a placeholder "built following the
    standard module pattern, no deviations" line (§B.7).
11. Run locator-reviewer once you've replaced the placeholder selectors.
`);
}

function main(): void {
  const [moduleDir, entity] = process.argv.slice(2);
  if (!moduleDir || !entity) {
    fail('Usage: npx ts-node scripts/new-module.ts <moduleDirName> <EntityClassName>  (e.g. widgets Widget)');
  }
  if (!/^[a-z][a-zA-Z]*$/.test(moduleDir)) {
    fail(`<moduleDirName> "${moduleDir}" should be a plain lowercase-start camelCase directory name (e.g. "widgets", "productsAndServices")`);
  }
  if (!/^[A-Z][a-zA-Z]*$/.test(entity)) {
    fail(`<EntityClassName> "${entity}" should be a PascalCase class name (e.g. "Widget")`);
  }

  const entityLower = entity.charAt(0).toLowerCase() + entity.slice(1);
  writeIfAbsent(`src/data/factories/${entityLower}Factory.ts`, factoryTemplate(entity));
  writeIfAbsent(`src/modules/${moduleDir}/${entity}Page.ts`, pageObjectTemplate(entity, moduleDir));
  writeIfAbsent(`tests/ui/${moduleDir}/${moduleDir}.spec.ts`, uiSpecTemplate(entity, moduleDir));
  writeIfAbsent(`tests/rbac/${moduleDir}.rbac.spec.ts`, rbacSpecTemplate(entity, moduleDir));

  printRemainingChecklist(entity, moduleDir);
}

main();
