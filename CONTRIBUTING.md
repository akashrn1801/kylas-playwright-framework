# Contributing to Kylas Playwright Framework

## Daily Workflow

### 1. Reset sandbox before every new task

```bash
npm run sandbox:reset
```

### 2. Create a feature branch from dev

```bash
git checkout dev && git pull origin dev
git checkout -b feature/description-YYYYMMDD
```

### 3. Make your changes and push

```bash
git add .
git commit -m "feat: description of change"
git push origin feature/description-YYYYMMDD
```

### 4. Test on sandbox

```bash
git checkout sandbox
git merge feature/description-YYYYMMDD
git push origin sandbox
# Wait for sandbox CI — only changed module tests run
```

### 5. PR to dev after CI passes

### 6. Promote through the chain

dev → qa → stage → prod → main (each via feature branch + PR)

---

## Adding a New Module

1. `src/data/factories/<module>Factory.ts` — data factory with `generate*Data()` and `generateAdmin*Data()`
2. `src/modules/<module>/<Module>Page.ts` — page object extending `BasePage` (10-section pattern)
3. `tests/ui/<module>/<module>.spec.ts` — UI tests
4. `tests/rbac/<module>.rbac.spec.ts` — RBAC tests
5. `package.json` — add `test:<module>` npm script

The selective test runner auto-detects new modules — no script updates needed.

---

## Test Conventions

- Always import from `src/fixtures/index.ts` not `@playwright/test`
- Always use `generateAdmin*Data()` for RBAC cross-role tests
- Every test must have at least one tag (`@smoke`, `@regression`, `@prodSafe`)
- Every test must end with `logger.success('TX passed')`
- Set `test.setTimeout(480000)` for create/update tests
- Never put locators or page actions in test files

---

## Commit Message Format

---

## Code Quality

```bash
npm run lint        # ESLint check
npm run lint:fix    # Auto-fix
npm run format      # Prettier
npm run clean       # Remove test-results + reports
```
