# Reference Patterns (full detail)

Imported from `CLAUDE.md`. Canonical code patterns used across Leads, Contacts, Companies, Deals page objects and RBAC specs. Read this section instead of re-reading source files for these recurring shapes.

### 1. `waitForXDetailsPage()` — URL + domcontentloaded + API response

```typescript
private async waitForCompanyDetailsPage(): Promise<void> {
  await this.page.waitForURL(/sales\/companies\/details\//, { timeout: 20000 });
  await this.page.waitForLoadState('domcontentloaded');
  // WHY: Wait for GET API — ensures React has entityId in state before share/edit fires
  await this.page.waitForResponse(
    (res) => res.url().match(/\/v1\/companies\/\d+$/) !== null && res.request().method() === 'GET',
    { timeout: 15000 }
  ).catch(() => null);
}
```
Adapt URL regex and `/v1/<module>/\d+$` per module. The `.catch(() => null)` makes the wait non-fatal. **Superseded for list/detail readiness by the shared `BasePage.waitForEntityDetailPage()`/`waitForEntityListPage()` — see the navigation-drift fix in `.claude/known-issues.md` before writing a new inline copy of this shape.**

### 2. Ellipsis menu pattern

```typescript
private readonly ellipsisButton = (): Locator =>
  this.page.locator('button.btn.dropdown-toggle.btn-down-arrow.btn-primary').first();

private readonly ellipsisMenuItem = (text: string): Locator =>
  this.page.locator('.dropdown-menu.show').locator('a.dropdown-item').filter({ hasText: text });

async openEllipsisMenu(): Promise<void> {
  await this.ellipsisButton().scrollIntoViewIfNeeded();
  await this.ellipsisButton().click();
  await this.page.waitForTimeout(500);
}

async clickEllipsisOption(optionText: string): Promise<void> {
  await this.openEllipsisMenu();
  const item = this.ellipsisMenuItem(optionText);
  await item.waitFor({ state: 'visible', timeout: 5000 });
  await item.click();
}

async assertEllipsisOptionNotVisible(optionText: string): Promise<void> {
  const item = this.ellipsisMenuItem(optionText);
  await expect(item).toBeHidden({ timeout: 3000 }).catch(async () => {
    const count = await item.count();
    expect(count).toBe(0);
  });
}
```
Note: Contacts edit button = `#edit-action` (no `-btn`), Leads/Companies = `#edit-action-btn`.

### 3. Share modal pattern (3-char search minimum, JS label click)

```typescript
async shareXxx(restrictedUserName: string, permissions: string[] = []): Promise<void> {
  await this.clickEllipsisOption('Share');
  await this.page.waitForTimeout(1000);
  const shareTypeControl = this.page.locator('.modal.show').locator('.is-invalid__control').first();
  await shareTypeControl.click();
  await this.page.locator('.is-invalid__option').filter({ hasText: 'User' }).first().click();
  await this.page.waitForTimeout(500);
  // WHY: Search requires ≥3 chars — find first eligible word, fallback to first 3 chars
  const words = restrictedUserName.trim().split(' ');
  const validWord = words.find((w) => w.length >= 3) ?? restrictedUserName.trim().substring(0, 3);
  await this.page.locator('[id="undefined_undefinedundefined_input_toId"]').fill(validWord);
  await this.page.waitForTimeout(800);
  await this.page.locator('.is-invalid__option').filter({ hasText: restrictedUserName }).first().click();
  await this.page.waitForTimeout(500);
  // WHY: JS click on label — CSS sibling selector unreliable in Playwright
  for (const permission of permissions) {
    const toggle = this.page.locator(`#inp_${permission}`);
    const isChecked = await toggle.isChecked().catch(() => false);
    if (!isChecked) {
      await this.page.evaluate((perm) => {
        const input = document.querySelector(`#inp_${perm}`) as HTMLElement;
        (input?.parentElement?.querySelector('label') as HTMLElement)?.click();
      }, permission);
      await this.page.waitForTimeout(300);
    }
  }
  await this.page.locator('.modal.show button.btn-primary.ml-auto').first().click();
  await this.page.waitForTimeout(1000);
}
```

**Reassign modal** follows the identical shape, with `[id="undefined_undefinedundefined_input_entitySelection"]` as the search input instead.

**Share permission keys:** `update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`

**Known unfixed instances of the unbounded-click race inside this pattern** (`CLAUDE.md` rules 2/18) — `QuotationsPage.fillOwner()`, and parts of `LeadsPage.ts` (close-reason radio selection, convert-to-deal product selection), and `QuotationsPage.ts`'s several random-option pickers — confirmed via grep, not yet independently verified as broken. Apply the bounded-click + 3-attempt-retry pattern already proven for Companies/Deals/Contacts/the Share-modal flow (`openUserShareTypeSearch()`) if you touch these.

### 4. Clone pattern (duplicate-avoidance, ID capture before save)

```typescript
async cloneXxx(): Promise<number | null> {
  await this.clickEllipsisOption('Clone');
  await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
  await this.page.waitForTimeout(1000);
  const originalName = await this.nameInput().inputValue().catch(() => '');
  if (await this.emailInput().isVisible().catch(() => false)) {
    await this.emailInput().fill(`clone${Date.now()}@testkylas.com`);
  }
  // Phone — Indian format: starts 6/7/8/9, 10 digits total
  if (await this.phoneInput().isVisible().catch(() => false)) {
    const newPhone = faker.helpers.arrayElement(['6','7','8','9']) + faker.string.numeric(9);
    await this.phoneInput().clear();
    await this.phoneInput().fill(newPhone);
  }
  const nameValue = await this.nameInput().inputValue().catch(() => '');
  if (!nameValue) await this.nameInput().fill(`${originalName || 'Entity'} Copy`);
  // WHY: Set up ID capture BEFORE save — response may arrive during click
  const idPromise = this.captureXxxIdFromResponse();
  await this.click(this.saveButton(), 'save cloned entity');
  await this.assertNoFormErrors('clone form');
  const id = await idPromise;
  await this.page.waitForTimeout(1500); // stays on original detail page
  return id;
}
```
For contacts clone: check `lastNameInput` value instead of `nameInput`.

**`DealsPage.cloneDeal()`'s Save click can silently produce zero effect** — root-caused: the click landed only ~80ms after the modal became visible, while its own async pre-fill was still committing (React click-handler-not-yet-attached race). Fixed by waiting for `nameInput()` to actually contain "Copy" before clicking Save — a real readiness check, not a guessed delay. A first attempt (click-then-retry) made things measurably worse (0/5, new hang) and was reverted. If a similar "click succeeds but nothing happens" symptom appears in another module's clone/save modal with substantial async pre-fill, check for this exact race before assuming something else.

**ID-based clone verification — a durable pattern superseding a modal-snapshot check (2026-08-23).** For any clone/duplicate feature, don't verify success by reading a value off the clone MODAL mid-render — verify via three stable, hard signals instead: (1) capture the new record's ID from a genuine network response (the existing `captureXxxIdFromResponse()` pattern above), (2) assert that ID differs from the original record's ID (a non-null ID alone isn't proof a real second record was created — it could coincidentally resolve to the same one under some other bug), (3) read any content check off the CLONE's own separately-loaded, fully-settled detail/list page — never the modal itself, which can be caught genuinely half-rendered. `DealsPage.cloneDeal()`/`assertClonedDealName()` is the first place this was built out this way — full investigation in `.claude/known-issues.md`'s Sandbox Build #144 entry, including a first, naive redesign attempt that made the pre-save modal-readiness wait purely non-fatal (proceed to Save regardless) and, when verified with real concurrent-load trials, caught a genuine data-correctness escape — one clone saved with a stale, non-"Copy" name. That result proved the modal-snapshot check WAS catching something real, and that removing it safely required adding a stronger end-state check, not just deleting the wait outright. The same category of gap — verifying a mutation via a transient UI/modal state rather than the record's own stable end-state — was independently flagged this session for the Reports module's own Save As feature (built in a parallel branch, noted there as a follow-up, not yet fixed) — worth checking for in any future clone/duplicate/Save-As-style feature in this codebase.

### 5. Right panel icon pattern (SVG ID map + dual-selector locator)

```typescript
// WHY: SVG gradient IDs differ per icon — more reliable than title attribute alone
private readonly rightPanelIconSvgMap: Record<string, string> = {
  'Notes':      'paint0_linear_972_2654',
  'Tasks':      'clip-Ic_Task',
  'Meetings':   'clip-Ic_Meetings',
  'Call Logs':  'paint1_linear_contacts',   // Contacts only — Leads: 'paint1_linear_leads'
  'Quotations': 'Quotation_Icon-16px_New',
  // Companies: omit 'Call Logs' — not available on company detail
};

private readonly rightPanelIcon = (title: string): Locator => {
  const svgId = this.rightPanelIconSvgMap[title];
  if (svgId) {
    return this.page
      .locator(`button.btn.btn-transparent:has(svg #${svgId}), button.btn.btn-transparent[title="${title}"]`)
      .first();
  }
  return this.page.locator(`button.btn.btn-transparent[title="${title}"]`);
};
```
**Fixed bug (SVG-collision):** clicking "Call Logs" on a Lead's detail page used to silently open **Emails** instead — identical SVG gradient ID, `title=""` always empty, wrong fallback attribute. Fixed in Leads/Contacts/Deals/Companies via `data-original-title` + a mutual-exclusion selector.

**Right-panel-icon visibility can lag a fresh share** — `assertRightPanelIconVisible()` timed out in Leads/Deals even with the generous navigation-timeout window, because the icon set is read from a permissions snapshot fetched once at page mount; waiting longer can't help if that snapshot predates the share's propagation. Fixed with a bounded reload-and-retry (fresh mount re-fetches the snapshot) applied identically across all 4 modules with this concept (Leads, Deals, Contacts, Companies — Meetings/Tasks/Call Logs/Quotations have no right-panel-icon concept at all).

### 6. Note add/delete with baseline-relative count assertion

**CRITICAL — always capture baseline BEFORE adding notes; never hardcode counts.**

```typescript
// 1. Open Notes panel
await restrictedPage.locator('button.btn.btn-transparent:has(svg #paint0_linear_972_2654)').first().click();
await restrictedPage.waitForTimeout(500);

// 2. Capture baseline BEFORE adding anything
const baselineCount = await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count();

// 3/4. Add note(s) via textarea → Rich Text Editor iframe → "Add"
await restrictedPage.locator('textarea.notes-textarea').click();
await restrictedPage.waitForTimeout(1000);
await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to keep');
await restrictedPage.waitForTimeout(500);
await restrictedPage.getByText('Add', { exact: true }).click();
await restrictedPage.waitForTimeout(1500);

// 5. Assert relative to baseline, never an absolute number
expect(await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count()).toBe(baselineCount + 2);

// 6. Delete newest note (notes are newest-first)
const lastNoteEllipsis = restrictedPage.locator('div.row.pt-2.pl-2.pr-2').first().locator('button[data-toggle="dropdown"]');
await lastNoteEllipsis.click();
await restrictedPage.waitForTimeout(300);
await restrictedPage.locator('.dropdown-menu.show .dropdown-item').filter({ hasText: 'Delete' }).click();
await restrictedPage.waitForTimeout(500);
await restrictedPage.locator('button#confirm.btn-danger').waitFor({ state: 'visible', timeout: 5000 });
await restrictedPage.locator('button#confirm.btn-danger').click();
await restrictedPage.waitForTimeout(1500);

// 8. Verify note text via CKEditor iframes (skip the currently-active editor)
const checkNoteText = async (text: string): Promise<boolean> =>
  restrictedPage.evaluate((t) => {
    for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
      if (iframe.title?.includes('Rich Text Editor')) continue;
      try { if (iframe.contentDocument?.body?.innerText?.includes(t)) return true; } catch {}
    }
    return false;
  }, text);
```

### 7. Add deal from modal (pipeline selection + product row + part payments + response listener)

```typescript
// WHY: Pipeline locator — nth(2) targets the visible React Select inside the deal modal
const pipelineControl = this.page.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
await pipelineControl.click();
await this.page.getByText('Default Deal Pipeline', { exact: true }).waitFor({ state: 'visible', timeout: 10000 });
await this.page.getByText('Default Deal Pipeline', { exact: true }).click();

await dealsPage.addProductRow();
await dealsPage.addPartPayments(2);

// WHY: ALWAYS set up response listener BEFORE clicking save
const dealIdPromise = this.page.waitForResponse(
  (res) => (res.url().includes('/deals') || res.url().includes('/deal')) &&
    res.request().method() === 'POST' && (res.status() === 200 || res.status() === 201),
  { timeout: 30000 }
).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
}).catch(() => null);

await this.page.locator('#editEntityModal button.save-button').click();
await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
const dealId = await dealIdPromise;
```
Without a product, fill estimated value as fallback: `[id="1_21_input_estimatedValue"]`.

**Note:** this inline ID-capture predicate (`.includes('/deals')`) is the OLD, unsafe shape — see `CLAUDE.md` rule 15. Real production code should use the versioned-path form.

### 8. Add contact from modal — exact field IDs (captured from live DOM)

```typescript
await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 });
// WHY: These IDs are from the company/lead "Add Contact" modal — not the standalone contact form
await this.page.locator('[id="0_12_input_firstName"]').fill(contactData.firstName);
await this.page.locator('[id="0_13_input_lastName"]').fill(contactData.lastName);
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Email' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_11_input_email_0"]').fill(contactData.email);
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Phone' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_12_input_phone_0"]').fill(contactData.phone);
```
**Standalone contact create form IDs differ:** `input[name="firstName"]`, `input[name="emails[0].value"]`. **Edit mode email/phone IDs:** `[id="1_11_input_email_0"]`, `[id="1_12_input_phone_0"]`.

### 9. Custom Fields pattern (generic helpers + per-module constants + environment safety)

Built for Lead's 9 custom fields (Text, Paragraph, Number, PickList, MultiPickList, Checkbox, Date, DateTimePicker, URL); extended with Company Lookup / Contact Lookup (`cfCompanyLookup`/`cfContactLookup` — live server-side RBAC-scoped searches, NOT a static picklist). **Read this before adding custom-field support to any other module — reuse the BasePage methods, don't re-implement them.**

`BasePage.selectLookupCustomField()` deliberately does **not** delegate to `selectRandomFromSearchableReactSelect()` — that method types `exactValue` as the search term, which breaks for Contact Lookup where the search token (first name) differs from the option's full display text (first + last name).

**Where things live, and why:**

| Piece | Lives in | Why |
|---|---|---|
| Fill/select/assert methods for each of the 9 field types | `BasePage.ts` (generic, reusable) | Parameterized by a raw Kylas field-name string, so every module calls the exact same methods unchanged. |
| Detail-page date/date-time display formatters | `BasePage.ts`, `protected` (`formatCustomFieldDetailDate`, `formatCustomFieldDetailDateTime`) | The rendered format is a Kylas-platform convention, not module-specific. `protected` so subclasses call it directly. |
| The exact field names for one module (e.g. `LEAD_CUSTOM_FIELD_NAMES`) | that module's own factory | Each module owns its own constant — never import one module's into another's; field sets diverge over time. |
| The `XxxCustomFieldData` interface + `generateXxxCustomFieldData()` | that module's factory | Module-owned data shape. |
| The actual fill/verify call sites | `<Module>Page.fill<Entity>CustomFields()` (private) + `assert<Entity>CustomFieldsOnDetail()` (public) | Thin wrapper calling the generic BasePage methods with the module's own constant. |

**The environment-safety contract (non-negotiable for every new fill method):** custom fields get added to one entity, on one environment, by hand — often weeks apart between qa/stage/prod. Every BasePage custom-field method therefore:
1. Checks DOM presence first (`isCustomFieldPresent()` — an `input[id$=...], textarea[id$=...]` suffix match, count > 0).
2. If absent: logs a clear line naming the field and why it's skipped, then returns — **never throws**.
3. If present: fills/selects/asserts normally.

This means the exact same call site starts working the moment fields exist in a new environment — zero code changes required. Do not add an environment branch anywhere else; the presence check inside each BasePage method is the only gate.

**Locator strategy — match by suffix, not the numeric prefix:** ids look like `7_11_input_customFieldValues.cfTextField`. The numeric prefix (`7_11`) is a static per-render wrapper index, confirmed identical across fresh-create/reload/edit. `customFieldInputLocator()` matches the **suffix** (`_input_customFieldValues.cf<Name>`), scoped to `input[id$=...], textarea[id$=...]` — strictly safer at zero cost, and avoids a real collision: react-dates renders an accessibility `<p id="DateInput__screen-reader-message-<the real input's id>">` next to every Date/DateTimePicker field, which — being built by prefixing the real input's own id — *also* ends with the same suffix and breaks an unscoped `[id$=...]` match. Don't drop the tag-name scoping when reusing this pattern.

**Two different suffix conventions exist across modules — confirmed live, not assumed identical.** Lead/Deal/Contact/Company/Quotation/Task use the "legacy" suffix shown above (`_input_customFieldValues.cf<Name>`). Products & Services, Meeting, and Call Log use a "plain" suffix instead (`_input_cf<Name>`, no `customFieldValues.` segment) — confirmed via direct DOM inspection of Products & Services' live create form. Getting this wrong doesn't error — it silently no-ops (the presence check just finds nothing and skips), so it's easy to miss. `BasePage`'s custom-field helpers take a `suffixStyle: 'legacy' | 'plain'` parameter (a strict string-literal union, so a typo is a `tsc` compile error, not a silent runtime no-op) — pass the right one for the module you're working on rather than assuming the legacy form.

**DateTimePicker is two independent widgets:** a `SingleDatePicker` (react-dates) for the date half, plus a **separate** `rc-time-picker` for time — the time input starts `disabled` and only becomes enabled once a date is picked. Don't assume a combined widget just because the field name suggests it.

**Validation mechanisms differ per field — don't assume one applies to all:**
- Some validate client-side, inline, on blur (`.invalid-feedback`/`.help-text.error`) — `TextField` (max length), `UrlField` (malformed URL).
- Some have no client-side check at all, rejected server-side only via a **generic** toast that never names the field (`assertFormErrorToast()`) — `ParagraphText`.
- Some (a native `<input type="number">`) make an invalid value impossible to enter via the UI at all — Playwright's `fill()` itself throws on non-numeric text. Don't manufacture a fake negative test for these; skip explicitly with a comment saying why.

**One toggle gotcha:** the "Show Required & Important Fields" toggle's on/off state persists across sessions (server/localStorage-backed) — it is NOT re-initialized per form open. A blind unconditional click on an already-off toggle flips it back **on**, hiding the section you're trying to reach. Always check `isChecked()` first.

### 10. Custom field Internal Name vs. Label — renaming a display label is always safe

Confirmed live by inspecting the actual field edit dialog at `/setup/fields/leads/list` (Settings → Customizations → Form Fields → Lead). Kylas custom fields have two separate identifiers:
- **Label** — user-facing display name, editable anytime by an admin.
- **Internal Name** (e.g. `cfTextField`) — set once at creation, architecturally impossible to change afterward (the Edit dialog exposes only a "Display Name" input; there is no Internal Name field anywhere in that form).

All locators/factory constants in this codebase are built on the Internal Name, matching the app's own API (`customFieldValues.cfTextField`) — **renaming a field's display label in the app is always safe and requires zero code changes.** The one real exception: a field *deleted and recreated* with a different internal name breaks every locator built on the old name — that's a re-creation, not a rename, and a separate, rarer risk.

### 11. CKEditor 5 description field — must reach the internal data model directly, never the DOM

CKEditor 5 (used by Products & Services' description field, `div[id="0_22_input_description"]`) maintains its own internal virtual data model, separate from the rendered DOM. A plain `.fill()`/`.type()` against the contenteditable region only mutates the visible DOM — it never touches the model that actually gets serialized into the save payload. The live editor instance is attached directly to the `.ck-editor__editable` DOM node as `.ckeditorInstance`; reach it and call `.setData()` on it directly:

```typescript
async setDescriptionViaCkEditor(text: string): Promise<void> {
  await this.page.evaluate((text) => {
    const wrapper = document.getElementById('0_22_input_description');
    const editable = wrapper?.querySelector('.ck-editor__editable') as any;
    if (editable?.ckeditorInstance) {
      editable.ckeditorInstance.setData(text);
    }
  }, text);
}
```
Confirmed live: the API wraps the saved content in a `<div>`, not a `<p>` — assertions checking the persisted value should account for this wrapper rather than expect the raw text verbatim.

### 12. Deal's product-row control is the same underlying component as Quotation's — confirmed live, not assumed

Before building a Deal-specific variant of any product-row search/attach helper, know that `DealsPage.addProductRow()`'s product-row react-select and `QuotationsPage`'s product-row react-select are **the same component** — confirmed live via direct DOM inspection: identical `is-invalid__*` class family, identical `"Search ..."` placeholder, identical `products.{row}.id` id convention, identical live-search behavior (typing filters to real, matching results), identical inactive-product exclusion rule. `DealsPage.addProductRow()` simply never exercises the search/type path because it only ever needs *a* random product — it opens the menu (which shows a default list with no typing required) and picks randomly from whatever's shown. That's a property of that one method's narrow purpose, not a limitation of the underlying component. Any new deterministic "attach this exact product by name" flow on Deals can reuse the same generic `BasePage.addProductRowAndSearchByName()` helper already proven on Quotations — no Deal-specific rework needed.

### 13. Test label naming convention — per-module letter prefix

Test titles in this codebase carry a literal, sequential label as a bracketed/inline prefix inside a code comment or `logger.success()` call (not part of the Playwright title string itself) — e.g. `L38`, `D28`, `Q29`, `PS1`, `CO12`. One letter (or two-letter) prefix per module, numbers sequential within each file:

| Module | Prefix | Module | Prefix |
|---|---|---|---|
| Leads | `L` | Quotations | `Q` |
| Deals | `D` | Products & Services | `PS` |
| Contacts | `C` | Tasks | `TK` |
| Companies | `CO` | Call Logs | `CL` |
| Meetings | `M` | Reports | `R` |

UI and RBAC spec files for the same module are numbered independently unless a cross-file collision forces a renumber — this has happened 3 times historically (Quotations' `Q22`–`Q27` → `Q29`–`Q34`; Leads' `L6`–`L21` → `L32`–`L47`; a self-inflicted `D39`/`D40` collision between new Deals UI tests and pre-existing Deals RBAC tests → renumbered to `D41`/`D42`) — see `.claude/known-issues.md`'s Products & Services consolidated-items list for the full resolution history of each. Before adding a new label to any file, grep the file (and its UI/RBAC sibling) for the next free number in sequence rather than assuming a gap-free run.

### 14. react-beautiful-dnd draggable single-select row pattern (Reports' Dimensions/Metrics)

Reports' Dimensions and Metrics sections are **not** a single multi-select — each is a **list of individual single-select rows**, built with `react-beautiful-dnd` (confirmed via `data-react-beautiful-dnd-droppable`/`data-react-beautiful-dnd-draggable` attributes on the container and each row), meaning rows are drag-to-reorder. This is a UI shape not used anywhere else in this codebase — don't assume a "multi-select with chips" pattern (`BasePage.selectRandomFromMultiValueReactSelect()`) applies just because a section conceptually allows more than one value.

- Each row's own react-select control uses the standard `is-invalid__*` class family, id convention `undefined_00_input_dimensions[0].field` / `undefined_00_input_metrics[0]` (index increments per row).
- An already-selected value in one row is **removed from every other row's own option list** — true duplicate selection is structurally impossible through the UI, confirmed for both Dimensions and Filters (§16 below) independently.
- **A gating control's enabled/disabled state can be driven by a stale click-counter instead of live row count — confirmed real, not a guess.** Reports' Dimensions "Add New" link was originally believed to cap at exactly 14 rows (one admin-session observation) — a dedicated restricted-user re-verification pass, repeating the exact same steps four more times under materially similar conditions, got four different numbers (22, ~1–3, 2, and the original 14). The likely mechanism: the control's visibility is keyed to a cumulative click count that never decrements when rows are removed, not the actual current row count. **Do not write a test asserting a specific numeric row cap for any similar "Add New" control** — assert only that the control eventually becomes disabled after enough clicks (a bounds-exists check), never a precise count, unless independently reconfirmed stable across repeated runs.
- **Drag-and-drop reorder was never exercised via real pointer-drag automation** (Playwright's `dragTo()`) in this codebase — only the DOM's draggable attributes were confirmed to exist. If a future test needs to verify reorder, use element-to-element `dragTo()` targeting, never raw pixel-coordinate sequences (a classic source of flaky Playwright tests across viewport sizes/browsers).

### 15. Dual react-select class family on one form — don't assume one family applies uniformly

Confirmed live on Reports' Create form: most dropdowns (Report Type, Entity Type, Chart Type, Date Filter, Date Range, Dimensions, Metrics) use the `is-invalid__control`/`is-invalid__option`/`is-invalid__menu` family already documented everywhere else in this codebase — but the Filters section's own "Select Filter" field picker uses a **completely different** family, `select__control`/`select__option`/`select__placeholder` (no `is-invalid` prefix at all). Both are genuine react-select instances on the exact same page. **Never assume a single class-family convention holds across an entire form** — confirm each dropdown's own class family live before writing its locator, even on a form where every other dropdown already matched the expected pattern.

### 16. Three-separate-full-page-routes pattern — an alternative to the modal-over-detail-page convention

Every other module in this codebase edits via a modal (`#editEntityModal`) layered over the detail page. Reports instead has **three fully distinct URLs**: `/sales/reports/create`, `/sales/reports/details/<id>`, `/sales/reports/edit/<id>` — Edit is a real page navigation, not a modal open/close. A future module built this way needs its own `waitForXEditPage()`-style readiness wait (mirroring `waitForEntityDetailPage()`'s shape) rather than the modal-visible/modal-hidden pattern every other module's edit flow uses. Don't assume the modal convention applies just because every existing module happens to use it — confirm live whether the target module's Edit action navigates or opens a modal before building the page object's Edit Actions section.

### 17. Paginated validation-error carousel banner — a distinct pattern from a single toast/inline error

Reports' Create form surfaces validation errors two ways simultaneously: inline "This is a required field" text under each invalid control, AND a separate paginated carousel banner (e.g. `"Source is a required field" (1/3)` with prev/next arrows) that cycles through multiple simultaneous errors one at a time. Every other module in this codebase uses a single toast or a single inline error — this carousel shape has no existing `BasePage` assertion helper (`assertNoFormErrors()`/`assertFormErrorToast()` don't cover it). If a future module's form surfaces more than one simultaneous validation error this way, a new assertion helper is needed rather than reusing either existing one as-is — check the banner's own page count (`(N/M)`) rather than assuming only one error is ever shown.

### 18. Stability-window fix pattern — for a third-party-widget-triggered react-select race

**A genuinely repo-wide risk, not module-specific**: a third-party embedded widget's own async registration/init call (confirmed live for `viasocket.com`'s chatbot widget) can fire an unrelated DOM mutation 20–160ms after a react-select menu opens, closing it again before an automated click can land — because the widget's script runs on every page of the app, **any** react-select interaction anywhere in this codebase is theoretically exposed to this exact race, not just the one it was found on. The fix is a general, reusable shape: don't just wait for the menu to become visible once — wait for it to **survive a short stability window afterward** before trusting it's safe to interact with:

```typescript
private async clickToOpenMenu(trigger: Locator, menu: Locator, description: string): Promise<void> {
  const attempts = 5;
  const STABILITY_WINDOW_MS = 500;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await this.click(trigger, `${description}: open menu (attempt ${attempt}/${attempts})`);
    const opened = await menu
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) continue;
    // WHY waitFor('hidden') TIMING OUT is the SUCCESS case here: if the menu
    // is still visible after the stability window, it survived — a real,
    // condition-based check, not a blind waitForTimeout(). Confirmed via 45
    // combined live trials with zero failures once this window was added.
    const tornDown = await menu
      .waitFor({ state: 'hidden', timeout: STABILITY_WINDOW_MS })
      .then(() => true)
      .catch(() => false);
    if (!tornDown) return;
    // menu closed again within the window — a third-party re-render tore it
    // down; retry with a fresh click rather than trusting a menu that just
    // proved itself unstable.
  }
  await menu.waitFor({ state: 'visible', timeout: config.timeouts.expect });
}
```

**Confirmed live, real gotchas found while building this fix, worth knowing before reaching for either of these two "obvious" alternatives**: blocking the third-party widget's domain via `page.route().abort()` is **unsafe** — it made the widget retry aggressively, saturating the CDP connection and hanging the entire browser session for 30 minutes in one real attempt. Waiting for the widget's own network response before interacting is **insufficient** — the disruptive re-render lands 130–160ms *after* the response arrives, not synchronously with it, so a response-based gate doesn't reliably outlast the race. The stability-window retry above is the only approach confirmed to actually work.

### 19. Factory field-naming gotcha — name TypeScript properties after the real API field, never the on-screen label

Confirmed live and costly enough to generalize: Reports' Create form has a field labeled **"Report Type"** on screen whose real underlying form/API field name is `category` (One Dimensional/Multi Dimensional/Hierarchy/Goal vs Achievement), and a field labeled **"Entity Type"** whose real field name is `reportType` (Lead/Deal/Contact/...) — the two labels and their real field names are effectively swapped from what a reader would guess. A factory whose own TypeScript property names mirror the visible labels (`reportType` meaning "Lead/Deal/...", `category` meaning "One/Multi Dimensional") would silently send data to the wrong field the moment someone forgets the swap. **When building a new module's factory, always confirm the real form/API field name (via live DOM inspection of the `name`/`id` attribute, not the visible label) before naming the corresponding TypeScript property** — name the property after the API field, not the label, exactly the same discipline already established for custom-field Internal Name vs. Label (§10 above), just at the top-level form-field scope instead of custom fields specifically. This class of mismatch can recur in any future module — it isn't a Reports-specific quirk, it's a real risk anywhere a UI label and its underlying field name aren't guaranteed to match.

### 20. Dashboard's Add-Dashlet wizard — per-type entity availability, a cross-module Reports dependency, and Grouped Smartlists' genuine multi-select

A 3-step wizard (`#dashlet-wizard`: Dashlet Type → Configure Dashlet → Preview) adds one of 3 dashlet types to a dashboard section, confirmed live to have real, structural differences between types rather than one uniform shape:

- **Entity availability genuinely differs by dashlet type.** Smartlist and Grouped Smartlists (`multilist`) both offer `lead`/`deal`/`contact`/`company`/`email`; Report offers a DIFFERENT 7-entity set — those same 4 plus `task`/`meeting`/`call` (Call Log), and never `email`. **Call Log dashlets can only ever be added as Report type** — Smartlist/Grouped Smartlists never offer it at all.
- **Report-type dashlets have a real cross-module dependency on the Reports module**, confirmed via live network capture (`POST /v3/reports/search?...&reportType=CALL`): Step 2's option list for a Report dashlet is **your own already-saved Reports**, filtered server-side by entity type — a Report dashlet cannot be added for an entity with zero saved Reports of that type. Any test needing a deterministic Report-type dashlet should create its own disposable Report first (via `ReportsPage`) and select it by exact name, never rely on this account's pre-existing Reports data.
- **Grouped Smartlists' Step 2 is a genuine multi-select (checkboxes); Smartlist's and Report's own Step 2 are genuine single-select (radios)** — same row markup family (`div.row` containing an empty, unclickable `<label>` and an `input[id^="check_"]`; the real option name lives in a sibling `.col` div, not the label or the input), differing only in the input's `type` attribute. Confirmed live via `.checked` reads after sequential clicks, not visually. The app itself enforces no real minimum beyond 1 and no maximum at all for Grouped Smartlists (all of an entity's available rows could be checked simultaneously with no error and no cap) — a test suite choosing to select more than 1 (e.g. this codebase's own 2-4 range) is a deliberate test-design choice to exercise genuine multi-select behavior, not a reflection of any app-enforced constraint. A Grouped Smartlists dashlet's own rendered header is always the literal, static string "Grouped Smartlists" for every entity, regardless of selection — never a synthesized title — so any assertion identifying "the dashlet I just added" must key off one of the actually-selected row names (which appear as its own inner sub-rows), never the generic header text, especially once more than one Grouped Smartlists dashlet coexists on the same dashboard (each lands in its own dynamically-created, entity-scoped section — confirmed never merged).

### 21. Hide Empty Fields toggle — per-module tab/field behavior

| Module | Quirk |
|---|---|
| Leads | Social fully collapses; Professional/Requirement/Other Details always mixed |
| Contacts | Social + Campaign Information fully collapse; Professional/Other Details always mixed |
| Companies | Social fully collapses; Other Details always mixed; no Professional-equivalent tab |
| Deals | Campaign Information can never fully collapse (Campaign/Source auto-picked) — check Sub Source/UTM Campaign fields directly |
| Tasks | No tab ever fully collapses; edit-modal save doesn't refresh the in-place detail panel — reload to see updated state |
| Meetings | No tab ever fully collapses; Description is structurally excluded from the toggle (never hidden) |
| Call Logs | Sentiment Information + Campaign Information fully collapse; Basic Info always mixed |
| Quotations | No tabs at all — field-level only |
| All | Relationship-list cards (Related Deals, Associated Contacts, Pending Activities, Deal's pipeline card) are never hidden by the toggle; a field set to `0` counts as "has a value," not empty |

### 22. `layoutCache` key is per-entity and NOT derivable — hand-verify before adding a new entity's key

Kylas's client-side IndexedDB cache (`kylasStorage` DB → `layoutCache` object store, one key per entity, caching that entity's own `/v1/layouts/<entity>/<create|edit|list>` response) uses a key that is **not** a fixed transformation of the entity's name — confirmed live across all 6 entities the Form Field Limit feature touches: Lead→`leads`, Deal→`deals`, Contact→`contacts`, Company→`companies`, Task→`tasks` (all the simple lowercase plural, which could tempt a "just lowercase+pluralize" derivation rule), but Products & Services→`products-services`, which no such rule predicts. The cached object's own `entityType` field always exactly matches its own key (confirmed for both `leads` and `products-services`), but that's circular for a "clear before first fetch" helper. **Never derive a `layoutCache` key from an entity name — each entity's key must be a hand-verified, live-confirmed constant** (e.g. `LEAD_LAYOUT_CACHE_KEY` in `leadFactory.ts`), added only once that entity is actually onboarded, never guessed ahead of time. `IDBObjectStore.delete(key)` on a wrong/non-existent key does not throw — it silently deletes nothing, so a wrong guess here fails silently, not loudly, surfacing later as an unrelated-looking flaky test. See `BasePage.clearApplicationCache()`, which takes the raw key string as a parameter rather than deriving it, keeping this per-entity knowledge in each entity's own factory rather than centralizing a guess-prone lookup table in `BasePage.ts`.

### 23. Number custom field's Min/Max Length validates DIGIT-COUNT of the typed value, not numeric magnitude

Confirmed live, decisively, via 5 fresh-field trials (a value at exactly min digits, at exactly max digits, a short value, a very long value, a short-but-plausible value) — a genuinely counter-intuitive, easy-to-re-break-by-assumption fact: Kylas's Number custom field's "Min Length"/"Max Length" configuration validates the **digit-count length of the typed string**, exactly as its on-screen label literally says, NOT the number's own numeric magnitude. A value like `11111111111` (eleven 1's, numerically over 11 billion) is **valid** under min=4/max=11 (11 digits, within range); a value like `8` is **invalid** under the same config (1 digit, below the 4-digit minimum) despite being a small, "reasonable-looking" number. Do not assume "min/max" means a numeric value bound for this field type — write boundary-value tests against digit-count, not numeric size (e.g. for min=4/max=11: a 3-digit value is under-min, an 11-digit value is at-max, a 12-digit value is over-max, regardless of the actual numbers involved). A prior investigation pass initially misread this as a numeric-value bound and filed a resulting "stuck validation" symptom as a suspected app bug — it was fully retracted once this digit-count rule was confirmed: the "invalid" value used in the original repro was never actually valid in the first place.

### 24. Real, confirmed CI worker counts — every shared/global-state-mutating test suite needs process-level locking, not just in-file `.serial`

`test.describe.configure({ mode: 'serial' })` only guarantees ordering **within one file** (confirmed at Playwright's own source — see the "Sharding order-dependency audit" entry in `known-issues.md`). A feature whose tests mutate a single, shared, account-wide record (not disposable per-test data) — e.g. a global field-configuration screen editable by both a UI-focused spec file and a separate RBAC spec file — needs cross-FILE, cross-WORKER mutual exclusion, because real CI genuinely runs these files concurrently. Confirmed directly against the actual files, not assumed (2026-09-21):

| Pipeline | `--workers` | Scope |
|---|---|---|
| GitHub Actions `dev.yml` | 1 | `@smoke` only |
| GitHub Actions `qa.yml` | 2 | `@regression` |
| GitHub Actions `stage.yml` | 2 | full suite |
| GitHub Actions `main.yml` | 2 | full suite |
| GitHub Actions `prod.yml` | 2 | `@prodSafe` only |
| GitHub Actions `sandbox.yml` | 1 or 2 (dynamic) | selective |
| GitHub Actions `staging-promotion-gate.yml` | 2 | — |
| Jenkins `Jenkinsfile` | 2 | branch-dependent |
| Jenkins `Jenkinsfile.qa` | 2 | `@regression` |
| Jenkins `Jenkinsfile.staging` | 2 | full suite |
| Jenkins `Jenkinsfile.prod` | 2 | `@prodSafe` only |
| Jenkins `Jenkinsfile.sandbox` | 1 | selective |

Every pipeline running `@regression`/full-suite scope at `workers=2` (qa.yml, stage.yml, main.yml, staging-promotion-gate.yml, Jenkinsfile, Jenkinsfile.qa, Jenkinsfile.staging) can and will schedule two spec files touching the same shared record onto different concurrent worker processes. **The fix pattern**: a real, cross-process file lock (`fs.mkdirSync`-based, mirroring `authManager.ts`'s own already-proven `withFileLock()`), wired in as an `auto: true` Playwright fixture wrapping the entire test body — not a per-method lock (which leaves the gap between "configure" and "verify/use" open), and not Playwright's own `dependencies` project feature (confirmed unsafe for this repo's CI shape — see `known-issues.md`'s Reports-module section). See `tests/ui/formFields/formFieldsTestLock.ts` for the reference implementation.

### 25. RBAC design for a "list visible, edit blocked" boundary — avoid the Forbidden-page / `isSessionExpiryPage()` collision entirely

Some screens' real, confirmed RBAC boundary is narrower than "fully blocked" — e.g. a restricted user can view a read-only list (no "Add" button, non-clickable rows) but is blocked only from an individual record's edit page, which renders the app's own **"Forbidden"** component (heading "Forbidden" + a "Home" button). This is the *same* UI component `authManager.ts`'s `isSessionExpiryPage()` already recognizes for an unrelated reason (invalid/expired session) — `BasePage.navigateTo()` calls this check after every navigation and will attempt a one-time session-recovery (re-login) the moment it sees a Forbidden render, which is exactly what a restricted user legitimately hitting a real RBAC block will also produce. **Do not build an RBAC-denial test that navigates to the blocked URL and asserts on the Forbidden page directly** — the session-recovery logic will interfere with or mask the real assertion. Instead, prove the RBAC boundary entirely through what the restricted user's list view itself confirms (button absence, row non-interactivity) — never navigate to the individual edit URL as a restricted user at all. See `FormFieldsConfigPage.assertRowNotClickable()`/`assertAddFieldButtonAbsent()` for the pattern.

### 26. A single test's own recurring "flaky" failure can actually be shared cross-process test infrastructure failing, not that test's own logic or a real backend dependency

Confirmed live, at real cost (2026-09-21/22 — the Form Fields feature's own `FFL36` investigation): a test that fails repeatedly under real `--workers=2` load, with a plausible-sounding "real backend" symptom (`TransientLeadSaveError` — a generic "no response captured within 60s" classification), can be almost entirely explained by bugs in **shared, cross-process test infrastructure** (a custom file-based lock, a fixture's own navigation/retry logic) rather than anything specific to that one test's own code or a genuine application/backend slowness. Direct network capture (19 combined live trials, reusing the real `saveLead()`/`adminPage` machinery, not a reimplementation) proved the real create-lead endpoint responds in as little as 239ms when observed — ruling out "the backend is slow" outright — while the SAME symptom (an 8-minute hang, eventually killed by Playwright's own test timeout) independently recurred on several **other, unrelated** tests (`FFL34`, `FFL52`, `FFL54`, `FFL1`, `FFL22`, `FFL9`, `FFL4`, `FFL19`) at different points as each underlying infrastructure bug was found and fixed in turn — never on any test outside the ones sharing `formFieldsTestLock.ts`'s lock. The real, compounding causes, in the order found: (1) `test.afterAll()` mutating the shared config with no cross-process lock protection at all (a structural gap — `afterAll` hooks can only receive worker-scoped fixtures, and the lock is deliberately test-scoped); (2) the lock's own stale-recovery comparing a per-**waiter's** local elapsed-polling counter against the threshold instead of the lock's own actual age, letting a waiter force-steal a few-milliseconds-old, entirely legitimate handoff; (3) the stale-lock removal itself using a blind `fs.rmSync`, letting two waiters that both detected the same stale lock race, with the loser's cleanup destroying the winner's brand-new legitimate acquisition; (4) the staleness threshold itself twice miscalibrated against the wrong reference point (once too low, once — after "fixing" it — accidentally raised *above* the shared test timeout, so a single hung test could starve every other test waiting behind it for the lock, since Playwright's own timeout-kill does not reliably run fixture teardown for a fixture stuck mid-acquisition); (5) 18 of this feature's own tests (across both its spec files) had no explicit `test.setTimeout`, leaving them governed by CI's own shorter project-default timeout despite sharing a lock whose legitimate wait times could exceed it; (6) the lock's own acquisition having no fairness guarantee at all ("whoever calls `mkdirSync` first wins"), letting a string of quick, unrelated tests continuously out-race a single waiter for its full timeout budget; (7) the fairness fix's own ticket-staleness check never refreshing a waiter's ticket while it legitimately kept polling, permanently ejecting a healthy, still-alive waiter as if it had crashed. **The lesson generalizes past this one lock:** before concluding a specific test has its own isolated bug or a real external dependency is unreliable, check whether it shares any custom, hand-rolled cross-process coordination (a lock, a queue, a shared fixture-setup retry path) with other tests, and whether those *other* tests have ever shown the *same* symptom shape — a shared infrastructure bug reproduces on whichever test happens to be running when it fires, not deterministically on one. See `tests/ui/formFields/formFieldsTestLock.ts` and `src/fixtures/index.ts`'s `navigateAndConfirmLoggedIn()` for the fixed implementations, and `tests/ui/formFields/leadFieldLimits.spec.ts`'s `saveAndCaptureLeadId()`/`createBareLead()` for a confirmed, still-open instance of the *narrower* related risk (a save-with-retry helper vs. a save-with-no-retry-at-all helper coexisting in the same file) — `createBareLead()` (14 call sites, every "edit lead" test in the file) calls the same underlying `saveLead()` with **zero** retry protection, unlike `saveAndCaptureLeadId()`'s 5-attempt reset-before-retry shape — not yet fixed as of this writing.

### 27. Minimal-fill `{minimal, onlyCustomField}` architecture — testing ONE field's validation on a form that requires much more to save successfully

Built for the Form Field Limit feature (all 6 entities: Lead/Contact/Company/Task/Products & Services/Deal), but the shape is generic and reusable anywhere a test needs to isolate one field's behavior against a form with many other fields/sections. **The problem this solves, confirmed at real cost (a two-day Lead-rollout misdiagnosis):** a baseline/setup record filled with realistic-looking random data for every field is exposed to any currently-active constraint (a min/max or Regex format) some *unrelated* earlier test configured on some *other* field. The save then correctly, silently blocks client-side — zero network request fires — which surfaces as `"Save button click resolved but no create request was observed within 4000ms"`, gets classified as transient, retried 3× against the identical blocking data, and fails identically every time for ~6-8 minutes before a real test failure. **This is a client-side-validation-block signature, not a backend/timing/concurrency bug** — before treating this shape as flaky or backend-side, check what the last field-configuration call (by any test) against the field(s) this save actually fills left behind, and whether the value being saved still satisfies it.

**The fix:** every entity's `fillXxxForm()`/`fillEditForm()` (and the `createXxx()`/`updateXxx()` wrappers that call them) accept an optional `{ minimal?: boolean; onlyCustomField?: XxxCustomFieldKey }`:
```ts
await leadsPage.createLead(leadData, { minimal: true, onlyCustomField: 'textField' });
```
`minimal: true` skips every non-essential section (whatever that entity's own equivalent of Communication/Location/Professional/Requirement/Campaign Info is); `onlyCustomField` fills exactly the one custom field under test and skips every other custom field entirely (omitting it while `minimal: true` fills **zero** custom fields — a plain baseline/edit-target record). Every existing caller that omits the options object gets byte-for-byte the original full-fill behavior — confirmed additive via full-repo grep before each entity's change shipped.

**Two required companion fixes, easy to regress if copied carelessly:**
- Blur the one filled custom field with `document.activeElement.blur()` — **never** `page.keyboard.press('Tab')`. `BasePage.fill()` never blurs what it just filled, so a minimal fill's on-blur inline error would otherwise never render; Tab doesn't just remove focus, it ADVANCES it to the next DOM-order element, which for a neighboring react-select can trigger that field's own "open on focus" behavior — one fix for a missing-blur bug directly caused a second, worse bug (an unwanted menu opening, itself a source of a `waitForClickTargetUnobstructed()`-class obstruction — see §28).
- **Reject-path tests** (expecting a client-side validation block) must NOT go through `createXxx()`/`updateXxx()` at all — those wait through the full transient-retry logic for a network response that will never arrive. Open the form directly, fill via the same minimal-fill `fillXxxForm(data, {minimal:true, onlyCustomField})`, then assert the inline error directly — never click Save. The one legitimate exception: a test that live-corrects an already-open, already-invalid form in place (type invalid → see error → fix it → confirm error clears → THEN save) calls the entity's own `saveXxx()` primitive directly rather than the `createXxx()` wrapper, which would discard the in-place-corrected state by opening a fresh form on its own internal retry.

**A related, independently-confirmed defensive-coding lesson from the same rollout:** a shared config-mutating method (`FormFieldsConfigPage.configureFieldLimit()`/`configureFieldRegex()`) having "worked fine" across one or two entities' full test suites is NOT evidence it correctly handles every DOM/config state a *different* entity's test-execution order could leave a field in — found twice, independently, on two different entities (Contact: `configureFieldLimit()` hung 15s+/26 retries on a Min-Length input a prior Regex format had DOM-disabled, because the method never checked for an active Regex lock before touching Min/Max; Company, found only AFTER fixing Contact's case: `configureFieldRegex()` switching FROM a Min/Max-locking format TO the one non-locking format, Email, left the prior format's Min/Max active-but-unlocked, rejecting a genuinely valid value on a pure length-boundary check). Both fixed once in the shared method, not per-entity. **"It hasn't happened for entity X" is a fact about that entity's own test-scheduling luck, not evidence the method is correct** — and "two entities' suites never hit this" can also mean neither one's coverage ever exercised the one shape that would reveal it (Company was the first entity with genuinely full 5-format Regex coverage; its first real run caught this on the first attempt). Re-check this question — "what DOM/config state could a DIFFERENT file's test leave this shared field in, and does this method defensively handle it or just assume its own author's test order?" — for any shared config-mutating helper before trusting it on a new consumer.

### 28. `BasePage.waitForClickTargetUnobstructed()` — verify the REAL click-target via `document.elementFromPoint()`, not a guessed overlay-class selector

An emotion-generated overlay class (`css-<hash>`, not a fixed name — varies per build) can linger over a control and physically intercept a click even after the semantic state (e.g. `.is-invalid__menu`) reports "closed." Confirmed live on two unrelated elements in the same investigation (a Multi Pick List reopen-input, and — separately — a Save button itself), so this is not narrow to one widget. The fix: `protected async waitForClickTargetUnobstructed(locator: Locator, timeoutMs?: number)` polls the real element at the locator's own click point via `document.elementFromPoint()` and compares it against the locator's resolved `ElementHandle` (exact match or containment either direction), waiting out the overlay before a click proceeds — rather than guessing at the overlay's own class name or waiting on unrelated semantic state. Being `protected` on `BasePage`, any page object can call `this.waitForClickTargetUnobstructed(someButton())` directly before any click site that has ever shown an "intercepts pointer events" Playwright error — reuse this rather than writing a narrower version scoped to one widget.

### 29. Heartbeat-based cross-process lock staleness — a holder-refreshed timestamp beats a fixed-age check

`formFieldLockFactory.ts` (the generalized successor to the original single-entity `formFieldsTestLock.ts`, one lock scope per entity — see rule 1's reuse-before-building and §24/§26 above for why a shared config-mutating flow needs process-level locking at all) judges staleness by **heartbeat**, not age: the current holder rewrites its own `heartbeatAtMs` timestamp every 10s while it still holds the lock, and a waiter only treats the lock as abandoned once that heartbeat itself has stopped for a threshold window — never "the lock is simply older than N seconds." A fixed-age check is wrong on its own terms: a legitimately slow but still-running test can exceed any fixed age threshold without being stuck, and a waiter that steals a lock out from under a live holder reintroduces exactly the shared-config race this locking exists to prevent. Combined with a FIFO fairness ticket queue (so a string of quick, unrelated tests can't perpetually out-race a single longer-waiting test for the lock). Reuse this mechanism as-is for any new cross-process coordination need in this codebase — don't rebuild a simpler, fixed-age version "just for this one case" (see §26's own catalog of exactly what goes wrong when a lock's staleness/fairness logic is under-built).
