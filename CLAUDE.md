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
- Workers forced to 1 in CI (`playwright.config.ts`); retries default to 1

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
