# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
End-to-end automation framework for Kylas Sales CRM using Playwright + TypeScript.

## Tech Stack
- Playwright ^1.60.0 + TypeScript (strict, ES2022)
- Node >=20.0.0 / npm >=10.0.0
- Faker.js for test data generation
- Allure + Playwright HTML reporters
- ErrorCollector for runtime browser/network error tracking

## Key Commands

```bash
# Run a specific module (UI + RBAC)
ENV=qa npm run test:leads
ENV=qa npm run test:contacts
ENV=qa npm run test:companies
ENV=qa npm run test:deals
ENV=qa npm run test:tasks
ENV=qa npm run test:meetings
ENV=qa npm run test:call-logs
ENV=qa npm run test:quotations

# Run a single test file directly
ENV=qa npx playwright test tests/ui/leads/leads.spec.ts --project=chromium --workers=1
ENV=qa npx playwright test tests/rbac/leads.rbac.spec.ts --project=chromium --workers=1

# Run by tag
ENV=qa npx playwright test --grep "@smoke" --project=chromium --workers=1

# TypeScript check
npx tsc --noEmit

# Lint + format
npm run lint:fix
npm run format

# View reports
npm run report:playwright
npm run report:allure

# Reset auth (sessions expire after ~1 hour)
rm -rf src/auth/storageStates/qa/

# Clean all output
npm run clean
```

## Environment Variables
Copy `.env.example` and set these per-env values in `.env`:
```
ENV=qa   # qa | staging | prod

QA_APP_URL=
QA_API_BASE_URL=
QA_ADMIN_EMAIL=
QA_ADMIN_PASSWORD=
QA_RESTRICTED_EMAIL=
QA_RESTRICTED_PASSWORD=

# For Quotations (deals pre-created in DB)
QA_ADMIN_DEAL_NAME=
QA_RESTRICTED_DEAL_NAME=
```
`STAGING_*` and `PROD_*` follow the same pattern.

## Architecture

### File Layout
```
src/
  core/BasePage.ts          — Base class all page objects extend
  fixtures/index.ts         — Custom test fixtures (ALWAYS import from here)
  auth/
    globalSetup.ts          — Logs in both roles before suite, saves storage state
    authManager.ts          — Session validation + re-login with 1-hr in-memory cache
    storageStates/<env>/    — Saved Playwright browser storage states per role
  modules/<module>/
    <Module>Page.ts         — Page object class
  data/factories/
    <module>Factory.ts      — generateXxxData() / generateAdminXxxData() functions
  error-collector/
    ErrorCollector.ts       — Singleton; captures pageerror / console-error / HTTP 4xx-5xx
    errorFilters.ts         — Noise filter + expected RBAC error classifier
  reporters/
    MiscErrorReporter.ts    — Playwright reporter that writes reports/misc-errors.json
  notifications/            — Email notification service (post-run)
  utils/logger.ts           — logger.info/warn/error/success (never use console.log)

tests/
  ui/<module>/              — Functional UI tests (adminPage fixture)
  rbac/<module>.rbac.spec.ts — Permission tests (adminPage + restrictedPage fixtures)

config/config.ts            — Single source of truth for env vars, timeouts, retry config
```

### Fixtures (`src/fixtures/index.ts`)
Two custom fixtures wrap authenticated browser contexts:
- **`adminPage`** — full-access "Playwright Automation" user
- **`restrictedPage`** — limited-access "User 1"

Both fixtures: attach `ErrorCollector` listeners (pageerror, console-error, requestfailed, 4xx/5xx), dismiss startup popups, and validate/renew sessions via `AuthManager`. Always import `test` and `expect` from `src/fixtures/index.ts`, never from `@playwright/test`.

### Auth Flow
`globalSetup.ts` runs once before the suite: logs in both roles, saves `src/auth/storageStates/<env>/<role>.json`, and captures the user display name to `userNames.json`. `AuthManager.getContextForRole()` reuses cached state with a 1-hour in-memory TTL — skipping the browser validation overhead for every test in the suite.

### Page Object Structure
Every page object extends `BasePage` and follows this exact section order:
1. `retryConfig` (reads from `config.searchRetry` or `config.meetingRetry`)
2. Locators (private readonly arrow functions returning `Locator`)
3. Constructor (`super(page)`)
4. Private Helpers
5. Navigation
6. Form Actions
7. Search & Open
8. Edit Actions
9. Assertions
10. Workflow Wrappers

Locators are arrow functions (`private readonly foo = (): Locator => ...`) so they are lazily evaluated and not captured at construction time.

### Test Data Factories
Each factory exports `generateXxxData()` plus prefixed variants for RBAC isolation:
- `generateAdminXxxData()` — prefix `ADM<timestamp>` — admin-only data, guaranteed invisible to restricted user
- `generateSharedXxxData()` — prefix `SHR<timestamp>` — data admin creates then shares with restricted user
- Restricted user creates data with plain `generateXxxData()`; its ownership is their own role

Country defaults to `India` in all factories (CRM validation requirement).

### Retry / Flake Mitigation
`config.searchRetry` drives the retry loop in every `searchAndOpen*` method. Meetings use `config.meetingRetry` (more retries, longer wait) because the calendar aggregation is slower. Do not hardcode retry values in page objects — read from config.

### ErrorCollector
Captures browser-level errors passively during every test. Results are written to `reports/misc-errors.json`. RBAC permission errors (403s) are marked `expected: true` by `errorFilters.ts` so they don't pollute the unexpected-error count. Review `misc-errors.json` after a run to spot regressions independent of test assertions.

## Key Conventions
- NEVER import from `@playwright/test` in test files — always use `src/fixtures/index.ts`
- NEVER hardcode test data — use factories
- NEVER put locators in test files — all locators live in the page object
- ALWAYS extend `BasePage` for page objects
- Use `logger.*` not `console.log`
- Tags: `@smoke` (navigation only), `@regression` (full), `@prodSafe` (read-only, safe on prod)
- `test.setTimeout(480000)` on any test that creates/edits records (local runs can be slow)

## Branch Strategy
Create feature branches from `dev`. Test on sandbox (`sandbox.yml` auto-detects changed files) before opening a PR to `dev`. PRs to `main` go through the full CI matrix.

## CI/CD
- GitHub Actions: `dev.yml`, `qa.yml`, `stage.yml`, `prod.yml`, `main.yml`
- Jenkins: `Jenkinsfile` (multi-branch), `Jenkinsfile.qa`, `Jenkinsfile.staging`, `Jenkinsfile.prod`
- `sandbox.yml`: selective test detection based on changed files (uses `scripts/reset-sandbox.sh`)
- Worker count in CI is controlled by the `WORKERS` env var (set per-Jenkinsfile), defaulting to 2 if unset (`playwright.config.ts`); retries default to 1

## Known Issues
- Annual Revenue field in `CompaniesPage` — commented out (prod bug)
- QA sessions expire after ~1 hour — run `rm -rf src/auth/storageStates/qa/` to force re-login
- Clone lead/contact creates a pre-filled form — must change email/phone to avoid duplicate validation errors
- `saveQuickTask()` waits for the task list view — use `saveQuickTaskFromEntityDetail()` when called from an entity detail page

## Module Status
- ✅ Leads (38 tests: 16 UI + 22 RBAC)
- ✅ Companies
- ✅ Contacts
- ✅ Deals
- ✅ Meetings
- ✅ Tasks
- ✅ Quotations
- ✅ Call Logs (43 tests: 21 UI + 22 RBAC)

---

## AUDIT FINDINGS SUMMARY
_Full audit performed 2026-07-01 across all modules, core framework, and CI/CD. This is a compact reference — read this before touching any page object, fixture, or CI file to avoid re-introducing known root causes of flakiness._

### Top 10 rules that PREVENT the issues found
1. Every detail-page navigation must wait for the entity's GET API response (`waitForResponse(/\/v1\/<module>\/\d+$/)`), not just URL + `domcontentloaded`. Several modules skip this — it's the #1 flakiness source.
2. Every share/reassign/delete/save must capture a `waitForResponse` promise **before** clicking, and await it — never end a mutation with only `waitForTimeout`.
3. All search/find/retry logic must read from `config.searchRetry`/`config.meetingRetry` via the page object's `retryConfig` getter — never hardcode loop counts or sleep values.
4. Scope locators to their container (modal/card/row) and use `.first()` or `exact: true` on any text filter — never bare `getByText('Add'|'Save'|'Edit')` at page level.
5. Never use DOM-position (`nth(n)`) or CSS-in-JS hash classes (`.css-xxxxx`) as locators — prefer stable `id`/`name`/`data-*`/role+accessible-name.
6. Cross-role (admin+restricted) tests must assume propagation lag — poll/retry on 403, never a single fixed sleep "to prevent permission errors."
7. Negative/RBAC assertions must distinguish "correctly absent" from "failed to load" — never `if (visible) {assert} else {logger.success('...correct RBAC')}`.
8. Count-based assertions (notes, list rows) must capture a baseline **before** the mutating action and assert `baseline + N` — never assert an absolute count.
9. Give every `expect()`/thrown assertion a message with the entity id/name — bare `expect(x).toBeTruthy()` gives zero triage signal on a rotating-flake investigation.
10. Assume QA/staging data grows unboundedly (no module cleans up) — search/list operations get slower over the life of the environment; budget retries accordingly.

### Anti-patterns to NEVER do (each one is a confirmed root cause in this codebase)
- Raw `page.goto()` + `waitForURL()` + `waitForTimeout()` in a **test file**, bypassing the page object's own `waitForXDetailsPage()` — the single most repeated anti-pattern (15-18+ sites per RBAC file).
- Marking `waitForXDetailsPage()`/equivalent `private` — RBAC tests will reinvent a weaker inline version instead of importing the real one (happened in Contacts, Leads).
- `Promise.race([waitForResponse, elementVisible])` for list/detail readiness — a stale-but-visible container can win the race and satisfy the wait on old data.
- `.locator(...).filter({ hasText: X }).first().click()` to open a row when `X` may not literally be the row's rendered text (e.g. custom prefix vs. system-generated number) — verify identity **after** navigating, don't trust the click landed right.
- `click({ force: true })` to bypass actionability checks — masks a real overlay/blocking-element bug instead of surfacing it.
- Catch-and-log-success on any exception ("...expected behaviour") — converts a real failure into a silent pass.
- Trusting `playwright.config.ts`'s `workers: isCI ? 2 : ...` to mean "1 worker in CI" — it does not; verify actual config before reasoning about parallel safety.
- Trusting a `private static` in-memory cache (e.g. `AuthManager`) to synchronize across CI workers — each Playwright worker is a separate OS process; only file locks/atomic writes work cross-process.
- Writing directly to a shared file (`storageStates/<env>/<role>.json`, `misc-errors.json`) via plain `fs.writeFileSync` from code that can run in multiple workers — write-temp-then-rename or accept last-writer-wins data loss.
- Appending `|| true` to a CI test-run command — it reports green regardless of failures; the only signal left is a buried email attachment.

### CI/CD flow (as of audit; verify against live Jenkinsfiles/workflows before relying on this)
| Branch | Scope | Workers | Runner | Known issue |
|---|---|---|---|---|
| sandbox | selective via `detect-tests.sh`, fallback `@smoke` | dynamic | GitHub Actions | Jenkins capture (`\| tail -1`) differs from GHA capture — can select wrong scope |
| dev | `@smoke` (~18 tests) | 1 | GitHub Actions | — |
| qa | `@regression` (~222 tests) | 2 | GHA + Jenkins | — |
| stage | full suite, no grep (~234) | 2 | GHA + Jenkins | `staging.yml` has undocumented auto-`promote-to-prod` job |
| prod | `@prodSafe` only (~13 tests) | 2 | Jenkins (primary) | Deals module has **zero** `@prodSafe` tests |
| main | full suite, no grep (Jenkins primary) | 2 | Jenkins primary; `main.yml` (GHA, manual) wrongly filters `@regression` only | Two CI paths for `main` cover different scope |

Also confirmed: `Jenkinsfile` (main/prod), `Jenkinsfile.sandbox`, and `staging.yml` append **`|| true`** — these pipelines go green regardless of test outcome. No scheduled/nightly runs exist anywhere. No cross-environment (QA/staging/prod) data-parity check exists.

### Module-specific known issues
| Module | Known issue |
|---|---|
| **Leads** | `waitForLeadDetailsPage()` has no GET-response wait (used by nearly every flow). `shareLead`/`reassignLead`/`convertLeadToAll` end in flat `waitForTimeout`, not a response wait. `assertOwnerOnDetail` uses unscoped `text=` instead of the already-defined (but unused) `detailOwner` locator. |
| **Contacts** | `waitForContactDetailsPage()` exists and is correct but is `private` — 18+ RBAC call sites bypass it with raw `goto`+2-3s sleep instead. `shareContact`/`reassignContact` same gap as Leads. |
| **Companies** | C13's "fix" (assert `lastName` instead of `firstName`) treats the symptom, not the cause — real bug is no wait for the Contacts card to refetch after re-navigation; assert **both** fields + wait for card refresh. CLAUDE.md's "Annual Revenue commented out" is **stale** — the field is active; only the detail-page assertion is skipped (currency formatting). |
| **Deals** | `pipelineControl()`/`sourceControl()` use `nth(2)`/`nth(3)` on generic `div`+text filters — brittle. `campaignControl()` locator chains through CSS-in-JS hash classes (`.css-2b097c-container`) that regenerate on any frontend rebuild — highest single locator risk in the codebase. `saveEditedDeal`/`addProductRow`/`addPartPayments` have no response-listener and no retry (unlike `saveDeal`, which does both correctly). |
| **Meetings** | `addButton()` is unscoped (`getByRole('button',{name:'Add'})` page-wide) and the open-form retry loop is hardcoded (3 attempts/15s) instead of using `config.meetingRetry` — root cause of the 600s Add-button timeout. Title field has two reactive re-check patches (after fill, after full form fill) but nothing right before the actual save click — medium/location/description fills after the second guard can still clear it. |
| **Tasks** | No `waitForTaskDetailsPage()` exists at all — `openTaskInDetailPanel()` only does `waitForTimeout(800)`. `waitForListReady()`'s `Promise.race` lets a stale-but-visible list satisfy the wait. Confirmed live bug: `leads.rbac.spec.ts:199` calls `saveQuickTask()` instead of `saveQuickTaskFromEntityDetail()` from a lead-detail-panel context — exactly the documented footgun. |
| **Quotations** | `searchAndOpenQuotation()` filters list rows by custom-prefix summary/number, but rows render system-generated numbers (`QUO-00042`) — the filter can match the wrong row with no identity check after click (root cause of the "wrong quotation loaded" bug). `assertDetailPageFields()` only `logger.warn()`s on a title mismatch instead of throwing. T7 depends on a shared, non-isolated deal (`config.deals.adminDealName`) instead of creating its own. |
| **Call-logs** | No retry-on-403 exists anywhere despite a commit message claiming to add "permission propagation retry" (`grep -r propagat src/` returns zero hits). `searchAndSelectEntity`'s ADM/SHR-prefix filter silently falls back to **unfiltered** options when the filtered pool is empty — likely the real cause of "necessary permission" errors on Associated Deal/Contact sub-fields, not a timing race. `callLogsProductivityButton()` still targets `button[...] svg` (detach-prone on React re-render) even though test CL31c already found and fixed this inline — never backported to the shared locator. `assertOnCallLogsListPage()`/`waitForListReady()` cannot distinguish "empty list" from "slow" from "broken search API" (list-search API 404s on QA per existing code comment). |
| **Core framework** | `playwright.config.ts:12` hardcodes `workers: isCI ? 2 : ...` — **CLAUDE.md's "workers forced to 1 in CI" claim above is false**; Jenkinsfiles set `WORKERS=1` but it's never read for this. `AuthManager`'s `private static` caches only synchronize within one process, not across the real 2 CI workers — concurrent re-login races the shared `storageStates/<env>/<role>.json` file (non-atomic write). `ErrorCollector` writes `misc-errors.json` via plain `fs.writeFileSync` with no cross-process lock — 2 workers writing concurrently means last-writer-wins, silently dropping one worker's errors. `expect.timeout` is hardcoded to `20000` in CI, ignoring `config.timeouts.expect`. |

### Established wait/locator patterns per module (verify before assuming a module is "safe")
| Module | `waitForXDetailsPage` has GET-response wait? | Retry-find pattern | Primary locator risk |
|---|---|---|---|
| Leads | ❌ No | ✅ `retryFindLead` (searchRetry) | Unscoped `text=` for stage/owner |
| Contacts | ✅ Yes, but `private` (bypassed) | ✅ `retryFindContact` | Whole-body `toContainText` (weak, not field-scoped) |
| Companies | ✅ Yes, correct | ✅ `retryFindCompany` | Unscoped Add button; no-`.first()` pipeline text |
| Deals | ❌ No | ✅ `retryFindDeal` (asymmetric — no retry for the negative/not-in-list case) | `nth(2)`/`nth(3)` + CSS-hash locators (critical) |
| Meetings | ❌ No GET wait anywhere in module | ✅ `retryFindMeetingInList`, but other loops hardcode instead of using `config.meetingRetry` | Unscoped Add button (root cause), `getByText(...).last()` |
| Tasks | ❌ No `waitForTaskDetailsPage` exists | ✅ `retryFindTask` (searchRetry) | Mostly fine; some unscoped `.dropdown-menu` selectors |
| Quotations | ⚠️ Partial — `goToQuotationDetail` correct, `searchAndOpenQuotation` has none | ⚠️ `retryFindInList` exists but is NOT used by `searchAndOpenQuotation` | `filter({hasText})` against mismatched row text (T22 root cause) |
| Call-logs | ❌ Abandoned (QA search API 404s) — DOM-only wait | ✅ `retryFindCallLog`, but search-only; no retry-on-permission | SVG-targeted button locator (detach-prone) |

---

## Reference Patterns

Canonical code patterns used across Leads, Contacts, Companies page objects and RBAC specs.  
Read this section instead of re-reading source files for these recurring shapes.

---

### 1. `waitForXDetailsPage()` — URL + domcontentloaded + API response

```typescript
private async waitForCompanyDetailsPage(): Promise<void> {
  await this.page.waitForURL(/sales\/companies\/details\//, { timeout: 20000 });
  await this.page.waitForLoadState('domcontentloaded');
  // WHY: Wait for GET API — ensures React has entityId in state before share/edit fires
  await this.page.waitForResponse(
    (res) => res.url().match(/\/v1\/companies\/\d+$/) !== null && res.request().method() === 'GET',
    { timeout: 15000 }
  ).catch(() => null);
}
```

Adapt URL regex and `/v1/<module>/\d+$` per module. The `.catch(() => null)` makes the wait non-fatal.

---

### 2. Ellipsis menu pattern

**Locators:**
```typescript
private readonly ellipsisButton = (): Locator =>
  this.page.locator('button.btn.dropdown-toggle.btn-down-arrow.btn-primary').first();

private readonly ellipsisMenuItem = (text: string): Locator =>
  this.page.locator('.dropdown-menu.show').locator('a.dropdown-item').filter({ hasText: text });
```

**Methods:**
```typescript
async openEllipsisMenu(): Promise<void> {
  await this.ellipsisButton().scrollIntoViewIfNeeded();
  await this.ellipsisButton().click();
  await this.page.waitForTimeout(500);
}

async clickEllipsisOption(optionText: string): Promise<void> {
  await this.openEllipsisMenu();
  const item = this.ellipsisMenuItem(optionText);
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
}

async assertEllipsisOptionNotVisible(optionText: string): Promise<void> {
  const item = this.ellipsisMenuItem(optionText);
  await expect(item).toBeHidden({ timeout: 3000 }).catch(async () => {
    const count = await item.count();
    expect(count).toBe(0);
  });
}
```

Note: Contacts edit button = `#edit-action` (no `-btn`), Leads/Companies = `#edit-action-btn`.

---

### 3. Share modal pattern (3-char search minimum, JS label click)

```typescript
async shareXxx(restrictedUserName: string, permissions: string[] = []): Promise<void> {
  await this.clickEllipsisOption('Share');
  await this.page.waitForTimeout(1000);
  // Open Share To type dropdown, select "User"
  const shareTypeControl = this.page.locator('.modal.show').locator('.is-invalid__control').first();
  await shareTypeControl.click();
  await this.page.locator('.is-invalid__option').filter({ hasText: 'User' }).first().click();
  await this.page.waitForTimeout(500);
  // WHY: Search requires ≥3 chars — find first eligible word, fallback to first 3 chars
  const words = restrictedUserName.trim().split(' ');
  const validWord = words.find((w) => w.length >= 3) ?? restrictedUserName.trim().substring(0, 3);
  await this.page.locator('[id="undefined_undefinedundefined_input_toId"]').fill(validWord);
  await this.page.waitForTimeout(800);
  await this.page.locator('.is-invalid__option').filter({ hasText: restrictedUserName }).first().click();
  await this.page.waitForTimeout(500);
  // WHY: JS click on label — CSS sibling selector unreliable in Playwright
  for (const permission of permissions) {
    const toggle = this.page.locator(`#inp_${permission}`);
    const isChecked = await toggle.isChecked().catch(() => false);
    if (!isChecked) {
      await this.page.evaluate((perm) => {
        const input = document.querySelector(`#inp_${perm}`) as HTMLElement;
        (input?.parentElement?.querySelector('label') as HTMLElement)?.click();
      }, permission);
      await this.page.waitForTimeout(300);
    }
  }
  await this.page.locator('.modal.show button.btn-primary.ml-auto').first().click();
  await this.page.waitForTimeout(1000);
}
```

**Reassign modal:**
```typescript
async reassignXxx(userName: string): Promise<void> {
  await this.clickEllipsisOption('Reassign');
  await this.page.waitForTimeout(500);
  const words = userName.trim().split(' ');
  const validWord = words.find((w) => w.length >= 3) ?? userName.trim().substring(0, 3);
  const reassignInput = this.page.locator('[id="undefined_undefinedundefined_input_entitySelection"]');
  await reassignInput.fill(validWord);
  await this.page.waitForTimeout(800);
  await this.page.locator('.is-invalid__option').filter({ hasText: userName }).first().click();
  await this.page.waitForTimeout(500);
  await this.page.locator('.modal.show button.btn-primary.ml-auto').first().click();
  await this.page.waitForTimeout(1000);
}
```

**Share permission keys:** `update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`

---

### 4. Clone pattern (duplicate-avoidance, ID capture before save)

```typescript
async cloneXxx(): Promise<number | null> {
  await this.clickEllipsisOption('Clone');
  await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
  await this.page.waitForTimeout(1000);
  // Read original value before other fills (used for safety refill)
  const originalName = await this.nameInput().inputValue().catch(() => '');
  // Change email to avoid duplicate error
  if (await this.emailInput().isVisible().catch(() => false)) {
    await this.emailInput().fill(`clone${Date.now()}@testkylas.com`);
  }
  // Change phone — Indian format: starts 6/7/8/9, 10 digits total
  if (await this.phoneInput().isVisible().catch(() => false)) {
    const newPhone = faker.helpers.arrayElement(['6','7','8','9']) + faker.string.numeric(9);
    await this.phoneInput().clear();
    await this.phoneInput().fill(newPhone);
  }
  // Safety: contacts check lastName, companies check name — refill if cleared
  const nameValue = await this.nameInput().inputValue().catch(() => '');
  if (!nameValue) await this.nameInput().fill(`${originalName || 'Entity'} Copy`);
  // WHY: Set up ID capture BEFORE save — response may arrive during click
  const idPromise = this.captureXxxIdFromResponse();
  await this.click(this.saveButton(), 'save cloned entity');
  await this.assertNoFormErrors('clone form');
  const id = await idPromise;
  await this.page.waitForTimeout(1500); // stays on original detail page
  return id;
}
```

For contacts clone: check `lastNameInput` value instead of `nameInput`.

---

### 5. Right panel icon pattern (SVG ID map + dual-selector locator)

```typescript
// WHY: SVG gradient IDs differ per icon — more reliable than title attribute alone
private readonly rightPanelIconSvgMap: Record<string, string> = {
  'Notes':      'paint0_linear_972_2654',
  'Tasks':      'clip-Ic_Task',
  'Meetings':   'clip-Ic_Meetings',
  'Call Logs':  'paint1_linear_contacts',   // Contacts only — Leads: 'paint1_linear_leads'
  'Quotations': 'Quotation_Icon-16px_New',
  // Companies: omit 'Call Logs' — not available on company detail
};

private readonly rightPanelIcon = (title: string): Locator => {
  const svgId = this.rightPanelIconSvgMap[title];
  if (svgId) {
    return this.page
      .locator(`button.btn.btn-transparent:has(svg #${svgId}), button.btn.btn-transparent[title="${title}"]`)
      .first();
  }
  return this.page.locator(`button.btn.btn-transparent[title="${title}"]`);
};
```

---

### 6. Note add/delete with baseline-relative count assertion (L28/CR17 pattern)

**CRITICAL** — always capture baseline BEFORE adding notes; never hardcode counts.

```typescript
// In the test (or inline in a page method):
// 1. Open Notes panel
await restrictedPage
  .locator('button.btn.btn-transparent:has(svg #paint0_linear_972_2654)')
  .first().click();
await restrictedPage.waitForTimeout(500);

// 2. Capture baseline BEFORE adding anything
const baselineCount = await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count();

// 3. Add first note (to keep)
await restrictedPage.locator('textarea.notes-textarea').click();
await restrictedPage.waitForTimeout(1000);
await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to keep');
await restrictedPage.waitForTimeout(500);
await restrictedPage.getByText('Add', { exact: true }).click();
await restrictedPage.waitForTimeout(1500);

// 4. Add second note (to delete)
await restrictedPage.locator('textarea.notes-textarea').click();
await restrictedPage.waitForTimeout(1000);
await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to delete');
await restrictedPage.waitForTimeout(500);
await restrictedPage.getByText('Add', { exact: true }).click();
await restrictedPage.waitForTimeout(1500);

// 5. Assert +2 relative to baseline
expect(await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count()).toBe(baselineCount + 2);

// 6. Delete newest note (notes are newest-first)
const lastNoteEllipsis = restrictedPage.locator('div.row.pt-2.pl-2.pr-2')
  .first().locator('button[data-toggle="dropdown"]');
await lastNoteEllipsis.click();
await restrictedPage.waitForTimeout(300);
await restrictedPage.locator('.dropdown-menu.show .dropdown-item').filter({ hasText: 'Delete' }).click();
await restrictedPage.waitForTimeout(500);
await restrictedPage.locator('button#confirm.btn-danger').waitFor({ state: 'visible', timeout: 5000 });
await restrictedPage.locator('button#confirm.btn-danger').click();
await restrictedPage.waitForTimeout(1500);

// 7. Assert +1 relative to baseline
expect(await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count()).toBe(baselineCount + 1);

// 8. Verify note text via CKEditor iframes (skip active editor)
const checkNoteText = async (text: string): Promise<boolean> =>
  restrictedPage.evaluate((t) => {
    for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
      if (iframe.title?.includes('Rich Text Editor')) continue;
      try { if (iframe.contentDocument?.body?.innerText?.includes(t)) return true; } catch {}
    }
    return false;
  }, text);
expect(await checkNoteText('Note to delete')).toBe(false);
expect(await checkNoteText('Note to keep')).toBe(true);
```

---

### 7. Add deal from modal (pipeline selection + product row + part payments + response listener)

```typescript
// WHY: Pipeline locator — nth(2) targets the visible React Select inside the deal modal
const pipelineControl = this.page.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
await pipelineControl.click();
await this.page.getByText('Default Deal Pipeline', { exact: true })
  .waitFor({ state: 'visible', timeout: 10000 });
await this.page.getByText('Default Deal Pipeline', { exact: true }).click();

// Add product row (DealsPage helper)
await dealsPage.addProductRow();

// Add 2 part payment installments
await dealsPage.addPartPayments(2);

// WHY: ALWAYS set up response listener BEFORE clicking save
const dealIdPromise = this.page.waitForResponse(
  (res) =>
    (res.url().includes('/deals') || res.url().includes('/deal')) &&
    res.request().method() === 'POST' &&
    (res.status() === 200 || res.status() === 201),
  { timeout: 30000 }
).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
}).catch(() => null);

await this.page.locator('#editEntityModal button.save-button').click();
await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
const dealId = await dealIdPromise;
```

Without product, fill estimated value as fallback:
```typescript
const estimatedValueInput = this.page.locator('[id="1_21_input_estimatedValue"]');
if (await estimatedValueInput.isVisible().catch(() => false)) {
  await estimatedValueInput.fill('50000');
}
```

---

### 8. Add contact from modal — exact field IDs (captured from live DOM)

When adding a contact from a company or lead detail page modal:

```typescript
// Modal title check
await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 });

// WHY: These IDs are from the company/lead "Add Contact" modal — not the standalone contact form
await this.page.locator('[id="0_12_input_firstName"]').fill(contactData.firstName);
await this.page.locator('[id="0_13_input_lastName"]').fill(contactData.lastName);

// Email — click Add Email button first (scoped to modal to avoid page-level ambiguity)
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Email' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_11_input_email_0"]').fill(contactData.email);

// Phone — same pattern
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Phone' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_12_input_phone_0"]').fill(contactData.phone);

// WHY: Set up response listener BEFORE save
const contactIdPromise = this.page.waitForResponse(
  (res) => res.url().includes('/v1/contacts') && res.request().method() === 'POST' &&
    (res.status() === 200 || res.status() === 201),
  { timeout: 30000 }
).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.id ?? body?.data?.id ?? null;
}).catch(() => null);

await this.page.locator('#editEntityModal button.save-button').click();
await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
const contactId = await contactIdPromise;
```

**Standalone contact create form IDs differ:** `input[name="firstName"]`, `input[name="emails[0].value"]`  
**Edit mode email/phone IDs:** `[id="1_11_input_email_0"]`, `[id="1_12_input_phone_0"]`
