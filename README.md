# Kylas Playwright Framework

> **Purpose:** Human onboarding for the Kylas Sales CRM end-to-end test framework: what it is, how to set it up, run it and where everything else is documented.
> **Read when:** You are new to the repo, setting up a machine, or looking for the right deeper document.
> **Size budget:** 40k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

End-to-end tests for **Kylas Sales CRM**, built on Playwright and TypeScript (strict). Tests are split into functional UI specs and RBAC specs (role-based access: a full-access admin user and a limited "restricted" user exercise the same feature). CI runs on GitHub Actions and Jenkins across a branch ladder, with a custom email summary and run-history ledger.

Current suite size (generated; do not edit by hand):

<!-- GEN:suite-totals:START -->
**932 tests** in **35 spec files** (UI 509 · RBAC 423)
<!-- GEN:suite-totals:END -->

<!-- GEN:module-table:START -->
| Module | UI tests | RBAC tests | Total |
|---|---:|---:|---:|
| Call-logs | 30 | 28 | 58 |
| Companies | 23 | 26 | 49 |
| Companies — Field Limits | 39 | 31 | 70 |
| Contacts | 23 | 23 | 46 |
| Contacts — Field Limits | 42 | 28 | 70 |
| Dashboard | 34 | 29 | 63 |
| Deals | 26 | 30 | 56 |
| Deals — Field Limits | 39 | 31 | 70 |
| Leads | 25 | 31 | 56 |
| Leads — Field Limits | 42 | 25 | 67 |
| Meetings | 19 | 12 | 31 |
| ProductsAndServices | 9 | 7 | 16 |
| ProductsAndServices — Field Limits | 39 | 31 | 70 |
| Quotations | 24 | 17 | 41 |
| Reports | 38 | 27 | 65 |
| Tasks | 18 | 16 | 34 |
| Tasks — Field Limits | 39 | 31 | 70 |
| **Total** | **509** | **423** | **932** |
<!-- GEN:module-table:END -->

Tag counts:

<!-- GEN:tag-counts:START -->
`@smoke` 51 · `@regression` 898 · `@prodSafe` 55
<!-- GEN:tag-counts:END -->

Module names in the table come from `deriveModuleFromFile()` (the same labels the notification email uses). Login's spec lives in `tests/ui/dashboard/` and is counted under Dashboard.

## Quick start

Prerequisites: Node `>=20`, npm `>=10`.

```bash
git clone <this-repo-url> && cd kylas-playwright-framework
npm install
npx playwright install chromium
npx tsc --noEmit            # sanity check, should print nothing
```

Create `.env` in the repo root. `.env.example` exists locally but is **gitignored and untracked**, and it only contains obsolete `*_DEAL_NAME` variables, so do not rely on it. `config/config.ts` reads `ENV` (`qa` | `staging` | `prod`, default `qa`) and requires, for the active environment's prefix only (`QA_`, `STAGING_` or `PROD_`):

| Variable | Required | Notes |
|---|---|---|
| `<PREFIX>_APP_URL` | yes | startup throws if missing |
| `<PREFIX>_ADMIN_EMAIL`, `<PREFIX>_ADMIN_PASSWORD` | yes | full-access "Playwright Automation" user |
| `<PREFIX>_RESTRICTED_EMAIL`, `<PREFIX>_RESTRICTED_PASSWORD` | yes | limited-access "User 1", used by every RBAC test |
| `<PREFIX>_API_BASE_URL` | effectively yes | not enforced at startup, but login and API calls need it |

Optional: `WORKERS`, `RETRY_COUNT`, `HEADLESS`, `NAVIGATION_TIMEOUT`, `EXPECT_TIMEOUT`, `DEFAULT_TIMEOUT`, SMTP settings for `notify`. Never commit `.env`; never paste credentials into logs or docs.

First run to confirm setup: `ENV=qa npm run test:meetings` (writes `src/auth/storageStates/<env>/`, gitignored). Sessions expire; if auth looks stale, `rm -rf src/auth/storageStates/qa/`.

## Running tests

Everything here is a real `package.json` script or a direct Playwright call. Scripts that end in `&& npm run notify` send the summary email afterwards (needs SMTP config).

| Command | What it actually runs |
|---|---|
| `npm run test:contacts` · `test:companies` · `test:deals` · `test:tasks` · `test:meetings` · `test:call-logs` · `test:productsAndServices` · `test:reports` | that module's UI folder **and** its RBAC spec |
| `npm run test:leads` | `tests/ui/leads/` **only** (no RBAC) |
| `npm run test:quotations` / `test:quotations:rbac` | UI folder only / RBAC spec only |
| `npm run test:formFields` | `tests/ui/formFields/` and `tests/rbac/formFields/` |
| `npm run test:login` | all of `tests/ui/dashboard/` (Dashboard UI plus Login) |
| `npm run test:rbac` | everything under `tests/rbac/` |
| `npm run test:ui` | the **whole** suite on chromium (the name is misleading) |
| `npm run test` | plain `playwright test`; locally `pretest` rotates reports and `posttest` notifies |
| `npm run test:headed`, `test:debug` | headed run with notify; Playwright inspector |

Direct calls (preferred when you need extra flags, because `npm run test:<m> -- <args>` appends args to the last `&&` command, not Playwright):

```bash
ENV=qa npx playwright test tests/ui/leads/leads.spec.ts --project=chromium --workers=1
ENV=qa npx playwright test tests/rbac/leads.rbac.spec.ts --project=chromium --workers=1
ENV=qa npx playwright test --grep "admin should create a new lead" --project=chromium
ENV=staging npx playwright test --grep "@smoke" --project=chromium --workers=2
npx playwright test --project=chromium --list           # discovery only, no app access
```

Locally four browser projects are configured; pass `--project=chromium` to pick one. CI uses chromium only. Reports: `npm run report:playwright`, `npm run report:allure`; `npm run clean` removes outputs.

Code quality: `npx tsc --noEmit`, `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run check:conventions`, `npm run check:test-counts`, `npm run docs:refresh`, `npm run check:docs`.

## Tags

Every test carries at least one tag in its title.

| Tag | Meaning | Runs on |
|---|---|---|
| `@smoke` | navigation / happy path | `dev` |
| `@regression` | full functional + RBAC | `qa` (and escalated sandbox) |
| `@prodSafe` | read-only, safe against real production data | `prod` |

A test that creates, edits or deletes data is never `@prodSafe`. `stage` and `main` run with no tag filter. Per-pipeline detail: [docs/CI_PIPELINES.md](./docs/CI_PIPELINES.md).

## Repo map

```
config/            env, timeouts, retry config; expected-test-counts.json; sharedConfigSuites.json
src/auth/          globalSetup, AuthManager (session cache, locked re-login), storage states
src/core/          BasePage: shared interaction/assertion/recovery helpers
src/fixtures/      adminPage / restrictedPage fixtures (always import test/expect from here)
src/modules/       one page object per module
src/data/          factories (generateXxxData) and product fixtures
src/error-collector/, src/reporters/, src/notifications/   error capture and email/history
tests/ui/<module>/ functional specs        tests/rbac/   permission specs
scripts/           planner, doc and convention checks, hooks, sandbox helpers
docs/              all engineering documentation (index below)
.github/           workflows, detect-tests.sh, PR template      Jenkinsfile*  Jenkins pipelines
```

## Git workflow

```
feature/* → dev → qa → stage → prod → main        sandbox: pre-PR check, reset to dev
```

Rules: cut feature branches from `dev`; each promote branch is cut from the previous promote branch; never push straight to `dev`/`qa`/`stage`/`prod`/`main`; never skip an environment; wait for CI before merging each PR. Commit format: `feat:` / `fix:` / `chore:` / `ci:` / `refactor:`.

```bash
npm run sandbox:reset                              # before every new task
git checkout dev && git pull origin dev
git checkout -b feature/<description>-YYYYMMDD
npx tsc --noEmit && npx playwright test tests/ui/<module>/ --project=chromium --headed --workers=1
git add . && git commit -m "feat: ..." && git push origin feature/<description>-YYYYMMDD
```

Then merge your feature branch into `sandbox` and push once (`bash scripts/sandbox-deploy.sh <feature-branch>` does the reset, merge and push); wait for `sandbox.yml`; open a PR into `dev`. Promote one hop at a time with new `feature/promote-<feature>-to-<env>-YYYYMMDD` branches, each cut from the previous one, each PR into the next environment branch (`https://github.com/akashrn1801/kylas-playwright-framework/compare/<target>...<promote-branch>`). Push rejected with non-fast-forward: `git pull origin <branch> --rebase`, then push. AI agents never run git write operations here; the human operator commits and pushes.

## Documentation index

| Doc | What it is |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Router and standing rules for Claude Code sessions, plus the Definition of Done |
| [docs/README.md](./docs/README.md) | Index of the docs folder |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Page objects, fixtures, auth, locks, sharding, CI flow |
| [docs/CONTRIBUTING_TESTS.md](./docs/CONTRIBUTING_TESTS.md) | How to add tests or a module; what to touch and not touch; size policy |
| [docs/PATTERNS.md](./docs/PATTERNS.md) | Short do/don't rules |
| [docs/RUNBOOK.md](./docs/RUNBOOK.md) | CI failure triage |
| [docs/CI_PIPELINES.md](./docs/CI_PIPELINES.md) | Workflows, shard planner, secrets, timeouts |
| [docs/REPORTING.md](./docs/REPORTING.md) | Email, history ledger, error reports |
| [docs/KNOWN_ISSUES_ACTIVE.md](./docs/KNOWN_ISSUES_ACTIVE.md) | Open issues only |
| [docs/known-issues/README.md](./docs/known-issues/README.md) | Resolved history by topic |
| [docs/adr/](./docs/adr/) | Architecture decision records |
| [docs/GLOSSARY.md](./docs/GLOSSARY.md) | Terms used across the docs |
| [APPLICATION_BUGS.md](./APPLICATION_BUGS.md) | Confirmed Kylas product bugs (for the product team) |
| [CHANGELOG.md](./CHANGELOG.md) | One line per significant change |
| [.claude/AGENT_DELEGATION_GUIDE.md](./.claude/AGENT_DELEGATION_GUIDE.md) | Subagent routing and hooks |

## Open items

No cross-browser coverage in CI, no scheduled or nightly runs, and QA/staging data is never cleaned up (so list and search operations slow down over time). Everything else open is tracked in [docs/KNOWN_ISSUES_ACTIVE.md](./docs/KNOWN_ISSUES_ACTIVE.md).

## Troubleshooting

- **`Missing required environment variable: X`**: the active `ENV`'s variables are incomplete in `.env`; see Quick start.
- **Redirected to sign-in mid-run**: clear the cached session (`rm -rf src/auth/storageStates/<env>/`); fixtures already retry one automatic re-login.
- **`ts-node` script fails with `TS2591` but `tsc --noEmit` passes**: check `tsconfig.json` still has `"types": ["node"]`; `--transpile-only` hides this.
- **`git clone <remote-name> .` fails**: clone needs a URL; use `git remote get-url origin`.
- **Clone lead/contact form rejects save**: change the pre-filled email or phone.
- **`saveQuickTask()` hangs from an entity detail panel**: use `saveQuickTaskFromEntityDetail()`.
- Anything CI-related: [docs/RUNBOOK.md](./docs/RUNBOOK.md).
