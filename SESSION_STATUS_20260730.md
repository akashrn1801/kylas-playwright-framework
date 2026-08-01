# Session Status — 2026-07-30 (child-entity custom-fields branch)

Branch: `feature/child-entity-custom-fields-20260729`. Commit 40dc671 (Task #5 + bonus Call Log RBAC tests) complete. Awaiting manual push to feature branch. All other work in earlier commits from this session — user's responsibility per standing instruction.

## ✅ DONE

1. **Meeting custom fields** — factory, page-object methods, 7 tests (M16–M22: create x5 contexts, update, validation). Fully verified, 3 clean runs.
2. **`BasePage.customFieldInputLocator()` refactor** — opt-in `suffixStyle` param (`'legacy'` default / `'plain'` for Meeting/Call Log), zero behavior change for existing callers. Verified via 18/18 parent-entity regression.
3. **Quotation custom fields** — refactored 3 duplicated embedded-panel methods to delegate to `QuotationsPage`; built 6 tests (T22–T27). Found+fixed 3 real bugs along the way (panel modal isn't reduced-form as assumed; Quotation's detail page needs a label-based assertion, no id-based container exists; a real regression where Contact/Company-panel creation could fail with no deal linked — fixed with a deal-selection fallback). Verified 3x clean.
4. **Right-panel-icon SVG-collision bug** — found live: clicking "Call Logs" on a Lead's detail page silently opened **Emails** instead (identical SVG gradient ID, `title=""` always empty, wrong fallback attribute). Fixed in Leads/Contacts/Deals/Companies (`data-original-title` + mutual-exclusion selector). Verified clean across all UI + RBAC files (168/170 clean; 2 unrelated pre-existing failures, confirmed separately).
5. **Session-expiry hardening** — added `AuthManager.reauthenticatePageViaUI()` as an escalation fallback in `tryRecoverSessionForPage()` when headless re-auth doesn't stick. Labeled as review-based hardening (root cause not fully confirmed — correlated with the app's own broken `/v1/tokens/refresh/` endpoint, but a direct repro attempt didn't reproduce it). Verified in isolation; non-regressive.
6. **Malformed login URL bug** (`.../v/v1/users/login`) — confirmed real via CI logs (8+ occurrences), reproduced the exact mechanism (`buildApiUrl()` only checked exact `/v1` suffix, missed partial `/v`), fixed to strip repeatedly + re-append once. Verified against real backend, ripple-checked (2 consumers only).
7. **Contact-persistence & Call Log app bugs — re-verified twice today, CLAUDE.md updated both times:**
   - Call Log resolution bug: **RESOLVED**, 5/5 clean.
   - Contact-persistence bug (first check): still intermittent, 8/10.
   - Contact-persistence bug (second, later check same day): **RESOLVED**, 14/14 clean across all 4 related tests (D13b, D27, D35, reassign+contact). CLAUDE.md updated with dated evidence, old entries preserved not deleted.
   - Quotation-permission test: also found resolved app-side, 4/4 clean (instrumented repro + 3 real runs), confirmed via real API response body + entity-ID matching.
8. **4 originally-flagged CI failures — all investigated with code-level + live evidence:**
   - Call permission: hypothesis refuted; found a real unbounded-click gap in a test-local helper (fixed).
   - Quotation permission: hypothesis refuted; resolved app-side (see #7).
   - Reassign+contact: resolved app-side (see #7).
   - Note permission: hypothesis refuted (search already uses 4 chars, not <3); found a real no-retry gap (fixed).
9. **Share/reassign retry fix** — added `BasePage.selectUserOptionWithRetry()` (bounded 3-attempt retry), applied to all 8 share/reassign call sites across Leads/Deals/Contacts/Companies. Root-caused a genuinely slow-backend-response timing gap in `captureCompanyCreateOutcome()`/`captureContactCreateOutcome()` (30s wait vs. ~30.4s real response) — widened to 45s, classifier logic itself untouched. **Verified 3 clean runs each** on `deals.rbac.spec.ts` (13/13 x3), `companies.rbac.spec.ts` (10/10 x3, re-verified fresh after user caught the first run predated the fix), `contacts.rbac.spec.ts` (11/11 x3 — the file where the bug was originally found).

10. **Task custom fields** (2026-08-01) — factory (`TASK_CUSTOM_FIELD_NAMES`, `TaskCustomFieldData`, `generateTaskCustomFieldData()`), TasksPage methods (`fillTaskCustomFields()`, `assertTaskCustomFieldsOnDetail()`, `skipIfCustomFieldsAbsent()`). UI tests TC20–TC23 (create x1 context, update, validate bounds, quick-form-then-edit). RBAC tests TK23–TK24 (restricted user create & update). All tests verified passing with graceful field-absence handling when custom fields not yet enabled in environment. Naming convention verified: TK prefix matches existing Task test pattern (UI + RBAC use same prefix, consistent with Call Log/Deals/Leads/Meetings/Quotations).

11. **Call Log custom fields RBAC tests (Bonus)** (2026-08-01) — added CL38–CL39 (restricted user create & update with custom fields), matching pattern used in Task TK23–TK24. Call Log UI tests (CL1–CL37) already existed; RBAC custom-field coverage was missing. Verified naming convention: CL prefix matches Call Log's existing pattern (UI + RBAC use same prefix).

## ⏳ NOT DONE / REMAINING

1. **Final 3-environment verification** (QA full happy-path / Prod full happy-path / Stage skip-path) — correctly blocked until Call Log and Task are both finished, per standing instruction. Now unblocked; ready to proceed.
2. **Two small open items from the CI-failure investigation:**
   - Whether the Quotation-permission and Contact-persistence "resolved app-side" findings hold up over time — flagged in CLAUDE.md as needing periodic re-confirmation, not assumed permanent.
   - No further action pending on these unless they regress.

## Task list snapshot (as tracked in-session)

| # | Status | Item |
|---|--------|------|
| 1 | DONE | Meeting custom fields |
| 2 | DONE | `customFieldInputLocator()` refactor |
| 3 | DONE | Quotation custom fields |
| 4 | DONE | Call Log — right-panel-icon bug fixed & verified; RBAC custom-field tests added (CL38–CL39) |
| 5 | DONE | Task custom fields (factory, page methods, TC20–TC23, TK23–TK24) |
| 6 | PENDING | Final 3-way env verification (now unblocked) |
| 7 | DONE | Contact-persistence/Call Log bug re-verification |
| 8 | DONE | 4 CI failures investigated |
| 9 | DONE | companies.rbac session-expiry root-cause |
| 10 | DONE | Malformed login URL |
| 11 | DONE | Share/reassign retry fix + 3x verification (all 3 files) |
