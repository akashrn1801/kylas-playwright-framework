# Kylas Playwright Framework

End-to-end test automation for **Kylas Sales CRM**, built on Playwright + TypeScript. 393 tests across 11 modules (21 spec files), split between functional UI coverage and RBAC (role-based access control) permission testing, running across a 6-branch CI/CD pipeline with its own reporting and email-notification system.

This document is written so a new engineer — or any of us in six months — can get productive in a day without digging through source or chat history. Where something is genuinely unresolved or fragile, it's called out explicitly in [Known Limitations](#known-limitations--open-items) rather than glossed over.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture — How It's Built](#architecture--how-its-built)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Running Tests](#running-tests)
6. [Test Tags](#test-tags)
7. [CI/CD Pipeline](#cicd-pipeline)
8. [Reporting and Notifications](#reporting-and-notifications)
9. [RBAC Testing Philosophy](#rbac-testing-philosophy)
10. [Git Workflow & Branch Promotion](#git-workflow--branch-promotion)
11. [Known Limitations / Open Items](#known-limitations--open-items)
12. [Contributing / Adding a New Module](#contributing--adding-a-new-module)
13. [Troubleshooting](#troubleshooting)

---

## Project Overview

| | |
|---|---|
| **Runner** | Playwright `^1.60.0` |
| **Language** | TypeScript `^6.0.3`, strict mode, ES2022 |
| **Test data** | `@faker-js/faker` `^10.4.0` |
| **Reporting** | Playwright HTML/JSON + `allure-playwright` `^3.9.0` + a custom email/history system (see [§8](#reporting-and-notifications)) |
| **CI** | GitHub Actions (primary for most branches) + Jenkins (primary for `prod`/`main`, manual fallback elsewhere) |
| **Runtime** | Node `>=20.0.0`, npm `>=10.0.0` |

**Modules covered** (11): Leads, Contacts, Companies, Deals, Meetings, Tasks, Quotations, Call Logs, Products & Services, Reports, and Dashboard/Login. Every module except Dashboard has both a UI spec and an RBAC spec.

**Current suite size** (verified fresh via `npx playwright test --project=chromium --list` on 2026-08-22, do not trust any older number without re-running this):

| Module | UI tests | RBAC tests | Total |
|---|---:|---:|---:|
| Call Logs | 26 | 24 | 50 |
| Companies | 19 | 22 | 41 |
| Contacts | 19 | 19 | 38 |
| Dashboard/Login | 4 | — | 4 |
| Deals | 21 | 25 | 46 |
| Leads | 21 | 27 | 48 |
| Meetings | 15 | 8 | 23 |
| Products & Services | 9 | 7 | 16 |
| Quotations | 21 | 14 | 35 |
| Reports | 37 | 27 | 64 |
| Tasks | 15 | 13 | 28 |
| **Total** | **207** | **186** | **393** |

Leads gained 4 tests on 2026-07-21/22: L46/L47 (UI, renumbered from L20/L21 on 2026-08-11) and L30/L31 (RBAC) cover the new Company Lookup/Contact Lookup custom fields — see `CLAUDE.md`'s Known Issues for the full story, including 9 real bugs found and fixed while building and verifying them.

---

## Architecture — How It's Built

Every page object (`src/modules/<module>/<Module>Page.ts`) extends `src/core/BasePage.ts` and follows a fixed 10-section structure (retry config → locators → constructor → private helpers → navigation → form actions → search & open → edit actions → assertions → workflow wrappers); locators are always lazily-evaluated arrow functions, never captured eagerly. Tests import `test`/`expect` from the custom fixture system (`src/fixtures/index.ts`) — never from `@playwright/test` directly — which wraps every test in session-expiry protection, error collection, and automatic re-login before the first navigation. Authentication runs once per suite via `src/auth/globalSetup.ts`, with `AuthManager` caching session validity in-memory and locking concurrent storage-state writes so parallel CI workers can't corrupt each other's re-login. Each module owns a data factory (`src/data/factories/<module>Factory.ts`) exporting `generateXxxData()` / `generateAdminXxxData()` (`ADM<timestamp>` prefix) / `generateSharedXxxData()` (`SHR<timestamp>` prefix) — the prefix convention exists because QA/staging data is never cleaned up, so a distinguishing prefix is the only reliable way to make an RBAC negative assertion ("restricted user provably cannot see this record") trustworthy. Lead, Contact, Deal, and Company each carry 9 environment-conditional custom fields, handled by generic, presence-checked `BasePage` helpers so a module only needs a thin per-entity wrapper. `ErrorCollector` passively captures `pageerror`/`console-error`/`requestfailed`/HTTP `>=400` on every test, classified into Noise / Expected-RBAC / Known-background-noise before anything is reported as unexpected.

**Full architecture detail** (complete fixture/auth-flow mechanics, the page object's exact 10-section contract, custom-fields/GPS-lookup mechanism, retry tuning, error-collection classification rules, and Products & Services' deliberate deviations from this whole pattern): see `.claude/architecture.md`.

**Full fix-by-fix investigation history behind this architecture** (every bug found and fixed while building it — locator collisions, ID-capture false positives, race conditions, session-expiry recovery's 5-phase history, and more, each with real evidence): see `.claude/known-issues.md`.

---

## Project Structure

```
kylas-playwright-framework/
├── .claude/                              # Reference docs imported by CLAUDE.md + subagent definitions
│   ├── agents/                           # 13 specialized subagent definitions (.md) — named individually in CLAUDE.md
│   ├── AGENT_DELEGATION_GUIDE.md
│   ├── architecture.md
│   ├── known-issues.md
│   ├── reference-patterns.md
│   └── settings.json                     # PostToolUse hook config (locator-reviewer reminder on Page Object/spec edits)
├── config/
│   └── config.ts                         # Single source of truth: env URLs/creds, timeouts, retry config
├── .github/
│   ├── scripts/
│   │   └── detect-tests.sh               # Selective test detection for sandbox CI
│   └── workflows/
│       ├── dev.yml                       # push→dev — @smoke, primary for dev
│       ├── main.yml                      # workflow_dispatch only — full suite, manual/emergency (base Jenkinsfile is primary)
│       ├── prod.yml                      # workflow_dispatch only — @prodSafe, manual/emergency (base Jenkinsfile is primary)
│       ├── qa.yml                        # push→qa — @regression, primary for qa
│       ├── sandbox.yml                   # push→sandbox — selective, via detect-tests.sh
│       ├── stage.yml                     # push→stage — full suite, primary for stage
│       └── staging-promotion-gate.yml    # workflow_dispatch only — gates staging→prod auto-merge
├── scripts/
│   ├── hooks/
│   │   ├── post-file-edit-locator-reminder.sh   # PostToolUse hook body — reminds to invoke locator-reviewer
│   │   ├── pre-commit                    # Blocks commits containing waitForTimeout()
│   │   └── pre-push                      # Blocks pushes with waitForTimeout()/hardcoded URLs
│   ├── reset-sandbox.sh
│   ├── rotate-reports.sh                 # Rotates reports/<env>/latest → previous before a local run
│   └── sandbox-deploy.sh                 # Resets sandbox branch to dev, merges feature branch, pushes once
├── src/
│   ├── auth/
│   │   ├── authManager.ts                # Session cache, cross-process file lock, re-login
│   │   └── globalSetup.ts                # Logs in both roles once before the suite
│   ├── core/
│   │   └── BasePage.ts                   # Base class every page object extends
│   ├── data/
│   │   ├── factories/                    # generateXxxData() per module (9 factories)
│   │   ├── files/
│   │   │   └── test-recording.mp3        # Real, non-empty audio fixture for Call Log recording upload
│   │   └── productFixtureAccessor.ts     # Reads src/data/productFixtures/<env>.json (gitignored, generated per run)
│   ├── error-collector/
│   │   ├── ErrorCollector.ts             # Per-worker singleton — captures + classifies runtime errors
│   │   └── errorFilters.ts               # Noise / RBAC-expected / background-noise pattern lists
│   ├── fixtures/
│   │   └── index.ts                      # adminPage, restrictedPage, adminContext, restrictedContext
│   ├── modules/
│   │   ├── call-logs/CallLogsPage.ts
│   │   ├── companies/CompaniesPage.ts
│   │   ├── contacts/ContactsPage.ts
│   │   ├── dashboard/LoginPage.ts
│   │   ├── deals/DealsPage.ts
│   │   ├── leads/LeadsPage.ts
│   │   ├── meetings/MeetingsPage.ts
│   │   ├── productsAndServices/ProductsAndServicesPage.ts   # Lives under /setup/, not /sales/ — see .claude/architecture.md
│   │   ├── quotations/QuotationsPage.ts
│   │   └── tasks/TasksPage.ts
│   ├── notifications/
│   │   ├── adapters/EmailAdapter.ts
│   │   ├── config/notificationConfig.ts  # SMTP settings + per-env/per-branch recipient lists
│   │   ├── scripts/
│   │   │   ├── loadDotEnv.ts
│   │   │   ├── notify.ts                 # `npm run notify` — sends the run-summary email
│   │   │   └── syncHistory.ts            # `npm run history:sync` — appends to ci/reporting-history
│   │   ├── AutomationHealth.ts           # Pure logic: weighted 0-100 health score + label + factors
│   │   ├── EmailTemplate.ts              # HTML email renderer — orchestrator + one buildXxx() per section
│   │   ├── FailureAnalyzer.ts            # Pure logic: classifies + clusters failures on real matching signal only
│   │   ├── NotificationService.ts        # Orchestrates parse → history → analysis → email
│   │   ├── ReportParser.ts               # Parses the Playwright JSON report into the shapes the email/history need
│   │   └── RunHistory.ts                 # Pure logic: append/prune, delta, recurring-flaky/-failing, module trend, slow-test trend, suite drift, pass-rate series
│   ├── reporters/
│   │   └── MiscErrorReporter.ts          # Merges per-worker error files → reports/<env>/misc-errors.json
│   └── utils/
│       ├── dateHelpers.ts
│       ├── logger.ts                     # logger.info/warn/error/success — never console.log
│       └── navigation.ts                 # safeWaitForURL() — shared bare-waitForURL() consolidation
├── tests/
│   ├── rbac/<module>.rbac.spec.ts        # Permission tests (adminPage + restrictedPage)
│   └── ui/<module>/<module>.spec.ts      # Functional UI tests (adminPage)
├── APPLICATION_BUGS.md                   # Confirmed, real Kylas application bugs (not test/framework bugs)
├── CLAUDE.md                             # Standing engineering rules, architecture/patterns/known-issues (imports .claude/*.md)
├── eslint.config.js                      # Active flat config (ESLint ^10.4.0 reads this exclusively)
├── .eslintrc.json                        # Legacy config — never read by `npm run lint` today; possible cleanup candidate, not removed here
├── .gitignore
├── Jenkinsfile
├── Jenkinsfile.prod
├── Jenkinsfile.qa
├── Jenkinsfile.sandbox
├── Jenkinsfile.staging
├── package.json
├── playwright.config.ts
├── .prettierignore
├── .prettierrc.json
├── PRODUCTS_AND_SERVICES_PROGRESS.md     # Full build/investigation history for the Products & Services module
├── README.md
└── tsconfig.json
```

---

## Getting Started

**Prerequisites:** Node.js `>=20.0.0`, npm `>=10.0.0`.

```bash
git clone <this-repo-url>
cd kylas-playwright-framework

npm install
npx playwright install chromium

cp .env.example .env
# Fill in credentials — see the table below for what's actually required

npx tsc --noEmit               # sanity check — should report no errors

ENV=qa npm run test:leads      # run one module end-to-end to confirm the setup works
```

### Environment variables

`config/config.ts` reads `ENV` (`qa` | `staging` | `prod`, default `qa`), uppercases it to a prefix, and resolves every value below from `<PREFIX>_*`. **Only the active environment's variables are required** — `config.ts` throws at startup only for the active `ENV`'s missing values, so you don't need staging/prod credentials to run against QA.

| Variable | Required? | Notes |
|---|---|---|
| `<PREFIX>_APP_URL` | Yes | Throws at startup if missing |
| `<PREFIX>_ADMIN_EMAIL` / `_ADMIN_PASSWORD` | Yes | Full-access "Playwright Automation" user |
| `<PREFIX>_RESTRICTED_EMAIL` / `_RESTRICTED_PASSWORD` | Yes | Limited-access "User 1", used by every RBAC test |
| `<PREFIX>_API_BASE_URL` | No | Read but not enforced — defaults to `''` if unset |

**`<PREFIX>_ADMIN_DEAL_NAME` / `_RESTRICTED_DEAL_NAME` are dead — do not set these.** They're still listed in the checked-in `.env.example`, but `config.deals` (the only code that ever read them) was removed from `config/config.ts` on 2026-08-11 once Quotations' RBAC tests were fixed to create their own fresh, known deal/company instead of depending on a static pre-existing one (see `.claude/known-issues.md`). Nothing in the codebase reads them today.

**Note:** the checked-in `.env.example` currently only lists those now-dead `*_DEAL_NAME` variables — it does **not** list `APP_URL`/`API_BASE_URL`/`ADMIN_EMAIL`/etc. for any environment. Don't assume `cp .env.example .env` gives you a complete file; you need to add the credential variables above yourself. (Flagged again in [Known Limitations](#known-limitations--open-items).)

```bash
# Reset auth if sessions look stale (QA sessions expire after ~1 hour)
rm -rf src/auth/storageStates/qa/
```

---

## Running Tests

All of the following are real `package.json` scripts or direct Playwright invocations — nothing here is invented.

### Per-module (UI + RBAC together), via npm script

```bash
ENV=qa npm run test:leads
ENV=qa npm run test:contacts
ENV=qa npm run test:companies
ENV=qa npm run test:deals
ENV=qa npm run test:tasks
ENV=qa npm run test:meetings
ENV=qa npm run test:call-logs
ENV=qa npm run test:productsAndServices
ENV=qa npm run test:quotations          # UI only
ENV=qa npm run test:quotations:rbac     # RBAC only, separately
ENV=qa npm run test:reports
```

Each of these appends `&& npm run notify` — an email goes out after every one of these runs (see [§8](#reporting-and-notifications)).

### Other npm scripts

```bash
npm run test              # plain `playwright test`, no post-run notify
npm run test:ui           # all tests, --project=chromium, then notify
npm run test:rbac         # every tests/rbac/*.spec.ts file, then notify
npm run test:login        # tests/ui/dashboard/, then notify
npm run test:headed       # --headed, then notify
npm run test:debug        # --debug (Playwright inspector)
npm run test:notify       # `npm test` then notify, unconditionally
```

`pretest` runs `scripts/rotate-reports.sh` automatically (local only — skipped when `$CI` is set), rotating `reports/<env>/latest` to `previous` before the new run starts. `posttest` runs `npm run notify` automatically, also local-only — in CI, each workflow/Jenkinsfile calls `notify` (and `history:sync`) as its own explicit step instead.

### Direct Playwright invocations

```bash
# Single spec file
ENV=qa npx playwright test tests/ui/leads/leads.spec.ts --project=chromium --workers=1
ENV=qa npx playwright test tests/rbac/leads.rbac.spec.ts --project=chromium --workers=1

# Single test by name
ENV=qa npx playwright test --grep "admin should create a new lead" --project=chromium

# By tag
ENV=qa npx playwright test --grep "@smoke" --project=chromium --workers=1

# Against a different environment
ENV=staging npx playwright test --project=chromium --workers=2
ENV=prod npx playwright test --project=chromium --workers=2
```

Locally, 4 browser projects are configured (`chromium`, `firefox`, `webkit`, `mobile-chrome` — see `playwright.config.ts`); pass `--project=<name>` to pick one, or omit it to run all four. **In CI, only `chromium` is configured** — there is no cross-browser coverage in any pipeline today.

### Reports

```bash
npm run report:playwright         # opens reports/playwright-report
npm run report:allure             # generates + opens the Allure report (runs report:allure:generate, then report:allure:open)
npm run clean                     # rm -rf test-results reports/ allure-results
```

### Code quality

```bash
npx tsc --noEmit      # type check
npm run lint          # eslint . --ext .ts
npm run lint:fix
npm run format         # prettier --write .
```

---

## Test Tags

Every test carries at least one tag in its title (`@smoke`, `@regression`, `@prodSafe`); many carry two. Verified counts across the current 393-test suite (tags overlap, so these don't sum to 393):

| Tag | Count | Meaning | Runs on |
|---|---:|---|---|
| `@smoke` | 29 | Navigation/happy-path only — "does the page load and the core flow work" | `dev` branch (every push) |
| `@regression` | 379 | The full functional + RBAC suite | `qa` branch (every push), and manually via `main.yml` |
| `@prodSafe` | 34 | Read-only — safe to run against real production data (no creates/edits/deletes) | `prod` branch (Jenkins primary; `prod.yml` manual fallback) |

`stage` and the base `Jenkinsfile` (for `prod`/`main`) run with **no `--grep` filter at all** — the entire 393-test suite.

---

## CI/CD Pipeline

### Branch flow

```
feature/* → dev → qa → stage → prod → main
     ↑
  sandbox (pre-PR smoke check, cut from dev)
```

Feature branches are cut from `dev`. Before opening a PR into `dev`, push to `sandbox` (`sandbox.yml` selectively runs only what your change plausibly affects). From there, each promotion (`dev→qa→stage→prod→main`) is its own PR — see [Git Workflow & Branch Promotion](#git-workflow--branch-promotion) below for the exact branch-cutting/push sequence per hop.

### Per-branch matrix (verified directly against every workflow/Jenkinsfile — CLI `--workers`/`--grep` flags always win over `playwright.config.ts` and any `WORKERS` env var)

| Branch | Primary CI | Trigger | Scope | Workers (actual, from the CLI invocation) |
|---|---|---|---|---|
| `sandbox` | GitHub Actions (`sandbox.yml`) | push | Selective, via `detect-tests.sh`; falls back to `@smoke` with no changed files | Dynamic: 2 if the detected target has >50 tests, else 1. (`Jenkinsfile.sandbox` exists as a manual fallback and always uses 1, regardless of target size — a real, minor divergence from the GHA path.) |
| `dev` | GitHub Actions (`dev.yml`) | push | `@smoke` | 1 |
| `qa` | GitHub Actions (`qa.yml`) | push | `@regression` | 2 (`Jenkinsfile.qa` is explicitly commented "NOT the primary CI for qa branch" — kept only for manual runs, also `--workers=2`) |
| `stage` | GitHub Actions (`stage.yml`) | push (+ manual) | Full suite, no `--grep` | 2 (`Jenkinsfile.staging` is explicitly commented "NOT the primary CI for stage branch" — manual only, also `--workers=2`) |
| `prod` | **Jenkins** (base `Jenkinsfile` — its own `branch 'prod'` condition is what actually triggers; `Jenkinsfile.prod` has no branch trigger of its own and is a manual-only fallback, consistent with `CLAUDE.md`) | Jenkins: branch push (via the base `Jenkinsfile`). `prod.yml`/`Jenkinsfile.prod`: manual only | `@prodSafe` | 2 |
| `main` | **Jenkins** (base `Jenkinsfile`, its own `branch 'main'` condition — commented "primary CI for prod and main only") | Jenkins: branch push/manual. `main.yml`: manual only | Full suite — both the base `Jenkinsfile` and `main.yml` run with no `--grep` at all; they're equivalent in scope today, not divergent | 2 |
| — | `staging-promotion-gate.yml` | manual only (`workflow_dispatch`) | Full suite against **`STAGING_*`** secrets, then gates an approval-based auto-merge of `staging`→`prod` | 2 (this is the one CI path where the `WORKERS` env var is actually read by `playwright.config.ts`, since no `--workers` CLI flag is passed) |

**Two similarly-named files, deliberately disambiguated in their own headers (added 2026-07-07):**
- **`stage.yml`** — ordinary, push-triggered CI for the `stage` branch. No approval gate, no auto-merge.
- **`staging-promotion-gate.yml`** (renamed from `staging.yml`) — manual-only, runs against `STAGING_*` secrets, and on success + human approval via a `production-approval` GitHub Environment gate, auto-merges `staging` into `prod` with no further review. Given that blast radius, it previously had **no failure notification at all**; it now sends one like every other pipeline.

Read each file's own header comment if you're ever unsure which is which — both now explicitly cross-reference the other.

### What every CI run actually does

1. Checkout, install Node, `npm ci`, install the `chromium` browser.
2. Run the scoped test command for that branch (table above).
3. `npm run history:sync` — append this run's stats to the persistent run-history ledger (see [§8](#reporting-and-notifications)).
4. `npm run notify` — send the summary email.
5. Archive/publish the HTML report as a build artifact.

---

## Reporting and Notifications

_Restrained-enterprise email redesign (2026-07-14) — full rewrite of `EmailTemplate.ts` into an
orchestrator plus one `buildXxx()` method per section, two new pure-logic modules
(`FailureAnalyzer.ts`, `AutomationHealth.ts`), and an extended `RunHistory.ts` schema. Every
capability described below as of the 2026-07-07 P0–P5 overhaul is preserved; what's new is called
out explicitly._

### Email summary (`npm run notify` → `src/notifications/scripts/notify.ts`)

After (almost) every run, `NotificationService` parses the Playwright JSON report via `ReportParser`,
reads `reports/<env>/misc-errors.json`, reads `reports/<env>/history-delta.json` (if present), derives
a failure-cluster list and an automation-health score, and renders an HTML email via `EmailTemplate`.
It's sent through Gmail/Zoho SMTP (`src/notifications/config/notificationConfig.ts`) to a QA team
recipient list, chosen per-branch first, falling back to per-environment.

The email now includes:
- A **masthead + full-width status banner**: brand, Automation Health label, and a prominent
  PASSED/FAILED/UNSTABLE banner (✅/❌/⚠️) directly below it — a deliberate two-block layout (not
  one pill doing both jobs), so status is visible at a glance without opening the email.
- A **stale-report warning** (see [Report freshness check](#report-freshness-check) below) — rendered
  as the very first thing in the email, above the masthead, when the underlying data is suspiciously
  old.
- **Header metadata badges** (ENV/BRANCH/BUILD/SOURCE) — color-coded by actual value, not one flat
  color: ENV varies by environment (prod/staging/qa each a distinct color), SOURCE varies by CI source
  (Jenkins/GitHub Actions/local each a distinct color, with 🔧/🐙/💻 to match), BRANCH/BUILD are flat.
  This mirrors the pre-2026-07-14 template's exact color values and structure — checked directly via
  `git show` against that version rather than guessed. See
  [Email design & compatibility](#email-design--compatibility) below for why these are solid hex
  colors, not the more "obvious" `rgba()` choice.
- An **Executive Summary** — plain-language deployment recommendation, prominently flagging any
  **suite drift** (see below) and any multi-test failure cluster.
- An **Automation Health** score (0–100, Excellent/Good/Needs Attention/Critical) with its weighted
  factors, in the masthead and its own dedicated block.
- A **KPI dashboard** — total/passed/failed/skipped/flaky/pass-rate/duration/modules/retries (each tile
  tinted a subtle semantic color — light green/red/amber — matching its status, not flat white), plus
  conditional signal chips for background errors, infra-classified failures, new failures (vs. the
  previous run), and recurring-flaky count.
- A **trend section**: Δ vs. the previous run, a pass-rate **sparkline** across the last ~10 runs,
  recurring-flaky *and* recurring-failing tests (see the lookback note below), and modules trending
  worse.
- **Module Analytics** — the per-module breakdown table, now ranked by health (not alphabetical) with
  a per-module trend arrow, and a one-line Total/UI/RBAC caption above it (previously its own
  standalone "Test Type Split" block).
- **Slowest Tests** (top 5, unchanged) — now with previous-duration/diff and a regression flag.
- **Flaky Tests** — now with historical frequency and a derived risk level (High/Medium/Low/New).
- **Failure Clusters** (replaces the old flat failed-tests table) — failures sharing a *real* matching
  signal (identical error message, same source location, or same failing API endpoint+status,
  cross-referenced against `misc-errors.json`) are grouped under one header showing "N tests
  affected," each with its own full title/file/error/trace detail still listed underneath — nothing is
  summarized away, and two failures are never merged without a real shared signal.
- A **background-errors** section (unchanged in substance) distinguishing unexpected / `Expected RBAC`
  / `Known Background Noise`, now also split into app-level vs. infra-level (5xx) within "unexpected."
- An **Action Required** list, synthesized from suite drift, failure clusters, flaky tests, background
  errors, and slow-test regressions, sorted by priority.
- An **Environment** block — Playwright version, worker count, and browsers actually exercised (sourced
  from the JSON report's own `raw.config`, not guessed), plus the reporting process's own Node
  version/OS.
- A **CI/CD & Artifacts** block — the repo-relative reports directory, the run URL, and (when real,
  never fabricated) a **re-run link** (Jenkins: the job's standard `/build` trigger endpoint, derived
  from a real `buildUrl`; GitHub Actions: honestly labeled as "re-run available from this page," since
  GitHub exposes no plain re-run URL) and a **full-history link** to this environment's ledger file on
  `ci/reporting-history`, resolved from `git remote get-url origin` — omitted, not faked, when the
  remote isn't GitHub.
- A footer line with the report's generation timestamp and its own `REPORT_ENGINE_VERSION` constant
  (independent of `package.json`'s version — the template's structure changes on its own schedule).

### Run history / trend tracking (`ci/reporting-history` branch)

`npm run history:sync` (`src/notifications/scripts/syncHistory.ts`) maintains a small, append-only, capped ledger of past run stats, so the email can show a trend instead of just one run's numbers in isolation.

**Storage decision:** the ledger lives as a JSONL file on a dedicated, never-merged git branch (`ci/reporting-history`), one branch per environment history — not a database, not a GitHub Actions cache, not an external service. Rationale: it needs to survive across CI runners (rules out local disk/cache), needs no new infrastructure or secret to provision (rules out a database), and a plain-text, human-readable, git-diffable ledger is easy to inspect/debug directly (`git show ci/reporting-history:reports/qa/history.jsonl`) without any tooling. The branch is capped at `MAX_RECORDS_PER_ENV = 100` (oldest records pruned on write).

**Concurrent-write handling:** two CI runs finishing around the same time will race to push to `ci/reporting-history`. The retry loop is **fetch + `reset --hard` + recompute the delta/append fresh** on each retry attempt — not a rebase. A rebase was tried first and was dropped after it demonstrably produced real, unresolvable merge conflicts on the plain-text ledger when two pushes landed close together; reset-and-recompute never conflicts because it never tries to replay a diff.

**Extended 2026-07-14** — each record now also stores `failedTestTitles` (mirroring the existing
`flakyTestTitles`) and the top-20 slowest test durations, and each module entry now carries its `type`
(fixing a latent bug where a same-named UI and RBAC module could collide on lookup) and its real
duration (previously always `0`). The lookback used for "recurring" issues was widened from 5 to 10
runs. **"Recurring flaky"/"recurring failing"** now means: flaky (or failing) in more than 2 of the
last 10 recorded runs on this branch (`RECURRING_FLAKY_LOOKBACK = 10`, `RECURRING_FLAKY_THRESHOLD =
2`, both overridable per call). **Suite drift** is flagged whenever the current run has *any* fewer
tests than the previous run (no percentage floor — a dropped test is treated as a signal worth
confirming, never as an acceptable margin, since it's frequently a silently-broken test file rather
than genuine improvement); growth in test count is never flagged, since the suite grows continuously
as normal development. Real measured ledger size at this suite's scale (263 tests, 16 module/type
combinations): the pre-2026-07-14 schema was already ~196KB/100KB records on a typical run (not the
"~40-60KB" originally estimated); the extended schema above is ~448KB/100 records typical, ~975KB
worst-case, per environment (~1.35MB across all 3 env files at the full cap) — an accepted tradeoff,
and git's own compression keeps the real on-disk/network cost below these raw-byte figures.

**Branch/commit local-git fallback (added 2026-07-14):** both `notify.ts` (the email-facing
`resolveNotificationInput()`) and `syncHistory.ts`'s own separate `branch` derivation previously ended
their fallback chain at a static `'unknown'` string whenever no CI env var (`BRANCH_NAME`/
`GITHUB_REF_NAME`, `GIT_COMMIT`/`GITHUB_SHA`) was set — even for a plain local run inside a real git
checkout, where the actual branch/commit is one command away. Both now fall back to real local
`git branch --show-current` / `git rev-parse --short HEAD` (wrapped in try/catch — a checkout with no
git metadata still degrades to `'unknown'`, not a thrown error). Confirmed live, twice independently:
a bare local `notify` run resolved the real current branch/commit instead of "unknown," and a bare
local `history:sync` run wrote the real branch into the ledger instead of "unknown."

### Failure clustering (`src/notifications/FailureAnalyzer.ts`)

New in this redesign. `classifyFailure()` assigns one of 11 categories (locator/assertion/timeout/
api/auth/network/environment/infra/console/js/unknown) per failed test, preferring a real HTTP-status
signal from `misc-errors.json` (cross-referenced by test title) over guessing from message text alone
where one exists. `clusterFailures()` groups failures only on a real matching signal — exact error
message, identical source location, or identical failing endpoint+status — never on partial/fuzzy
similarity, since a false merge would hide a genuinely separate bug inside another one's summary. A
failure sharing no signal with any other becomes its own single-test "cluster," rendered identically
to a normal standalone failure.

### Automation health score (`src/notifications/AutomationHealth.ts`)

New in this redesign. A weighted 0-100 score (Excellent ≥90 / Good ≥75 / Needs Attention ≥50 /
Critical <50) factoring in pass rate, failure count, flakiness, unexpected background errors, suite
drift, **recurring failures/flakiness**, and **report staleness** — all six can fire together on the
same run (confirmed live: a run with recurring issues plus a stale report scored 30/Critical, with all
five applicable factors listed individually). The weights are a starting point, documented as such in
the source — revisit once real multi-run data accumulates, the same convention already used for the
slow-test regression threshold below.

**Recurring failures/flakiness** (added 2026-07-14, same day as the redesign): a real gap found by
running this against 4 sequential test runs — a test that had failed (or flaked) in 3 of the last 4
recorded runs still scored the overall run "Excellent," because the score only weighed that run's raw
counts, never the recurring-issue history the same email's Trend section already surfaces. Fixed by
penalizing recurring failures more heavily than recurring flakiness (a test that keeps failing outright
is a stronger "known, unaddressed problem" signal than one that keeps eventually passing on retry) —
confirmed live: the same 4-run scenario now scores 79/Good instead of 91/Excellent once a recurring
issue is present, without changing the 3 earlier runs' scores (they didn't have enough history yet for
anything to qualify as "recurring").

### Report freshness check (`NotificationService.checkReportFreshness()`)

Added 2026-07-14 after two real sent emails both showed report content several days older than the
actual send date — traced to `notify.ts` silently reusing whatever stale
`reports/<env>/latest/playwright-report/results.json` happened to be on disk, with **no check anywhere
in the pipeline** for how old that data actually was (confirmed via grep across the entire
`src/notifications` tree before this fix — zero references to freshness/staleness). `checkReportFreshness()`
compares `report.endTime` against `Date.now()` (the latter passed as an explicit parameter, not called
internally, so the function stays pure/testable); if the gap exceeds `STALE_REPORT_THRESHOLD_HOURS`
(default 4, overridable via env var — a starting heuristic, not statistically tuned, same convention as
the health-score weights), the email gets:
- A full-width warning banner as the very first thing in the email, above the masthead.
- `⚠️ STALE REPORT — ` prepended to the subject line, so it's visible even in an inbox list view before
  the email is opened.
- A `-30` "Data freshness" factor in the automation health score (see above) — one of the largest single
  penalties, since a stale report undermines trust in every other number in the email.

Confirmed live against the genuinely stale (4-day-old) `reports/qa/latest` artifact: correctly detected,
correctly dropped health from 100 to 70, correctly prefixed the subject.

### Email design & compatibility

The masthead/header row went through several rounds of real, evidence-based fixes worth knowing about
before touching them again:

- **Container width is fully fluid (`width="100%"`, no `max-width`), by design — not an oversight.**
  Checked the actual pre-2026-07-14 template (`git show <old-commit>:src/notifications/EmailTemplate.ts`)
  rather than guessing: it also had no width cap, ever. A capped width (600px, then 750px were both
  tried) always leaves visible white space once the reading pane is wider than the cap — there is no
  fixed number that fills every pane. The trade-off, same as the old template already had: on a very
  wide monitor, line-length and tile spacing stretch out rather than staying at a fixed comfortable
  width. Accepted explicitly, not a regression.
- **Outlook desktop renders the email body with Microsoft Word's layout engine, not a browser engine** —
  a real, documented, longstanding Microsoft architecture choice (since Outlook 2007). Word implements
  only a small legacy CSS subset: it does **not** understand `max-width` at all (any table relying on
  CSS `max-width` alone renders however its literal HTML `width` *attribute* resolves in Outlook,
  uncapped), and it silently drops unsupported property *values* — including `rgba()` transparency —
  rather than degrading them, which can produce a background color that's simply invisible with no other
  symptom. Both of these were real bugs caught in this redesign (a `max-width`-only container, and
  `rgba()`-based badge colors) — fixed by using literal HTML `width` attributes and solid opaque hex
  colors, which Word's engine has always supported.
- **Badge chips are joined with a real space character, not just CSS `margin`.** An earlier version
  relied entirely on margin for the visual gap between adjacent badges; any context that doesn't render
  margin — plain-text view, a client that strips inline styles, copy-paste, a screen reader — ran the
  label/value text of adjacent badges together with zero separation. Confirmed by stripping all HTML
  tags from the real rendered output and checking the extracted text reads correctly.
- **Emoji are scoped to two specific contextual "what am I looking at" indicators** (the status banner,
  the SOURCE badge) — reintroduced 2026-07-14, matching the old template's exact choices for exactly
  these two fields (✅/❌/⚠️ for status, 🔧/🐙/💻 for Jenkins/GitHub Actions/local). The rest of the
  email's section headers (Module Analytics, Trend, etc.) stay emoji-free — a deliberate, narrower scope
  than the old template's emoji-everywhere style, not an oversight.

### Background-error report (`reports/<env>/misc-errors.json`)

Each Playwright worker process runs its own `ErrorCollector` instance and writes its own `misc-errors-worker-<N>.json` (namespaced by env and worker index specifically to survive two workers, or two concurrent cross-environment runs, writing at once without clobbering each other). `MiscErrorReporter` (a Playwright reporter, wired into `playwright.config.ts`) merges all worker files into the final `reports/<env>/misc-errors.json` once the run ends, and prints a terminal summary tagging each error `[Expected RBAC]` / `[Known background noise]` / neither. The redundant `expected: boolean` field (always exactly `!!expectedReason`) was removed 2026-07-14 after an exhaustive grep confirmed its only 3 real consumers; all 3 now read `expectedReason` directly.

### Trace files

Every failure retains a Playwright trace (`trace: 'retain-on-failure'` in `playwright.config.ts`), plus a screenshot and video. `ReportParser` reads the trace path straight out of Playwright's own JSON report `attachments` array and converts it to a repo-relative path, so the link in the email still means something after the CI runner that produced it is gone — it matches what you'll find inside the downloaded `test-results` artifact zip. As of 2026-07-14, `ReportParser` also extracts each failure's `error.stack` and `error.location` (file/line/column) — both were previously discarded — and strips terminal ANSI color escape codes from error text (Playwright's JSON reporter embeds them raw; left in, they rendered as garbage characters and could break exact-message clustering).

---

## RBAC Testing Philosophy

Every module (except Dashboard/Login) has a paired `tests/rbac/<module>.rbac.spec.ts` alongside its `tests/ui/<module>/<module>.spec.ts`. RBAC tests use **both** `adminPage` and `restrictedPage` fixtures together, exercising the same CRM feature from two permission levels in one test:

- **"Playwright Automation"** (`adminPage`) — full-access user, can create/see/edit anything.
- **"User 1"** (`restrictedPage`) — limited-access user, whose visibility into admin-owned records is exactly what's under test.

The core pattern in nearly every RBAC test: admin creates a record with `generateAdminXxxData()` (guaranteed invisible to the restricted user, by the `ADM`-prefix convention explained in [§2](#architecture--how-its-built)), then the test asserts the restricted user genuinely cannot see it — not "the element wasn't visible," but a real absence check that can't be confused with a slow/broken page (per CLAUDE.md's audit rule: never `if (visible) {assert} else {logger.success('...correct RBAC')}` — that pattern silently converts "the page failed to load" into a false pass).

The other half of RBAC coverage is the **share/reassign/clone** family: admin explicitly shares (or reassigns, or clones) a record to/for the restricted user with a specific permission set (`update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`), and the test verifies the restricted user can now do exactly what was granted — no more, no less. These tests assume real propagation lag between the share action and the permission taking effect server-side — they poll/retry on a transient 403 rather than sleep-and-hope, and they still fail loudly on a permission that never arrives.

RBAC-expected errors (403s, 422/`029003`) are captured by `ErrorCollector` like any other error but classified `expectedReason: 'rbac'` (see [§2](#architecture--how-its-built)) — they show up in reports as confirmation the permission boundary is being enforced, not as noise to filter out and not as a regression to chase.

---

## Git Workflow & Branch Promotion

### Branch strategy

```
feature/* → dev → qa → stage → prod → main
     ↑
  sandbox (pre-PR smoke check, cut from dev)
```

| Branch    | Purpose             | Tests Run       |
| --------- | ------------------- | --------------- |
| `sandbox` | Pre-PR smoke check  | Selective (`detect-tests.sh`) |
| `dev`     | Feature development | `@smoke`      |
| `qa`      | QA regression       | `@regression` |
| `stage`   | Full suite          | all tests |
| `prod`    | Production safe     | `@prodSafe`   |
| `main`    | Final validation    | `@regression` |

**Golden rules:**
1. Always cut feature branches from `dev`.
2. Each promote branch cuts from the previous promote branch (not from `dev` again).
3. Never push directly to `dev`/`qa`/`stage`/`prod`/`main`.
4. Never skip environments.
5. Wait for CI to pass before merging each PR.

### Daily workflow

```bash
# 1. Reset sandbox before every new task
npm run sandbox:reset

# 2. Create a feature branch from dev
git checkout dev && git pull origin dev
git checkout -b feature/description-YYYYMMDD

# 3. Make your changes, verify locally
npx tsc --noEmit
npx playwright test tests/ui/your-module/ --project=chromium --headed --workers=1

# 4. Commit and push
git add .
git commit -m "feat: description of change"
git push origin feature/description-YYYYMMDD
```

**Commit message format:** `feat: ...` / `fix: ...` / `chore: ...` / `ci: ...` / `refactor: ...`

### Verify on sandbox before opening a PR to dev

Merge your feature branch to sandbox first — `sandbox.yml`'s selective test detection runs only what your change plausibly affects, catching CI-breaking issues before they hit `dev`'s own pipeline:

```bash
git checkout sandbox && git pull origin sandbox
git merge feature/description-YYYYMMDD
git push origin sandbox
```

Wait for `.github/workflows/sandbox.yml` to complete. If it fails, fix locally, commit, push to the feature branch, and re-merge to sandbox. If it passes, open a PR from your feature branch into `dev` and wait for `dev`'s own CI before merging.

### Promoting through qa → stage → prod → main

Each hop cuts a **new** promote branch from the **previous promote branch** (not from `dev` again), opens a PR into the next environment branch, and waits for that branch's CI to pass before merging:

```bash
# dev → qa (first promotion, after sandbox CI + the dev PR have both passed)
git checkout dev && git pull origin dev
git checkout -b feature/promote-FEATURE-to-qa-YYYYMMDD
git push origin feature/promote-FEATURE-to-qa-YYYYMMDD
# Open PR: compare/qa...feature/promote-FEATURE-to-qa-YYYYMMDD

# qa → stage — cut from the qa promote branch above, not from dev
git checkout feature/promote-FEATURE-to-qa-YYYYMMDD && git pull origin feature/promote-FEATURE-to-qa-YYYYMMDD
git checkout -b feature/promote-FEATURE-to-stage-YYYYMMDD
git push origin feature/promote-FEATURE-to-stage-YYYYMMDD
# Open PR: compare/stage...feature/promote-FEATURE-to-stage-YYYYMMDD

# stage → prod — cut from the stage promote branch
git checkout feature/promote-FEATURE-to-stage-YYYYMMDD && git pull origin feature/promote-FEATURE-to-stage-YYYYMMDD
git checkout -b feature/promote-FEATURE-to-prod-YYYYMMDD
git push origin feature/promote-FEATURE-to-prod-YYYYMMDD
# Open PR: compare/prod...feature/promote-FEATURE-to-prod-YYYYMMDD

# prod → main — cut from the prod promote branch
git checkout feature/promote-FEATURE-to-prod-YYYYMMDD && git pull origin feature/promote-FEATURE-to-prod-YYYYMMDD
git checkout -b feature/promote-FEATURE-to-main-YYYYMMDD
git push origin feature/promote-FEATURE-to-main-YYYYMMDD
# Open PR: compare/main...feature/promote-FEATURE-to-main-YYYYMMDD
```

Open each PR at `https://github.com/akashrn1801/kylas-playwright-framework/compare/<target-branch>...<promote-branch>`.

### Clean up merged branches

```bash
git branch -r --merged origin/main | grep "feature/" | sed 's/origin\///' | while read b; do
  git push origin --delete "$b"
done
```

### Send notification after tests

```bash
npm run notify
```

---

## Known Limitations / Open Items

Cross-checked against `CLAUDE.md`'s own audit notes and re-verified directly against source on 2026-08-12 — this list reflects what's true **today**, not a stale carry-over.

- **`.env.example` is incomplete, and its only contents are now dead.** It currently only ships the Quotations `*_DEAL_NAME` variables — no `APP_URL`/`API_BASE_URL`/`ADMIN_EMAIL`/etc. for any environment — and even those are no longer read by any code (`config.deals` was removed from `config/config.ts` on 2026-08-11; see [Getting Started](#getting-started)). A first-time `cp .env.example .env` will not produce a working file; see [Getting Started](#getting-started) for the actual required variable list.
- **No cross-browser coverage in CI.** `firefox`/`webkit`/`mobile-chrome` are configured for local runs only; every CI pipeline runs `chromium` exclusively.
- **`Jenkinsfile.sandbox`'s worker count (always 1) diverges from `sandbox.yml`'s dynamic 1–2** — a minor, currently-harmless inconsistency between the GHA path (primary) and the Jenkins manual fallback for the same branch.
- **No scheduled/nightly runs exist anywhere** — every pipeline is push- or manually-triggered only.
- **No cross-environment (QA/staging/prod) data-parity check exists.**
- **QA/staging data grows unboundedly** — no module cleans up the records it creates, so search/list operations get measurably slower over the life of the environment. Retry budgets in `config.searchRetry` account for this, but it's a standing tax on every run, not a one-time cost.
- **Several additional known flakiness/open-code items are tracked in detail in `.claude/known-issues.md` rather than duplicated here** — including the unresolved Deals Call-permission-on-shared-deal flake, `DealsPage.fillDealForm()`'s intentional associated-contact/company randomization (pass `associatedContactName`/`associatedCompanyName` on `DealData` when a new Deals test needs a known, not-random, associated entity instead), and `CallLogsPage.searchAndSelectEntity()`'s thinner staging retry margin (plus its silent fallback-to-first-option on exhaustion). See that file's relevant sections for full evidence and current status.
- **Recently built, not yet proven under a real live CI run at the time of writing:** the P0–P5 reporting overhaul (tiered error classification, run-history/trend tracking, trace-linking fixes, the `staging-promotion-gate.yml` rename) and the two sandbox-CI bug fixes (`tsconfig.json`'s `"types": ["node"]` fix for `ts-node`'s intermittent `@types/node` resolution failure; the `createRolePage()` browser-context leak fix) were all verified via isolated local execution and real (non-push) script runs, but not yet exercised end-to-end by an actual CI pipeline run against real GitHub/Jenkins infrastructure. Treat the very first live CI run after this work lands as still partially a verification step, not a routine run.
- **The 2026-07-14 email/reporting redesign** (restrained-enterprise `EmailTemplate.ts` rewrite, `FailureAnalyzer.ts`, `AutomationHealth.ts`, the extended `RunHistory.ts` schema, the freshness check, the local-git fallback) compiles cleanly (`tsc --noEmit`, `eslint`, zero errors) and has now been run end-to-end multiple times: a combined pass exercising every feature at once (real Playwright execution, real failure clusters, real recurring-issue and freshness penalties stacking together, real git-derived branch/commit) against a throwaway `ci/reporting-history` ledger, plus one real send via the actual SMTP path (recipient temporarily scoped to one address for that test, reverted immediately after — confirmed via empty `git diff`). What's genuinely still open: **the real `ci/reporting-history` branch itself has never been touched by any of this verification** (by design, to avoid polluting it) — the first real CI run after this ships is effectively run #1 for that branch. The automation-health weights, the 4-hour staleness threshold, and the slow-test 20%-regression threshold are all documented in source as starting heuristics, not statistically-tuned constants — expect to revisit them once real multi-run data accumulates. Real Outlook desktop rendering was verified structurally (literal HTML `width` attributes, solid non-`rgba()` colors — the specific things Word's engine is documented to require) but never captured from an actual Outlook client; likewise, email dark-mode support is best-effort CSS (`prefers-color-scheme`) never verified against a real Gmail/Outlook dark-mode render.
- **A related, deliberately unresolved architectural question:** whether long CI jobs (`qa`/`stage`, ~220+ tests on 2 workers) should be split into parallel shards is flagged but intentionally not implemented — it was raised while investigating a browser-context resource-exhaustion incident, but splitting job topology is a bigger, separate decision than the incident's actual fix warranted.
- **Lead's edit form (`fillEditForm()`) does NOT update Timezone, Country, or the 5 Professional fields — Contact's edit form DOES update its Timezone/Company.** This is a real, pre-existing asymmetry: Lead's `fillEditForm()` was deliberately scoped to fill only firstName/lastName/Salutation/Requirement/custom-fields, so those 7 fields are create-only on Lead; Contact's `fillEditForm()` re-fills its Timezone/Company. The detail-page assertions accommodate this — Lead's create-only fields are asserted on create only. **Open decision for a maintainer:** either extend Lead's `fillEditForm()` to also update these fields (fuller update coverage, but a riskier change to a heavily-used shared method — react-select re-selection on a pre-filled edit form is exactly where subtle bugs live), or accept them as create-only. Left as create-only as the lower-risk choice, flagged rather than silently changed.
- **The same unbounded-click dropdown risk fixed elsewhere in this codebase is still present, unfixed, in `LeadsPage.ts` (close-reason radio selection, convert-to-deal product selection) and `QuotationsPage.ts` (several random-option pickers)** — confirmed via code read, not yet verified as actually broken in either module, but the identical shape (a raw, unbounded `.click()` on a randomly-indexed option in a list that can still be populating) is present.
- **A `[id*="..."]` substring-locator pattern — the same shape that caused the (fixed) Company Phones collision — still appears in `QuotationsPage.ts` (`[id*="input_products"][id*="quantity"]`, a compound match).** Not confirmed broken. (Re-verified 2026-08-12: this bullet previously also named `CompaniesPage.ts`/`DealsPage.ts`/`ContactsPage.ts` — Companies and Contacts have no such locator at all, and Deals' own copy was already hardened on 2026-08-10 specifically to eliminate this exact risk, so only the Quotations instance remains today.)
- **Company Website field's validation behavior (confirmed live to show the identical "Enter a valid URL" inline validation as the custom UrlField) has no dedicated negative-validation test** — unlike the custom UrlField, which has `generateLeadCustomFieldInvalidUrl`. The claim was verified ad-hoc at implementation time per its own note, but has not been independently re-confirmed since, and there's no regression test guarding it.
- **`reports/<env>/misc-errors.json` (and its per-worker files) are overwritten by every subsequent test invocation, including a single isolated test run** — this is a same-process problem, not just the already-documented cross-process race. A full-suite run's own 91-entry report was lost this way during a follow-up session's own work (a later isolated test run overwrote it before its data was fully analyzed) — worth considering a timestamped/run-scoped output path for full-suite runs specifically.
- **`companies.spec.ts` CO4's rare flaky generic-error toast on save (2026-07-22) is now mitigated, not just observed.** `saveCompany()`/`createCompany()` gained a 3-attempt transient-backend-error retry classifier on 2026-07-21 that covers this exact shape (a generic, non-field-specific error with no session-expiry cause) — re-verified 2026-08-12 directly against `CompaniesPage.ts`. The original correlation with a background duplicate-check 400 was never proven causal, and the fix wasn't built specifically for this bullet, but it does now cover the observed symptom. Not re-confirmed under fresh concurrent load since the fix landed.

---

## Contributing / Adding a New Module

Before making any change, read `CLAUDE.md`'s **25 Standing Rules** — a permanent, always-apply list distilled from real issues found and fixed across multiple sessions in this codebase.

Full daily-workflow and branch-promotion mechanics are in [§10 Git Workflow & Branch Promotion](#git-workflow--branch-promotion) above — this is the module-specific checklist:

1. **Factory** — add `src/data/factories/<module>Factory.ts` exporting `generateXxxData()`, `generateAdminXxxData()` (`ADM<timestamp>` prefix), and, if the module supports sharing, `generateSharedXxxData()` (`SHR<timestamp>` prefix). Default `country: 'India'` if the module has that field.
2. **Page object** — add `src/modules/<module>/<Module>Page.ts` extending `BasePage`, following the fixed 10-section order from [§2](#architecture--how-its-built). Read the "Reference Patterns" section of `CLAUDE.md` first — the ellipsis-menu, share-modal, reassign-modal, and clone patterns are meant to be reused nearly verbatim, not reinvented per module.
3. **UI tests** — `tests/ui/<module>/<module>.spec.ts`, importing `test`/`expect` from `src/fixtures/index.ts` only. Tag every test (`@smoke`, `@regression`, and/or `@prodSafe` if it's genuinely read-only). Give any create/edit test `test.setTimeout(480000)` — local runs can be slow.
4. **RBAC tests** — `tests/rbac/<module>.rbac.spec.ts`, using both `adminPage` and `restrictedPage`. Follow the negative-assertion and share/reassign patterns in [§9](#rbac-testing-philosophy).
5. **`package.json` script** — add `test:<module>` following the existing pattern (`playwright test tests/ui/<module>/ tests/rbac/<module>.rbac.spec.ts --project=chromium && npm run notify`).

`sandbox.yml`'s selective test detection (`detect-tests.sh`) works off changed file paths, not a hardcoded module list — a new module's tests get picked up automatically, no CI config changes required for that part.

**Code conventions** (see `CLAUDE.md` for the full list): never import from `@playwright/test` directly in a spec file; never hardcode test data; never put locators in test files; use `logger.*`, never `console.log`.

---

## Troubleshooting

**`Missing required environment variable: X`** — the active `ENV`'s credentials are incomplete in `.env`. Check which `ENV=` is set and that all 5 required variables (`APP_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RESTRICTED_EMAIL`, `RESTRICTED_PASSWORD`) exist for that prefix — see [Getting Started](#getting-started).

**Tests fail with auth errors / redirected to sign-in mid-run** — the cached session expired (QA sessions last ~1 hour). Clear it and re-run:
```bash
rm -rf src/auth/storageStates/qa/
```
The fixtures already attempt one automatic re-login on a detected sign-in redirect before failing — if you're seeing this, it's a genuine second failure, not the first. For the full 5-phase session-expiry recovery architecture (why a second failure can still happen despite this, and every mechanism already in place to prevent it), see `.claude/known-issues.md`.

**`Target page, context or browser has been closed`** — investigated as part of a real sandbox CI incident. A confirmed resource leak in `createRolePage()` (a throw-before-`use()` path that skipped context/page cleanup) was found and fixed, but was *not* proven to be the direct cause of any single reported incident — only proven to be a real leak that could contribute over a long run. If you see this consistently (not once in a long run), it's worth re-opening the investigation with real evidence, not assuming the existing fix already covers it.

**`ts-node` script fails to compile with a `TS2591` (`Cannot find name 'process'`, etc.) error, but `tsc --noEmit` on the same file passes** — this exact class of bug was root-caused live: `ts-node`'s default per-file compilation only auto-discovers `@types/node` if the entry file's own import graph happens to reach into `node_modules`; a shallow/pure-logic script can silently fail to get Node's global types. Fixed at the project level via `tsconfig.json`'s `"types": ["node"]` — if you hit this again, check that setting hasn't been reverted before re-diagnosing from scratch. Also: verifying a standalone script with `ts-node --transpile-only` is not sufficient — it skips type-checking entirely and will not catch this class of bug. Verify with a real, non-transpile-only run.

**`git clone <remote-name> .` fails** — `git clone` needs a URL, not a remote name. Use `git remote get-url origin` first if you need to resolve the actual URL programmatically (see `resolveGitRemoteUrl()` in `syncHistory.ts` for the canonical pattern).

**Email report shows a wildly wrong duration or a start time that looks like an end time** — this exact bug existed and was fixed: summing every individual test's duration double-counts overlapping time under parallel workers, and Playwright's JSON report has no top-level `startTime` (only `stats.startTime`). `ReportParser.ts` now reads `raw.stats.duration`/`raw.stats.startTime` directly. If you see this again, something has regressed that fix — it was verified against real production data to the exact second, not guessed.

**Flaky test's trace link in the email points at a passing run, not the failure** — also a fixed, previously-real bug: for a flaky test, Playwright's `lastResult` is the passing retry, which has no trace (`retain-on-failure` only keeps failed-attempt traces). `ReportParser.ts` now sources the trace from the last **non-passing** attempt for flaky tests specifically.

**Clone lead/contact form shows validation errors on save** — clone pre-fills the form with the original's email/phone; you must change at least one before saving to avoid a duplicate-value rejection. See the Clone pattern in `CLAUDE.md`'s Reference Patterns.

**`saveQuickTask()` hangs or times out when called from within a Lead/Contact detail panel** — use `saveQuickTaskFromEntityDetail()` instead; `saveQuickTask()` waits for the standalone task list view, which never appears from that context.

**Push rejected (`fetch first` / `non-fast-forward`)**
```bash
git pull origin <branch-name> --rebase
git push origin <branch-name>
```

For anything not covered here, `CLAUDE.md`'s "Known Issues — Critical / Do Not Touch" section (and its full detail in `.claude/known-issues.md`) has a much deeper per-module list of known flakiness root causes and the locator/wait patterns proven to fix them — read it before touching any page object, fixture, or CI file.
