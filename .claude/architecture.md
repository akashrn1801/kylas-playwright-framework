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

