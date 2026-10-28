# CI Pipelines — Resolved History

> **Purpose:** Resolved incidents about Jenkins/GitHub Actions pipeline behaviour: timeouts, test selection, duration estimates, fixture-setup navigation, deadline-aware waits, load signals.
> **Read when:** Editing a `Jenkinsfile*`/workflow, `src/fixtures/index.ts` fixture setup, `BasePage.waitForEntityListPage()` timing, or `src/notifications/scripts/estimateDuration.ts`.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-28 @ 566df8c

Sharding and lock history is in `docs/known-issues/sharding-and-locks.md`. Real Jenkins/GitHub execution of several items below could not be performed from the authoring environment; the ones marked **unverified** need a real run.

### Jenkins approval "24 h" timeout lasted up to 62.9 h: the host suspended — 2026-10-28
- **Symptom:** `main` #13 sat at the Approval Gate from 2026-10-20 17:56:50Z ("Timeout set to expire in 1 day 0 hr") and ended "Timeout has been exceeded" at 2026-10-23 08:49:52Z (3,773 min, +38.9 h). `prod` #14, parked at 18:00Z, ended with the same duration. `main` #10 (+1.3 h) and #12 (+3.1 h) also overran.
- **Root cause:** the Jenkins host is a laptop that suspends. `journalctl` shows 38.8 h of suspend inside #13's 24 h window (0.3 h, 2.4 h and 36.1 h on 10-21 to 10-23); #10 and #12 fit within 0.3 h. Jenkins' `timeout` does not count suspended time (the likely mechanism, JVM timers that do not tick during suspend, was not verified in Jenkins' code). Not a Jenkinsfile bug: the `timeout(time: 24, unit: 'HOURS')` is correct.
- **Fix:** sleep was disabled on the host on 2026-10-28 (done by the maintainer, [RUNBOOK](../RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 1; not checkable from the repo; the laptop must stay plugged in); the approval steps of the base `Jenkinsfile`, `Jenkinsfile.prod` and `Jenkinsfile.staging` now log a wall-clock stamp before `input` and the real age after it (also when the timeout fires), so a stretched wait is visible. Still to confirm: the stamps on the next real approval ([KI-45](../KNOWN_ISSUES_ACTIVE.md)).
- **Revert:** remove the `wallClockEpoch()`/`wallClockStamp()` logging; `systemctl unmask` the sleep targets.
- **Commit:** `0f87be3`.

### Jenkins pipeline-wide timeout drifted from the test count — 2026-09-09
- **Symptom:** The root `Jenkinsfile` (primary CI for `prod`/`main`) would be killed mid-run; the pipeline-wide `options { timeout(...) }` was hand-bumped (60→150→300 min) each time the suite grew, while `Run Tests` computed its own inner timeout from the test count. A slow `Approval Gate` also consumed the test run's budget.
- **Root cause:** One global timeout covering every stage, kept in sync by hand. A dynamic value in `options{}` is impossible (evaluated before any stage); `Math.ceil(BigDecimal)` is blocked by Jenkins' Groovy sandbox (`ea92ef6`).
- **Fix:** Per-stage scoped timeouts (Checkout, Install, Setup, Clear Auth State, Detect Tests, Approval Gate 24h decoupled); `Run Tests` keeps its dynamic formula and alone bounds test execution; the global `options{}` timeout is a 48h last-resort backstop. Verified by lint and manual trace only. **Unverified:** a first real Jenkins run should show each per-stage timeout enforcing.
- **Revert:** Restore the single `options { timeout(...) }` in `Jenkinsfile`.
- **Commit:** `276d82f`.

### Jenkinsfile ignored the branch for test selection — 2026-09-04
- **Symptom:** `dev`, `qa` and `sandbox` ran the full suite on Jenkins for ~2 months instead of `@smoke` / `@regression` / selective scope.
- **Root cause:** Only `isProd = env.BRANCH_NAME == 'prod'` was branch-conditional; everything else fell through to unfiltered. `sandbox`'s computed `detect-tests.sh` output was never consumed.
- **Fix:** An if/else-if chain mirroring each GitHub workflow: `dev`→`@smoke`, `qa`→`@regression`, `prod`→`@prodSafe`, `sandbox`→detected target (defensive `@smoke` fallback), `stage`/`main`→full suite. Test-selection only; workers/timeout untouched.
- **Revert:** Revert the `testFilter` chain in `Jenkinsfile`.
- **Commit:** `09989be`. **Unverified:** a manual Jenkins run on `dev` (confirm `@smoke`) and `qa` (confirm `@regression`).

### Duration estimate replaced hard-coded comments — 2026-09-04
- **Symptom:** Workflow/Jenkinsfile duration comments were hand-typed and wrong; Jenkins `history:sync` had never authenticated.
- **Root cause:** No data-driven estimate; no credential bound for Jenkins' history push (same class as the GitHub ledger bug).
- **Fix:** `computeDurationEstimate()` (`src/notifications/RunHistory.ts`, `npm run estimate-duration`) averages only matching `branch`+`workers` history records and says "insufficient history" rather than guessing; `RunHistoryRecord.workers` is optional (backward-compatible). Jenkinsfiles bind a `github-credentials` Username/Password via `usernamePassword()`, never string-interpolated. A hard-coded `ENV=prod` in the main `Jenkinsfile` call was removed before any run. Read-only check of `origin/ci/reporting-history` shows `runSource:"jenkins"` records for prod and qa, so credential wiring works for those two; staging had none locally (**unverified**, local ref may be stale).
- **Revert:** Remove the `estimate-duration` steps and credential bindings.
- **Commit:** `09989be`.

### Fixture-setup navigation had no bucket for a third landing — 2026-09-09
- **Symptom:** `leads.rbac.spec.ts` ellipsis tests failed with `admin page failed to reach the app's /sales/ area … current URL: ***/setup` (same signature 8× across 3 of 4 shards, 6 self-recovered via retry).
- **Root cause:** `navigateAndConfirmLoggedIn()` raced only `/sales/` vs `/signIn`; anything else became `'timeout'` and triggered an expensive full re-login that does not address the cause (the app resumes the shared account's last-visited section, e.g. a Products & Services test navigating `/setup/...` on another shard).
- **Fix:** `NavOutcome` is `'sales' | 'signIn' | 'wrongPage' | 'timeout'`; classification order: URL race, `isSessionExpiryPage()` (catches the Forbidden bootstrap page), then any other same-origin landing → `'wrongPage'` → cheap in-place re-navigation with no re-login. Since the 2026-09-21 follow-up the retry forces a specific target, `${config.appUrl}/sales/home` (`src/fixtures/index.ts` ~458-474), because a bare re-navigation was proven insufficient for a stable "resume last visited section" state. Generic, not enumerated to `/setup`.
- **Revert:** Revert the `wrongPage` branch in `src/fixtures/index.ts`.
- **Commit:** `e8529d6`.

### Ellipsis menu closed by a second click — 2026-09-09
- **Symptom:** After the fix above, the same tests failed with a pure `.dropdown-menu.show` 5000ms timeout.
- **Root cause:** `openEllipsisMenu()` (Leads/Deals/Contacts/Companies) clicked a Bootstrap `dropdown-toggle` unconditionally, so a second call closed the open menu. A page-wide `.dropdown-menu.show` check was rejected: Leads' detail page has a second dropdown (`.dropdown-menu.closed-stage-list`).
- **Fix:** Click only if the button's own `aria-expanded` is not `'true'` (`ellipsisButton().getAttribute('aria-expanded')`), in all four modules.
- **Revert:** Revert `openEllipsisMenu()` in the four page objects.
- **Commit:** `e8529d6`.

### Quotation report entity type not deployed to stage/prod — 2026-09-09
- **Symptom:** Two Reports tests (`reports.spec.ts` and `reports.rbac.spec.ts`, "quotation report count matches") timed out (`locator.waitFor: Timeout 10000ms exceeded`; the retry showed `Timeout 15000ms exceeded waiting for locator('#editEntityModal')`) waiting for a `Quotation` option in the Entity Type dropdown on prod; identical retries failed identically while the same tests passed on QA.
- **Root cause:** The feature existed on QA only — an environment gap, not a flake and not a Quotations-module issue. **UNVERIFIED (re-check per rule 20):** `ReportsPage.ts` contradicts itself. The comment above its endpoint map (~line 103) says Quotation reports were "confirmed deployed to stage/prod 2026-09-03", while `skipIfQuotationEntityTypeUnavailable()` (~line 929) still says "confirmed QA-only as of 2026-09-09". The prod failure in the symptom is the evidence for the 09-09 wording; nothing in the repo shows which statement holds today. Same note in [reports-module.md](./reports-module.md) and KI-33.
- **Fix:** `ReportsPage.skipIfQuotationEntityTypeUnavailable()` reads the live Entity Type option list and `test.skip()`s with a reason when absent — self-healing the moment the feature ships (no static env-name check; same convention as `BasePage.skipDedicatedCustomFieldTestIfAbsent()` and the per-module `skipIfCustomFieldsAbsent()` wrappers). Only those two tests use the entity type (grep-confirmed).
- **Revert:** Remove the first-statement call in both tests.
- **Commit:** `6184a11`.

### `browser.newContext()` Protocol error and fixture budget — 2026-08-26
- **Symptom:** A thrown CDP Protocol error in fixture setup, then (follow-up run) Tasks RBAC killed by CI's 120s test timeout during recovery.
- **Root cause:** Protocol error cause NOT confirmed (one occurrence, resource-pressure-consistent) — left unhardened per rule 10. Real structural gaps: `createRolePage()`'s recovery login had no try/catch (only 1 of 2 intended attempts), and `navigateAndConfirmLoggedIn()`'s legitimate worst case can exceed a 120s test timeout.
- **Fix:** try/catch around the recovery login; deadline-aware setup — deadline = `Date.now() + testInfo.timeout * 0.85`, waits capped at `min(nominal, timeRemaining)`, fail fast with a diagnostic when the remaining budget cannot support another attempt (a static +120000ms pad was rejected as environment-specific).
- **Revert:** Revert the deadline logic in `src/fixtures/index.ts`.
- **Commit:** `aefd527`.

### `waitForEntityListPage()` could outlive the test timeout (`PS6`) — 2026-09-30
- **Symptom:** `productsAndServices.rbac.spec.ts` `PS6` failed identically twice with `page.reload: Target page, context or browser has been closed` after "list table not visible within 120000ms … reloading and retrying once".
- **Root cause:** `PS6` alone lacked `test.setTimeout(480000)`, so CI's 120000ms default governed while `NAVIGATION_TIMEOUT: 120000` made the method's own waits sum to more; Playwright's outer timeout fired mid-recovery. Not caused by more concurrent jobs (each runs on its own VM).
- **Fix:** Added the missing `test.setTimeout(480000)`; `BasePage.waitForEntityListPage()` is now deadline-aware (0.85 × `test.info().timeout`, each wait floored at 5000ms because `timeout: 0` means wait forever, fail fast under 15000ms remaining). The race has since gained a third signal, the app's 429 "Too many requests" page (`RATE_LIMIT_PAGE_PATTERN`, 2026-10-16); the deadline arithmetic is unchanged.
- **Revert:** Revert the deadline arithmetic in `waitForEntityListPage()`.
- **Commit:** `3d58073`.

### Load signals per CI job are measured — 2026-10-06
- **Symptom:** No evidence whether sequencing formFields after core shards reduced backend pressure.
- **Root cause:** Recovery events (429 page, "Something is broken" page, `globalSetup` retries) were not counted anywhere.
- **Fix:** `ErrorCollector.recordRecoveryEvent()` → worker file → `MiscErrorReporter` merge → `scripts/merge-misc-errors.ts` (attributes by shard artifact directory) → `JobStats.buildJobRecoveryRows()` → "Load Signals by Job" table in the email. Main-process events use `recovery-events-main.json` because `onBegin()` deletes worker files after `globalSetup`.
- **Revert:** Remove the three `recordRecoveryEvent` call sites and `resetMainProcessRecoveryEvents()`.
- **Commit:** `1bd03cc`.

### `deals.rbac.spec.ts` very long single test, GitHub log viewer freeze — 2026-08/09
- **Symptom:** A Deals RBAC test took ~243s; GitHub's web log viewer looked frozen on a long run.
- **Root cause:** Neither a defect. 243s is the documented ~190s ceiling of chained `waitForEntityListPage()`/detail navigations working as designed; the viewer is a UI limitation (raw log via `gh run view --log` kept writing).
- **Fix:** None. Pull the raw log before concluding a CI run hung.
- **Revert:** n/a.
- **Commit:** n/a — no change.

### Repo hygiene detail (detail for KNOWN_ISSUES_ACTIVE.md KI-26, which stays open there) — 2026-10-09
- **Status:** open · **What:** `.env.example` is gitignored and never committed, so a fresh clone has no credential template (the README lists the real required variables; the local file only holds dead `*_DEAL_NAME` entries); `.eslintrc.json` is a legacy config never read by `npm run lint` (`eslint.config.js` is active); pre-existing prettier drift in `LeadsPage.ts` and `BasePage.ts` (`npx prettier --check` 2026-10-27; `QuotationsPage.ts` is clean); `.claude/settings.json` carries an inert `agent_delegation` / `investigation_log` block whose `INVESTIGATION_LOG.md` does not exist. <!-- ref-ok -->
