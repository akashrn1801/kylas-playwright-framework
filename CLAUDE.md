# CLAUDE.md — Standing Engineering Instructions

Core, always-apply rules for working on this codebase, kept lean on purpose — every line here loads into every session regardless of relevance, so detailed reference material lives in the imported files below instead of inline. For end-user/project-overview documentation (setup, running tests, CI matrix, troubleshooting), see `README.md`. For confirmed, real Kylas application bugs, see `APPLICATION_BUGS.md`.

**Imported reference files** (full detail, loaded on demand — not duplicated here):
@.claude/architecture.md
@.claude/reference-patterns.md
@.claude/known-issues.md
@.claude/AGENT_DELEGATION_GUIDE.md

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [The 25 Standing Rules](#the-25-standing-rules)
3. [Architecture Summary](#architecture-summary) — full detail in `.claude/architecture.md`
4. [Key Conventions](#key-conventions)
5. [Reference Patterns Index](#reference-patterns-index) — full detail in `.claude/reference-patterns.md`
6. [CI/CD Quick Reference](#cicd-quick-reference)
7. [Module Status](#module-status)
8. [Framework Reliability Overhaul & Agent System](#framework-reliability-overhaul--agent-system) — full delegation detail in `.claude/AGENT_DELEGATION_GUIDE.md`
9. [Known Issues — Critical / Do Not Touch](#known-issues--critical--do-not-touch) — full investigation history in `.claude/known-issues.md`
10. [Dev-Branch Lint-Fix Drift](#dev-branch-lint-fix-drift)
11. [Concurrent-Worker Credential File Race](#concurrent-worker-credential-file-race)
12. [When You're Stuck](#when-youre-stuck)

---

## Quick Reference

- **Branch strategy:** `feature/* → dev → qa → stage → prod → main` (full mechanics in `README.md`'s Git Workflow section)
- **Never:** push/merge (user only), use `waitForTimeout()`, hardcode test data
- **Always:** use real condition-based waits, create fresh test data, check for session expiry
- **When in doubt:** verify with live evidence, not assumption
- **Tech stack:** Playwright `^1.60.0` + TypeScript `^6.0.3` (strict, ES2022), Node `>=20.0.0`/npm `>=10.0.0`, `@faker-js/faker` `^10.4.0`, Allure + Playwright HTML reporters, ErrorCollector for passive error tracking, Playwright MCP (installed 2026-08-01, live investigation only)

---

## The 25 Standing Rules

Apply these to **every change, every time, no exceptions.**

1. **Reuse before building.** Before writing any new interaction/assertion logic, check whether an existing BasePage helper or Lead/Contact pattern already does this. This codebase has repeatedly duplicated the same logic across modules instead of sharing it — don't add another instance of that anti-pattern. If something genuinely needs new logic, build it once, generically, in BasePage — not copy-pasted per module.

2. **No unbounded clicks/actions.** Never write a raw `.click()`/`.fill()`/`.waitFor()` with no timeout and no retry. This exact "click registers but nothing visibly happens" React-timing race has already been found and fixed in Companies, Deals, Contacts, Quotations, and the Share-modal flow across 4 modules. Any new interaction must be bounded (a real timeout) and either retry-capable or fail loudly and fast — never hang silently for the full test timeout.

3. **Session-expiry protection is mandatory.** Any new raw Playwright assertion (`expect().toBeVisible/toHaveText/toHaveURL`, etc.) written directly in a module file — not already wrapped by an existing BasePage helper — must be wrapped in `withSessionExpiryRecovery()`. This codebase has had this exact gap recur repeatedly (5+ times across different sessions) specifically because new code forgets this. Check this every single time, not just when told to.

4. **No hardcoded dropdown options, ever.** Any picklist/multi-picklist/dropdown must read its real options live from the DOM at runtime. Never hardcode an option string, index, or assumed count — option lists can and do grow/shrink over time and differ across environments.

5. **Test data must be genuinely fresh, never randomly reused.** Any test needing an isolated/controlled entity (for RBAC checks, permission boundaries, or anything where "this specific record has zero prior access/history" matters) must create that record fresh in the test itself — never rely on a randomly-selected pre-existing record. This exact mistake produced a false conclusion once already (the CR9 test-isolation bug).

6. **Locators must be built on internal names, never display labels.** Custom field display labels can be renamed by account admins; internal field names cannot change. Any new locator must key off the internal name (confirmed via the field's settings screen), never the on-screen text.

7. **Check field/feature presence before assuming it exists everywhere.** Anything environment-conditional (a custom field, a config value, a feature flag) must be presence-checked and gracefully skipped (with a clear log line) if absent — never assumed to exist identically across qa/stage/prod. Environments diverge, and this codebase has already been burned by assuming otherwise.

8. **Don't trust a single passing run.** Before calling anything "fixed" or "verified," re-run the specific test 3-5 times in isolation, zero flakiness accepted. A test passing once proves nothing on its own in this codebase's history.

9. **Ripple-check any shared code change.** Before modifying any method used by more than one caller (BasePage helpers, `fillXForm()`/`fillEditForm()`, any shared factory function), grep every consumer and confirm the change is purely additive. Treat shared code as high blast radius by default.

10. **Never patch a symptom without a confirmed root cause.** If a bug can be reproduced, root-cause it with real evidence before fixing. If it CANNOT be reproduced, don't just document and walk away — do a thorough code review to find plausible failure modes and apply a defensive hardening fix, clearly labeled as "hardened based on review, root cause not confirmed" rather than overstated as a proven fix.

11. **No silent scope expansion or silent scope-narrowing.** If you find an unrelated bug while working, STOP and report it — don't fix it silently (scope creep) and don't ignore it silently either. Flag it, let the human decide whether it's in-scope now or a tracked follow-up.

12. **Check real, live evidence over assumption — always.** Verify live/fresh rather than trusting an old investigation's conclusion or your own inference, especially if any real-world data (test data volume, environment config, account settings) could plausibly have changed since.

13. **No commits, no pushes, ever, without explicit permission.** All git operations beyond creating a branch are performed by the user only.

14. **Document with real evidence, not narrative.** Any CLAUDE.md/README.md update must include concrete evidence (exact error text, real IDs, actual pass counts, timestamps) — not a prose summary alone.

15. **ID-capture from a network response must match a versioned, specific path — never a bare substring.** Found and fixed in 3 places where `captureXxxIdFromResponse()` matched `.includes('/deals')`/`.includes('companies')` with no version prefix, occasionally matching an unrelated background request that raced ahead with no `id` field. Any new response-capture predicate must require the real versioned path (`/v1/<module>/`) and explicitly exclude `/reports/`.

16. **Session expiry has more than one symptom — protect against all of them.** Confirmed: a `/signIn` redirect, a distinct "Forbidden" bootstrap-time page with the URL unchanged, and a `waitForResponse()`/ID-capture promise sitting after an already-covered click that can still silently time out. Any new awaited network-response promise needs its own explicit protection; any new page-state check should use the shared `isSessionExpiryPage()`-style check, not a bare URL match.

17. **A locator that is unique today can become ambiguous the moment a sibling field/button is added elsewhere in the DOM.** Confirmed twice (a Company Phones substring collision; Deal's estimated-closure-date field breaking once Deal gained its own Date/DateTimePicker custom fields). Prefer the narrowest reliable scope over a broad substring/placeholder/text match, and treat "currently unique" as temporary, not permanent.

18. **A bug class fixed in one place is not fixed everywhere — sweep the whole codebase, and explicitly document any instance you deliberately leave unfixed.** The unbounded-click race (rule 2) is still unfixed in `QuotationsPage.fillOwner()` and parts of `LeadsPage.ts` — see `.claude/reference-patterns.md` §3. When you fix a bug class, grep for every other instance in the same pass.

19. **Retry budgets and timeouts must be sized per real observed latency for that specific environment — never copied uniformly across qa/staging/prod, and a retry-exhaustion fallback must never silently guess.** `CallLogsPage.searchAndSelectEntity()`'s staging budget is thinner than qa's/prod's despite needing its full budget to recover from real indexing lag; its exhaustion path also silently clicks the first option instead of failing loudly.

20. **Environment-scoping conclusions decay over time — a "qa/prod-only" or "small dataset" finding must be re-verified, not assumed permanent.** QA/staging data grows unboundedly; an earlier "stage's option list is too small to trigger this" conclusion went stale once stage's data grew to the same scale weeks later.

21. **A single isolated, unloaded local repro run is not proof a flake doesn't exist — some bugs only manifest under real concurrent CI load.** In each confirmed case the correct response was defensive hardening (clearly labeled, per rule 10) or accepting a genuinely uncertain, load-dependent flake — never dismissing it as "couldn't reproduce, so not real."

22. **Never log a field's raw value without checking whether it's sensitive.** A generic `BasePage.fill()` used to log every filled value verbatim, including real QA admin/restricted passwords, into every `login.spec.ts` log file. Any new logging of a filled/typed value must check the field's purpose (a description/name pattern like `password|token|secret|api[_-]?key`) and redact — never assume a DOM `type="password"` attribute will always be present.

23. **This repo's CI has genuinely divergent scope and safety nets per branch — verify which pipeline actually protects a given change before trusting "CI is green."** See [CI/CD Quick Reference](#cicd-quick-reference) and README.md's full matrix.

24. **Any generated report/log/evidence file that a later run can overwrite should be treated as ephemeral.** `reports/<env>/misc-errors.json` is overwritten by every subsequent Playwright invocation, even a single isolated test run in the same environment. Copy or rename anything you intend to reference later before running more tests against the same environment.

25. **Before concluding local work is lost, uncommitted, or unmerged, verify actual git state.** Check `git reflog`/`git stash list` before treating uncommitted changes as gone, and `git fetch` before trusting a local branch's view of what's merged/ahead/behind.

---

## Architecture Summary

Full detail: `.claude/architecture.md` (imported above).

- **File layout:** `src/core/BasePage.ts` (shared base class), `src/fixtures/index.ts` (custom fixtures — always import `test`/`expect` from here, never `@playwright/test` directly, except `login.spec.ts`), `src/auth/` (globalSetup + AuthManager + per-env storage states), `src/modules/<module>/<Module>Page.ts`, `src/data/factories/<module>Factory.ts`, `src/error-collector/`, `src/reporters/MiscErrorReporter.ts`, `src/notifications/`. Tests: `tests/ui/<module>/` and `tests/rbac/<module>.rbac.spec.ts`. `config/config.ts` is the single source of truth for env vars/timeouts/retry config and owns `buildApiUrl(path)` — the only canonical URL-normalization function; do not hand-roll another copy (two confirmed bugs already came from that).
- **Fixtures:** `adminPage`/`restrictedPage` attach ErrorCollector + session-expiry listeners before first navigation, race sign-in vs. landing on `/sales/`, and proactively refresh a near-expiring session via `AuthManager.ensureFreshSession()`.
- **Page objects** follow a fixed 10-section order (retryConfig → locators → constructor → private helpers → navigation → form actions → search & open → edit actions → assertions → workflow wrappers). Locators are always lazily-evaluated arrow functions.
- **Factories** export `generateXxxData()` / `generateAdminXxxData()` (`ADM<timestamp>`) / `generateSharedXxxData()` (`SHR<timestamp>`) — the prefix convention exists because QA/staging data never gets cleaned up, so a distinguishing prefix is the only reliable way to make an RBAC negative-assertion trustworthy.
- **Custom fields** (Lead/Contact/Deal/Company, 9 fields each) are environment-conditional — every BasePage custom-field method must presence-check and never throw on absence. Full field-by-field mechanism in `.claude/reference-patterns.md` §9–10.
- **ErrorCollector** passively captures pageerror/console-error/requestfailed/4xx-5xx on every test, classified into Noise / Expected-RBAC / Known-background-noise before anything is reported as unexpected.

---

## Key Conventions

- **NEVER import from `@playwright/test` in test files** — always use `src/fixtures/index.ts` (except `login.spec.ts`, by design).
- **NEVER hardcode test data** — use factories (`generateXxxData()`).
- **NEVER put locators in test files** — all locators live in the page object.
- **ALWAYS extend `BasePage`** for page objects.
- **Use `logger.*`, never `console.log`**, for all logging. Never log a filled/typed value without checking it isn't sensitive (rule 22).
- **Tags:** `@smoke` (navigation/happy-path only), `@regression` (full functional + RBAC), `@prodSafe` (read-only, safe against real production data). Every test carries at least one; many carry two.
- **`test.setTimeout(480000)`** on any test that creates/edits records — local runs can be slow.
- **Commit message format:** `feat: ...` / `fix: ...` / `chore: ...` / `ci: ...` / `refactor: ...`
- **Session-expiry quick patterns:** wrap new assertions in `withSessionExpiryRecovery()` (rule 3); guard `waitForResponse()` promises with `armResponseWaitWithRecovery()`, or wrap a whole workflow method in `withSessionExpiryRetry()` (rule 16); use `authManager.isSessionExpiryPage(page)`, never a bare URL check. Full architectural history in `.claude/known-issues.md`.
- **`@typescript-eslint/no-explicit-any` is a hard ESLint error, not a warning, and is blocked at pre-commit** — upgraded 2026-08-06 after 17 `any`-type warnings had silently accumulated across the codebase over time with no real enforcement gate (a warning never failed `npm run lint` or blocked a commit). Both `eslint.config.js` (the active flat config under this repo's ESLint v10) and the now-inert legacy `.eslintrc.json` were updated for consistency. `scripts/hooks/pre-commit` (and the installed `.git/hooks/pre-commit`) now run ESLint on staged `.ts` files and block the commit on any error. When you hit this, find or define the real, specific type for the value — never silence it with `unknown` or another vague type (see `.claude/known-issues.md` for the 9-file cleanup that fixed the original 17, including two cases where the "real type" was an official Node/`@types/node` type already available, and one case where removing a redundant `any` cast surfaced a genuine `tsc` narrowing gap unrelated to any behavior bug).

---

## Reference Patterns Index

Full code + evidence for all 10 in `.claude/reference-patterns.md` (imported above) — read that file instead of re-reading source for these recurring shapes:

1. `waitForXDetailsPage()` — URL + domcontentloaded + API response (superseded by `waitForEntityDetailPage()`/`waitForEntityListPage()` for list/detail readiness specifically)
2. Ellipsis menu pattern
3. Share modal pattern (3-char search minimum, JS label click) — also documents the still-unfixed unbounded-click instances (rule 18)
4. Clone pattern (duplicate-avoidance, ID capture before save) — also documents the `DealsPage.cloneDeal()` React-timing race
5. Right panel icon pattern (SVG ID map + dual-selector locator) — also documents the SVG-collision bug and the reload-and-retry visibility fix
6. Note add/delete with baseline-relative count assertion
7. Add deal from modal (pipeline + product row + part payments + response listener)
8. Add contact from modal — exact field IDs from live DOM
9. Custom Fields pattern (generic helpers + per-module constants + environment safety contract)
10. Custom field Internal Name vs. Label — renaming a display label is always safe

---

## CI/CD Quick Reference

- GitHub Actions: `dev.yml`, `qa.yml`, `stage.yml`, `prod.yml`, `main.yml`, `sandbox.yml`, `staging-promotion-gate.yml`
- Jenkins: `Jenkinsfile` (multi-branch, primary for prod/main), `Jenkinsfile.qa`, `Jenkinsfile.staging`, `Jenkinsfile.prod`, `Jenkinsfile.sandbox` (all Jenkins paths except the base `Jenkinsfile` are manual-only fallbacks, not primary)
- `sandbox.yml`: selective test detection via `.github/scripts/detect-tests.sh`, based on changed file paths.
- Worker count is controlled by CLI `--workers` (always wins over `playwright.config.ts`/`WORKERS` env var) — see rule 23 for why "CI passed" doesn't mean the same thing on every branch, and `README.md`'s full per-branch matrix for exact trigger/scope/worker-count per pipeline.

---

## Module Status

Verified fresh via `npx playwright test --project=chromium --list` as of 2026-07-28: **285 tests across 17 spec files, 9 modules.** Full per-module UI/RBAC breakdown table lives in `README.md`'s Project Overview — any older count anywhere is stale and should be re-run, not trusted (rule 12/20).

**Last full regression evidence (2026-07-28):** all 10 UI+RBAC spec files touched by that session's work (Companies, Contacts, Deals, Leads, Tasks) run in full on stage: **189 passed, 0 failed, 0 flaky, 4 expected skips** (193 total). Two unrelated network-connectivity drops and one memory-pressure process kill occurred mid-verification (confirmed via direct `curl`/`free -h` evidence) — each discarded its own polluted partial data and was re-run clean.

---

## Framework Reliability Overhaul & Agent System

A multi-agent initiative (started 2026-08-01) to automate QA, testing, and investigation. Full delegation chains, manual-request table, and hooks detail: `.claude/AGENT_DELEGATION_GUIDE.md` (imported above).

**13 Specialized Subagents** (in `.claude/agents/`): `flaky-test-auditor`, `locator-reviewer`, `self-healing-locator-scout`, `resilience-architect`, `enterprise-code-reviewer`, `pipeline-guard`, `security-dependency-auditor`, `test-coverage-strategist`, `failure-triage-investigator`, `discovery-agent`, `test-data-lifecycle-manager`, `release-readiness-summarizer`, `accessibility-auditor`.

**In short:** editing a Page Object/spec → `locator-reviewer` (real `PostToolUse` hook, see below). Pushing → `flaky-test-auditor` + `enterprise-code-reviewer` gate. A test failure → `failure-triage-investigator` classifies app-bug vs. code-bug first, always, before any fix. An investigation finding an uncovered flow → `test-coverage-strategist` writes tests, never auto-merged.

**Hooks (real, installed to `.git/hooks/`, tracked in `scripts/hooks/`):** hard-deny on `git push`/`git merge`/`gh pr merge`; a verified-working pre-commit hook blocking `waitForTimeout()`; a verified-working pre-push hook checking for the same plus hardcoded URLs; a real Claude Code `PostToolUse` hook (`.claude/settings.json`, matcher `Write|Edit`) that reminds to invoke `locator-reviewer` on Page Object/spec edits.

**Playwright MCP** (installed 2026-08-01, QA/stage only, disabled on Prod): only agents 3/4/9/13 have access, gated behind approval, and must follow the `.claude/evidence/{agent-name}/{date-slug}/` protocol.

---

## Known Issues — Critical / Do Not Touch

Full investigation history (every bug class, architectural overhaul, and inconclusive flake, with dates and evidence): `.claude/known-issues.md` (imported above). This is only the highest-signal digest — read the full file before touching anything related.

- **Session-expiry recovery is a deliberate 5-phase architecture** (`withSessionExpiryRecovery()`, `withSessionExpiryRetry()`, `ensureFreshSession()`, `authManager.isSessionExpiryPage()`) built after 5 independent partial fixes failed to hold. Don't hand-roll a 6th mechanism — extend the existing combinators.
- **`page.route()`-based network interception (`route.fetch()`) is confirmed unusable against this backend** — it broke unrelated saves with generic `HTTP 400` errors even on requests nowhere near a 401. Don't re-attempt this approach for session recovery.
- **`config.buildApiUrl()` is the only canonical URL-normalization function.** Two independent, confirmed bugs (the login URL, then `DealsPage.fetchCurrentDealApiData()`) came from hand-rolled copies assuming `config.apiBaseUrl` always includes `/v1`. The second bug survived a ripple-check that found the exact line but didn't read what it did — a match is not the same as understanding it.
- **ID-capture predicates must use a versioned path (`/v1/<module>/`), never a bare substring** — 3 confirmed false-positive incidents from `.includes('/deals')`-style matches.
- **`BasePage.selectRandomOptionWithRetry()` is the canonical react-select random-pick helper** (7 call sites already migrated) — don't write a new inline unbounded read+click for this shape.
- **Known unfixed unbounded-click races:** parts of `LeadsPage.ts` (close-reason radio, convert-to-deal product selection), several `QuotationsPage.ts` random-option pickers. (`QuotationsPage.fillOwner()` was fixed 2026-08-09 — see below.)
- **`DealsPage.fillDealForm()`'s associated contact/company pick is deliberately randomized** (a 2026-07-05 CI-hang fix) — pass `associatedContactName`/`associatedCompanyName` on `DealData` whenever ownership matters for a new Deals test.
- **Custom-field methods must presence-check and never throw on absence** — the environment-safety contract (`.claude/reference-patterns.md` §9). Fields get added to qa/stage/prod weeks apart, by hand.
- **Several investigated flakes are formally INCONCLUSIVE, not resolved** — do not re-close them without new evidence: `quotations.rbac.spec.ts:380`, `call-logs.spec.ts:391`, `meetings.spec.ts:120`, `tasks.rbac.spec.ts:69`, the 2026-08-03 HTTP-500-on-meeting-creation and Deals-RBAC-Task-permission-timeout pair, and the original 2026-07-06 unexplained Deals Call-permission flake. Full detail and evidence-gap analysis for each in `.claude/known-issues.md`.
- **Confirmed real Kylas application bugs** (not code bugs) live in `APPLICATION_BUGS.md`, not here.
- **5 sandbox failures root-caused and fixed 2026-08-09** (CL39, CL32/CL33, D28, Quotations detail-verify — sandbox run `31269450132`, confirmed real `--workers=2`): a test-data `entityType`-mismatch bug (not the initially-suspected "date-time picker hang" — CL39's real failure was in the Call Type dropdown, verified via live deterministic reproduction), a shared-`#editEntityModal`-reuse gap in `DealsPage.cloneDeal()`/`TasksPage.cloneTaskViaEllipsis()` (now both check `.modal-title` before trusting the modal, matching sibling flows that already did), `QuotationsPage.waitForListReady()` never actually checking readiness (fixed to race the list container against the create button, mirroring `CallLogsPage`'s proven pattern), and a genuine **Kylas application-side JS race** in the Log-a-Call modal under concurrent multi-session access (live-captured `TypeError` in the app's own `openCallLogForm` — see `APPLICATION_BUGS.md` #5). Full evidence and fix detail in `.claude/known-issues.md`.
- **`CompaniesPage`/`LeadsPage.openUserShareTypeSearch()` still has a `waitForTimeout(500)` after the `Escape` keypress in its catch/retry backoff** — the pre-commit hook caught this exact anti-pattern in `QuotationsPage.fillOwner()` (2026-08-09) because `fillOwner()` was written by copying this method's pattern verbatim, blind wait included; `fillOwner()` was fixed to wait for `.is-invalid__menu` to become hidden instead, but the **original source of the copied pattern in Companies/Leads was left untouched** (outside this session's diff) and is now the one remaining known instance of this exact anti-pattern in the codebase. Apply the identical condition-based fix there in a future session.

---

## Dev-Branch Lint-Fix Drift

**Confirmed via `git diff origin/dev origin/{qa,stage,prod,main}` — `dev` is missing 3 lint-fix hunks that are identically present on qa, stage, prod, AND main:**

1. `src/modules/call-logs/CallLogsPage.ts` — a blank/whitespace-only comment line above the `document.querySelector(...).removeAttribute("aria-hidden")` eval-string call should be `// eslint-disable-next-line @typescript-eslint/no-implied-eval`.
2. `src/modules/tasks/TasksPage.ts` — the import from `@data/factories/taskFactory` is missing the `TaskCustomFieldKey` named import that the other 4 branches already have.
3. `src/reporters/MiscErrorReporter.ts` — two blank/whitespace-only comment lines above `onBegin`/`onEnd` should each be `// eslint-disable-next-line @typescript-eslint/no-unused-vars`.

**Why this lives here, not in `APPLICATION_BUGS.md`:** this is a repo/branch-hygiene gap in test-framework code (lint suppressions and an unused import), not a defect in the Kylas application itself — `APPLICATION_BUGS.md` is deliberately scoped to real product bugs only, and mixing in engineering-process issues would dilute that file's signal.

**Action needed:** backport these 3 hunks into `dev` (cherry-pick the relevant commit from qa/stage/prod/main, or hand-apply the diff) so `dev` doesn't silently regress lint status the moment someone edits near these lines. Per rule 13, this requires the user to actually perform the git operation.

---

## Concurrent-Worker Credential File Race

**Confirmed real, found 2026-08-07/08 during the Task custom-fields / multi-select-cap verification work — `AuthManager` has no locking around writes to the shared `storageStates/<env>/<role>.json` file.** Every worker process for a given role (`admin`/`restricted`) reads and writes the *same* credential file. If one worker detects a bad session mid-run and does a forced re-login (`Storage state cleared for role: admin` → fresh login → `Storage state saved: .../admin.json`), it can overwrite that file while a **different** worker's in-flight request still depends on the old session/token — producing a spurious ID-capture timeout with no connection to any real bug in the code under test.

**Observed real occurrence:** `tests/ui/leads/leads.spec.ts:226` (L12, "admin should mark lead as Closed Unqualified via Close Lead dropdown select reason and verify stage") failed with `Error: Lead ID not captured after save — cannot proceed (save likely failed silently)`, traced to `Lead create response not captured (TimeoutError: page.waitForResponse: Timeout 60000ms exceeded while waiting for event "response")`. At almost the exact same timestamp, a **different concurrent worker** in the same run logged `admin page did not land on /sales/ ... forcing a fresh login and retrying`, cleared, and overwrote the shared `admin.json` — while the failing test's create-POST wait was still in flight, both workers acting as the same `admin` role. Run: full Lead UI+RBAC regression on QA, `--workers=2`, 2026-08-07 ~04:39 UTC. Re-ran the specific failing test 3x immediately after in single-worker isolation: 3/3 clean — consistent with, not disproof of, a concurrency-dependent root cause, since isolation removes the second worker needed to trigger the race in the first place (rule 21).

**This is the same broader bug family as the already-documented Lead session-expiry/ID-capture issue (`leads.rbac.spec.ts:398`, see `.claude/known-issues.md`), but a distinct, more specific candidate mechanism** — a cross-worker shared-credential-file collision, not a single page's mid-test session expiry. Reported as a real, concrete correlation, not a proven-from-one-occurrence root cause.

**Until this is fixed with proper file locking or per-worker isolated credential files, ALWAYS run with `--workers=1` — this is not just a convention, it's a correctness requirement given the current architecture.** Any `--workers>1` run's "all passed" result should be treated as **less trustworthy** than an equivalent `--workers=1` run — not because anything is necessarily broken by it, but because the test conditions weren't the safe, standard ones. (Concretely: the 2026-08-07/08 Lead/Deal/Contact/Company regression runs verifying the multi-select cap fix were run with `--workers=2` — their "all passed" results carry this same caveat, flagged honestly rather than left implicit.)

**The ORIGINAL full regression run this same session — 3.3 hours, 308 tests, establishing that the `any`-type cleanup plus the docs/hooks consolidation work caused zero regressions — also ran under `--workers=2`, not just the smaller Lead/Deal/Contact/Company verification above.** This is recorded explicitly, not glossed over: **the human has reviewed this risk and made a conscious, informed decision to proceed with pushing despite it, rather than re-running under `--workers=1`, given the extensive additional verification already performed tonight** — individual live re-runs, isolated confirmations, and root-cause investigation of every discovered issue (including this exact race, caught and diagnosed the same night). This is a documented, deliberate risk-acceptance decision, not an unnoticed gap.

**Not fixed tonight, deliberately** — implementing proper locking or per-worker isolated credential files is its own separate, potentially significant piece of work, not something to fold into an unrelated fix.

---

## When You're Stuck

1. **Flaky test?** → Ask `failure-triage-investigator` (classifies app bug vs. code bug first, always)
2. **Broken locator?** → Ask `self-healing-locator-scout` (finds live correct element)
3. **Slow flow?** → Ask `resilience-architect` (measures real timing, proposes wait strategy)
4. **Code quality?** → Ask `enterprise-code-reviewer` (pre-push gate)
5. **Before promoting?** → Ask `pipeline-guard` + `release-readiness-summarizer`

Never silently patch a flaky test or hide a real bug — classify first, then fix.
