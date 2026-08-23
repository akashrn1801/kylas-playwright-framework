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
| Meetings | `M` | | |

UI and RBAC spec files for the same module are numbered independently unless a cross-file collision forces a renumber — this has happened 3 times historically (Quotations' `Q22`–`Q27` → `Q29`–`Q34`; Leads' `L6`–`L21` → `L32`–`L47`; a self-inflicted `D39`/`D40` collision between new Deals UI tests and pre-existing Deals RBAC tests → renumbered to `D41`/`D42`) — see `.claude/known-issues.md`'s Products & Services consolidated-items list for the full resolution history of each. Before adding a new label to any file, grep the file (and its UI/RBAC sibling) for the next free number in sequence rather than assuming a gap-free run.
