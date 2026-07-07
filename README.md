# Kylas Playwright Framework

End-to-end test automation for **Kylas Sales CRM**, built on Playwright + TypeScript. 259 tests across 9 modules (17 spec files), split between functional UI coverage and RBAC (role-based access control) permission testing, running across a 6-branch CI/CD pipeline with its own reporting and email-notification system.

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
10. [Known Limitations / Open Items](#known-limitations--open-items)
11. [Contributing / Adding a New Module](#contributing--adding-a-new-module)
12. [Troubleshooting](#troubleshooting)

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

**Modules covered** (9): Leads, Contacts, Companies, Deals, Meetings, Tasks, Quotations, Call Logs, and Dashboard/Login. Every module except Dashboard has both a UI spec and an RBAC spec.

**Current suite size** (verified fresh via `npx playwright test --project=chromium --list`, do not trust any older number without re-running this):

| Module | UI tests | RBAC tests | Total |
|---|---:|---:|---:|
| Call Logs | 21 | 22 | 43 |
| Companies | 17 | 20 | 37 |
| Contacts | 15 | 17 | 32 |
| Dashboard/Login | 4 | — | 4 |
| Deals | 17 | 22 | 39 |
| Leads | 16 | 24 | 40 |
| Meetings | 7 | 7 | 14 |
| Quotations | 15 | 14 | 29 |
| Tasks | 11 | 10 | 21 |
| **Total** | **123** | **136** | **259** |

---

## Architecture — How It's Built

### Page Object Model, anchored on `BasePage`

Every page object (`src/modules/<module>/<Module>Page.ts`) extends `src/core/BasePage.ts`, which supplies the primitives every module reuses: `click`, `fill`, `selectOption`, `waitForVisible`/`waitForHidden`, `waitForUrl`, `assertVisible`/`assertText`/`assertUrl`, `assertNoFormErrors`, `takeScreenshot`, `isVisible`, `getText`, `navigateTo`, `reloadPage`, `getPageTitle`, `getCurrentUrl`, and `getLoggedInUserName`. Nothing module-specific lives in `BasePage` — it stays a thin, shared toolbox so a change to a wait helper doesn't require touching nine page objects.

Every page object follows the **same 10-section order**, top to bottom:

1. `retryConfig` (reads `config.searchRetry` or `config.meetingRetry`)
2. Locators (private `readonly` arrow functions returning `Locator`)
3. Constructor (`super(page)`)
4. Private Helpers
5. Navigation
6. Form Actions
7. Search & Open
8. Edit Actions
9. Assertions
10. Workflow Wrappers

**Why this matters in practice:** with 9 modules maintained by more than one person, the cost of "where do I even look" compounds fast. A fixed section order means anyone can jump into an unfamiliar page object already knowing that retry tuning is at the top and workflow wrappers are at the bottom — no per-file archaeology. Locators are also always lazily-evaluated arrow functions (`private readonly foo = (): Locator => ...`), never captured eagerly at construction time, because the DOM element a locator resolves to may not exist yet when the page object is instantiated.

### Custom fixture system (`src/fixtures/index.ts`)

Never import `test`/`expect` from `@playwright/test` directly in a spec file — always from `src/fixtures/index.ts`. It exports:

- **`adminPage`** / **`restrictedPage`** — the two fixtures nearly every test uses. Both call a shared `createRolePage()` helper that:
  1. Gets a browser context via `AuthManager.getContextForRole(role)` (see below) instead of a raw `storageState`, so an expired session is transparently re-logged-in rather than failing the test.
  2. Attaches `ErrorCollector` listeners (`pageerror`, `console-error`, `requestfailed`, response `>=400`) and a session-expiry listener (401 responses, or a mid-test redirect to `/signIn`) *before* the first navigation, so nothing from the very first page load is missed.
  3. Navigates to the app and races two outcomes — landing on `/sales/` vs. being redirected to sign-in — rather than a single blind `waitForURL`. On a signed-out landing it forces a fresh login and retries once (2 attempts total) before failing loudly with the last-seen URL in the error message.
  4. Dismisses the app's startup popup (`#cancel[data-dismiss="modal"]`) if present.
  5. On CI, staggers `restrictedPage` startup by a random 0–3s to avoid concurrent-session conflicts when multiple workers log in around the same moment.
- **`adminContext`** / **`restrictedContext`** — lighter-weight raw `BrowserContext` fixtures built directly from the saved `storageState` file, with none of the above error-listener/retry machinery. Use these only when a test genuinely doesn't need error capture or session-expiry handling.

### Auth flow and session caching

`src/auth/globalSetup.ts` runs once before the whole suite: logs in both roles, saves `src/auth/storageStates/<env>/<role>.json`, and captures each role's display name to `userNames.json`. During the run, `src/auth/authManager.ts`'s `AuthManager` class:

- Caches session validity **in-memory per role for 30 minutes** (`SESSION_CACHE_MS`), so most tests skip the overhead of re-validating a session that was just checked.
- Uses `withFileLock()` (an `fs.mkdirSync`-based atomic lock) around storage-state writes, so two CI workers racing a re-login don't corrupt each other's write — the actual file write itself is also rename-based (write-to-temp, then atomic rename) rather than a direct in-place overwrite.

### Data factory pattern (`src/data/factories/`)

One factory per module (`leadFactory.ts`, `contactFactory.ts`, `companyFactory.ts`, `dealFactory.ts`, `meetingFactory.ts`, `taskFactory.ts`, `quotationFactory.ts`, `callLogFactory.ts`), each exporting `generateXxxData()` plus RBAC-oriented variants:

- `generateXxxData()` — plain Faker-generated data, used when a restricted user creates their own record (ownership is inherently theirs).
- `generateAdminXxxData()` — prefixed `ADM<timestamp>` — admin-only data.
- `generateSharedXxxData()` — prefixed `SHR<timestamp>` — data the admin creates specifically to then share with the restricted user.

**Why the prefix+timestamp convention exists:** an RBAC test's entire assertion is "restricted user provably cannot see this record unless it's shared with them." Two problems make a plain Faker name insufficient for that: (1) the QA/staging environments never get cleaned up — every module's data accumulates indefinitely — so a search by a generic name can collide with old leftover records from a previous run and produce a false pass; (2) without a distinguishing prefix, there's no cheap way to tell "genuinely admin-owned, never shared" data apart from "shared" data when both need to exist side-by-side in the same test. The `ADM`/`SHR` prefix plus a timestamp makes every run's records uniquely searchable and unambiguously classifiable, which is what makes the negative assertion ("restricted user does NOT see this") trustworthy rather than accidental.

`Country` defaults to `India` in every factory — a hard CRM-side validation requirement, not a test choice.

### Retry / flake mitigation

`config.searchRetry` (per-env retry count + wait) drives every `searchAndOpen*`/`retryFind*` method across modules. Meetings use a separate, longer `config.meetingRetry` because calendar-data aggregation is measurably slower than a plain list search. Page objects must read from these config values — hardcoding a retry count or a `waitForTimeout` loop bypasses the one place retry behavior is tuned per environment.

### Error collection (`src/error-collector/`)

`ErrorCollector` is a singleton attached by the fixtures to every `adminPage`/`restrictedPage`, passively capturing `pageerror`, `console-error` (type `error`), `requestfailed`, and any HTTP response `>= 400` during every test — independent of whether the test itself asserts on anything. `errorFilters.ts` then classifies each captured error into one of three buckets before it's written out:

1. **Noise** — dropped entirely (`isNoise()`): third-party scripts (Grammarly, Sentry, Stripe, font/CDN assets), `HTTP 429` rate-limiting, and `ERR_ABORTED` on a large, individually-enumerated list of background/prefetch endpoints that Playwright's own navigation legitimately cancels mid-flight.
2. **Expected RBAC** (`isExpectedRbacError()`) — HTTP `422`/errorCode `029003`, or specific "you don't have permission" message patterns. This is the CRM correctly denying restricted-user access — expected, but still counted and shown, just not flagged as a regression.
3. **Known background noise** (`isExpectedBackgroundNoise()`) — a **deliberately narrow** subset of endpoints (AI-workflow subscription checks, calendar-integration status, marketplace widgets, tenant usage/feature checks, dashboard summary-card polls, etc.) where a *completed* `4xx`/`5xx` response (not just an aborted one) has been individually confirmed, live, to never correlate with a test failure. Every entity CRUD/detail/search/layout endpoint is deliberately **excluded** from this list — those are load-bearing (page objects wait on their responses), so a real failure there must keep surfacing as unexpected. Widening this list without the same live-evidence bar is exactly the kind of change that could quietly bury a real outage.

Anything not caught by one of the three buckets above is **unexpected** and is what the end-of-run email and `misc-errors.json` report treat as worth investigating.

---

## Project Structure

```
kylas-playwright-framework/
├── .github/
│   ├── scripts/
│   │   └── detect-tests.sh              # Selective test detection for sandbox CI
│   └── workflows/
│       ├── dev.yml                      # push→dev — @smoke, primary for dev
│       ├── qa.yml                       # push→qa — @regression, primary for qa
│       ├── stage.yml                    # push→stage — full suite, primary for stage
│       ├── prod.yml                     # workflow_dispatch only — @prodSafe, manual/emergency (Jenkins.prod is primary)
│       ├── main.yml                     # workflow_dispatch only — @regression, manual/emergency (Jenkins is primary)
│       ├── sandbox.yml                  # push→sandbox — selective, via detect-tests.sh
│       └── staging-promotion-gate.yml   # workflow_dispatch only — gates staging→prod auto-merge
├── config/
│   └── config.ts                        # Single source of truth: env URLs/creds, timeouts, retry config
├── src/
│   ├── auth/
│   │   ├── globalSetup.ts               # Logs in both roles once before the suite
│   │   ├── authManager.ts               # Session cache, cross-process file lock, re-login
│   │   └── storageStates/<env>/         # Saved browser storage states per role (gitignored)
│   ├── core/
│   │   └── BasePage.ts                  # Base class every page object extends
│   ├── data/
│   │   ├── factories/                   # generateXxxData() per module (8 factories)
│   │   └── files/                       # Static fixture files (e.g. upload attachments)
│   ├── error-collector/
│   │   ├── ErrorCollector.ts            # Per-worker singleton — captures + classifies runtime errors
│   │   └── errorFilters.ts              # Noise / RBAC-expected / background-noise pattern lists
│   ├── fixtures/
│   │   └── index.ts                     # adminPage, restrictedPage, adminContext, restrictedContext
│   ├── modules/
│   │   ├── call-logs/CallLogsPage.ts
│   │   ├── companies/CompaniesPage.ts
│   │   ├── contacts/ContactsPage.ts
│   │   ├── dashboard/LoginPage.ts
│   │   ├── deals/DealsPage.ts
│   │   ├── leads/LeadsPage.ts
│   │   ├── meetings/MeetingsPage.ts
│   │   ├── quotations/QuotationsPage.ts
│   │   └── tasks/TasksPage.ts
│   ├── notifications/
│   │   ├── adapters/EmailAdapter.ts
│   │   ├── config/notificationConfig.ts # SMTP settings + per-env/per-branch recipient lists
│   │   ├── scripts/
│   │   │   ├── loadDotEnv.ts
│   │   │   ├── notify.ts                # `npm run notify` — sends the run-summary email
│   │   │   └── syncHistory.ts           # `npm run history:sync` — appends to ci/reporting-history
│   │   ├── EmailTemplate.ts             # HTML email renderer
│   │   ├── NotificationService.ts       # Orchestrates parse → history → email
│   │   └── RunHistory.ts                # Pure logic: append/prune, delta, recurring-flaky detection
│   ├── reporters/
│   │   └── MiscErrorReporter.ts         # Merges per-worker error files → reports/<env>/misc-errors.json
│   └── utils/
│       └── logger.ts                    # logger.info/warn/error/success — never console.log
├── tests/
│   ├── ui/<module>/<module>.spec.ts     # Functional UI tests (adminPage)
│   └── rbac/<module>.rbac.spec.ts       # Permission tests (adminPage + restrictedPage)
├── scripts/
│   ├── reset-sandbox.sh
│   ├── rotate-reports.sh                # Rotates reports/<env>/latest → previous before a local run
│   └── sandbox-deploy.sh                # Resets sandbox branch to dev, merges feature branch, pushes once
├── reports/<env>/{latest,previous}/     # Namespaced Playwright HTML/JSON + Allure output, per environment
├── Jenkinsfile, Jenkinsfile.qa, Jenkinsfile.staging, Jenkinsfile.prod, Jenkinsfile.sandbox
├── playwright.config.ts
├── tsconfig.json
├── CLAUDE.md            # Guidance for AI coding agents working in this repo — canonical code patterns, audit findings
├── CONTRIBUTING.md       # Daily workflow, adding a module, test conventions
├── GIT_WORKFLOW.md       # Branch promotion mechanics (PR chain, golden rules)
└── package.json
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
| `<PREFIX>_ADMIN_DEAL_NAME` / `_RESTRICTED_DEAL_NAME` | Only for some Quotations tests | Quotations are created against a pre-existing deal in the DB; read via `config.deals` |

**Note:** the checked-in `.env.example` currently only lists the `*_DEAL_NAME` variables — it does **not** list `APP_URL`/`API_BASE_URL`/`ADMIN_EMAIL`/etc. for any environment. Don't assume `cp .env.example .env` gives you a complete file; you need to add the credential variables above yourself. (Flagged again in [Known Limitations](#known-limitations--open-items).)

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
ENV=qa npm run test:quotations          # UI only
ENV=qa npm run test:quotations:rbac     # RBAC only, separately
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
npm run report:allure             # generates + opens the Allure report
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

Every test carries at least one tag in its title (`@smoke`, `@regression`, `@prodSafe`); many carry two. Verified counts across the current 259-test suite (tags overlap, so these don't sum to 259):

| Tag | Count | Meaning | Runs on |
|---|---:|---|---|
| `@smoke` | 22 | Navigation/happy-path only — "does the page load and the core flow work" | `dev` branch (every push) |
| `@regression` | 246 | The full functional + RBAC suite | `qa` branch (every push), and manually via `main.yml` |
| `@prodSafe` | 14 | Read-only — safe to run against real production data (no creates/edits/deletes) | `prod` branch (Jenkins primary; `prod.yml` manual fallback) |

`stage` and the base `Jenkinsfile` (for `prod`/`main`) run with **no `--grep` filter at all** — the entire 259-test suite.

---

## CI/CD Pipeline

### Branch flow

```
feature/* → dev → qa → stage → prod → main
     ↑
  sandbox (pre-PR smoke check, cut from dev)
```

Feature branches are cut from `dev`. Before opening a PR into `dev`, push to `sandbox` (`sandbox.yml` selectively runs only what your change plausibly affects). From there, each promotion (`dev→qa→stage→prod→main`) is its own PR — see `GIT_WORKFLOW.md` for the exact branch-cutting/push sequence per hop.

### Per-branch matrix (verified directly against every workflow/Jenkinsfile — CLI `--workers`/`--grep` flags always win over `playwright.config.ts` and any `WORKERS` env var)

| Branch | Primary CI | Trigger | Scope | Workers (actual, from the CLI invocation) |
|---|---|---|---|---|
| `sandbox` | GitHub Actions (`sandbox.yml`) | push | Selective, via `detect-tests.sh`; falls back to `@smoke` with no changed files | Dynamic: 2 if the detected target has >50 tests, else 1. (`Jenkinsfile.sandbox` exists as a manual fallback and always uses 1, regardless of target size — a real, minor divergence from the GHA path.) |
| `dev` | GitHub Actions (`dev.yml`) | push | `@smoke` | 1 |
| `qa` | GitHub Actions (`qa.yml`) | push | `@regression` | 2 (`Jenkinsfile.qa` is explicitly commented "NOT the primary CI for qa branch" — kept only for manual runs, also `--workers=2`) |
| `stage` | GitHub Actions (`stage.yml`) | push (+ manual) | Full suite, no `--grep` | 2 (`Jenkinsfile.staging` is explicitly commented "NOT the primary CI for stage branch" — manual only, also `--workers=2`) |
| `prod` | **Jenkins** (`Jenkinsfile.prod`) | Jenkins: branch push. `prod.yml`: manual only | `@prodSafe` | 2 |
| `main` | **Jenkins** (base `Jenkinsfile`, commented "primary CI for prod and main only") | Jenkins: branch push/manual. `main.yml`: manual only | Full suite (Jenkinsfile) / `@regression` (`main.yml`) | 2 |
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

### Email summary (`npm run notify` → `src/notifications/scripts/notify.ts`)

After (almost) every run, `NotificationService` parses the Playwright JSON report via `ReportParser`, reads `reports/<env>/misc-errors.json`, reads `reports/<env>/history-delta.json` (if present), and renders an HTML email via `EmailTemplate`. It's sent through Gmail/Zoho SMTP (`src/notifications/config/notificationConfig.ts`) to a QA team recipient list, chosen per-branch first, falling back to per-environment.

The email includes:
- Pass/fail/flaky/skipped counts and pass rate, correct wall-clock duration and real start/end time (see the Bug 2A note below).
- A per-module breakdown table.
- Failed and flaky test tables, each with a link to that test's **trace file** — for a flaky test, the link points at the **failing attempt's** trace, not the passing retry (see the trace-linking note below — this is the more useful debugging artifact).
- A background-errors section distinguishing three states per error: unexpected (needs investigation), `✓ Expected RBAC`, and `🔵 Known Background Noise` — see [§2](#architecture--how-its-built)'s error-collection section for what each means.
- A trend section (only rendered when history data exists — see below): a Δ vs. the previous run on this branch, and any test that's been flaky in ≥2 of its last 5 runs ("recurring flaky").

### Run history / trend tracking (`ci/reporting-history` branch)

`npm run history:sync` (`src/notifications/scripts/syncHistory.ts`) maintains a small, append-only, capped ledger of past run stats, so the email can show a trend instead of just one run's numbers in isolation.

**Storage decision:** the ledger lives as a JSONL file on a dedicated, never-merged git branch (`ci/reporting-history`), one branch per environment history — not a database, not a GitHub Actions cache, not an external service. Rationale: it needs to survive across CI runners (rules out local disk/cache), needs no new infrastructure or secret to provision (rules out a database), and a plain-text, human-readable, git-diffable ledger is easy to inspect/debug directly (`git show ci/reporting-history:reports/qa/history.jsonl`) without any tooling. The branch is capped at `MAX_RECORDS_PER_ENV = 100` (oldest records pruned on write) so it never grows unbounded.

**Concurrent-write handling:** two CI runs finishing around the same time will race to push to `ci/reporting-history`. The retry loop is **fetch + `reset --hard` + recompute the delta/append fresh** on each retry attempt — not a rebase. A rebase was tried first and was dropped after it demonstrably produced real, unresolvable merge conflicts on the plain-text ledger when two pushes landed close together; reset-and-recompute never conflicts because it never tries to replay a diff.

"Recurring flaky" means: this test has been marked `flaky` (failed at least once, then passed on Playwright's own retry) in at least 2 of its last 5 recorded runs on this branch (`RECURRING_FLAKY_LOOKBACK = 5`, `RECURRING_FLAKY_THRESHOLD = 2`).

### Background-error report (`reports/<env>/misc-errors.json`)

Each Playwright worker process runs its own `ErrorCollector` instance and writes its own `misc-errors-worker-<N>.json` (namespaced by env and worker index specifically to survive two workers, or two concurrent cross-environment runs, writing at once without clobbering each other). `MiscErrorReporter` (a Playwright reporter, wired into `playwright.config.ts`) merges all worker files into the final `reports/<env>/misc-errors.json` once the run ends, and prints a terminal summary tagging each error `[Expected RBAC]` / `[Known background noise]` / neither.

### Trace files

Every failure retains a Playwright trace (`trace: 'retain-on-failure'` in `playwright.config.ts`), plus a screenshot and video. `ReportParser` reads the trace path straight out of Playwright's own JSON report `attachments` array and converts it to a repo-relative path, so the link in the email still means something after the CI runner that produced it is gone — it matches what you'll find inside the downloaded `test-results` artifact zip.

---

## RBAC Testing Philosophy

Every module (except Dashboard/Login) has a paired `tests/rbac/<module>.rbac.spec.ts` alongside its `tests/ui/<module>/<module>.spec.ts`. RBAC tests use **both** `adminPage` and `restrictedPage` fixtures together, exercising the same CRM feature from two permission levels in one test:

- **"Playwright Automation"** (`adminPage`) — full-access user, can create/see/edit anything.
- **"User 1"** (`restrictedPage`) — limited-access user, whose visibility into admin-owned records is exactly what's under test.

The core pattern in nearly every RBAC test: admin creates a record with `generateAdminXxxData()` (guaranteed invisible to the restricted user, by the `ADM`-prefix convention explained in [§2](#architecture--how-its-built)), then the test asserts the restricted user genuinely cannot see it — not "the element wasn't visible," but a real absence check that can't be confused with a slow/broken page (per CLAUDE.md's audit rule: never `if (visible) {assert} else {logger.success('...correct RBAC')}` — that pattern silently converts "the page failed to load" into a false pass).

The other half of RBAC coverage is the **share/reassign/clone** family: admin explicitly shares (or reassigns, or clones) a record to/for the restricted user with a specific permission set (`update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`), and the test verifies the restricted user can now do exactly what was granted — no more, no less. These tests assume real propagation lag between the share action and the permission taking effect server-side — they poll/retry on a transient 403 rather than sleep-and-hope, and they still fail loudly on a permission that never arrives.

RBAC-expected errors (403s, 422/`029003`) are captured by `ErrorCollector` like any other error but classified `expectedReason: 'rbac'` (see [§2](#architecture--how-its-built)) — they show up in reports as confirmation the permission boundary is being enforced, not as noise to filter out and not as a regression to chase.

---

## Known Limitations / Open Items

Cross-checked against `CLAUDE.md`'s own audit notes and this session's fixes — this list reflects what's true **today**, not a stale carry-over.

- **`.env.example` is incomplete.** It currently only ships the Quotations `*_DEAL_NAME` variables — no `APP_URL`/`API_BASE_URL`/`ADMIN_EMAIL`/etc. for any environment. A first-time `cp .env.example .env` will not produce a working file; see [Getting Started](#getting-started) for the actual required variable list.
- **No cross-browser coverage in CI.** `firefox`/`webkit`/`mobile-chrome` are configured for local runs only; every CI pipeline runs `chromium` exclusively.
- **`Jenkinsfile.sandbox`'s worker count (always 1) diverges from `sandbox.yml`'s dynamic 1–2** — a minor, currently-harmless inconsistency between the GHA path (primary) and the Jenkins manual fallback for the same branch.
- **Two CI paths cover different scope for `main`:** the base `Jenkinsfile` (primary, branch-triggered) runs the full suite with no `--grep`; `main.yml` (manual-only fallback) filters to `@regression` only. They are not equivalent runs.
- **Deals has zero `@prodSafe` tests** — the `prod` pipeline currently has no coverage at all for the Deals module.
- **No scheduled/nightly runs exist anywhere** — every pipeline is push- or manually-triggered only.
- **No cross-environment (QA/staging/prod) data-parity check exists.**
- **QA/staging data grows unboundedly** — no module cleans up the records it creates, so search/list operations get measurably slower over the life of the environment. Retry budgets in `config.searchRetry` account for this, but it's a standing tax on every run, not a one-time cost.
- **A confirmed, unresolved app-level flake in Deals** (investigated 2026-07-06, no confirmed mechanism found across six controlled experiments): logging a Call on a deal shared with the restricted user intermittently fails with a permission error even when contact/company sharing is verified correct via screenshots. Two later-discovered client-side bugs (a substring-match contact-selector bug, and `DealsPage.fillDealForm()`'s random associated-contact/company picker) could have contaminated the original six experiments without being visible at the time, so the "no consistent mechanism" conclusion is downgraded to uncertain, not disproven. Full history and every experiment's evidence: see `CLAUDE.md`'s "Known Issues" section. Real fix requires backend/network-level access this suite doesn't have — do not re-attempt a client-side isolation without it.
- **`DealsPage.fillDealForm()`'s associated contact/company selection is intentionally randomized**, as a deliberate 2026-07-05 fix for a CI-hang/timeout problem in that picker — not a bug. For any new Deals test where the associated contact/company's *specific identity* matters (sharing, reassigning, ownership-dependent actions), pass `associatedContactName`/`associatedCompanyName` on `DealData` to select a known, freshly-created entity by exact name instead. Passing neither preserves the original random-pick behavior.
- **Recently built, not yet proven under a real live CI run at the time of writing:** the P0–P5 reporting overhaul (tiered error classification, run-history/trend tracking, trace-linking fixes, the `staging-promotion-gate.yml` rename) and the two sandbox-CI bug fixes (`tsconfig.json`'s `"types": ["node"]` fix for `ts-node`'s intermittent `@types/node` resolution failure; the `createRolePage()` browser-context leak fix) were all verified via isolated local execution and real (non-push) script runs, but not yet exercised end-to-end by an actual CI pipeline run against real GitHub/Jenkins infrastructure. Treat the very first live CI run after this work lands as still partially a verification step, not a routine run.
- **A related, deliberately unresolved architectural question:** whether long CI jobs (`qa`/`stage`, ~220+ tests on 2 workers) should be split into parallel shards is flagged but intentionally not implemented — it was raised while investigating a browser-context resource-exhaustion incident, but splitting job topology is a bigger, separate decision than the incident's actual fix warranted.
- **`SETUP.md` is legacy and describes an older, now-superseded version of this framework** (a single `playwright.yml`, a `develop`/`main`-only branch model, one `leadFactory.ts`, no error-collector or reporting system). It predates the current `dev→qa→stage→prod→main` pipeline and the multi-module suite described in this README. Prefer this README, `GIT_WORKFLOW.md`, and `CLAUDE.md` over `SETUP.md` for anything current.

---

## Contributing / Adding a New Module

Full daily-workflow and branch-promotion mechanics live in `CONTRIBUTING.md` and `GIT_WORKFLOW.md` — this is the module-specific checklist:

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
The fixtures already attempt one automatic re-login on a detected sign-in redirect before failing — if you're seeing this, it's a genuine second failure, not the first.

**`Target page, context or browser has been closed`** — investigated as part of a real sandbox CI incident. A confirmed resource leak in `createRolePage()` (a throw-before-`use()` path that skipped context/page cleanup) was found and fixed, but was *not* proven to be the direct cause of any single reported incident — only proven to be a real leak that could contribute over a long run. If you see this consistently (not once in a long run), it's worth re-opening the investigation with real evidence, not assuming the existing fix already covers it.

**`ts-node` script fails to compile with a `TS2591` (`Cannot find name 'process'`, etc.) error, but `tsc --noEmit` on the same file passes** — this exact class of bug was root-caused live: `ts-node`'s default per-file compilation only auto-discovers `@types/node` if the entry file's own import graph happens to reach into `node_modules`; a shallow/pure-logic script can silently fail to get Node's global types. Fixed at the project level via `tsconfig.json`'s `"types": ["node"]` — if you hit this again, check that setting hasn't been reverted before re-diagnosing from scratch. Also: verifying a standalone script with `ts-node --transpile-only` is not sufficient — it skips type-checking entirely and will not catch this class of bug. Verify with a real, non-transpile-only run.

**`git clone <remote-name> .` fails** — `git clone` needs a URL, not a remote name. Use `git remote get-url origin` first if you need to resolve the actual URL programmatically (see `resolveGitRemoteUrl()` in `syncHistory.ts` for the canonical pattern).

**Email report shows a wildly wrong duration or a start time that looks like an end time** — this exact bug existed and was fixed: summing every individual test's duration double-counts overlapping time under parallel workers, and Playwright's JSON report has no top-level `startTime` (only `stats.startTime`). `ReportParser.ts` now reads `raw.stats.duration`/`raw.stats.startTime` directly. If you see this again, something has regressed that fix — it was verified against real production data to the exact second, not guessed.

**Flaky test's trace link in the email points at a passing run, not the failure** — also a fixed, previously-real bug: for a flaky test, Playwright's `lastResult` is the passing retry, which has no trace (`retain-on-failure` only keeps failed-attempt traces). `ReportParser.ts` now sources the trace from the last **non-passing** attempt for flaky tests specifically.

**Clone lead/contact form shows validation errors on save** — clone pre-fills the form with the original's email/phone; you must change at least one before saving to avoid a duplicate-value rejection. See the Clone pattern in `CLAUDE.md`'s Reference Patterns.

**`saveQuickTask()` hangs or times out when called from within a Lead/Contact detail panel** — use `saveQuickTaskFromEntityDetail()` instead; `saveQuickTask()` waits for the standalone task list view, which never appears from that context. (A live instance of exactly this bug exists today at `tests/rbac/leads.rbac.spec.ts:199` — see `CLAUDE.md`'s Tasks module audit note.)

**Push rejected (`fetch first` / `non-fast-forward`)**
```bash
git pull origin <branch-name> --rebase
git push origin <branch-name>
```

For anything not covered here, `CLAUDE.md`'s "Audit Findings Summary" has a much deeper per-module list of known flakiness root causes and the locator/wait patterns proven to fix them — read it before touching any page object, fixture, or CI file.
