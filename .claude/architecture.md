# Architecture (full detail)

Imported from `CLAUDE.md`. See that file for the condensed summary and the rest of the standing rules.

### File Layout

```
src/
  core/BasePage.ts          — Base class all page objects extend
  fixtures/index.ts         — Custom test fixtures (ALWAYS import from here)
  auth/
    globalSetup.ts          — Logs in both roles before suite, saves storage state
    authManager.ts          — Session validation + re-login with in-memory cache
    storageStates/<env>/    — Saved Playwright browser storage states per role (gitignored)
  modules/<module>/
    <Module>Page.ts         — Page object class
  data/
    factories/<module>Factory.ts  — generateXxxData()/generateAdminXxxData()/generateSharedXxxData()
    files/                  — Static fixture files (e.g. upload attachments)
  error-collector/
    ErrorCollector.ts       — Singleton; captures pageerror/console-error/HTTP 4xx-5xx
    errorFilters.ts         — Noise filter + expected-RBAC + known-background-noise classifiers
  reporters/
    MiscErrorReporter.ts    — Playwright reporter; merges per-worker error files → reports/<env>/misc-errors.json
  notifications/            — Email notification service (post-run) — see README §8 for full detail
  utils/logger.ts           — logger.info/warn/error/success (never use console.log)

tests/
  ui/<module>/<module>.spec.ts       — Functional UI tests (adminPage fixture)
  rbac/<module>.rbac.spec.ts         — Permission tests (adminPage + restrictedPage fixtures)

config/config.ts            — Single source of truth for env vars, timeouts, retry config, buildApiUrl()
```

### Fixtures (`src/fixtures/index.ts`)

Two custom fixtures wrap authenticated browser contexts — **always import `test`/`expect` from here, never from `@playwright/test` directly** (the one deliberate exception is `login.spec.ts`, which tests the login UI itself and must not depend on the auth machinery it's testing):

- **`adminPage`** — full-access "Playwright Automation" user.
- **`restrictedPage`** — limited-access "User 1".

Both fixtures, via a shared `createRolePage()` helper:
1. Get a browser context via `AuthManager.getContextForRole(role)` instead of a raw `storageState`, so an expired session is transparently re-logged-in rather than failing the test.
2. Attach `ErrorCollector` listeners (`pageerror`, `console-error`, `requestfailed`, response `>=400`) and a session-expiry listener (401 responses, or a mid-test redirect to `/signIn`) *before* the first navigation, so nothing from the very first page load is missed.
3. Navigate to the app and race two outcomes — landing on `/sales/` vs. being redirected to sign-in — rather than a single blind `waitForURL`. On a signed-out landing it forces a fresh login and retries once (2 attempts total) before failing loudly with the last-seen URL in the error message.
4. Dismiss the app's startup popup (`#cancel[data-dismiss="modal"]`) if present.
5. On CI, stagger `restrictedPage` startup by a random 0–3s to avoid concurrent-session conflicts when multiple workers log in around the same moment.
6. Call `AuthManager.ensureFreshSession(page, role)` (proactive token-expiry check — see `.claude/known-issues.md`), wrapped in try/catch so a failure here never fails the test outright.

`adminContext`/`restrictedContext` are lighter-weight raw `BrowserContext` fixtures built directly from the saved `storageState` file, with none of the above error-listener/retry machinery — use only when a test genuinely doesn't need error capture or session-expiry handling.

### Auth Flow and Session Caching

`src/auth/globalSetup.ts` runs once before the whole suite: logs in both roles, saves `src/auth/storageStates/<env>/<role>.json`, and captures each role's display name to `userNames.json`. `src/auth/authManager.ts`'s `AuthManager`:
- Caches session validity in-memory per role for 30 minutes (`SESSION_CACHE_MS`).
- Uses `withFileLock()` (an `fs.mkdirSync`-based atomic lock) around storage-state writes, with the actual write itself rename-based (write-to-temp, then atomic rename) — so two CI workers racing a re-login don't corrupt each other's write.
- Login is `PUT {apiBaseUrl}/users/login`, body `{email, password, rememberMe}`, response `{token}` — a JWT stored verbatim in `localStorage.token`. Every API call sends `Authorization: Bearer <accessToken>` from inside the decoded JWT payload (`payload.data.accessToken`). There is **no cookie-based session** — clearing `localStorage` alone immediately redirects to `/signIn`.
- `buildApiUrl(path)` (`config/config.ts`) normalizes `config.apiBaseUrl` (strips trailing slashes, appends `/v1` only if not already present) — the canonical way to build any request URL. **Do not hand-roll another URL-normalization copy** — see the two real bugs this exact gap caused, in `.claude/known-issues.md`.

### Page Object Structure

Every page object extends `BasePage` and follows this **exact section order**, top to bottom:

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

**Why this matters in practice:** with 9 modules maintained by more than one person, the cost of "where do I even look" compounds fast. A fixed section order means anyone can jump into an unfamiliar page object already knowing that retry tuning is at the top and workflow wrappers are at the bottom. Locators are always lazily-evaluated arrow functions (`private readonly foo = (): Locator => ...`), never captured eagerly at construction time, because the DOM element a locator resolves to may not exist yet when the page object is instantiated.

### Test Data Factories

Each factory (`src/data/factories/<module>Factory.ts`) exports `generateXxxData()` plus RBAC-oriented variants:
- `generateXxxData()` — plain Faker data, used when a restricted user creates their own record (ownership is inherently theirs).
- `generateAdminXxxData()` — prefixed `ADM<timestamp>` — admin-only data.
- `generateSharedXxxData()` — prefixed `SHR<timestamp>` — data the admin creates specifically to then share with the restricted user.

**Why the prefix+timestamp convention exists:** an RBAC test's entire assertion is "restricted user provably cannot see this record unless it's shared with them." Two problems make a plain Faker name insufficient: (1) QA/staging never get cleaned up — every module's data accumulates indefinitely — so a search by a generic name can collide with old leftover records and produce a false pass; (2) without a distinguishing prefix, there's no cheap way to tell "genuinely admin-owned, never shared" data apart from "shared" data when both need to exist side-by-side in the same test. The `ADM`/`SHR` prefix plus a timestamp makes every run's records uniquely searchable and unambiguously classifiable.

`Country` defaults to `India` in every factory — a hard CRM-side validation requirement, not a test choice.

### Custom Fields and GPS Address Lookup

Lead, Contact, Deal, and Company each have 9 admin-configured custom fields (Text, Paragraph, Number, PickList, MultiPickList, Checkbox, Date, DateTimePicker, URL) — environment-conditional, not guaranteed to exist identically on qa/stage/prod. `BasePage`'s "Custom Field Helpers" section holds every generic fill/select/assert method (parameterized by the raw Kylas field name, e.g. `"TextField"`); a module only needs its own `<MODULE>_CUSTOM_FIELD_NAMES` constant plus a thin `fill<Entity>CustomFields()`/`assert<Entity>CustomFieldsOnDetail()` wrapper. Full field-by-field mechanism (validation quirks per type, the DateTimePicker's two-widget split, the Internal-Name-vs-Label safety note) is in `.claude/reference-patterns.md` §9–10.

Contact's address field and Meeting's location field also expose a "Get GPS Address" lookup — a live, Google-Places-style autocomplete, not browser geolocation. `BasePage.fillAddressViaGpsOrManual()` tries GPS search first and falls back to a manual address string if the trigger isn't present or no predictions return.

### Retry / Flake Mitigation

`config.searchRetry` (per-env retry count + wait) drives every `searchAndOpen*`/`retryFind*` method across modules. Meetings use a separate, longer `config.meetingRetry` because calendar-data aggregation is measurably slower. **Never hardcode a retry count or a `waitForTimeout` loop** — always read from config, and size the budget per environment from real measured latency (rule 19 in `CLAUDE.md`).

### Error Collection (`src/error-collector/`)

`ErrorCollector` is a singleton attached by the fixtures to every `adminPage`/`restrictedPage`, passively capturing `pageerror`, `console-error` (type `error`), `requestfailed`, and any HTTP response `>=400` during every test — independent of whether the test itself asserts on anything. `errorFilters.ts` classifies each captured error into one of three buckets before it's written to `reports/<env>/misc-errors.json`:
1. **Noise** (`isNoise()`) — dropped entirely: third-party scripts (Grammarly, Sentry, Stripe, font/CDN assets), HTTP 429 rate-limiting, and `ERR_ABORTED` on a large, individually-enumerated list of background/prefetch endpoints Playwright's own navigation legitimately cancels mid-flight.
2. **Expected RBAC** (`isExpectedRbacError()`) — HTTP 422/errorCode `029003`, or specific "you don't have permission" patterns. The CRM correctly denying restricted-user access — expected, still counted and shown, never flagged as a regression.
3. **Known background noise** (`isExpectedBackgroundNoise()`) — a deliberately narrow, individually-live-confirmed subset of endpoints (AI-workflow subscription checks, calendar-integration status, marketplace widgets, tenant usage/feature checks, dashboard summary polls) where a completed 4xx/5xx has been confirmed to never correlate with a test failure. Every entity CRUD/detail/search/layout endpoint is deliberately excluded — those are load-bearing, so a real failure there must keep surfacing. **Widening this list without the same live-evidence bar is exactly the kind of change that could quietly bury a real outage.**

Anything not caught by one of these three buckets is unexpected and is what the end-of-run email and `misc-errors.json` treat as worth investigating.

### Products & Services — Deliberate Deviations from the Standard Module Pattern

Confirmed live and documented here specifically so this module's real, deliberate departures from every other module's shape don't get "normalized" back to the standard pattern by a future session that hasn't read this. Full investigation/build history: `PRODUCTS_AND_SERVICES_PROGRESS.md`.

1. **Lives on the Settings page, not Sales.** Every other module's CRUD lives under `/sales/<module>/...`; Products & Services lives entirely under `/setup/products-services/...` (`list`, `create`, `edit/{id}`) — a Settings-area entity, not a Sales-pipeline one, despite being test-driven with the exact same `adminPage`/`restrictedPage` fixtures and page-object conventions as every other module.
2. **No detail page.** Every other module has a distinct `/details/{id}` view separate from its edit form. Products & Services has none — `edit/{id}` is the only per-record page; there is no read-only detail view to navigate to or assert against. Any future `waitForEntityDetailPage()`-style helper reuse for this module is a category error, not a missing feature.
3. **Fresh-per-run fixtures (redesigned 2026-08-11, reversing the original "3 permanent fixtures" model — confirmed and approved).** Three products (`adminActive`, `restrictedActive`, `inactive` — see `generateProductFixtureDefinitions()` in `productsAndServicesFactory.ts`) are now created UNCONDITIONALLY every distinct test run — no search-first, no get-or-create, no active-state-drift check — with a realistic name (cars/bikes/laptops/mobiles pool) + a run-unique suffix + a `[QA-Auto]` tag, referenced by ID from `src/data/productFixtures/<env>.json` (overwritten fresh every run). Used by every test WITHIN one run; a different run creates a different new set. Products are never deleted, so this means real, permanent accumulation in the shared Products & Services picker over time — a deliberate, accepted tradeoff, not a defect to flag. This still inverts the "generate fresh data every test" convention every other module follows in one respect — the 3 fixtures are shared across all tests *within* a run, not created per-test — but no longer in the cross-run-permanence sense the original design used. See the CRITICAL `adminActive` corruption incident in `PRODUCTS_AND_SERVICES_PROGRESS.md` for why fixture mutations still need care even under the new model (a corrupted fixture is still shared by every test in that run). **No new product may ever be created beyond these 3 role-based fixtures per run** — still an absolute constraint, just no longer "beyond these 3, ever, for the life of the environment."
4. **RESOLVED 2026-08-11.** A restricted user attempting to edit an admin-owned product fixture gets HTTP 403 with `errorCode: "00902001"` (confirmed live: the field is literally named `code`, not `errorCode`, in the actual response body) — a Products-specific shape, not the `029003`/422 pattern every other module's RBAC denials use. **A deeper bug than originally scoped was found while fixing this:** `errorFilters.ts`'s `RBAC_EXPECTED_STATUS_CODES`/`RBAC_EXPECTED_ERROR_CODES` arrays were declared and exported but never actually *read* anywhere — `isExpectedRbacError()` hardcoded `'422'`/`'029003'` as inline string checks instead, and even that hardcoded check was itself dead in practice, since the raw error code was never captured into any string the check could match against (only the human-readable `message` field was captured, never `errorCode`/`code`). Adding `403`/`00902001` to the arrays alone would have changed nothing. **Real fix applied:** `src/fixtures/index.ts` now also captures the raw error code (`json?.errorCode || json?.code`) into a new `apiErrorCode` field threaded through `MiscError` → `isExpectedRbacError(message, apiErrorMessage, statusCode, apiErrorCode)`, which now checks `statusCode`/`apiErrorCode` against the two arrays as its primary, precise check — making them genuinely load-bearing for the first time — with the old message-text-pattern matching kept as a fallback for the pre-existing 029003/"Invalid company"/"Invalid contact" case, which had only ever worked through that fallback anyway.
