# Products & Services — Resolved History and Durable Quirks

> **Purpose:** Durable facts, deliberate deviations and resolved incidents for the Products & Services (P&S) module.
> **Read when:** touching `ProductsAndServicesPage.ts`, P&S fixtures, product-row pickers on Deals/Quotations, or the Units / description / date-picker helpers.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Open P&S items (JWT lifetime, `assertQuotationInList()` false-positive, duplicated date pickers) are tracked in [KNOWN_ISSUES_ACTIVE.md](../KNOWN_ISSUES_ACTIVE.md) (KI-16, KI-23, KI-24). Module-agnostic rules are in [PATTERNS.md](../PATTERNS.md).

## Deliberate deviations from the standard module pattern

Do not "normalize" these back to the standard shape.

1. **Lives under Settings, not Sales.** Routes are `/setup/products-services/list`, `/create`, `/edit/{id}` — not `/sales/...`. It still uses the standard `adminPage`/`restrictedPage` fixtures and page-object conventions.
2. **No detail page.** `edit/{id}` is the only per-record page (view and edit). A `waitForEntityDetailPage()`-style helper is a category error here; row-click navigates straight to edit and there is no edit icon.
3. **Fresh-per-run fixtures.** Three products (`adminActive`, `restrictedActive`, `inactive`; see `generateProductFixtureDefinitions()` in `productsAndServicesFactory.ts`) are created unconditionally every run (realistic name + run-unique suffix + `[QA-Auto]` tag) and referenced by id from `src/data/productFixtures/<env>.json`, overwritten each run. They are shared by all tests *within* a run, never per test, and never deleted, so the shared product picker grows permanently (accepted tradeoff). No product beyond these three may be created per run. Creation is skipped when the invocation cannot reach a P&S spec (`src/auth/productFixtureNeed.ts`).
4. **RBAC denial shape differs.** A restricted user editing an admin-owned product gets HTTP 403 with body field `code: "00902001"` (not the `029003`/422 shape other modules use). See the `errorFilters.ts` incident below.
5. **Product-row search is the same component as Quotations'.** Deal and Quotation product rows share one react-select (`is-invalid__*` classes, `products.{row}.id`, live search, inactive products excluded); reuse `BasePage.addProductRowAndSearchByName()` rather than a Deal-specific variant. `DealsPage.addProductRow()` only picks randomly because it never needs the typing path.
6. **Product name uniqueness is enforced inline**, as-you-type/on-blur (`GET /products/has-duplicates?...`), not at save; `assertDuplicateNameFieldError()` asserts the live field state.
7. **Unit multi-select** needs `ArrowDown` after focus to open ("press Down to open" is async), and every workflow picks exactly one option.
8. **Custom-field id suffix style is `plain`** (`_input_cf<Name>`), not the legacy `customFieldValues.cf<Name>` — pass `suffixStyle: 'plain'`; a wrong style silently no-ops.

## Incidents

### CKEditor 5 description must be set through its data model — 2026-08
- **Symptom:** description typed via `.fill()`/`.type()` was absent from the saved payload.
- **Root cause:** CKEditor 5 keeps a virtual data model separate from the DOM; plain input only mutates the rendered DOM. The API also wraps saved content in a `<div>`, not `<p>`.
- **Fix:** `setDescriptionViaCkEditor()` calls `.ckeditorInstance.setData(text)` on the live `.ck-editor__editable` node; assertions allow the `<div>` wrapper.
- **Revert:** n/a — additive helper in `ProductsAndServicesPage.ts`.
- **Commit:** `0c5d3bf`

### `adminActive` fixture corrupted by the Units multi-select — 2026-08-10 (CRITICAL)
- **Symptom:** the permanent `adminActive` product lost/changed its unit; later tests timed out selecting a unit.
- **Root cause:** `selectFromReactSelect()` had no clear-existing-chip step. Harmless for single-select; for a multi-select a new pick only adds, and an already-selected option is excluded from the menu, so a second call targeting it finds nothing.
- **Fix:** bounded chip-clear-first logic; live fixture restored via an approved read-modify-write PUT and re-verified by GET diff.
- **Revert:** drop the chip-clear block in `selectFromReactSelect()` (not advised — corrupts shared fixtures).
- **Commit:** `0c5d3bf`

### `Distribute Equally` modal blocks Deal Save after adding a product — 2026-08-10
- **Symptom:** Deal edit + new product row: Save fired zero requests; initially concluded "unfixable app bug" from headless evidence.
- **Root cause:** a real feature — a body-level portal modal (`.installments-modal.distribute-modal`, NOT inside `#editEntityModal`) must be resolved before Save's handler does anything. Lesson: never conclude "app bug" from headless evidence alone; verify live, headed, first.
- **Fix:** `DealsPage.handleDistributeUnallocatedAmountIfPresent()` drives it automatically.
- **Revert:** remove the call from `DealsPage.fillEditForm()`; PS10/PS11 and Deal edit+product tests then fail.
- **Commit:** `0c5d3bf`

### RBAC 403 / `00902001` never matched the expected-RBAC filter — 2026-08-11
- **Symptom:** P&S RBAC denials surfaced as unexpected background errors.
- **Root cause:** `RBAC_EXPECTED_STATUS_CODES`/`RBAC_EXPECTED_ERROR_CODES` in `errorFilters.ts` were declared and exported but never read; `isExpectedRbacError()` hardcoded `'422'`/`'029003'`, and the raw error code was never captured (only the message).
- **Fix:** `src/fixtures/index.ts` captures `json?.errorCode || json?.code` into `apiErrorCode`, threaded through `MiscError` to `isExpectedRbacError(message, apiErrorMessage, statusCode, apiErrorCode)`, which now checks the two arrays first; text-pattern matching kept as fallback for `029003`.
- **Revert:** revert the `apiErrorCode` threading and restore inline checks.
- **Commit:** `0c5d3bf`

### Date-picker "element detached from the DOM" race on Deal edit — 2026-08
- **Symptom:** `BasePage.selectDateCustomField()`'s final day-cell click failed in roughly half of Deal create+edit cycles, always on edit's first calendar interaction.
- **Root cause:** only partly established. "Previous calendar still closing" was disproven (all date-picker widgets stay mounted, CSS-hidden). Leading, unconfirmed theory: `fillEditForm()`'s rapid fills leave a React re-render lagging as the first click fires. A 3-attempt reopen-and-retry had 0% retry success (recovery came from the typing fallback).
- **Fix:** simplified to one attempt then the typing fallback; verified 24/24 across two batches. The logged warning is expected, self-healing behavior. Shared by all modules with date custom fields.
- **Revert:** restore the retry loop in `selectDateCustomField()` (no benefit measured).
- **Commit:** `unknown — see git log -S'selectDateCustomField'`

### `clearAllProducts()` threw "chips still present" — 2026-08-22
- **Symptom:** `clearAllProducts()` failed with chips still present after the loop reported done.
- **Root cause:** async-hydration race — the Requirement section's product data had not finished hydrating, so the inner loop legitimately read zero before chips reappeared.
- **Fix:** bounded 4-round outer settle loop confirming the zero state holds (stability-window idiom, [PATTERNS.md](../PATTERNS.md)); a pre-existing `waitForTimeout(150)` removed in the same pass.
- **Revert:** remove the outer loop in `clearAllProducts()`.
- **Commit:** `0c5d3bf`

### `searchAndSelectByName()` searched only the first word — 2026-08-23
- **Symptom:** product lookup returned 50 alphabetical results with the target absent.
- **Root cause:** the search term was the first word only; every P&S fixture starts with the shared `[QA-Auto]` prefix, so the term could not discriminate. A second confirmed case where "index lag" was the wrong first guess.
- **Fix:** search with the full name (matches `addProductRowAndSearchByName()`); one caller.
- **Revert:** restore the first-word token in `BasePage.searchAndSelectByName()`.
- **Commit:** `unknown — see git log -S'searchAndSelectByName'`

### PS6 "browser closed" timeout collision — 2026-09-30
- **Symptom:** PS6 failed identically twice with `page.reload: Target page, context or browser has been closed`.
- **Root cause:** it was the only test in its file without `test.setTimeout(480000)`, so CI's 120000ms default undercut `waitForEntityListPage()`'s own summed internal waits; the outer timeout tore down the context mid-recovery. Not caused by concurrent job count (jobs run on isolated VMs).
- **Fix:** added the missing `test.setTimeout`; `BasePage.waitForEntityListPage()` made deadline-aware (see [locators-and-timing.md](./locators-and-timing.md)).
- **Revert:** n/a — the timeout line is the fix; deadline logic is in `BasePage.ts`.
- **Commit:** `unknown — see git log -S'waitForEntityListPage'`

## Resolved one-liners (2026-08-10 consolidated list)

- Item 1: `adminActive` corruption — fixed (above). Item 2: date-picker detachment — fixed (above).
- Two P&S spec comments still cite a progress file that no longer exists; the substance is in this file.
- `assertForbiddenOnRestrictedEdit()` 403/`00902001` handling, PS10/PS11 Distribute Equally fix and Batch 7's 12/12 regression are all closed.
- `npm run test:<module> -- <args>` appends args to the last `&&` command — a standing gotcha, documented in [CONTRIBUTING_TESTS.md](../CONTRIBUTING_TESTS.md).
