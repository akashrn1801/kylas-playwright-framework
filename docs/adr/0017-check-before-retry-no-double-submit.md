# ADR 0017 — Check before retry, never double-submit (hardening batch B4)

> **Purpose:** Records the B4 decisions of the 2026-11 hardening work: where the framework repeats a create or a click, and what it must check first. Extends [ADR 0014](0014-definitive-errors-and-ready-signals.md) and [ADR 0016](0016-first-attempt-hardening-framework-wide.md).
> **Read when:** Adding or changing a retry, a re-click, or an error-page recovery.
> **Size budget:** 12k chars (hard cap 60k)
> **Last verified:** 2026-11-05 @ 072b6b2

## Status
Accepted — 2026-11-05 (owner approved the B4 proposals). In the code, proven on QA only for the deals.rbac call-log path; the sandbox run on staging is the proof of the rest.

## Rule
A retry is allowed only for a read, an idempotent call, or a create that a CHECK shows was not written. The check is made first, from a source that answers at once (the database, not the search index) or by a bounded poll when only the index can answer. When the check cannot be made and no response was seen, the step fails by name. Nothing is clicked twice to "see if it works".

## Decisions
- **Leads Save is clicked once** (`clickSaveButtonAndVerifyRequestFires`). The loop that re-clicked up to 3 times after 4 s without a request is gone: a slow first click would be submitted twice. After the click it waits (10 s) for any of the app's answers: the create request, Save disabled or gone, or an inline error. If none is seen it does not click again; the response wait (60 s) classifies the outcome. Removed recovery: a click the app really lost now costs that wait and then the create check below, not a re-click; watch for it in the sandbox run.
- **`createLead` checks before it retries.** On a transient outcome it asks `GET /leads/has-duplicates` (answered from the database) whether the attempt's e-mail or phone now exists. Exists -> fails by name, no retry (the create went through). Unknown -> retries only if the backend answered with a retryable status (429/5xx, ADR 0014 section 1); no response at all and no way to check -> fails by name.
- **Quotation create 500** (and the "connection closed before response" reset, creates only): before the single retry it polls `POST /v1/quotations/search` for the quotation number (15 s, the index trails the write). Found -> fails by name, no retry. Not found, or no number readable -> one retry, as before (residual risk: an index lag beyond 15 s). Updates (PATCH/PUT) are idempotent and are repeated without the check. New `src/utils/quotationApi.ts`.
- **No success inferred from the URL.** `assertSuccessToast` and the inaccessible-entity save loop no longer treat "still on the list/detail URL" as success (an in-place modal save never changes the URL). The evidence is the success toast recorded from the click, or the save request's own 2xx (`lastSaveAnsweredOk`); otherwise the step fails naming the page.
- **deals.rbac `logCallFromDealPanel`** (was `logCallWithRetry`): one attempt. The 3x whole-flow retry could log the call twice and hid the first failure; the `aria-hidden` removal on `#callLogModal` is deleted: D21 passed on QA without it, and nothing shows the app leaves it set. The one re-click of "Log a call" stays (opening a modal is not a submit). The share-permission retry inside `CallLogsPage.saveCallLog()` stays (the save was refused, nothing written).
- **`withRateLimitRecovery` reloads only the 429 page.** On "Something is broken" it throws at once with the last failed request (`recentFailedWrite`/`recentFailedRead`), instead of reloading. `tryRecoverFromAppErrorBoundary` is no longer called.

## Not changed
`CallLogsPage.saveCallLog` permission retry, `TasksPage` inaccessible-relation retry and the quotation inaccessible-entity retry (a 029003 refusal writes nothing), login retries (ADR 0016 S2), `withSessionExpiryRetry` (sign-out, nothing written).
