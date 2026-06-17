# Kylas Playwright Framework

Enterprise-grade end-to-end automation for **Kylas Sales CRM** — built with Playwright + TypeScript.

## Tech Stack

| Tool              | Version | Purpose                          |
| ----------------- | ------- | -------------------------------- |
| Playwright        | ^1.60.0 | Test runner + browser automation |
| TypeScript        | ^6.0.3  | Language                         |
| Faker.js          | ^10.4.0 | Test data generation             |
| Allure Playwright | ^3.9.0  | Test reporting                   |
| ESLint + Prettier | latest  | Code quality                     |
| Jenkins           | —       | CI/CD orchestration              |
| GitHub Actions    | —       | Branch-level CI workflows        |

## Quick Start

```bash
npm ci
npx playwright install chromium
cp .env.example .env
# Edit .env with your credentials
npm test
```

## Branch Strategy

| Branch    | Tests                           | CI            |
| --------- | ------------------------------- | ------------- |
| `sandbox` | Selective (changed module only) | `sandbox.yml` |
| `dev`     | `@smoke`                        | `dev.yml`     |
| `qa`      | `@regression`                   | `qa.yml`      |
| `stage`   | Full suite                      | `stage.yml`   |
| `prod`    | `@prodSafe` ⚠️ approval         | `prod.yml`    |
| `main`    | `@regression` ⚠️ approval       | `main.yml`    |

## Daily Workflow

```bash
# 1. Reset sandbox
npm run sandbox:reset

# 2. Create feature branch
git checkout dev && git pull origin dev
git checkout -b feature/my-change-YYYYMMDD

# 3. Make changes, push to feature branch
git push origin feature/my-change-YYYYMMDD

# 4. Merge to sandbox for selective CI
git checkout sandbox
git merge feature/my-change-YYYYMMDD
git push origin sandbox

# 5. After CI passes, PR → dev
# https://github.com/akashrn1801/kylas-playwright-framework/compare/dev...feature/my-change-YYYYMMDD
```

## Test Modules

| Module     | UI Tests | RBAC Tests | Total   |
| ---------- | -------- | ---------- | ------- |
| Quotations | 15       | 13         | 28      |
| Tasks      | 11       | 10         | 21      |
| Deals      | 9        | 6          | 15      |
| Meetings   | 7        | 7          | 14      |
| Leads      | 5        | 4          | 9       |
| Contacts   | 3        | 4          | 7       |
| Companies  | 3        | 4          | 7       |
| Dashboard  | 4        | —          | 4       |
| **Total**  | **57**   | **48**     | **105** |

## Documentation

See [KYLAS_FRAMEWORK_GUIDE.md](KYLAS_FRAMEWORK_GUIDE.md) for complete developer guide.

## Setup Requirements

- Node.js `>=20.0.0`
- npm `>=10.0.0`
- Jenkins with `Node22` tool + Allure + HTML Publisher plugins
- GitHub Secrets configured for QA/STAGING/PROD environments
