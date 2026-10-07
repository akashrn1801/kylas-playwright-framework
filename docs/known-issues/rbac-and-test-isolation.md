# RBAC and Test Isolation — Resolved History

> **Purpose:** Resolved RBAC test-isolation bugs, retracted app-bug claims, Lead lookup-field fixes, and durable per-module Hide-Empty-Fields behavior.
> **Read when:** writing an RBAC test, suspecting an "app bug" in permissions/sharing, or touching Hide Empty Fields tests.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Open items: [../KNOWN_ISSUES_ACTIVE.md](../KNOWN_ISSUES_ACTIVE.md) (KI-04, KI-22). Real product bugs: [../../APPLICATION_BUGS.md](../../APPLICATION_BUGS.md). Rules: [../PATTERNS.md](../PATTERNS.md).

### CR9 false conclusion from a reused record — 2026-07
- **Symptom:** An RBAC test concluded a permission leak.
- **Root cause:** It used a randomly selected pre-existing record, not a fresh one with zero prior access.
- **Fix:** isolated entities are created fresh in the test (rule 5); `ADM`/`SHR` factory prefixes make negative assertions trustworthy on never-cleaned data.
- **Revert:** n/a.
- **Commit:** unknown — see `git log --grep=CR9`.

### Retracted "app bugs": Deal Contact persistence and company-share bypass — 2026-08-11
- **Symptom:** Two previously confirmed Kylas bugs.
- **Root cause:** Neither reproduced: a full reload showed the Associated Contacts card correctly; the CR9 repro passed 3/3 (caveat: the narrow original race timing was not recreated).
- **Fix:** removed from the confirmed list. Standing lesson: never conclude "app bug" from headless evidence alone — verify headed first.
- **Revert:** n/a.
- **Commit:** unknown — see `git log --grep=retract`.

### D13b masked ownership bug — 2026-08-11
- **Symptom:** D13b failed on stage but not QA.
- **Root cause:** The test created its deal with no `associatedContactName`, falling into the random-pick path; QA's (retracted) display bug timed out first and masked it.
- **Fix:** create a contact explicitly and pin the deal to it (5/5 clean; stage regression 215/216 with the 1 failure being the pre-fix run).
- **Revert:** revert the D13b setup.
- **Commit:** unknown — see `git log -S'D13b'`.

### Lead Company/Contact Lookup custom fields: nine code bugs — 2026-07-22
- **Symptom:** L46/L47 and L30/L31 failed in varied ways (qa/stage/prod).
- **Root cause:** (1) non-cycling Bootstrap carousel not reset on detail page; (2) `CompaniesPage.clickAddCompany()` modal-open race; (3) transient backend 400 unclassified in `createCompany`/`createLead`/`createContact`; (4) Close-Lead toggle visibility flake; (5) ~9-minute share-modal hang from unbounded `userOption.click()` across Leads/Companies/Contacts/Deals, identical in `QuotationsPage.selectFromIsInvalidControl()`; (6) `DealsPage.selectFirstOptionFromDropdown()` random pick on a 25+-option list (stage — an old "qa/prod only" scoping had gone stale, rule 20); (7) `ContactsPage.selectFromContactDropdown()` unbounded click (6 call sites, prod).
- **Fix:** `revealDetailCarouselSlideFor()`; bounded re-click; classify create POST by body and retry only transient failures; bounded reload-and-retry sized from measured baselines; `openUserShareTypeSearch()` bounded click + 3 attempts in all 4 modules; batch-read + type to filter; bounded click. Each verified 3× on qa/staging/prod.
- **Revert:** revert per-method.
- **Commit:** `2a200f1`.

### Corrections to RBAC tests — 2026-08
- **Symptom:** CR13 titled "5 permissions"; Contact+Meeting/Company RBAC read as app bugs.
- **Root cause:** Quotation is genuinely inapplicable to Contacts' restricted view; the denial was correct RBAC enforcement.
- **Fix:** title corrected to 4; tests reframed as negative assertions with a positive counterpart.
- **Revert:** n/a.
- **Commit:** unknown — see `git log --grep=CR13`.

### Restricted-user Products & Services edit denial is 403/`00902001` — 2026-08-11
- **Symptom:** Expected-RBAC filtering never applied; Products denials showed as unexpected errors.
- **Root cause:** `errorFilters.ts` status/code arrays were declared but never read; the raw `errorCode`/`code` was never captured.
- **Fix:** `src/fixtures/index.ts` captures `json?.errorCode || json?.code` into `apiErrorCode`; `isExpectedRbacError()` checks status and code arrays first, message patterns as fallback. Detail: [products-and-services.md](./products-and-services.md).
- **Revert:** revert the `apiErrorCode` threading.
- **Commit:** `0c5d3bf`.

### Share-propagation lag on right-panel icons — 2026-08
- **Symptom:** `assertRightPanelIconVisible()` timed out in Leads/Deals right after a share.
- **Root cause:** Icon set comes from a permissions snapshot fetched once at mount; waiting longer cannot help.
- **Fix:** bounded reload-and-retry (fresh mount re-fetches), applied to Leads, Deals, Contacts, Companies.
- **Revert:** revert the retry loop per module.
- **Commit:** unknown — see `git log -S'assertRightPanelIconVisible'`.

### Right-panel "Call Logs" opened Emails — 2026-07
- **Symptom:** Clicking "Call Logs" on a Lead silently opened Emails.
- **Root cause:** Identical SVG gradient ID, `title=""` always empty.
- **Fix:** `data-original-title` plus a mutual-exclusion selector in Leads/Contacts/Deals/Companies.
- **Revert:** revert the locator.
- **Commit:** unknown — see `git log -S'data-original-title'`.

### Saving an edited Company had no network confirmation — 2026-08-25
- **Symptom:** COR7 searched under the new name before the save landed.
- **Root cause:** `CompaniesPage.saveEditedCompany()` did not await the PUT (Leads fixed the same class earlier). COR9 was unrelated (`browser.newContext()`/`isSessionValid()` infrastructure class).
- **Fix:** mirror the Leads confirmation (22/22 under `--workers=2`). The Contacts twin is still open (KI-22).
- **Revert:** revert `saveEditedCompany()`.
- **Commit:** `73fe067`.

### Hide Empty Fields: per-module tab/field behavior — 2026-09-08 (durable facts)

| Module | Quirk |
|---|---|
| Leads | Social fully collapses; Professional/Requirement/Other Details always mixed |
| Contacts | Social + Campaign Information fully collapse; Professional/Other Details always mixed |
| Companies | Social fully collapses; Other Details always mixed; no Professional-equivalent tab |
| Deals | Campaign Information never fully collapses (Campaign/Source auto-picked); check Sub Source/UTM Campaign fields directly |
| Tasks | No tab fully collapses; edit-modal save does not refresh the in-place detail panel — reload |
| Meetings | No tab fully collapses; Description is excluded from the toggle |
| Call Logs | Sentiment + Campaign Information fully collapse; Basic Info always mixed |
| Quotations | No tabs — field-level only |
| All | Relationship cards (Related Deals, Associated Contacts, Pending Activities, pipeline card) are never hidden; a field set to `0` counts as a value |

### Quotation RBAC create: HTTP 500 after rapid re-auth — 2026-08-09
- **Symptom:** `saveQuotationHandlingInaccessibleEntities()` failed with a backend `HTTP 500` on `POST /quotations/`.
- **Root cause:** Method confirmed unchanged; most plausible trigger was three rapid forced re-logins of the admin session (hypothesis, see KI-17). The bounded `openCreateForm()` made the failure legible instead of a silent 480s hang.
- **Fix:** bounded `openCreateForm()` click; no fix for the (unconfirmed) collision.
- **Revert:** revert the bounded click.
- **Commit:** unknown — see `git log -S'openCreateForm' -- src/modules/quotations`.
