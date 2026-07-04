# Failure Analysis — Full Suite Run (Staging, workers=2)

**Status:** Suite run complete. **Result: 236 passed, 0 failed, 0 flaky (1.9h).**

Run: `ENV=staging npx playwright test --project=chromium --workers=2 --reporter=line`
Started: 2026-07-04 ~10:28. Finished: 2026-07-04 ~12:19 (1.9h elapsed).

There are no failing or flaky tests to report from this run — every test passed on its first attempt, no retries were consumed. The per-test template below is kept for the next run that does produce failures.

---

## Status of the five previously-unproven items, this run

| Test | File:Line | Result this run |
|---|---|---|
| admin shares lead with Note Task Meeting Call permissions... (L20) | `tests/rbac/leads.rbac.spec.ts:421` | **Passed** |
| admin shares lead with Task permission... (L17) | `tests/rbac/leads.rbac.spec.ts:300` | **Passed** |
| restricted user cannot see Delete option on admin-assigned task (TK20) | `tests/rbac/tasks.rbac.spec.ts:229` | **Passed** |
| restricted user should verify grand total math (T23) | `tests/rbac/quotations.rbac.spec.ts:261`* | **Passed** |
| Restricted user should create a Contact call log with Outcome Busy... (CL21) | `tests/rbac/call-logs.rbac.spec.ts:60` | **Passed** |

\* Line number for T23 may have shifted slightly from the addition of T7b earlier tonight — confirmed by test title match in the log, not just line number.

All five passed cleanly under real concurrent load (workers=2, full 236-test suite, 1.9h run). This is the first real evidence — not isolated-run inference — that the fixes for L20/L17/TK20/T23 hold up under the actual load conditions that caused the original failures, and that CL21's original failure did not reproduce here either, consistent with the 10/10 clean isolated runs from earlier tonight.

---

## Notable non-failure observations from this run (for awareness, not action)

These did not cause any test failure — flagging only because they appeared in the background error collector during the run:

- **`saveQuotationHandlingInaccessibleEntities()` fired for real during this run** (not just in my earlier isolated testing): one quotation hit an inaccessible contact, was removed, still failed on company, company was removed too, then it succeeded — exactly the designed escalation path, confirmed working under real load.
- **MeetingsPage's existing (pre-existing, not part of tonight's changes) "Meeting form did not open on attempt 1/5 — retrying" fired once and recovered** — unrelated to tonight's fixes, working as designed.
- **Background `[MiscError]` entries** (401/404s on specific lead/contact/company/deal IDs, a 400 on `has-duplicates`, `ERR_BLOCKED_BY_ORB` on the S3-hosted call recording preview, a couple of `ERR_CONNECTION_CLOSED`/`ERR_ABORTED`): these are passive `ErrorCollector` captures, not tied to any failing assertion. The 404s on specific record IDs are consistent with one test's data being deleted/superseded while another concurrent test's background widget (recently-viewed, related-entity fetch) still references it — normal shared-environment noise under concurrency, not something that broke any test tonight.

---

<!-- Template for each failing/flaky test, filled in once a future run produces failures:

## <Test Name> — `<file>:<line>`

**Status:** Hard failure / Flaky

**What it does:**
<plain-language steps>

**Exact point of failure:**
<method, line, action>

**Error message:**
```
<full error text>
```

### Correct Flow (per Akash)


### Fix Applied


### Verified


-->
