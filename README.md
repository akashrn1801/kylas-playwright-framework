# Kylas Playwright Framework — Enterprise Automation Suite

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Project Structure](#project-structure)
3. [Tech Stack](#tech-stack)
4. [Environment Configuration](#environment-configuration)
5. [Local Setup](#local-setup)
6. [Running Tests](#running-tests)
7. [Framework Architecture](#framework-architecture)
8. [Branch Strategy & CI/CD Flow](#branch-strategy--cicd-flow)
9. [GitHub Actions Pipeline](#github-actions-pipeline)
10. [Jenkins Pipeline](#jenkins-pipeline)
11. [Adding New Tests](#adding-new-tests)
12. [Adding New Environments](#adding-new-environments)
13. [Troubleshooting](#troubleshooting)

---

## Project Overview

Enterprise-grade Playwright automation framework for **Kylas Sales CRM**.
Built with TypeScript, Page Object Model, fixture-based auth, and multi-environment CI/CD.

**Covers:**
- UI functional tests (Leads module, Login)
- RBAC (Role-Based Access Control) tests
- Multi-environment execution (QA, Staging, Prod)
- Jenkins pipeline with approval gate before Prod

---

## Project Structure

```
kylas-playwright-framework/
├── .github/
│   └── workflows/
│       └── playwright.yml        # CI — runs on push/PR to develop and main
├── config/
│   └── config.ts                 # Central config — reads ENV prefix, resolves all values
├── src/
│   ├── auth/
│   │   ├── globalSetup.ts        # Runs ONCE before all tests — creates auth sessions
│   │   ├── authManager.ts        # Login and session management helper
│   │   └── storageStates/        # Session files per env (gitignored)
│   │       ├── qa/
│   │       ├── staging/
│   │       └── prod/
│   ├── core/
│   │   └── BasePage.ts           # Base class — shared helpers (click, fill, wait, assert)
│   ├── data/
│   │   └── factories/
│   │       └── leadFactory.ts    # Generates fake lead data using @faker-js/faker
│   ├── fixtures/
│   │   └── index.ts              # Playwright fixtures — adminPage, restrictedPage etc.
│   ├── modules/
│   │   ├── dashboard/
│   │   │   └── LoginPage.ts      # Login page actions and assertions
│   │   └── leads/
│   │       └── LeadsPage.ts      # Leads module — create, search, edit, assert
│   └── utils/
│       └── logger.ts             # Colour-coded console logger
├── tests/
│   ├── rbac/
│   │   └── leads.rbac.spec.ts    # RBAC tests — restricted vs admin access
│   └── ui/
│       ├── dashboard/
│       │   └── login.spec.ts     # Login tests
│       └── leads/
│           └── leads.spec.ts     # Leads CRUD tests
├── .env                          # Local secrets — NEVER commit to git
├── .gitignore
├── Jenkinsfile                   # Jenkins CI pipeline
├── package.json
├── playwright.config.ts
└── tsconfig.json
```

---

## Tech Stack

| Tool | Purpose |
|---|---|
| Playwright | Browser automation |
| TypeScript | Type safety |
| Node.js 22 | Runtime |
| @faker-js/faker | Test data generation |
| allure-playwright | Test reporting |

---

## Environment Configuration

### How it works

The active environment is controlled by a single variable:

```bash
ENV=qa        # default
ENV=staging
ENV=prod
```

`config/config.ts` reads `ENV`, uppercases it to a prefix (`QA`, `STAGING`, `PROD`),
and resolves all URLs and credentials from that prefix.
Only the active environment's variables are required at startup.

### `.env` file (local only — never push to GitHub)

```dotenv
# ENVIRONMENT SELECTOR
ENV=qa

# QA
QA_APP_URL=https://app-qa.sling-dev.com
QA_API_BASE_URL=https://api-qa.sling-dev.com/v1
QA_ADMIN_EMAIL=playwrightautomation@mailinator.com
QA_ADMIN_PASSWORD=your-password
QA_RESTRICTED_EMAIL=restricteduser@mailinator.com
QA_RESTRICTED_PASSWORD=your-password

# STAGING
STAGING_APP_URL=https://app-stage.sling-dev.com
STAGING_API_BASE_URL=https://api-stage.sling-dev.com/v1
STAGING_ADMIN_EMAIL=your-staging-admin@example.com
STAGING_ADMIN_PASSWORD=your-password
STAGING_RESTRICTED_EMAIL=your-staging-restricted@example.com
STAGING_RESTRICTED_PASSWORD=your-password

# PROD
PROD_APP_URL=https://app.kylas.io
PROD_API_BASE_URL=https://api.kylas.io/v1
PROD_ADMIN_EMAIL=your-prod-admin@example.com
PROD_ADMIN_PASSWORD=your-password
PROD_RESTRICTED_EMAIL=your-prod-restricted@example.com
PROD_RESTRICTED_PASSWORD=your-password

# TIMEOUTS (ms)
DEFAULT_TIMEOUT=30000
NAVIGATION_TIMEOUT=60000
EXPECT_TIMEOUT=10000

# BROWSER
BROWSER=chromium
HEADLESS=true

# EXECUTION
WORKERS=2
RETRY_COUNT=1
```

### GitHub Secrets required

Go to `Settings → Secrets and variables → Actions` and add:

| Secret | Description |
|---|---|
| `QA_APP_URL` | QA app base URL |
| `QA_API_BASE_URL` | QA API base URL |
| `QA_ADMIN_EMAIL` | Admin email for QA |
| `QA_ADMIN_PASSWORD` | Admin password for QA |
| `QA_RESTRICTED_EMAIL` | Restricted user email for QA |
| `QA_RESTRICTED_PASSWORD` | Restricted user password for QA |

---

## Local Setup

### Prerequisites

- Node.js 22+
- npm

### First time setup

```bash
# 1. Clone the repo
git clone https://github.com/akashrn1801/kylas-playwright-framework.git
cd kylas-playwright-framework

# 2. Install dependencies
npm install

# 3. Install Playwright browsers
npx playwright install chromium

# 4. Create your .env file
cp .env.example .env
# Fill in your credentials

# 5. Verify TypeScript compiles
npx tsc --noEmit
```

---

## Running Tests

### Run all tests locally (QA)

```bash
npx playwright test --project=chromium --workers=2
```

### Run against specific environment

```bash
ENV=qa      npx playwright test --project=chromium
ENV=staging npx playwright test --project=chromium
ENV=prod    npx playwright test --project=chromium --workers=1
```

### Run specific test file

```bash
npx playwright test tests/ui/leads/leads.spec.ts --project=chromium
npx playwright test tests/rbac/leads.rbac.spec.ts --project=chromium
npx playwright test tests/ui/dashboard/login.spec.ts --project=chromium
```

### Run specific test by name

```bash
npx playwright test --grep "admin should create a new lead" --project=chromium
```

### Run in headed mode (watch browser)

```bash
npx playwright test --project=chromium --headed
```

### Clear auth session cache (force re-login)

```bash
rm -rf src/auth/storageStates/
```

### View HTML report

```bash
npx playwright show-report reports/playwright-report
```

---

## Framework Architecture

### Authentication — globalSetup

Login runs **once** before any test starts via `src/auth/globalSetup.ts`.
Sessions are saved to `src/auth/storageStates/{env}/admin.json` and `restricted.json`.

- **Local:** sessions reused if under 8 hours old (speeds up re-runs)
- **CI:** always logs in fresh (`CI=true` bypasses cache)

### Fixtures — `src/fixtures/index.ts`

Tests receive pre-authenticated pages via fixtures:

```typescript
test('example', async ({ adminPage }) => {
  // adminPage is already logged in as admin
});

test('rbac example', async ({ restrictedPage }) => {
  // restrictedPage is already logged in as restricted user
});
```

Available fixtures: `adminPage`, `restrictedPage`, `adminContext`, `restrictedContext`

### Page Object Model

```
BasePage (src/core/BasePage.ts)
  └── LoginPage  (src/modules/dashboard/LoginPage.ts)
  └── LeadsPage  (src/modules/leads/LeadsPage.ts)
```

`BasePage` provides shared helpers: `click`, `fill`, `navigateTo`, `waitForUrl`,
`assertVisible`, `assertText`, `assertUrl`, `takeScreenshot`.

### Test Data — `src/data/factories/leadFactory.ts`

All test data is generated fresh per test using `@faker-js/faker`:

```typescript
const leadData = generateLeadData();
// with overrides:
const leadData = generateLeadData({ firstName: 'John' });
```

### Logger — `src/utils/logger.ts`

```typescript
logger.info('message')     // cyan
logger.success('message')  // green
logger.warn('message')     // yellow
logger.error('message')    // red
```

---

## Branch Strategy & CI/CD Flow

```
feature/*
    │
    └── PR to develop
              │
              ▼
          develop ── CI runs QA tests ── must pass ── 1 approval required
              │
              └── PR to main
                        │
                        ▼
                      main ── protected ── no direct pushes
```

### Daily workflow

```bash
# 1. Start from develop
git checkout develop
git pull origin develop

# 2. Create feature branch
git checkout -b feature/your-feature-name

# 3. Make changes and test locally
ENV=qa npx playwright test --project=chromium

# 4. Commit and push
git add .
git commit -m "feat: describe your change"
git push origin feature/your-feature-name

# 5. Raise PR to develop on GitHub
# 6. CI runs automatically — must pass
# 7. Get 1 approval — then merge
```

### Commit message format

```
feat: add new lead creation test
fix: resolve search flakiness in leads list
chore: update .gitignore
ci: fix GitHub Actions workflow
refactor: extract auth logic into helper
test: add RBAC negative flow tests
docs: update README
```

### Branch protection rules

| Branch | Direct push | Requires PR | Requires approval | CI required |
|---|---|---|---|---|
| `main` | ❌ | ✅ | ✅ 1 reviewer | ✅ |
| `develop` | ❌ | ✅ | ✅ 1 reviewer | ✅ |
| `feature/*` | ✅ | ❌ | ❌ | ❌ |

---

## GitHub Actions Pipeline

### `playwright.yml`

Triggers on:
- Push to `develop`
- PR targeting `develop` or `main`

What it does:
1. Checks out code
2. Installs Node.js 22
3. Runs `npm ci`
4. Installs Playwright Chromium
5. Runs all tests with `ENV=qa`
6. Uploads HTML report as artifact (retained 7 days)

View runs at: `https://github.com/akashrn1801/kylas-playwright-framework/actions`

---

## Jenkins Pipeline

The `Jenkinsfile` defines a multi-stage pipeline with separate jobs per environment.

### Pipeline flow

```
Checkout → Install → Test QA → Test Staging → Allure Report → Approval Gate → Test Prod
```

| Stage | Environment | Behaviour on failure |
|---|---|---|
| Checkout | — | Fails pipeline |
| Install | — | Fails pipeline |
| Test — QA | QA | Fails pipeline |
| Test — Staging | Staging | Marks UNSTABLE, continues |
| Allure Report | — | Always runs |
| Approval — Prod | — | Manual gate — 24hr timeout |
| Test — Prod | Prod | Runs with 1 worker |

### Approval gate

On `main` and `develop` branches, the pipeline pauses at **Approval — Prod** and
waits for a human to click **"Yes, run Prod tests"** in Jenkins before continuing.
If nobody approves within 24 hours, the pipeline aborts automatically.

### Jenkins credentials required

Add all 18 credentials as `Secret text` in:
`Jenkins → Manage Jenkins → Credentials → System → Global credentials`

```
QA_APP_URL               QA_API_BASE_URL
QA_ADMIN_EMAIL           QA_ADMIN_PASSWORD
QA_RESTRICTED_EMAIL      QA_RESTRICTED_PASSWORD

STAGING_APP_URL          STAGING_API_BASE_URL
STAGING_ADMIN_EMAIL      STAGING_ADMIN_PASSWORD
STAGING_RESTRICTED_EMAIL STAGING_RESTRICTED_PASSWORD

PROD_APP_URL             PROD_API_BASE_URL
PROD_ADMIN_EMAIL         PROD_ADMIN_PASSWORD
PROD_RESTRICTED_EMAIL    PROD_RESTRICTED_PASSWORD
```

---

## Adding New Tests

### 1. Create a new spec file

```bash
touch tests/ui/deals/deals.spec.ts
```

### 2. Create a page object

```typescript
import { Page } from '@playwright/test';
import { BasePage } from '../../core/BasePage';

export class DealsPage extends BasePage {
  private readonly addButton = () =>
    this.page.locator('button').filter({ hasText: 'Add Deal' });

  constructor(page: Page) {
    super(page);
  }

  async clickAddDeal(): Promise<void> {
    await this.click(this.addButton(), 'add deal button');
  }
}
```

### 3. Test structure

```typescript
import { test, expect } from '../../../src/fixtures/index';
import { DealsPage } from '../../../src/modules/deals/DealsPage';

test.describe('Deals module', () => {

  test('admin should create a deal', async ({ adminPage }) => {
    const dealsPage = new DealsPage(adminPage);
    // your test steps
  });

});
```

---

## Adding New Environments

### 1. Update `config/config.ts`

```typescript
type Environment = 'qa' | 'staging' | 'prod' | 'uat';

const urls: Record<Environment, { appUrl: string; apiBaseUrl: string }> = {
  ...existing,
  uat: {
    appUrl: process.env.UAT_APP_URL || '',
    apiBaseUrl: process.env.UAT_API_BASE_URL || '',
  },
};
```

### 2. Add to `.env`

```dotenv
UAT_APP_URL=https://app-uat.sling-dev.com
UAT_ADMIN_EMAIL=admin@uat.com
UAT_ADMIN_PASSWORD=password
UAT_RESTRICTED_EMAIL=restricted@uat.com
UAT_RESTRICTED_PASSWORD=password
```

### 3. Run against it

```bash
ENV=uat npx playwright test --project=chromium
```

---

## Troubleshooting

### `Missing required environment variable: X`

Your `.env` is missing a key for the active environment.
Check `ENV=` and ensure all 6 variables exist for that env.

### Tests redirected to `/signIn`

Session expired or stale. Clear and re-run:

```bash
rm -rf src/auth/storageStates/
npx playwright test --project=chromium
```

### Search returns 0 results after create/edit

Search index on QA/Staging can lag 1-3 seconds after save.
The framework retries 3 times automatically. If it persists, the QA server may be under load.

### TypeScript errors after merge

```bash
npx tsc --noEmit
```

Common causes: duplicate imports, duplicate object keys, missing methods.

### Push rejected

```bash
git pull origin <branch> --rebase
git push origin <branch>
```

If conflicts during rebase:

```bash
git add .
git rebase --continue
git push origin <branch>
```

### CI fails with `STAGING_APP_URL missing` when `ENV=qa`

Fixed — `config.ts` only validates the active environment at startup.

### Jenkins build fails immediately (2-3 seconds)

Check the `tools` block in `Jenkinsfile` — `nodejs 'Node22'` must match
exactly the name configured in `Jenkins → Manage Jenkins → Tools → NodeJS`.# test trigger
