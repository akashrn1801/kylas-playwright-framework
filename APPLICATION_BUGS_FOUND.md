# Application Bugs Found

Genuine Kylas app bugs discovered during test automation work — confirmed with live evidence, not test/framework defects. Each entry states what was confirmed, how, and what is *not* yet known.

---

## Call recording playback is blocked by the browser (ERR_BLOCKED_BY_ORB) — confirmed 2026-07-18

**What's broken:** The recording file attached to a Call Log fails to load/play in the browser. The native `<audio>` player renders but shows `0:00 / 0:00` (duration never resolves) — a real user cannot play back the recording.

**Root mechanism (confirmed, not inferred):** The signed download URL Kylas generates for the recording (DigitalOcean Spaces / S3-compatible storage) includes:
```
response-content-disposition=attachment%3B%20filename%3Dtest-recording.mp3
```
Forcing a `Content-Disposition: attachment` response header on a URL that the page then feeds to an inline `<audio>` element. Chromium's ORB (Opaque Response Blocking) — a standard browser security feature, not a test artifact — blocks the response because a `Content-Disposition: attachment` download response doesn't satisfy what a media element expects to consume inline.

**How this was confirmed (not a Playwright/headless-only artifact):**
1. First surfaced as background noise (`net::ERR_BLOCKED_BY_ORB`, `Resource type: media`) in the automated full-suite run (2026-07-18) across 3 distinct call recordings, both admin and restricted-user sessions, both RBAC and UI test files — 8 total occurrences, all on tests that still passed (the tests only assert a recording *appears*, never that it *plays*).
2. Independently reproduced in a **live, interactive, non-headless browser session** (not the automated test harness) on 2026-07-18: navigated to an existing call log (`Rosemary Hyatt`, call log id 167328) at `https://app-qa.sling-dev.com/sales/calls/list`, and captured via `browser_network_requests`:
   ```
   [GET] https://qa-call-recording.sgp1.digitaloceanspaces.com/.../167328_test-recording_1784366346.mp3?response-content-disposition=attachment...
     => [FAILED] net::ERR_BLOCKED_BY_ORB
   ```
3. Screenshot evidence (`logs/evidence/call-recording-orb-bug-2026-07-18.png`, not committed — gitignored) shows the Recording File section with the audio control stuck at `0:00 / 0:00`.

**Scope of what's confirmed vs. not:**
- Confirmed: the specific network request fails identically in a real interactive browser, not just headless test automation. This is standard Chromium engine behavior — any real user on Chrome would very likely hit the same block.
- Not confirmed: whether this affects all recordings/tenants or only ones uploaded via the QA seed/test-upload path; whether Staging/Prod signed URLs have the same `response-content-disposition=attachment` construction; whether some other playback path (e.g. a "download" button rather than inline play) works around it.

**Recommendation:** This is a backend/signed-URL configuration issue (the storage layer is generating an inline-playback URL with a forced download disposition) — needs whoever owns the call-recording upload/signing service to review whether `response-content-disposition` should be `inline` for playback URLs, reserving `attachment` only for an explicit "download" action. Not something fixable from this test suite.

**Test suite impact:** None currently — no test asserts on successful audio playback, so this doesn't fail any test today. Worth considering whether `call-logs.rbac.spec.ts` / `call-logs.spec.ts`'s "upload a recording file and verify recording appears" tests should also assert playback succeeds, which would have caught this automatically instead of relying on background-error review.
