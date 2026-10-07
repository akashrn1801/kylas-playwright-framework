# Form Field Limits — Resolved History and Durable Rules

> **Purpose:** Durable rules and resolved incidents for the Form Field Limit feature (`/setup/fields/<entity>/list`, custom-field length/regex limits) across all six entities.
> **Read when:** adding an entity to formFields, editing `FormFieldsConfigPage.ts`, or any test that mutates account-wide field configuration.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Open failures (`FFPS5`, `FFRPS8`) are [KI-01](../KNOWN_ISSUES_ACTIVE.md#ki-01--ffps5-stable-across-re-testing-root-cause-unconfirmed) and KI-02. The 429 / error-boundary symptoms of run 36573185433 are in [rate-limits-and-error-pages.md](./rate-limits-and-error-pages.md); locking and sharding are in [sharding-and-locks.md](./sharding-and-locks.md). Generic rules are in [PATTERNS.md](../PATTERNS.md).

## Durable rules

1. **`layoutCache` key is per entity and not derivable.** Kylas caches `/v1/layouts/<entity>/...` in IndexedDB (`kylasStorage` → `layoutCache`). Keys: leads, deals, contacts, companies, tasks — but `products-services`, which no lowercase-plural rule predicts. Each entity's key is a hand-verified constant in its factory (e.g. `LEAD_LAYOUT_CACHE_KEY`) passed to `BasePage.clearApplicationCache()`; deleting a wrong key silently deletes nothing.
2. **Number custom field Min/Max Length validates digit count**, not magnitude: `11111111111` is valid under min=4/max=11; `8` is invalid. Write boundary tests against digit count. A past "stuck validation" app-bug claim was retracted for this reason.
3. **RBAC boundary is "list visible, edit blocked".** A restricted user sees a read-only list (no "Add Field", rows not clickable) and is blocked only on the individual edit page, which renders the app's "Forbidden" component — the same one `isSessionExpiryPage()` treats as session expiry, so `navigateTo()` would attempt re-login. Never navigate a restricted user to the edit URL; prove the boundary from the list (`FormFieldsConfigPage.assertRowNotClickable()`/`assertAddFieldButtonAbsent()`).
4. **RBAC baseline shape per entity:** 3 access-boundary tests + 4 admin-configures/restricted-verifies dual-fixture tests (Text/Number/Paragraph limits, one Regex format) + every single-restricted-role functional test (Design B, [ADR 0004](../adr/0004-design-b-rbac-split.md)). Lead was retrofitted last, deliberately.
5. **Full regex coverage standard:** 5 formats × valid/invalid × create/edit = 20 combinations per entity (Company first; Lead and Contact backfilled). Audit by reading the generator call sites (`generateValidXxxValue()`), not by grepping titles — wording diverges from the format's real name ("Driving Licence" vs "Driver Licence", "PAN number" vs "PAN Card").
6. **Dedicated custom field per consumer** ([ADR 0001](../adr/0001-dedicated-custom-fields.md), commit `ab06f5e`) ends the shared-field collision class at its root; locks only coordinate processes on one filesystem.
7. **Entity shape is parameterized:** `FormFieldsConfigPage` takes `{tabLabel, urlSlug}`, confirmed live per entity, never guessed.
8. **A shared config-mutating helper "working" for one entity is not evidence for another.** Ask what DOM/config state a different file's test could leave the field in, and whether the method handles it defensively.

## Incidents

### `configureFieldLimit()` hung on a DOM-disabled Min-Length input — 2026-09-22
- **Symptom:** 15s+ / 26 retries clicking Min Length (found on Contact).
- **Root cause:** an earlier-scheduled test (UI or RBAC file; the lock prevents concurrent writes, not execution order) left an active fixed-pattern Regex format, which disables Min/Max in the DOM. `clearFieldConfiguration()` already cleared Regex first; `configureFieldLimit()` never did.
- **Fix:** clear an active Regex before touching Min/Max, once, in the shared method; later entities inherited it.
- **Revert:** remove the Regex-clear step from `FormFieldsConfigPage.configureFieldLimit()`.
- **Commit:** `unknown — see git log -S'configureFieldLimit'`

### `configureFieldRegex()` left stale Min/Max when switching to Email — 2026-09-23
- **Symptom:** a valid Email rejected with "Enter the value having length between 10 - 10" (found on Company).
- **Root cause:** switching from a Min/Max-locking format (e.g. PAN Card) to Email — the one non-locking format — left the prior format's numeric Min/Max active-but-unlocked. Every other transition self-corrects. Also, the early-return guard checked only the Regex label, ignoring leftover Min/Max. Invisible earlier because Lead/Contact omitted the "valid Email accepted" test.
- **Fix:** clear/reset Min/Max on that transition; guard now checks Min/Max as well as the label.
- **Revert:** restore the label-only guard in `FormFieldsConfigPage.configureFieldRegex()`.
- **Commit:** `unknown — see git log -S'configureFieldRegex'`

### Minimal-fill: unrelated field limits blocked baseline saves — 2026-09 (Lead rollout)
- **Symptom:** `Save button click resolved but no create request was observed within 4000ms`, classified transient, retried 3×, failing identically for ~6–8 minutes.
- **Root cause:** a baseline record filled with realistic data for every field met a min/max or Regex some other test left on another field; the save was correctly blocked client-side, so no request fired. This is a validation-block signature, not a backend/timing bug — check what the last config call left behind.
- **Fix:** every entity's `fillXxxForm()`/`fillEditForm()` and `createXxx()`/`updateXxx()` accept `{ minimal?: boolean; onlyCustomField?: XxxCustomFieldKey }`; `minimal: true` skips non-essential sections, `onlyCustomField` fills exactly one custom field (none if omitted). Callers omitting it get the original full fill.
- **Revert:** drop the options parameter (additive; all existing callers unaffected).
- **Commit:** `b9b88d7`

### Blur via Tab opened a neighbouring react-select — 2026-09
- **Symptom:** a minimal fill rendered no on-blur inline error; the first fix caused an unwanted menu to open and an "intercepts pointer events" obstruction.
- **Root cause:** `BasePage.fill()` never blurs. `keyboard.press('Tab')` advances focus to the next element, which can be a react-select that opens on focus.
- **Fix:** blur with `document.activeElement.blur()`, never Tab; and use `BasePage.waitForClickTargetUnobstructed()` (`document.elementFromPoint()` vs the locator's handle) before clicks that have shown obstruction.
- **Revert:** n/a — additive helpers.
- **Commit:** `b9b88d7`

### Reject-path tests routed through `createXxx()` waited for a response that never comes — 2026-09
- **Symptom:** tests expecting a client-side block waited through the full transient-retry logic.
- **Root cause:** `createXxx()`/`updateXxx()` wait for a network response; a validation block produces none.
- **Fix:** reject-path tests open the form, run `fillXxxForm(data, {minimal:true, onlyCustomField})`, assert the inline error, never click Save. Exception: live-correct-in-place tests call the entity's own `saveXxx()` primitive directly, since `createXxx()` would reopen a fresh form on retry.
- **Revert:** n/a — test-design rule.
- **Commit:** `b9b88d7`

### Cross-entity shared-state mutation outside the lock — 2026-09-29
- **Symptom:** FFD15, FFTK38 and others failed around config state nothing in their own file set (e.g. `regexLabel: expected "No Regex", got "Email"`).
- **Root cause:** UI and RBAC files for one entity landed on different CI machines, so the local file lock did not coordinate them.
- **Fix:** fixed per-entity UI+RBAC matrix and per-sub-block `.serial`; see [sharding-and-locks.md](./sharding-and-locks.md), [ADR 0002](../adr/0002-formfields-carve-out-from-sharding.md).
- **Revert:** see the ADR.
- **Commit:** `9e35fc1`
