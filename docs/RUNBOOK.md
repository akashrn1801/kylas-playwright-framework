# CI Failure Runbook

> **Purpose:** Symptom → likely cause → first check → where it is documented, for failures seen in this repo's CI and local runs.
> **Read when:** A CI run or local run failed and you need to know whether it is a code bug, an app bug, an environment effect or a pipeline problem.
> **Size budget:** 40k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Every row comes from a real incident. "Documented" links point at the resolved-history topic file; open items are in [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md). Check that first: your failure may already be a tracked open item.

## First five minutes

1. **Get the raw log, not the web viewer.** `gh run view <run-id> --log > run.log`. The Actions web viewer can appear frozen on a long, high-volume run while the raw log keeps writing.
2. **Find the first failing test, not the retry's error.** In a failing test's output the attempt-1 error is the cause; the retry error is often a downstream symptom. In the JSON report `results[].errors[]` (plural) can hold a more useful message than the singular `error`.
3. **Check `misc-errors.json`** (`reports/<env>/misc-errors.json`, per-shard artifact `misc-errors-<env>-<shard>`): unexpected 4xx/5xx, `pageerror`, and the app's own JS errors near the failure time. It is overwritten by every later run in the same environment; copy it first.
4. **Open the trace** (`test-results` artifact, `trace.zip`) or the failure screenshot. Several classes below are only identifiable from the screenshot (the 429 page, the error-boundary page).
5. **Classify before fixing.** Application bug vs code bug, per the `failure-triage-investigator` convention ([agent guide](../.claude/AGENT_DELEGATION_GUIDE.md)). Never conclude "app bug" from headless evidence alone; verify live and headed. Never call a flake fixed from one passing run: re-run 3-5 times in isolation. A flake that vanishes in isolation can still be real under CI concurrency.
6. A message in a log is not evidence. Read the real error text (git stderr, HTTP body) it claims to summarize.

## Triage table

### Pipeline and infrastructure

| Symptom | Likely cause | First check | Documented |
|---|---|---|---|
| Job killed at ~6h, annotation "exceeded the maximum execution time of 6h0m0s" | GitHub's hard per-job ceiling; `timeout-minutes` above 360 is ignored | Is the run sharded? Did a core change escalate `sandbox.yml` to `@regression`? | [sharding-and-locks](./known-issues/sharding-and-locks.md) |
| Email headline "No Tests Executed", or a run shows passed with zero executed | Stale `results.json` from a `--list` probe read after a cancel | Run finished or was cancelled? `ReportParser` emits `no-tests-executed` | [reporting-and-notifications](./known-issues/reporting-and-notifications.md) |
| "Suite Drift Detected" banner on a clean run | Compared against a different branch/scope record in the env-keyed ledger (fixed: same branch + scope required) | First run per branch+scope has no comparable prior; real drift means a total decrease within the same scope | [reporting-and-notifications](./known-issues/reporting-and-notifications.md) |
| Notification trend/recurring-flaky sections empty | `ci/reporting-history` has no records or the push failed | `git fetch origin ci/reporting-history`; look for `history/<env>.jsonl`; read the real git stderr in `history:sync` output | [reporting-and-notifications](./known-issues/reporting-and-notifications.md) |
| "Related history" link in the email 404s | Link is `blob/<sha>/<file>#L<line>` of the run's commit | Did the file exist at that commit? | [REPORTING.md](./REPORTING.md) |
| Email carries "STALE REPORT" subject prefix | `results.json` older than the stale threshold (hours) | Was a fresh run actually produced? Check `report.endTime` | [REPORTING.md](./REPORTING.md) |
| Retry count looks wildly larger than failure count | A `.serial` block retries the whole block, re-running tests that already passed | Which file is serial? One real failure triggers N retried tests | [sharding-and-locks](./known-issues/sharding-and-locks.md) |
| A shard fails in `globalSetup` with HTTP 429 on `/products/layout`, currencies or `POST /products` | Too many concurrent `globalSetup`s on one backend | Count of jobs starting together; `withTransientRetry()` retries 429/5xx only | [rate-limits-and-error-pages](./known-issues/rate-limits-and-error-pages.md) |
| `globalSetup` HTTP 400 on `GET /products/layout?view=create` (staging) | Open, unexplained | Is it 400 (not retried) or 429? Re-run once; note concurrent stage/sandbox runs | [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md) |
| Jenkins stage times out / run killed | Per-stage timeouts, `Approval Gate` 24h wait, dynamic `Run Tests` timeout | Which stage's own timeout fired? Approval wait no longer shares the test budget | [ci-pipelines](./known-issues/ci-pipelines.md) |
| Jenkins webhook returns 502 on every delivery | Tunnel (ngrok) expired | Redeliver after restoring the tunnel | [ci-pipelines](./known-issues/ci-pipelines.md) |
| Wrong tests ran for a branch in Jenkins | Branch-to-test-selection chain | Console log's `testFilter` | [ci-pipelines](./known-issues/ci-pipelines.md) |
| Everything on one shard fails together, other shards green | Shared-state suite split across shards, or a backend blip | Are two files of one shared-config suite on different shards? Static-asset 503 on the app bundle | [sharding-and-locks](./known-issues/sharding-and-locks.md) |

### Application page states

| Symptom | Likely cause | First check | Documented |
|---|---|---|---|
| Timeout waiting for a normal element; screenshot shows "Whoa! Too many requests at once!" | The app's HTTP-429 page replaced the screen under CI load | Screenshot. Is the call site wrapped in `withRateLimitRecovery()`? A sustained window defeats a plain reload, so a longer timeout will not help | [rate-limits-and-error-pages](./known-issues/rate-limits-and-error-pages.md) |
| Screenshot shows "Something is broken here" (card-scoped or whole `#app`) | Frontend error boundary swallowed a component failure | Same wrapper; the app's own failure cause is not established | [rate-limits-and-error-pages](./known-issues/rate-limits-and-error-pages.md) |
| Fixture setup error: landed on `/setup/...` instead of `/sales/` | App resumes the last visited section for the shared account; another worker navigated `/setup` | `navigateAndConfirmLoggedIn()` classifies `wrongPage` and re-navigates without re-login | [rate-limits-and-error-pages](./known-issues/rate-limits-and-error-pages.md) |
| Redirected to `/signIn`, or a "Forbidden" page with unchanged URL | Session expiry, two distinct symptoms | `authManager.isSessionExpiryPage()`; a new raw assertion not wrapped in `withSessionExpiryRecovery()`? | [session-expiry-and-auth](./known-issues/session-expiry-and-auth.md) |
| Repeated re-login "succeeds" then redirects to `/signIn` within seconds | Suspected cross-worker shared-credential-file collision; unconfirmed | Count `Creating authenticated browser context` lines per minute in the log | [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md) |
| `Target page, context or browser has been closed` | Playwright's outer test timeout fired mid-recovery (a missing `test.setTimeout`), or fixture teardown | The test's own timeout vs `NAVIGATION_TIMEOUT` (CI default test timeout is shorter than local) | [locators-and-timing](./known-issues/locators-and-timing.md) |
| Client-side `TypeError ... reading 'content'` in `openCallLogForm` | Real Kylas app bug under concurrent access | `APPLICATION_BUGS.md` #1; the page object already reload-retries | [APPLICATION_BUGS.md](../APPLICATION_BUGS.md) |
| Report creation fails once with HTTP 500 `01403004` for Meeting reports | Real backend defect; immediate retry succeeds | `createReport()` retries that signature once | [reports-module](./known-issues/reports-module.md) |

### Test-level symptoms

| Symptom | Likely cause | First check | Documented |
|---|---|---|---|
| "Save button click resolved but no create request was observed within 4000ms", retried 3x identically | Client-side validation block: a still-active Min/Max or Regex setting left by another test makes the filled value invalid, so no request fires | What did the last field-config call leave behind? Does the filled value satisfy it? Not a backend or timing bug | [form-fields](./known-issues/form-fields.md) |
| formFields test fails on a disabled Min-Length input or a wrong Regex label | Shared account-wide field config mutated by a test in a different file/shard | Are UI and RBAC files of that entity on one shard? Lock heartbeat | [form-fields](./known-issues/form-fields.md), [ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md) |
| A test hangs for minutes with no error | Unbounded click/wait, or shared lock acquisition starving | The lock files under `.locks/`; a missing `test.setTimeout(480000)` | [sharding-and-locks](./known-issues/sharding-and-locks.md) |
| "ID not captured after save" / `waitForResponse` timeout | Unversioned ID-capture predicate matched an unrelated request, or session expired mid-wait | Predicate must match `/v1/<module>/` and exclude `/reports/`; use `armResponseWaitWithRecovery()` | [locators-and-timing](./known-issues/locators-and-timing.md) |
| Ellipsis menu item never visible | Second `openEllipsisMenu()` call toggled an open Bootstrap menu shut | The menu button's `aria-expanded` | [locators-and-timing](./known-issues/locators-and-timing.md) |
| Dropdown option click hangs or reports zero options | Unbounded random pick, or the search term not discriminating the target. "Index lag" has been wrong twice | Use `selectRandomOptionWithRetry()`; is the search term specific? | [locators-and-timing](./known-issues/locators-and-timing.md) |
| React-select menu closes before the click lands | Third-party chat widget re-render 20-160ms after open | Stability-window retry pattern (`PATTERNS.md`) | [locators-and-timing](./known-issues/locators-and-timing.md), [PATTERNS.md](./PATTERNS.md) |
| Tests asserting "Quotation" as a Reports entity type fail on stage/prod only | Feature deployed to QA only | The two Reports tests presence-check and skip | [reports-module](./known-issues/reports-module.md) |
| A Hide-Empty-Fields Quotations auto-reveal test takes ~6 min | Unexplained timing outlier | Needs a trace | [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md) |
| `quotations.spec.ts` whole file re-runs after one failure | `.serial` mode by design | Not a merge/shard bug | [sharding-and-locks](./known-issues/sharding-and-locks.md) |
| Flake that passes in isolation | Possibly concurrency-only | Rule 21: harden defensively, label it unconfirmed, or log it as inconclusive; never dismiss | [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md) |

## Local-run problems

| Symptom | Fix / check |
|---|---|
| `Missing required environment variable: X` | The active `ENV`'s variables are incomplete in `.env` (see [README](../README.md#quick-start)) |
| Auth errors mid-run on QA | `rm -rf src/auth/storageStates/qa/` forces a fresh login |
| `ts-node` script fails `TS2591` while `tsc --noEmit` passes | `tsconfig.json`'s `"types": ["node"]` was reverted; `--transpile-only` hides this class |
| `npm run test:<m> -- <args>` ignores your flags | Args attach to the last `&&` command (`npm run notify`). Use `npx playwright test <paths> <flags>` |
| Clone lead/contact form rejects save | Change email/phone: clone pre-fills the originals |
| `saveQuickTask()` hangs from an entity detail panel | Use `saveQuickTaskFromEntityDetail()` |
| Docs numbers look stale | `npm run docs:refresh`, then `npm run check:docs` |

## When it is an app bug

Confirmed real Kylas bugs live in [APPLICATION_BUGS.md](../APPLICATION_BUGS.md), not in the engineering docs. A test stays red for a real app bug; do not mask it. Add a new confirmed one there with live evidence.
