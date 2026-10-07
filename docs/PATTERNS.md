# Patterns

> **Purpose:** Short numbered do/don't rules for recurring shapes in this codebase. Each points at the real implementing method — code lives in source, not here.
> **Read when:** Before writing any interaction, locator, wait, factory, RBAC test or shared-state feature; or when a symptom looks like a known race.
> **Size budget:** 40k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

The standing rules themselves are one-liners in [CLAUDE.md](../CLAUDE.md). This file holds their mechanics. Structure/background: [ARCHITECTURE.md](./ARCHITECTURE.md). Terms: [GLOSSARY.md](./GLOSSARY.md). Rule IDs below are `P<n>`.

## Interaction

**P1. Bound every click/fill; make it retry-capable or fail fast.** No raw `.click()`/`.fill()`/`.waitFor()` without a timeout. A click that "registers" while React has not attached its handler is a repeated bug class. Exemplars: `BasePage.click()`, `CompaniesPage.openUserShareTypeSearch()` (bounded click + 3 attempts). Known unfixed instances: `LeadsPage` (close-reason radio, convert-to-deal product pick), several `QuotationsPage` random-option pickers — see [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md).

**P2. Random react-select pick → `BasePage.selectRandomOptionWithRetry()`.** 3 attempts, each bounded, each re-rolling the index (one index can be persistently non-actionable). Don't write another unbounded read+click.

**P3. Ellipsis menu: gate the toggle on `aria-expanded`.** The button is a Bootstrap `dropdown-toggle`; a second click *closes* it. Check the button's own `aria-expanded !== 'true'` before clicking — not a page-wide `.dropdown-menu.show` (Leads has a second dropdown). Exemplar: `openEllipsisMenu()` in Leads/Deals/Contacts/Companies. Edit button ids differ (`#edit-action` Contacts; `#edit-action-btn` Leads/Companies).

**P4. Share modal: search needs ≥3 characters; click the permission label via JS.** Pick the first name word ≥3 chars (else first 3 chars). Permission toggles are clicked via the sibling `label` (CSS sibling selectors are unreliable). Share keys: `update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`. Reassign has the identical shape with its own search input. Exemplar: each module's `shareXxx()`/`openUserShareTypeSearch()`.

**P5. Clone: verify via stable end-state, not the modal.** Capture the new ID from a versioned network response (P17), assert it differs from the original, read the name on the clone's own settled detail page. Modal pre-fill can commit late: wait for the Name input to actually contain "Copy" before Save (a click-then-retry attempt was measured worse and reverted). Check `.modal-title` — `#editEntityModal` is shared by Edit/Clone/Add-Contact/Add-Quotation. Exemplar: `DealsPage.cloneDeal()`/`assertClonedDealName()`. Clone of Lead/Contact pre-fills email/phone: change them or the duplicate check rejects Save.

**P6. Verify any mutation by its own end-state.** A UI value read mid-modal/mid-transition can precede the commit; making that check "non-fatal" without a backstop lets wrong data through. Prefer a hard signal (response ID, URL change) plus a content check on a separately loaded page.

**P7. A modal that needs reconciliation before Save is a feature, not a bug.** Deal edit + product add opens a body-level "Distribute Equally" portal (`.installments-modal.distribute-modal`, outside `#editEntityModal`) that must be resolved first. Exemplar: `DealsPage.handleDistributeUnallocatedAmountIfPresent()`. Never conclude "app bug" from headless evidence alone — verify headed.

**P8. Obstruction: verify the real click target.** An emotion-generated overlay can linger after the semantic menu state says closed. Use `BasePage.waitForClickTargetUnobstructed(locator)` (`document.elementFromPoint()` vs the locator's handle) before a click that has ever shown "intercepts pointer events"; don't guess overlay class names (hash-suffixed).

**P9. Blur with `document.activeElement.blur()`, never `Tab`.** Tab advances focus to the next element and can open a neighbouring react-select ("open on focus"), causing P8-class obstruction.

**P10. CKEditor 5 (Products & Services description): set via the model.** `.fill()` mutates only the DOM; call `.ckeditorInstance.setData()` on the `.ck-editor__editable` node. Exemplar: `ProductsAndServicesPage.setDescriptionViaCkEditor()`. The saved value is wrapped in a `<div>`, not `<p>`.

## Waits and races

**P11. No `waitForTimeout()`; use condition waits.** Blocked at pre-commit for new lines (older instances remain — see active issues). Waiting on the wrong thing is also a bug (P26).

**P12. List/detail readiness → `BasePage.waitForEntityListPage()` / `waitForEntityDetailPage()`.** URL-matches-once is not readiness (the router can bounce); the follow-up entity GET must not be swallowed by `.catch(() => null)`. Both are deadline-aware and reload-and-retry. Don't write a new inline `waitForXDetailsPage()`.

**P13. Menu "closed before I could click" → stability window.** A third-party widget (`viasocket.com` chatbot) can tear down a just-opened react-select 20–160ms later. After opening, require the menu to *survive* a short window (`waitFor hidden` timing out is success), retry on teardown. Exemplar: `ReportsPage.clickToOpenMenu()` (5 attempts, 500ms window). Do **not** block the domain via `page.route().abort()` (hung a browser session 30 min) or gate on the widget's response (re-render lands 130–160ms after it).

**P14. Response waits: arm before the click, with recovery.** `BasePage.armResponseWaitWithRecovery()`; a bare `waitForResponse()` after a covered click can still time out silently. Prefer `hasFired()`-style synchronous signals over flags when other code reacts faster than recovery.

**P15. Ready-signal for async-populated controls.** E.g. Pipeline react-select shows "No Options" until `GET /v1/pipelines/lookup` returns; `DealsPage.clickAddDeal()` arms that wait. Products chip clearing needs a settle loop confirming zero holds (`clearAllProducts()`). If a click "resolves but nothing happens", check async pre-fill/hydration first.

**P16. Per-test timeouts.** `test.setTimeout(480000)` on any test that creates/edits records. Retry/timeout budgets must be sized from measured latency per environment and must be deadline-aware when nested in a setup path; a retry-exhaustion path must fail loudly, never silently pick the first option (`CallLogsPage.searchAndSelectEntity()` is the known counter-example).

**P17. ID capture: versioned path, exclude `/reports/`, match method+status.** `/v1/<module>/` — never `.includes('/deals')` (false-positived against `/v4/reports/deals`). Exemplar: `LeadsPage.captureLeadIdFromResponse()` family. Match only 200/201 and classify transient vs real failures by body.

**P18. "Index lag" is a hypothesis to disprove, not a default.** Check first whether the search term discriminates the target (`BasePage.searchAndSelectByName()` once searched only the shared `[QA-Auto]` first word and got 50 capped results) and whether the data linkage is right (Associated Deal created without its contact).

**P19. Batch DOM reads.** Per-row `.nth(i).innerText()` loops → one `allTextContents()` (6–38× faster). Counts: read `span.update`, not `#totalRecords`.

**P20. Serial blocks and sharding.** `fullyParallel: true` gives no same-file shard guarantee; only `test.describe.configure({ mode: 'serial' })` keeps a block atomic. Scope `.serial` to the smallest block that needs it: on one failure Playwright re-runs the *whole* block, inflating retry counts and skip-cascading unrelated tests. Dependent tests must be serial; file boundaries protect nothing. ([ADR-0006](./adr/0006-serial-sub-blocks.md))

## Locators

**P21. Build on internal names, not labels.** Custom-field internal names (`cfTextField`) are immutable; display labels are admin-editable. Match by *suffix* with tag scoping (`input[id$=…], textarea[id$=…]`) — react-dates adds a `<p id="DateInput__screen-reader-message-…">` that ends with the same suffix. Numeric id prefixes are per-render wrapper indexes. Two suffix conventions exist (`legacy` vs `plain`); a wrong one silently no-ops, so it is a typed parameter.

**P22. "Unique today" is temporary.** Scope narrowly (exact `name="phoneNumbers[0]"` over `id*="input_phone_0"`; Deal estimated-closure date broke once Deal gained Date custom fields). GPS triggers are section-scoped (`getFormSectionContainer()`/`getGpsAddressTrigger()` throw on ambiguity). A `[id*=…]` compound match still exists in `QuotationsPage` (not confirmed broken).

**P23. Right-panel icons: SVG-id map + `data-original-title` + mutual exclusion.** `title` is always empty and two icons share a gradient id (Call Logs once silently opened Emails). Visibility can lag a fresh share because the permission snapshot is fetched at mount — bounded reload-and-retry (`assertRightPanelIconVisible()` in Leads/Deals/Contacts/Companies). Companies has no Call Logs icon.

**P24. Dual react-select class families on one form.** Most use `is-invalid__*`; Reports' Filters "Select Filter" uses `select__*`. Confirm each control's family live.

**P25. Detail-page carousel.** The detail view is a non-cycling Bootstrap carousel; reach a slide with `BasePage.revealDetailCarouselSlideFor()`. Detail-page tabs: `clickDetailPageTab()`.

## Data

**P26. Fresh data for isolation.** Any test needing "this record has zero prior access" creates it in the test (ADM/SHR factories) — never a randomly chosen existing record. `DealsPage.fillDealForm()` picks the associated contact/company at random on purpose; pass `associatedContactName`/`associatedCompanyName` when ownership matters.

**P27. Name factory properties after the real API field.** Reports' "Report Type" label is field `category`; "Entity Type" is `reportType`. Confirm via live `name`/`id`, not the label.

**P28. Never hardcode dropdown options, counts or indexes.** Read live from the DOM; presence-check environment-conditional fields and skip with a log line (`skipIfCustomFieldsAbsent()`, `ReportsPage.skipIfQuotationEntityTypeUnavailable()`).

**P29. Number custom field validates DIGIT-COUNT, not magnitude.** min=4/max=11: `11111111111` valid, `8` invalid. Boundary tests use digit counts.

**P30. `layoutCache` key is per-entity and not derivable.** IndexedDB `kylasStorage.layoutCache` keys: `leads`, `deals`, `contacts`, `companies`, `tasks`, but `products-services`. Hand-verify before adding one (`<ENTITY>_LAYOUT_CACHE_KEY` in the factory); a wrong key deletes nothing silently. `BasePage.clearApplicationCache()` takes the raw key.

**P31. Number/Date custom-field validation differs per type.** Text/URL validate inline on blur; Paragraph only via a generic server toast (`assertFormErrorToast()`); native number inputs make invalid values unenterable (skip with a comment, no fake test). The "Show Required & Important Fields" toggle persists — check `isChecked()` before clicking. DateTimePicker is two widgets (react-dates + `rc-time-picker`, time disabled until a date is set). `selectDateCustomField()`'s final day-cell click has an intermittent detach race, mitigated by a 1-attempt-then-typing fallback.

**P32. Notes: baseline-relative counts.** Capture the count before adding; assert `baseline + n`. Newest note first; delete via ellipsis → `button#confirm.btn-danger`. Note text lives in CKEditor iframes (skip the active editor).

**P33. Test labels.** Per-module prefix + sequential number in code comments/`logger.success`: Leads `L`, Deals `D`, Contacts `C`, Companies `CO`, Meetings `M`, Quotations `Q`, Products & Services `PS`, Tasks `TK`, Call Logs `CL`, Reports `R`, Dashboard `DB`, Form Fields `FF…`. UI and RBAC files number independently unless a collision forces a renumber — grep both for the next free number.

## Auth and recovery

**P34. Session expiry has several symptoms; protect all.** `/signIn` redirect, URL-unchanged "Forbidden" bootstrap page, and a covered click followed by a `waitForResponse` that never resolves. Any new raw `expect(...)` in a module file → `withSessionExpiryRecovery()`; page-state checks use `authManager.isSessionExpiryPage()`, never a bare URL match. Don't blind-retry share/reassign/clone/add-from-panel flows with `withSessionExpiryRetry()` (they assume an open detail view).

**P35. App error pages (429, "Something is broken") → `withRateLimitRecovery()`.** Reload-and-retry once; compose outside `withSessionExpiryRecovery()`. A sustained 429 window can defeat a plain reload — don't answer it with a longer timeout.

**P36. `config.buildApiUrl()` is the only URL normalizer.** Two bugs came from hand-rolled copies assuming `/v1` was present.

**P37. Never log a typed value without a sensitivity check.** `BasePage.fill()` redacts when the description matches `SENSITIVE_FIELD_PATTERN` (`password|token|secret|api[_-]?key…`); don't rely on `type="password"`.

**P38. Transient backend errors: classify by body, retry only transient.** Create flows retry only generic non-field errors with no session cause; never mask a real 4xx. `globalSetup` uses `withTransientRetry()` for 429/5xx only.

**P39. Test infrastructure can be the flake.** Before blaming one test or the backend, check whether unrelated tests sharing a custom lock/fixture path show the same symptom. "Save resolves but no request fires" is a client-side validation block (P43), not a backend/timing bug.

## RBAC

**P40. Negative assertions must be real absence checks.** Never `if (visible) {assert} else {log "correct RBAC"}` — it turns "page failed to load" into a pass. Admin creates with `generateAdminXxxData()`; restricted verifies absence. Share/reassign/clone tests poll through propagation lag (transient 403) and still fail loudly when a permission never arrives.

**P41. "List visible, edit blocked": prove it from the list.** The blocked edit page renders the app's "Forbidden" component, which `isSessionExpiryPage()` also recognizes — `navigateTo()` would attempt a re-login. Assert button absence/row non-interactivity (`FormFieldsConfigPage.assertAddFieldButtonAbsent()`, `assertRowNotClickable()`); never navigate to the blocked URL as the restricted user.

**P42. Design B.** UI file = admin-only; every restricted-role test lives in the RBAC file ([ADR-0004](./adr/0004-design-b-rbac-split.md)). RBAC-expected errors are classified `Expected RBAC`, shown as confirmation, not noise.

## Shared state and CI

**P43. Minimal-fill `{ minimal, onlyCustomField }`.** To test one field's validation on a form that needs much more to save, `fillXxxForm(data, { minimal: true, onlyCustomField })` skips non-essential sections and every other custom field (omitting `onlyCustomField` fills none). Callers omitting options get the original full fill. Reject-path tests must not go through `createXxx()` (it waits through transient retries for a request that never fires): open the form, fill, assert the inline error. A baseline record filled with random data can violate a constraint some earlier test left on an unrelated field — the symptom is "Save click resolved but no create request observed", retried identically.

**P44. Shared config-mutating helpers must handle any prior state.** `configureFieldLimit()` once hung on a Min input DOM-disabled by a leftover Regex; `configureFieldRegex()` switching to Email from a Min/Max-locking format left a stale numeric length. "Worked for entity X" is test-order luck; ask what a *different* file's test could leave behind.

**P45. A cross-process file lock protects only one filesystem.** Sharded CI = separate VMs. Dedicated fields per consumer ([ADR-0001](./adr/0001-dedicated-custom-fields.md)), a fixed co-located shard ([ADR-0002](./adr/0002-formfields-carve-out-from-sharding.md)) or genuine cross-machine coordination are the only real guarantees; `.serial` is necessary but not sufficient.

**P46. Lock staleness = holder heartbeat, with FIFO fairness.** Use `createFormFieldLock()`; don't build a fixed-age variant ([ADR-0005](./adr/0005-heartbeat-based-lock.md)). Classify tests per-test: mutating → lock-wrapped `test`; read-only → plain `baseTest`.

**P47. Shared-config suites register in `config/sharedConfigSuites.json`** so `scripts/plan-shards.ts` excludes them from bin-packing; the workflow matrix must match (`check:formfields-matrix-sync`).

**P48. Don't use Playwright's `dependencies` project feature.** It silently bypasses `--grep` for the dependency and re-runs it on a second invocation. Use self-contained per-test windows.

**P49. Run-count verification windows.** Report window is coarse (±1 calendar day); tag the entity with a unique field and filter, or use the narrow-window mode (IST wall-clock, `toIstWallClockDate()`); read totals from the report-data API response (`armReportDataResponseCapture()`), not the DOM tooltip.

**P50. Generated/ephemeral evidence.** `reports/<env>/misc-errors.json` and per-worker files are overwritten by every later run; copy before re-running. Before declaring work lost, check `git reflog`/`git stash list` and `git fetch`.

## Per-module quirks

**P51. Deals.** Product-row react-select is the same component as Quotations' (`BasePage.addProductRowAndSearchByName()` is reusable; `DealsPage.addProductRow()` just picks randomly). Fallback estimated value: `[id="1_21_input_estimatedValue"]`.

**P52. Contacts/Companies add-from-panel modal ids.** Company/Lead "Add Contact" modal: `[id="0_12_input_firstName"]`, `[id="0_13_input_lastName"]`, email `[id="1_11_input_email_0"]`, phone `[id="1_12_input_phone_0"]` (standalone form uses `input[name="firstName"]`, `input[name="emails[0].value"]`). Verify live before relying on ids.

**P53. Reports.** Three real routes (`/sales/reports/create`, `/details/<id>`, `/edit/<id>`) — Edit is a navigation, not a modal; needs a `waitForXEditPage()`-style wait. Dimensions/Metrics are lists of single-select rows (`react-beautiful-dnd`); an option picked in one row is removed from others; never assert an exact "Add New" row cap (a stale click counter drives it — got 14/22/2/~1–3). Drag-reorder is untested; if needed use element-to-element `dragTo()`, not pixel sequences. Validation shows inline text **and** a paginated carousel banner `(n/m)` — no existing helper covers it; read the page count. Call Log's date filter has "Logged At", not "Created At". See [reports-module](./known-issues/reports-module.md).

**P54. Dashboard Add-Dashlet wizard.** Three steps. Smartlist/Grouped Smartlists offer lead/deal/contact/company/email; Report offers lead/deal/contact/company/task/meeting/call (never email); Call Log dashlets exist only as Report type. Report dashlets depend on saved Reports of that entity — create a disposable Report first and select by exact name. Grouped Smartlists is a real multi-select (checkboxes; no app cap — the 2–4 range is a test choice), Smartlist/Report single-select (radios); option name is in a sibling `.col`, not the label. Its header is always the literal "Grouped Smartlists" — identify the dashlet by a selected row name. Each entity's first dashlet creates `id="{entity}_section"`. Use a disposable dashboard per test. See [dashboard-module](./known-issues/dashboard-module.md).

**P55. Hide Empty Fields toggle.** Relationship cards (Related Deals, Associated Contacts, Pending Activities, Deal pipeline card) are never hidden; a field of `0` counts as filled.

| Module | Behaviour |
|---|---|
| Leads | Social collapses fully; Professional/Requirement/Other Details always mixed |
| Contacts | Social + Campaign Information collapse; Professional/Other Details mixed |
| Companies | Social collapses; Other Details mixed; no Professional tab |
| Deals | Campaign Information never fully collapses (Campaign/Source auto-picked) — check Sub Source/UTM Campaign directly |
| Tasks | No tab collapses; edit save doesn't refresh the in-place panel — reload |
| Meetings | No tab collapses; Description is never hidden |
| Call Logs | Sentiment + Campaign Information collapse; Basic Info mixed |
| Quotations | No tabs; field-level only |

**P56. Products & Services.** Units is a genuine multi-select but workflows pick one; clear existing chips first (`selectFromReactSelect()`), opening needs `ArrowDown` after focus. Name uniqueness is checked live (`GET /products/has-duplicates`). Fixtures: three fresh per run, never create more ([products-and-services](./known-issues/products-and-services.md)).

**P57. Contact/Meeting.** Address/location field offers "Get GPS Address" (`fillAddressViaGpsOrManual()`); Lead has two identical triggers — scope by section.

**P58. Lookup custom fields (Company/Contact Lookup).** Live, RBAC-scoped server searches, not static picklists; `BasePage.selectLookupCustomField()` deliberately does not delegate to the generic searchable select (search token ≠ option display text).

**P59. Lead `fillEditForm()` is intentionally narrower than Contact's.** Lead edit does not re-fill Timezone/Country/Professional; extending it is an open maintainer decision.

**P60. Quotations.** `assertQuotationInList()` search is fuzzy OR-matching capped at 10 — can false-positive on the never-cleaned dataset (open). Quotation report entity type may not exist on stage/prod — presence-check.
