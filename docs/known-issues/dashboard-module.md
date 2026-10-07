# Dashboard Module — Resolved History and Durable Findings

> **Purpose:** Confirmed behavior and resolved incidents for the Dashboard module (dashboards, dashlets, Add-Dashlet wizard).
> **Read when:** touching `DashboardPage.ts`, `dashboard*.spec.ts`, or adding a dashlet/dashboard test.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Open items — the DB33/DB36 render race and the stuck-dashlet symptom — are [KI-05](../KNOWN_ISSUES_ACTIVE.md). Dashboard follows the standard module pattern with no structural deviation.

## Durable facts

1. **Add-Dashlet wizard** (`#dashlet-wizard`, 3 steps: type → configure → preview). Smartlist and Grouped Smartlists offer lead/deal/contact/company/email; Report offers lead/deal/contact/company/task/meeting/call (never email), so Call Log dashlets exist only as Report type.
2. **Report dashlets depend on the Reports module**: Step 2 lists your own saved Reports for that entity type (`POST /v3/reports/search?...`). Create a disposable Report first and select it by exact name.
3. **Step 2 inputs**: Grouped Smartlists is a real multi-select (checkboxes), Smartlist/Report are single-select (radios); the real option name is in a sibling `.col` div, not the label or input. The app enforces no cap; the suite's own 2–4 range is a test-design choice. A Grouped Smartlists header is always the literal "Grouped Smartlists" — identify a dashlet by a selected row name.
4. **Entity sections** (`id="{entity}_section"`) are created on an entity's first dashlet; different entities never merge.
5. **Collapse/expand state is account-persisted** (survives reload); edit mode disables it.
6. **A fresh load always lands on the PRIMARY dashboard**; "persists after reload" checks on another dashboard must re-select it from the switcher.
7. **Edit-mode Cancel always opens a "Discard Dashboard" modal**, even with zero changes. Dashboard Name has no stable selector except `.dashboard-name input`.
8. **Restricted users cannot mark "Default Dashboard" primary** (`mark_as_preferred` → HTTP 403, `errorCode: 024002`) — a by-design RBAC boundary. Deleting a disposable primary dashboard auto-falls-back to Default for both roles, so teardown never force-restores primary.

## Incidents

### Shared dashboards per role broke under `fullyParallel` — 2026-09-01
- **Symptom:** a single-test loop over 17 combinations (DB8/DB20) was slow and opaque; a `beforeAll`/`afterAll` shared dashboard produced three separate dashboards in one run.
- **Root cause:** `fullyParallel: true` does not guarantee one `beforeAll`/`afterAll` pair per describe block; `.serial` was rejected because it skip-cascades every remaining test after one failure.
- **Fix:** 34 individual tests, each creating and deleting its own disposable dashboard.
- **Revert:** n/a — structural test design.
- **Commit:** `7c5b992`

### `openMarkAsPrimary()` fired and returned immediately — 2026-09-02
- **Symptom:** DB14 reload raced the in-flight mutation; DB26 hid a genuine HTTP 403.
- **Root cause:** the click was fire-and-forget with no wait for the underlying POST.
- **Fix:** arm `armResponseWaitWithRecovery()` for the real endpoint before the click; throw on a non-ok response. Verified 3/3 per role.
- **Revert:** remove the armed wait in `openMarkAsPrimary()`.
- **Commit:** `7c5b992`

### `switchToDashboard()` read a stale title during teardown — 2026-09-03
- **Symptom:** teardown failed on a single unretried `getCurrentDashboardName()` read.
- **Root cause:** the previous dashboard's title was still showing before the target's async re-render landed. Why teardown's first switch specifically stalls (attempt 1/3 failed 6/6, never in test bodies) was never established; the retry reliably masks it.
- **Fix:** bounded 3-attempt retry + `expect.poll()`. Verified 6/6.
- **Revert:** restore the single read in `switchToDashboard()`.
- **Commit:** `7c5b992`

### `deleteDashboardByName()` hung for the full navigation timeout — 2026-09-03
- **Symptom:** DB10/DB22 `finally` blocks, calling it a second "guaranteed no-op" time, hung until the test timeout in CI.
- **Root cause:** on an already-deleted dashboard it fell into `switchToDashboard()`'s click on nothing, waiting `NAVIGATION_TIMEOUT` (equal to the outer CI test timeout). Not a concurrency bug.
- **Fix:** presence-check with `isDashboardInSwitcher()` before switching. Verified 12/12 incl. `--workers=2` with CI timeouts.
- **Revert:** remove the presence check in `deleteDashboardByName()`.
- **Commit:** `7c5b992`

### DB3 "expand a collapsed section" removed — 2026-09-02
- **Symptom:** intermittent `aria-expanded` stuck at `false`.
- **Root cause:** not found; the concurrency hypothesis was tested and disproven (an isolated run still failed).
- **Fix:** test removed per explicit direction; `expandSection()` stays (used by DB2/DB4 setup/cleanup).
- **Revert:** restore the test from git history.
- **Commit:** `unknown — see git log -S'DB3'`

### DB32 static-asset 503 — 2026-09
- **Symptom:** the dashboard page never booted in one run.
- **Root cause:** `HTTP 503`/`ERR_ABORTED` on the app's own core JS bundle — an infra blip; self-healed on retry. Not the render race.
- **Fix:** none needed.
- **Revert:** n/a.
- **Commit:** `n/a — no change`

### `addDashlet()` retry cancelled its own in-flight confirmation request — 2026-09-02
- **Symptom:** dashlet-add tests (Grouped Smartlists / Smartlist) intermittently never saw their dashlet after a retry; failures concentrated on DB33 and DB36 and persisted after the fix (that residue is [KI-05](../KNOWN_ISSUES_ACTIVE.md)).
- **Root cause:** the old two-attempt `DashboardPage.addDashlet()` re-submitted the wizard while its first attempt's confirmation fetch was still in flight, cancelling the very request it needed to observe.
- **Fix:** one submission per attempt, with the confirmation awaited before any retry decision; 18/18 isolated single-test runs passed before and after, so the defect only shows under rapid multi-dashlet adds.
- **Revert:** restore the previous retry loop in `addDashlet()` (not advised).
- **Commit:** unknown — see `git log -S'addDashlet' -- src/modules/dashboard/DashboardPage.ts`.
