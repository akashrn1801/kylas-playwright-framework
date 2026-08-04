# Quickstart Guide

## Project Overview

End-to-end automation framework for Kylas Sales CRM using Playwright + TypeScript. Two test suites per module: UI tests (functional) and RBAC tests (permission boundaries).

---

## Tech Stack

- Playwright ^1.60.0 + TypeScript (strict, ES2022)
- Node >=20.0.0 / npm >=10.0.0
- Faker.js for test data generation
- Allure + Playwright HTML reporters
- ErrorCollector for passive browser/network error tracking
- Playwright MCP (installed 2026-08-01 for live investigation)

---

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

---

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

`STAGING_*` and `PROD_*` follow the same pattern. **Never** hardcode values outside `requireEnv()`.
