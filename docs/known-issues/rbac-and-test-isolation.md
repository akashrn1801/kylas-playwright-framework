# RBAC and Test Isolation — Resolved History

> **Purpose:** Resolved RBAC test-isolation bugs, retracted app-bug claims, Lead lookup-field fixes, and durable per-module Hide-Empty-Fields behavior.
> **Read when:** writing an RBAC test, suspecting an "app bug" in permissions/sharing, or touching Hide Empty Fields tests.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 4a85ad7

Open items: [../KNOWN_ISSUES_ACTIVE.md](../KNOWN_ISSUES_ACTIVE.md) (KI-04, KI-22, KI-43). Real product bugs are tracked outside this repo. Rules: [../PATTERNS.md](../PATTERNS.md).

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
- **Root cause** (the heading says nine; only these seven are recorded): (1) non-cycling Bootstrap carousel not reset on detail page; (2) `CompaniesPage.clickAddCompany()` modal-open race; (3) transient backend 400 unclassified in `createCompany`/`createLead`/`createContact`; (4) Close-Lead toggle visibility flake; (5) ~9-minute share-modal hang from unbounded `userOption.click()` across Leads/Companies/Contacts/Deals, identical in `QuotationsPage.selectFromIsInvalidControl()`; (6) `DealsPage.selectFirstOptionFromDropdown()` random pick on a 25+-option list (stage — an old "qa/prod only" scoping had gone stale, rule 20); (7) `ContactsPage.selectFromContactDropdown()` unbounded click (6 call sites, prod).
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

### OPEN (KI-43): staging search index not reflecting new records — sandbox 38582148420 (64 failed) and 38690038228 (55 failed), 2026-10-14
- **Symptom:** two consecutive sandbox runs failed on code whose diff vs the last green stage run (`79859d6`) was comments/log strings only. 38582148420 (`ea8925f`): all 5 selective shards, 64 failed, 17 flaky. 38690038228 (staging, 2026-10-15 06:02Z): 55 failed, 20 flaky, 423 passed. Signatures: `.is-invalid__option` never visible after typing a just-created contact/company/deal name (about 25 tests: Deals, Companies, Leads, Quotations, Call Logs; also `No Deal/Lead/Contact options found` and `live search ... returned no options after 3 attempt(s)`); `retryFindDeal`/`retryFindCompany`/`retryFindLead`/`retryFindContact` returning false after the create (about 12); `POST /v1/meetings` 422 `01503001` "Invalid lead/contact/company/deal summary response." persisting through all 3 attempts of `saveMeetingRetryOnEntitySummaryLag` (11 tests; 39 meeting 422s in 38582148420 vs 1-2 expected RBAC 422s in stage 37953246450 / main 38396600241); `POST /call-logs/` 403 (9) and "No Deal options found" (call-logs, reports).
- **Root cause:** NOT established. HYPOTHESIS: the staging search indexer / event consumer was stalled or backlogged. No test-code fix is possible: the index did not catch up within 188 s, so no bounded wait could succeed.
- **Evidence:** shard 5 trace (`productsAndServices.rbac.spec.ts:189`, both attempts): `POST /v1/deals/` 201, `POST /v1/search/deal` `totalElements` unchanged 2 s later (5824 in 38582148420, 5828 in 38690038228), `GET /v1/search/deal/lookup?q=id:<name>` 200 `content: []` 9-11 s later. Worst in the first hours of 38582148420 (422s per UTC hour 14/15/16: 17/16/6; started 14:37Z). Live probe 2026-10-15 10:46Z (staging, `--retries=0`): created 1 deal, polled the same lookup every 2 s for 188 s: 90 of 90 polls 200 with 0 results; never findable. Green runs (stage 37953246450, main 38396600241) passed these tests first time on the same test code.
- **Not verified:** whether contacts/leads/companies were also never indexed (CI logs say yes; only deals were probed); why 5824 became 5828 between the runs; whether the 422/403 clusters share the indexer or are separate backend services.
- **Ask the Kylas dev team:** is the staging search indexer / event consumer for deal, contact, lead and company stalled or backlogged since about 2026-10-14; do the "summary response" (`01503001`) lookups for meetings read the same index; was there a staging deploy or reindex around 10-14 Oct. Do not add retries or longer waits.
- **2026-10-29 (run 40821683680, staging):** from the log, `leads.spec:543` first failed in `ContactsPage.fillContactForm` (Company search `"com"`, no transient error, so ONE attempt although the message said 3); its retry created a company at 06:12-06:13 and `Company Lookup` for `"Lang"` still found nothing at 06:15:21; the same company was found by later tests at 06:33 and 06:54. `meetings.rbac:187`: company saved 05:55:30, contact-form search for its exact name empty by 05:56:10. No `live search hit a transient` line appears anywhere in the log. Fixed on our side: contacts no longer pick a random company unless asked (`RANDOM_EXISTING_COMPANY`), and the message reports the real attempt count.
- **2026-10-26:** sandbox run 40279659288 (`a9f5372`, staging) passed all 14 jobs; see KI-43 for the scope reading. A left-over probe deal named `Probe-IndexLag-*` exists on staging.
- **Commit:** n/a, no code change.

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

### Inconclusive one-off flakes, full list (moved from KNOWN_ISSUES_ACTIVE.md, KI-04) — 2026-07-06 … 2026-08-03
(a) Deals "log a Call on a shared deal" permission failure; (b) `quotations.rbac.spec.ts` ~8-minute timeout in `openCreateForm()`; (c) `call-logs.spec.ts` company live-search "no options"; (d) `meetings.spec.ts` reschedule failure (3× HTTP 500 on invitee lookup); (e) `tasks.rbac.spec.ts` edit-modal hang (hardened, 0/5 reproductions); (f) HTTP 500 on meeting creation and Deals RBAC Task-permission timeout (pass in isolation, fail in suite).
- **Evidence:** each was one occurrence or unreproducible locally; rule 21 forbids dismissing load-dependent flakes. Line numbers drift — search by test title. Detail: [rbac-and-test-isolation.md](./rbac-and-test-isolation.md), [locators-and-timing.md](./locators-and-timing.md).
- Original list: (a) Deals "log a Call on a shared deal" permission failure; (b) `quotations.rbac.spec.ts` ~8-minute timeout in `openCreateForm()`; (c) `call-logs.spec.ts` company live-search "no options"; (d) `meetings.spec.ts` reschedule failure (3× HTTP 500 on invitee lookup); (e) `tasks.rbac.spec.ts` edit-modal hang (hardened, 0/5 reproductions); (f) HTTP 500 on meeting creation and Deals RBAC Task-permission timeout (pass in isolation, fail in suite).

## Lead coverage work, 2026-10-30 (evidence for KI-52 to KI-54)

- **KI-52 (read-only share):** lead 769200 (owner admin 32495), one rule 1459489 granting only `read` (checked by `GET /v1/share-rules/{id}` and the Sharing page). Restricted user (JWT user id 32496), fresh page load: Notes, Tasks, Meetings and Call Logs icons and the Notes card absent. Same token: `POST /v1/notes/relation` 200 (admin sees it), `DELETE /v1/notes/{id}` 200 for own and for the admin's note, `POST /v1/tasks` 200 (admin sees it); `POST /v1/meetings` 422 `01503001`, `POST /v1/call-logs/` 403 `02001006`. Controls: unshared lead 400 `007003`; lead shared with Note/Task/Meeting/Call allows all four.
- **KI-53 (old shares):** of 17,316 share rules, 5 are "all records" rules and all point restricted → admin; the rest are single-record user-to-user rules (no team/role rules). The 2,806 admin leads visible to the restricted user carry exactly the permission mixes the share tests grant (none with delete). Deleting a lead leaves 0 rules for it.
- **KI-54 (sessions):** both roles reported invalid within 20 s at the start of two runs; the restricted page rendered blank for 60 s; the next test recovered. Tokens from other helper sessions stayed valid, so a plain "newer login kills older token" does not explain it.
- **KI-55 (meeting id, inconclusive, hardened):** "Meeting ID not captured" was not reproduced; `MeetingsPage.captureIdFromResponse` now matches only the create URL and L18/L20 prove the meeting by its unique title (Meetings regression 10/10 passed).

