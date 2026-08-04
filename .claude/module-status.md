## Module Status
(counts below verified fresh via `npx playwright test --project=chromium --list` on 2026-07-28 — 285 tests total across 17 files; see README.md's Project Overview table for the full per-module UI/RBAC breakdown)

**Full regression evidence (2026-07-28):** all 10 UI+RBAC spec files touched by this session's work (Companies, Contacts, Deals, Leads, Tasks) run in full on **stage**, real evidence not assumed: **189 passed, 0 failed, 0 flaky, 4 skipped** (193 total — the 4 skips are the expected CO18/CO19 + COR21/COR22 graceful skip, Company custom fields not yet present on stage) — confirmed clean across separate per-file runs (`companies.rbac.spec.ts` 22/22, `contacts.rbac.spec.ts` 19/19, `deals.rbac.spec.ts` 25/25, `leads.rbac.spec.ts` 27/27, `tasks.rbac.spec.ts` 11/11, `companies.spec.ts` 19/19 incl. 2 skips, `contacts.spec.ts` 19/19, `deals.spec.ts` 19/19, `leads.spec.ts` 21/21, `tasks.spec.ts` 11/11). Two unrelated network-connectivity drops and one memory-pressure process kill occurred mid-verification (all confirmed via direct `curl`/`free -h` evidence, not assumed) — each one discarded its own polluted partial data and was re-run clean from a precise per-file remaining-count, never silently absorbed into the final numbers.
- ✅ Leads (48 tests: 21 UI + 27 RBAC) — +4 vs. 2026-07-17 (L20/L21 UI, L30/L31 RBAC — the Company/Contact Lookup custom-field tests, see Known Issues)
- ✅ Companies (41 tests: 19 UI + 22 RBAC) — +4 vs. 2026-07-27 (CO18/CO19 UI + COR21/COR22 RBAC — the 9-custom-field create/edit tests for both admin and restricted user, see Known Issues)
- ✅ Contacts (38 tests: 19 UI + 19 RBAC)
- ✅ Deals (44 tests: 19 UI + 25 RBAC) — +5 vs. 2026-07-22 (D37/D38 UI — the 9-custom-field create/edit tests; D39/D40 RBAC — the same coverage for restricted user, added 2026-07-28 to close a gap where Deal had zero custom-field RBAC coverage despite Lead/Contact both having it; net +1 RBAC from splitting D13 into D13a/D13b, see Known Issues)
- ✅ Meetings (16 tests: 8 UI + 8 RBAC)
- ✅ Tasks (22 tests: 11 UI + 11 RBAC)
- ✅ Quotations (29 tests: 15 UI + 14 RBAC)
- ✅ Call Logs (43 tests: 21 UI + 22 RBAC)
- ✅ Dashboard/Login (4 tests, UI only)

---

