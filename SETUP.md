# Kylas Playwright Framework — Complete Setup & Workflow Guide

---

## Table of Contents

1. [Project Structure](#project-structure)
2. [Environment Configuration](#environment-configuration)
3. [Local Setup](#local-setup)
4. [Running Tests](#running-tests)
5. [GitHub Branch Strategy](#github-branch-strategy)
6. [Daily Workflow](#daily-workflow)
7. [CI/CD — GitHub Actions](#cicd--github-actions)
8. [Branch Protection Rules](#branch-protection-rules)
9. [Adding New Environments](#adding-new-environments)
10. [Troubleshooting](#troubleshooting)

---

## Project Structure

```
kylas-playwright-framework/
├── .github/
│   └── workflows/
│       └── playwright.yml        # CI pipeline — runs on every PR
├── config/
│   └── config.ts                 # Central config — reads ENV and resolves all values
├── src/
│   ├── auth/
│   │   ├── globalSetup.ts        # Runs once before all tests — creates auth sessions
│   │   ├── authManager.ts        # Handles login and session management
│   │   └── storageStates/        # Session files per env (gitignored)
│   │       ├── qa/
│   │       ├── staging/
│   │       └── prod/
│   ├── core/
│   │   └── BasePage.ts           # Base class with shared helpers (click, fill, wait)
│   ├── data/
│   │   └── factories/
│   │       └── leadFactory.ts    # Generates fake lead data for tests
│   ├── fixtures/
│   │   └── index.ts              # Playwright fixtures — adminPage, restrictedPage etc.
│   ├── modules/
│   │   ├── dashboard/
│   │   │   └── LoginPage.ts
│   │   └── leads/
│   │       └── LeadsPage.ts
│   └── utils/
│       └── logger.ts             # Colour-coded logger (INFO / SUCCESS / WARN)
├── tests/
│   ├── rbac/
│   │   └── leads.rbac.spec.ts    # Role-based access control tests
│   └── ui/
│       ├── dashboard/
│       │   └── login.spec.ts
│       └── leads/
│           └── leads.spec.ts
├── .env                          # Local secrets — NEVER committed to git
├── .gitignore
├── package.json
├── playwright.config.ts
└── tsconfig.json
```

---

## Environment Configuration

### How it works

The active environment is controlled by a single variable:

```bash
ENV=qa       # default
ENV=staging
ENV=prod
```

`config/config.ts` reads `ENV`, uppercases it to a prefix (`QA`, `STAGING`, `PROD`), and resolves all URLs and credentials from that prefix. Only the active environment's variables are required at startup.

### `.env` file (local only — never push to GitHub)

```dotenv
# ENVIRONMENT SELECTOR
ENV=qa

# QA
QA_APP_URL=https://app-qa.sling-dev.com
QA_API_BASE_URL=https://api-qa.sling-dev.com/v1
QA_ADMIN_EMAIL=playwrightautomation@mailinator.com
QA_ADMIN_PASSWORD=Password@007
QA_RESTRICTED_EMAIL=restricteduser@mailinator.com
QA_RESTRICTED_PASSWORD=Password@007

# STAGING
STAGING_APP_URL=https://app-stage.sling-dev.com
STAGING_API_BASE_URL=https://api-stage.sling-dev.com/v1
STAGING_ADMIN_EMAIL=your-staging-admin@example.com
STAGING_ADMIN_PASSWORD=StagingPassword
STAGING_RESTRICTED_EMAIL=your-staging-restricted@example.com
STAGING_RESTRICTED_PASSWORD=StagingPassword

# PROD
PROD_APP_URL=https://app.kylas.io
PROD_API_BASE_URL=https://api.kylas.io/v1
PROD_ADMIN_EMAIL=your-prod-admin@example.com
PROD_ADMIN_PASSWORD=ProdPassword
PROD_RESTRICTED_EMAIL=your-prod-restricted@example.com
PROD_RESTRICTED_PASSWORD=ProdPassword

# TIMEOUTS (ms)
DEFAULT_TIMEOUT=30000
NAVIGATION_TIMEOUT=60000
EXPECT_TIMEOUT=10000

# BROWSER
BROWSER=chromium
HEADLESS=true

# EXECUTION
WORKERS=4
RETRY_COUNT=1
```

### GitHub Secrets (used by CI — replaces .env in pipeline)

Go to `Settings → Secrets and variables → Actions` and add:

| Secret Name              | Value                                 |
| ------------------------ | ------------------------------------- |
| `QA_APP_URL`             | `https://app-qa.sling-dev.com`        |
| `QA_API_BASE_URL`        | `https://api-qa.sling-dev.com/v1`     |
| `QA_ADMIN_EMAIL`         | `playwrightautomation@mailinator.com` |
| `QA_ADMIN_PASSWORD`      | `Password@007`                        |
| `QA_RESTRICTED_EMAIL`    | `restricteduser@mailinator.com`       |
| `QA_RESTRICTED_PASSWORD` | `Password@007`                        |

---

## Local Setup

### Prerequisites

- Node.js 18+
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
# Fill in your credentials in .env

# 5. Verify TypeScript compiles
npx tsc --noEmit
```

---

## Running Tests

### Run all tests (QA — default)

```bash
npx playwright test --project=chromium --workers=2 --reporter=line
```

### Run against a specific environment

```bash
# QA
ENV=qa npx playwright test --project=chromium --workers=2 --reporter=line

# Staging
ENV=staging npx playwright test --project=chromium --workers=2 --reporter=line

# Production
ENV=prod npx playwright test --project=chromium --workers=2 --reporter=line
```

### Run a specific test file

```bash
npx playwright test tests/ui/leads/leads.spec.ts --project=chromium
```

### Run a specific test by name

```bash
npx playwright test --grep "admin should create a new lead" --project=chromium
```

### View HTML report after run

```bash
npx playwright show-report reports/playwright-report
```

### Clear auth session cache (force re-login)

```bash
rm -rf src/auth/storageStates/
```

---

## GitHub Branch Strategy

```
main          ← production-ready code only. Protected. No direct pushes.
develop       ← integration branch. All feature PRs merge here first.
feature/*     ← your daily work branches. One per feature or fix.
```

### Rules

| Branch      | Who can push directly | Requires PR | Requires approval |
| ----------- | --------------------- | ----------- | ----------------- |
| `main`      | Nobody                | Yes         | Yes (1)           |
| `develop`   | Nobody                | Yes         | Yes (1)           |
| `feature/*` | Anyone                | No          | No                |

---

## Daily Workflow

### Starting a new feature or fix

```bash
# 1. Always start from develop (get latest)
git checkout develop
git pull origin develop

# 2. Create your feature branch
git checkout -b feature/your-feature-name

# 3. Make your changes and run tests locally
ENV=qa npx playwright test --project=chromium --workers=2

# 4. Commit your changes
git add .
git commit -m "feat: describe what you did"

# 5. Push your branch
git push origin feature/your-feature-name
```

### Raising a Pull Request

1. Go to `https://github.com/akashrn1801/kylas-playwright-framework/pulls`
2. Click `New pull request`
3. Set **base** to `develop`, **compare** to your `feature/` branch
4. Add a clear title and description
5. Click `Create pull request`
6. CI will run automatically — wait for it to pass ✅
7. Request a review from a teammate
8. Once approved and CI passes → `Merge pull request`

### Merging develop into main (release)

```bash
# On GitHub: raise a PR from develop → main
# Title: "release: YYYY-MM-DD"
# Same process — CI runs, needs approval, then merge
```

### Commit message format

```
feat: add new lead creation test
fix: resolve search flakiness in leads list
chore: update .gitignore
ci: fix GitHub Actions workflow
refactor: extract auth logic into helper
```

---

## CI/CD — GitHub Actions

### What triggers CI

| Event                  | What runs                   |
| ---------------------- | --------------------------- |
| Push to `develop`      | Full test suite on chromium |
| PR targeting `develop` | Full test suite on chromium |
| PR targeting `main`    | Full test suite on chromium |

### What CI does (in order)

1. Checks out the code
2. Installs Node.js 20
3. Runs `npm ci` (clean install)
4. Installs Playwright Chromium browser
5. Runs all tests with `ENV=qa`
6. Uploads HTML report as an artifact (kept 7 days)

### Viewing CI results

- Go to: `https://github.com/akashrn1801/kylas-playwright-framework/actions`
- Click any run to see logs
- Download the `playwright-report` artifact for the full HTML report

### CI workflow file location

```
.github/workflows/playwright.yml
```

---

## Branch Protection Rules

### main branch

- No direct pushes allowed (including repo owner)
- Requires PR with 1 approval before merge
- Requires CI (`playwright-tests`) to pass
- Force pushes blocked

### develop branch

- No direct pushes allowed
- Requires PR with 1 approval before merge
- Force pushes blocked

---

## Adding New Environments

To add a new environment (e.g. `uat`):

### 1. Update `config/config.ts`

```typescript
type Environment = 'qa' | 'staging' | 'prod' | 'uat';  // add here

const urls: Record<Environment, ...> = {
  ...
  uat: { appUrl: process.env.UAT_APP_URL || '', apiBaseUrl: process.env.UAT_API_BASE_URL || '' },
};
```

### 2. Add to `.env`

```dotenv
UAT_APP_URL=https://app-uat.sling-dev.com
UAT_API_BASE_URL=https://api-uat.sling-dev.com/v1
UAT_ADMIN_EMAIL=admin@uat.com
UAT_ADMIN_PASSWORD=password
UAT_RESTRICTED_EMAIL=restricted@uat.com
UAT_RESTRICTED_PASSWORD=password
```

### 3. Add GitHub Secrets (for CI)

Add `UAT_APP_URL`, `UAT_ADMIN_EMAIL` etc. in GitHub → Settings → Secrets.

### 4. Run against it

```bash
ENV=uat npx playwright test --project=chromium --workers=2
```

---

## Troubleshooting

### `Missing required environment variable: X`

Your `.env` file is missing a key for the active environment. Check which `ENV=` is set and ensure all 6 variables for that environment exist in `.env`.

### Tests fail with auth errors / redirected to login

The cached session has expired. Clear it and re-run:

```bash
rm -rf src/auth/storageStates/
npx playwright test --project=chromium
```

### Switched ENV but getting wrong app URL

Old session files from a different environment are being reused. Clear them:

```bash
rm -rf src/auth/storageStates/
```

Session files are now stored per-env under `storageStates/qa/`, `storageStates/staging/` etc. so this should not happen anymore.

### CI fails with `STAGING_APP_URL` missing even when `ENV=qa`

This was a bug that has been fixed. `config.ts` now only validates the active environment's URL at startup — other environments' variables are not required.

### TypeScript errors after a merge

Run `npx tsc --noEmit` to see all errors. Common causes after merges:

- Duplicate imports in a file
- Duplicate object keys
- Missing methods called but not defined

### Push rejected (`fetch first` or `non-fast-forward`)

```bash
git pull origin <branch-name> --rebase
git push origin <branch-name>
```

If there are conflicts during rebase, resolve them, then:

```bash
git add .
git rebase --continue
git push origin <branch-name>
```
