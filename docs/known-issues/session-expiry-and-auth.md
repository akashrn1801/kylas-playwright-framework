# Session Expiry and Auth — Resolved History

> **Purpose:** Resolved incidents about login, JWT/session expiry recovery, URL building for auth calls, credential logging and the shared credential file.
> **Read when:** Touching `AuthManager`, `withSessionExpiryRecovery()`, fixtures' fixture-setup navigation, or investigating a redirect to `/signIn` / "Forbidden" mid-test.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Open items on this topic (JWT lifetime variance, storage-state age) live in `docs/KNOWN_ISSUES_ACTIVE.md`, not here.

### Session-expiry recovery is one shared architecture — 2026-07-09..07-20
- **Symptom:** Five separate "fixes" each recurred; raw `expect(...).toBeVisible/toHaveText/toHaveURL` calls (80 of them, across 7 modules) were silently unprotected against a mid-test redirect to `/signIn`.
- **Root cause:** No cookie session exists — login is `PUT {apiBaseUrl}/users/login`, the JWT sits in `localStorage.token`, every call sends `Authorization: Bearer <payload.data.accessToken>`; clearing localStorage alone redirects to `/signIn`. A second symptom is a URL-unchanged "Forbidden" bootstrap page. A `page.route()` + `route.fetch()` interceptor was built and abandoned: `route.fetch()` itself broke unrelated saves with generic `HTTP 400` — do not retry that approach.
- **Fix:** `BasePage.withSessionExpiryRecovery()` replaced all 80 sites; `authManager.isSessionExpiryPage()` recognises both `/signIn` and Forbidden; `AuthManager.ensureFreshSession()` refreshes proactively (headless login) when the JWT is near expiry, wired into `src/fixtures/index.ts`; `withSessionExpiryRetry()` wraps whole workflow methods (deliberately NOT share/reassign/clone/add-from-panel, which assume a specific detail view).
- **Revert:** Not revertable piecemeal — extend the combinators, don't add a sixth mechanism.
- **Commit:** `a1d8291` (mid-test recovery + `withSessionExpiryRetry`); earlier phases `6f2c734`.

### `buildApiUrl()` is the only URL normaliser — 2026-07
- **Symptom:** `HTTP 404` on ~64–98 tests per CI run; separately `DealsPage.fetchCurrentDealApiData()` silently swallowed the same fault.
- **Root cause:** Hand-rolled copies assumed `config.apiBaseUrl` always includes `/v1`; CI's secret has a different shape. The second copy survived a ripple-check that matched the line but did not read what it did.
- **Fix:** `config.buildApiUrl(path)` strips trailing slashes and appends `/v1` only if absent; both call sites use it.
- **Revert:** n/a — reverting reintroduces both 404 bugs.
- **Commit:** `0276029`.

### ID-capture predicates must use a versioned path — 2026-07
- **Symptom:** A real success toast but "save failed silently" — captured id was `null`.
- **Root cause:** `captureXxxIdFromResponse()` matched bare `.includes('/deals')` / `companies` and raced an unrelated background POST (`/v4/reports/deals`) in 3 places.
- **Fix:** Predicates require `/v1/<module>/` and exclude `/reports/`. Any new capture predicate must do the same.
- **Revert:** n/a.
- **Commit:** unknown — see git log -S'captureDealIdFromResponse'.

### `waitForResponse()` recovery races — 2026-07
- **Symptom:** ID-capture promises after an already-recovered click still timed out silently; `assertNoFormErrors()` (~1.5s) threw before slower (10s+) recovery set its flag; the app's own redirect to `/signIn` aborted recovery navigation with `net::ERR_ABORTED`.
- **Root cause:** Flag-based coordination race in `armResponseWaitWithRecovery()`, and a competing navigation in `tryRecoverSessionForPage()`.
- **Fix:** Synchronous `hasFired()` signal; bounded retry keyed on the `ERR_ABORTED` signature.
- **Revert:** Revert `armResponseWaitWithRecovery()` / `tryRecoverSessionForPage()` in `src/core/BasePage.ts` / `src/auth/authManager.ts`.
- **Commit:** `a1d8291`.

### Credential leakage into plaintext logs — 2026-07-20
- **Symptom:** Real admin/restricted passwords appeared verbatim in every `login.spec.ts` log (`logs/`, gitignored, never committed).
- **Root cause:** `LoginPage.loginWithCredentials()` → generic `BasePage.fill()` logged the filled value unconditionally.
- **Fix:** `SENSITIVE_FIELD_PATTERN` (`password|passwd|pwd|secret|token|api[_-]?key`, now in `src/utils/sensitiveFieldPattern.ts`) is matched against the caller's description; matches log `[REDACTED]`. Description-based on purpose — a DOM `type="password"` check is not reliable.
- **Revert:** n/a — security fix. (Rotating the QA credentials was recommended; not confirmed done.)
- **Commit:** `a1d8291`.

### Cross-worker credential-file race — hypothesis, never confirmed — 2026-08-07..09
- **Symptom:** Two occurrences: `Lead ID not captured after save — cannot proceed (save likely failed silently)` on a Lead test, and a Quotation save `HTTP 500` after three rapid re-auth cycles ("headless re-auth succeeds" then redirect to `/signIn` within seconds), both under `--workers=2`. Isolated single-worker reruns passed 3/3 and 1/1.
- **Root cause:** UNCONFIRMED. Hypothesis: one worker's forced re-login (`Storage state cleared for role: admin` → `Storage state saved`) invalidates the shared `storageStates/<env>/<role>.json` session while another worker's request is in flight. The old claim "AuthManager has no locking around writes" is **contradicted by current code**: `AuthManager.withFileLock()` (mkdir-based lock) plus temp-file + `fs.renameSync` atomic writes exist in `src/auth/authManager.ts` (added with the original cross-process login lock). What remains unproven is a cross-*session* invalidation (a re-login by one worker invalidating another's token), not file corruption.
- **Fix:** None needed for file integrity (locking exists). The old standing instruction "ALWAYS run `--workers=1` — a correctness requirement" is **not true of the repo today**: nearly every CI pipeline runs `--workers=2` (see the generated workflow matrix in `docs/CI_PIPELINES.md`), including the full-suite pipelines. Treat `--workers=1` as a cheap way to remove one variable when diagnosing, not a rule. Making `openCreateForm()` bounded (2026-08-09) turned the hang into a diagnosable error.
- **Revert:** n/a — doc correction.
- **Commit:** `77d90aa` (lock + atomic writes); `unknown — see git log -S'openCreateForm'` for the bounded click.

### `navigateAndConfirmLoggedIn()` landed on neither `/sales/` nor `/signIn` — see ci-pipelines.md
- Fixture-setup navigation classification (`'wrongPage'` outcome) is recorded in `docs/known-issues/ci-pipelines.md` under Build #239.
