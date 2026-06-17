# Changelog

All notable changes to the Kylas Playwright Framework are documented here.

---

## [2.0.0] — June 2026

### Added

- **Quotations module** — 28 tests (15 UI + 13 RBAC) covering full CRUD, download, grand total math, RBAC isolation
- **Sandbox branch** — permanent selective test runner branch with `npm run sandbox:reset`
- **Selective test detection** — `.github/scripts/detect-tests.sh` auto-detects changed modules and runs only affected tests
- `sandbox.yml` GitHub Actions workflow for selective CI on sandbox branch
- `Jenkinsfile.sandbox` for Jenkins sandbox pipeline
- `logger.success('TX passed')` pattern standardised across all 105 tests
- `DealData.skipAssociatedEntities` flag for RBAC test isolation
- `config.searchRetry` and `config.meetingRetry` — centralised retry configuration
- `ReportParser.mapStatus` fix — correctly distinguishes flaky from failed tests

### Fixed

- CI login test failures — removed `viewport: null` from CI project config
- `actions/upload-artifact` upgraded to v6 for Node.js 24 compatibility
- Artifact upload path corrected to `reports/playwright-report/`
- `assertQuotationNotInList` rewritten to check specific summary instead of row count
- `searchTaskById` flakiness — try/catch fallback to name search
- `storageStates` path inconsistency between `globalSetup.ts` and `authManager.ts`
- Duplicate patterns removed from `errorFilters.ts`
- `Jenkinsfile.qa` updated to use `--grep @regression`
- `QA_ADMIN_DEAL_NAME` missing secret removed from all workflows

### Removed

- `Jenkinsfile.qa.bak` leftover backup file
- `feature.yml` GitHub Actions workflow (replaced by `sandbox.yml`)
- Hardcoded `retryConfig` from all 7 page objects (centralised in `config.ts`)

---

## [1.0.0] — May 2026

### Added

- Initial framework — Leads, Contacts, Companies, Deals, Meetings, Tasks modules
- 77 tests (UI + RBAC) across 6 modules
- GitHub Actions CI/CD pipeline — dev, qa, stage, prod, main workflows
- Jenkins pipelines — Jenkinsfile, Jenkinsfile.qa, Jenkinsfile.staging, Jenkinsfile.prod
- Global setup with session caching
- Custom Playwright fixtures — adminPage, restrictedPage
- Faker.js data factories with ADM/RES prefixes for RBAC isolation
- Email notification system with HTML report
- MiscErrorReporter for background error capture
- Allure + Playwright HTML reporting
