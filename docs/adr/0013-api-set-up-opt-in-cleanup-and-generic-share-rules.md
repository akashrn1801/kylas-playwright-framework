# ADR 0013 — API set-up for Lead tests, opt-in cleanup fixtures, and generic share-rule support

> **Purpose:** Records why Lead tests now create and read data through the API, why cleanup is opt-in, how list preferences are protected, and why share rules are modelled for every entity rather than for leads.
> **Read when:** You add a test that creates records, change `src/fixtures/index.ts`, touch `src/utils/apiClient.ts` / `leadApi.ts` / `shareRuleApi.ts`, or give another entity share-rule tests.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-30 @ fdf15d2 (base commit of the work; changes uncommitted)

## Status
Accepted — 2026-10-30. Built and exercised on QA (single worker). The mutation and repeat-each results are in the build report, not here.

## Context
- Every Lead test created its data through the UI (a full form fill, minutes each) and none deleted it. QA held 14,745 leads, and the restricted user saw 2,806 admin-owned leads only through share rules old tests created and never removed (patterns matched the L10-L20 shares; no team or role rules exist; no rule grants the restricted user "all admin leads").
- Assertions read the persisted state through the list search (which trails a write) or through unscoped page text.
- A share is not a lead feature: the rule is created by `POST /v1/<entity>/{id}/share`, listed and edited on Setup → Data Management → Share Data, saved by `PUT /v1/<entity>/{id}/share/{ruleId}` and removed by `DELETE /v1/share-rules/{id}/delete`. Deleting a record removes its rules (0 left, checked live for leads).
- List sort, page size and view mode are stored per user (`POST /v1/search-lists/{id}/mark-as-preferred`, one call per setting, applied after a short delay). A test that changed them left the shared account in that state (seen: Kanban and "Last Name, Descending" persisted into later tests).
- `reports.spec.ts` / `reports.rbac.spec.ts` assert Lead totals against the API.

## Decision
- **`src/utils/apiClient.ts`** is the one base for API helpers (token, request context, error text); `leadApi.ts` and `shareRuleApi.ts` only hold endpoints. The Bearer value is read from the live page's localStorage (the JWT payload's `data.accessToken`, as `BasePage.fetchAuthenticatedApiData()` does), so no extra login happens (KI-51) and a teardown works after a page crash. A transport failure (no response at all) is retried once for GET/PUT/DELETE only, never POST, and every retry is logged with its URL.
- **Tests keep what they create (decision 2026-10-30, as the framework has always worked); QA is cleaned in one go later.** The fixtures `leadCleanup` (leads, plus task/meeting/call log via `trackRecord`) and `shareRuleCleanup` (entity type + rule id) in `src/fixtures/index.ts` register records but **delete nothing by default**. With `CLEANUP_TEST_DATA=1` (`config.cleanupTestData`) they delete only the registered IDs (the deal/contact/company a conversion created first, found from `conversionDetails`), never search-and-delete, never throw. Restoring the owner's list sort/size/view is NOT deletion and always runs.
- **Every record a Leads test creates is logged (type, ID, URL) and added to the test's annotations** by `src/utils/createdRecords.ts` (called from `LeadsPage`, `LeadApi` and the Leads specs; conversion-created records are logged at teardown), so each can be opened in Kylas afterwards.
- Deleting that is the feature under test (delete-lead, bulk delete, delete share rule) stays in the tests.
- **Unique contact values (2026-10-30):** the accounts reject a lead/contact/company whose e-mail or phone is already used (staging and QA: `EMAIL_PHONE`) and kept data only grows, so every e-mail and phone tests send comes from `src/data/factories/uniqueValues.ts` (e-mail: epoch ms + per-process counter + 8 random hex digits; phone: random 10 digits starting 6-9, never repeated in a process). The phone space is small, so lead creates also ask the app first (`GET /v1/leads/has-duplicates`, database-backed, answered at once): `LeadsPage.createLead` swaps a used value (max 5, then fails loudly) and `LeadApi.createLead` fails loudly on a used value. Contacts and companies use the unique values but have no pre-check.
- **Shared share-rule vocabulary** in `src/core/sharePermissions.ts` (permissions, `permissionSet()`, `SHARE_ENTITIES` = label + API path), `ShareRuleApi`, and an entity-agnostic `ShareRulesPage`. Only Lead is verified; another entity adds one `SHARE_ENTITIES` entry and its own page-object checks.
- **Every share or RBAC test creates its own brand-new record** and checks that exactly one rule applies to it.
- Known Kylas defects: the test asserts the correct behaviour and carries `test.fail(true, 'Kylas bug SD-…')` after its set-up assertions (L77: SD-32157, L79: SD-32158), so it stays green until fixed (KI-52, RUNBOOK).

## Consequences
- Good: setup takes seconds instead of minutes; assertions read the server's own state; per-permission access checks can be reused for other entities.
- Cost: kept data grows (tests use unique names/e-mails and never assume list sizes or a clean QA); new tests depend on the API shapes captured on 2026-10-30 (task, meeting, multipart call log, notes, share rules); a hard-coded meeting time zone id (372) is the one unavoidable literal.
- Not covered: Map view (loads Google Maps), list view-mode semantics for other entities, selecting another entity type on the Share Data filter, call logs by API for non-lead entities.

## Rejected
- **Deleting test data by default (first version of this ADR):** reversed 2026-10-30; one later bulk cleanup (Setup → Data Management → Share Data for old shares) is preferred.
- **A global auto-cleanup of every test's leads:** the Reports specs assert Lead totals, so deleting other tests' leads could shift them mid-run.
- **Per-entity share helpers:** the feature is one page and one API; copies would drift.
- **Retrying every API call, or POST:** a retried create could create a duplicate; a hang-up was seen once and could not be reproduced (360 calls, fresh/shared/parallel/idle) — it is unexplained, so the retry is deliberately narrow.
- **Shortening the restore with "sleep until applied":** preference writes are applied with a delay, so the next read polls the real state instead.

## How to revert
Remove the two fixtures and `src/utils/{apiClient,leadApi,shareRuleApi}.ts`, `src/core/sharePermissions.ts`, `src/modules/shareRules/`; the tests that use them (marked in the build report) go with them. Existing tests do not depend on any of it.

## Commit(s)
Not committed yet (the maintainer commits).
