# Application Bugs

Genuine Kylas **application-level** bugs discovered during test automation work — confirmed with live evidence, not test/framework defects. Each entry states what was confirmed, how, which environment(s) it affects, and what is *not* yet known. Scope is deliberately narrow: this file tracks real product defects only. Repo/branch-hygiene issues, inconclusive/unreproduced flakes, and test-framework bugs belong in `CLAUDE.md`, not here — see [Investigated but not confirmed](#investigated-but-not-confirmed--excluded-from-this-list) at the bottom for what was deliberately kept out and why.

---

## 1. Call recording playback is blocked by the browser (`ERR_BLOCKED_BY_ORB`)

**Status:** Confirmed, unresolved. **First confirmed:** 2026-07-18.

**What's broken:** The recording file attached to a Call Log fails to load/play in the browser. The native `<audio>` player renders but shows `0:00 / 0:00` (duration never resolves) — a real user cannot play back the recording.

**Root mechanism (confirmed, not inferred):** The signed download URL Kylas generates for the recording (DigitalOcean Spaces / S3-compatible storage) includes:
```
response-content-disposition=attachment%3B%20filename%3Dtest-recording.mp3
```
This forces a `Content-Disposition: attachment` response header on a URL the page then feeds to an inline `<audio>` element. Chromium's ORB (Opaque Response Blocking) — a standard browser security feature, not a test artifact — blocks the response because a `Content-Disposition: attachment` download response doesn't satisfy what a media element expects to consume inline.

**Exact repro steps:**
1. Open any Call Log detail panel that has a recording file attached (admin or restricted user, RBAC or plain UI context — reproduced in both).
2. Observe the `<audio>` control: it renders but stays at `0:00 / 0:00`.
3. Inspect network traffic for the recording's `GET` request.

**Environments confirmed affected:** QA (`app-qa.sling-dev.com`). Not independently confirmed on Staging/Prod — the signed-URL construction may or may not differ there (open item, see below).

**Evidence:**
- Background noise (`net::ERR_BLOCKED_BY_ORB`, `Resource type: media`) observed in the automated full-suite run (2026-07-18) across 3 distinct call recordings, both admin and restricted-user sessions, both RBAC and UI test files — 8 total occurrences. All tests still passed (they only assert a recording *appears*, never that it *plays*).
- Independently reproduced in a **live, interactive, non-headless browser session** (not the automated test harness) on 2026-07-18: navigated to an existing call log (`Rosemary Hyatt`, call log id `167328`) at `https://app-qa.sling-dev.com/sales/calls/list`, captured via live network inspection:
  ```
  [GET] https://qa-call-recording.sgp1.digitaloceanspaces.com/.../167328_test-recording_1784366346.mp3?response-content-disposition=attachment...
    => [FAILED] net::ERR_BLOCKED_BY_ORB
  ```
- Screenshot evidence (`logs/evidence/call-recording-orb-bug-2026-07-18.png`, gitignored, local only) shows the Recording File section with the audio control stuck at `0:00 / 0:00`.

**Scope of what's confirmed vs. not:**
- Confirmed: the specific network request fails identically in a real interactive browser, not just headless test automation. This is standard Chromium engine behavior — any real user on Chrome would very likely hit the same block.
- Not confirmed: whether this affects all recordings/tenants or only ones uploaded via the QA seed/test-upload path; whether Staging/Prod signed URLs have the same `response-content-disposition=attachment` construction; whether some other playback path (e.g. a "download" button rather than inline play) works around it.

**Recommendation:** Backend/signed-URL configuration issue — the storage layer is generating an inline-playback URL with a forced-download disposition. Needs whoever owns the call-recording upload/signing service to review whether `response-content-disposition` should be `inline` for playback URLs, reserving `attachment` only for an explicit "download" action. Not fixable from this test suite.

**Test suite impact:** None currently — no test asserts on successful audio playback. Worth considering whether `call-logs.rbac.spec.ts` / `call-logs.spec.ts`'s "upload a recording file and verify recording appears" tests should also assert playback succeeds, which would have caught this automatically instead of relying on background-error review.

---

## 2. Deal's Contact association does not persist / display (Company association confirmed working correctly)

**Status:** Confirmed, unresolved, raised with the app team. **First confirmed:** 2026-07-24 (Deal custom-fields branch regression run); **independently confirmed via direct manual testing by the user, 2026-07-27**, who raised it as a bug for the app team.

**What's broken:** Adding a Contact to a Deal — via the create form's Associated Contacts field, the ellipsis menu's "Add Contact," or after a Reassign — should make that contact appear on the deal's detail page (`Associated Contacts` card) and be resolvable as a real linked entity. **Actual:** the contact never appears; the deal's Associated Contacts card shows "No Contacts found" / a count of 0, even though the save itself reports success with zero validation errors. **Company association has no such issue** — confirmed via 5/5 clean runs of a dedicated Company-only check.

**Exact repro steps (occurrence #1, most directly reproducible):**
1. Open an existing deal's ellipsis menu → "Add Contact."
2. Select any real, valid, existing contact (confirmed via log: `Associated contact selected: "Kallie Funk" (index 5 of 25)`).
3. Save. Observe: `No validation errors found in deal edit form` / `Deal updated` (a reported success).
4. Reload the deal detail page. Observe: `Associated Contacts: No Contacts found` (count 0, expected 1).

**Environment:** QA (confirmed) and Stage (independently reconfirmed live via the Call-permission test path, 2026-07-28 — same defect, different fresh deal ID).

**Every confirmed occurrence (5 independent code paths, same signature — 1 later retracted, see below):**
1. `tests/ui/deals/deals.spec.ts` — "admin should add an existing contact to a deal from ellipsis menu and verify in Associated Contacts" (D35): reproduced 3/3 in isolated single-worker runs.
2. `tests/rbac/deals.rbac.spec.ts` — "restricted user contact and company owned by restricted not admin" (original combined test, later split): `TimeoutError` waiting for `.deal-contact__name` to ever render.
3. `tests/rbac/deals.rbac.spec.ts` — "admin reassigns deal to restricted user and restricted becomes owner can edit and delete": `Error: Restricted user should be able to add a new contact after reassign — Expected: 1, Received: 0`.
4. `tests/rbac/deals.rbac.spec.ts` — "restricted user adds an existing contact to own deal via ellipsis": `Error: Associated contacts count should increase by 1 — Expected: 1, Received: 0`.
5. ~~"admin shares deal Quotation permission... can create quotation" (2026-07-27)~~ — **retracted 2026-07-28.** This occurrence's own evidence-gathering tool (`getAssociatedContactId()`) was later found to 404 silently in CI due to an unrelated `config.apiBaseUrl`-normalization bug, meaning it could report "no contact" even when a contact was genuinely linked. Direct API re-verification against 4 real deals from the original CI run (430321–430324) confirmed every one genuinely had its contact linked on the backend. Occurrences #1–4 are unaffected — they predate/don't depend on that tool.

**A clean counter-example that proves the bug is still real (not just an artifact of a broken checker):** the Call-permission RBAC test, re-verified with the fixed checker, correctly detected and shared the contact this time — and the test still failed, but later and differently: a live dialog appeared reading `heading "No Contact Associated"` / `"There is no contact associated for this deal. Please add associate a contact with the deal"`, on the exact same fresh deal (ID `430338`) that the now-fixed API check confirmed has `associatedContacts count: 1`. A live, fresh, direct API-vs-UI mismatch, independently reproduced.

**Investigated as a possible client-side race first, before accepting it as app-level (root-cause discipline applied):** the shared `BasePage.selectRandomOptionWithRetry()` helper had a real, latent gap (no wait for the react-select menu's close transition after the option click — the same race class already root-caused for `DealsPage.cloneDeal()`). Fixed defensively regardless, but **the failure reproduced identically even after this fix was applied** (confirmed via `tsc --noEmit`/`eslint` clean) — ruling out this specific client-side race as the cause.

**Plausible but unconfirmed connection to a separate, older, unresolved Deals flake** (see [Investigated but not confirmed](#investigated-but-not-confirmed--excluded-from-this-list) below): if Contact association only *sometimes* persists, that could plausibly explain the older "logging a Call on a shared deal intermittently fails" mystery — flagged as a hypothesis worth backend investigation, not a confirmed resolution of that older, separately-tracked issue.

**Recommendation:** Backend persistence/display defect in how a Deal's Contact association renders on the detail page and is read back — needs Kylas backend/DB investigation. Not fixable from this test suite. Do not retry, mask, or loosen any test around this; the tests are deliberately left asserting the correct expected behavior.

---

## 3. RBAC gap: restricted user can create a Meeting against a Contact whose associated Company was never shared

**Status:** Confirmed real app-level RBAC defect, unresolved, flagged for backend investigation. **First confirmed:** 2026-07-22 (Sandbox CI run `29935223512`); **recurred independently, 2026-07-23** (local full-suite run, single worker).

**What's broken:** A permission boundary that should always block Meeting creation in this scenario does — on every other observed attempt — except intermittently under a specific timing condition, where it lets the create through.

**Exact permission condition (unambiguous):** Admin shares a Contact with the restricted user, granting **only** the `meeting` permission (no `update`/`note`/`task`/`reassign`/`clone`/`delete`). The Contact's associated Company (set at creation) is **never independently shared** with the restricted user.

**Expected behavior (confirmed correct on every other attempt):** `POST /v1/meetings` → HTTP `422`, `errorCode: "01503001"`, `message: "Invalid company summary response."` — reproduced 4/4 clean in local isolation and on the same CI test's own Playwright-level retry.

**Actual observed behavior (the bug):** The create is allowed through — a real Meeting is persisted. Direct evidence quoted from the CI run's own ARIA page-snapshot (run `29935223512`, job `88974945922`):
```
- alertdialog:
    - text: Meeting created
    - generic: "(Meeting ID: 98430)"
...
- heading "Meeting-1784738138087 (#98430)"
- Invitees: User 1 (Organizer), link "S SHR1784738061652 Towne pending shr1784738061652@testkylas.com Contact"
    - /url: /sales/contacts/details/465646
```
Correlatable identifiers for backend log lookup: **Meeting ID 98430**, **Contact ID 465646** (`SHR1784738061652 Towne`), timestamp **2026-07-22T16:35:38.087Z**.

**Environment:** Sandbox-CI-adjacent QA (first occurrence), Stage (second occurrence, Meeting ID `10398`, Contact ID `89985`).

**Confirmed NOT a client-side artifact:** the test's own error-toast selectors were verified via 4 correctly-blocked local runs — there was no error toast because the backend genuinely returned success, not because the test failed to detect one.

**Root cause confirmed to be timing-dependent, not purely random (2026-07-23):** a controlled re-investigation, moving the verification check to *after* the meeting-creation attempt (matching the real test's actual sequence), found: of 8 attempts landing naturally in a 3.9–5.6s window between share-completion and Save, **2/8 reproduced the bug** (gaps of 5539ms and 4495ms — both `saveThrew=false, status=201`), 6/8 correctly blocked (gaps 3942–5621ms). Not a hard threshold — a 3942ms gap was correctly blocked while a nearly-identical 5539ms gap was not. Zero reproductions in 10 slower (10–25s) attempts. This is a genuine intermittent server-side race tied to how quickly the client moves from share-completion to the meeting-create request.

**Complete list of confirmed occurrences (real, persisted records):**

| Occurrence | Env | Meeting ID | Contact ID | Share→Save gap |
|---|---|---|---|---|
| Sandbox CI run 29935223512 (2026-07-22) | QA-adjacent | 98430 | 465646 | not captured |
| Stage full-suite run (2026-07-23) | Stage | 10398 | 89985 | 4067ms |
| Fast-timing repro attempt 6 (2026-07-23) | QA | 98487 | 465753 | 5539ms |
| Fast-timing repro attempt 8 (2026-07-23) | QA | 98488 | 465755 | 4495ms |

**Recommendation:** A materially serious defect class — the permission-check race manifests as a false-*allow* (a genuine security boundary bypassed under fast-request timing), not merely a false-deny delay. Needs server-side investigation into the meeting-creation permission-check code path's interaction with company-share propagation timing — outside what this client-side Playwright suite can fix. **Do not retry, mask, or loosen the test asserting the correct-deny behavior** — doing so would hide a real permission-boundary defect.

---

## 4. Companies "Annual Revenue" field — commented out due to a confirmed prod-side issue

**Status:** Confirmed at a basic level; evidence trail is thin (a one-line note carried forward from prior session history, not a full repro writeup). **Environment:** Prod.

**What's broken:** The Annual Revenue field on `CompaniesPage` is commented out in the codebase rather than exercised by tests, due to a confirmed prod-side bug with this field.

**What's not known:** The exact failure mode (validation rejection, display corruption, save failure, etc.) was not preserved in detail in any of the source material available at the time this file was consolidated — only the fact that it's commented out "(prod bug)" survived. If this needs re-investigating (e.g. before re-enabling the field), start with a fresh live repro on Prod rather than trusting this one-line note further, per the standing rule that a claim without full evidence should be re-verified before being relied on again.

**Recommendation:** Re-confirm live before re-enabling this field or building new coverage around it.

---

## Investigated but not confirmed — excluded from this list

These were investigated as possible application bugs but never reached the "confirmed" bar this file requires, or were explicitly determined not to be bugs. Full detail lives in `CLAUDE.md`'s Known Issues / Investigation History section — listed here only so nothing looks silently dropped:

- **Unexplained Deals flake (investigated 2026-07-06):** logging a Call on a deal shared with the restricted user intermittently fails with a permission error even when contact/company sharing is verified correct. Six controlled experiments, no consistent mechanism found across any of them — downgraded to "uncertain," not confirmed either way. Two later-discovered client-side bugs could have contaminated the original experiments, so this is explicitly not re-investigated without new evidence.
- **HTTP 500 on meeting creation with custom fields (2026-08-03 full-suite run):** one occurrence, backend `500` on `POST /v1/meetings` after a fully-valid form fill. Passed cleanly in isolation — classified **INCONCLUSIVE** (pass-in-isolation pattern suggests transient/load-dependent, but no server-side evidence was captured to confirm root cause).
- **Deals RBAC Task-permission 8.2-minute timeout (2026-08-03 full-suite run):** failed only under full-suite load, passed cleanly in isolation (4.5 min). Classified **INCONCLUSIVE** — a code-side cumulative RBAC-permission-check effect could not be ruled out for lack of response-time/session-state instrumentation.
- **Call Log custom-field validation (2026-08-03):** confirmed the backend does **not** enforce character-limit/format validation on Call Log custom fields, unlike Meeting/Quotation/Task. Explicitly classified **NOT A BUG** — validation is simply not yet built for this entity; the corresponding test is `test.skip()`-ed with a comment pending that backend work.
