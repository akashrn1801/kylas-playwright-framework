## Reference Patterns

Canonical code patterns used across Leads, Contacts, Companies page objects and RBAC specs.  
Read this section instead of re-reading source files for these recurring shapes.

---

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

Adapt URL regex and `/v1/<module>/\d+$` per module. The `.catch(() => null)` makes the wait non-fatal.

---

### 2. Ellipsis menu pattern

**Locators:**
```typescript
private readonly ellipsisButton = (): Locator =>
  this.page.locator('button.btn.dropdown-toggle.btn-down-arrow.btn-primary').first();

private readonly ellipsisMenuItem = (text: string): Locator =>
  this.page.locator('.dropdown-menu.show').locator('a.dropdown-item').filter({ hasText: text });
```

**Methods:**
```typescript
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

---

### 3. Share modal pattern (3-char search minimum, JS label click)

```typescript
async shareXxx(restrictedUserName: string, permissions: string[] = []): Promise<void> {
  await this.clickEllipsisOption('Share');
  await this.page.waitForTimeout(1000);
  // Open Share To type dropdown, select "User"
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

**Reassign modal:**
```typescript
async reassignXxx(userName: string): Promise<void> {
  await this.clickEllipsisOption('Reassign');
  await this.page.waitForTimeout(500);
  const words = userName.trim().split(' ');
  const validWord = words.find((w) => w.length >= 3) ?? userName.trim().substring(0, 3);
  const reassignInput = this.page.locator('[id="undefined_undefinedundefined_input_entitySelection"]');
  await reassignInput.fill(validWord);
  await this.page.waitForTimeout(800);
  await this.page.locator('.is-invalid__option').filter({ hasText: userName }).first().click();
  await this.page.waitForTimeout(500);
  await this.page.locator('.modal.show button.btn-primary.ml-auto').first().click();
  await this.page.waitForTimeout(1000);
}
```

**Share permission keys:** `update`, `note`, `task`, `meeting`, `quotation`, `reassign`, `clone`, `delete`

---

### 4. Clone pattern (duplicate-avoidance, ID capture before save)

```typescript
async cloneXxx(): Promise<number | null> {
  await this.clickEllipsisOption('Clone');
  await this.saveButton().waitFor({ state: 'visible', timeout: 15000 });
  await this.page.waitForTimeout(1000);
  // Read original value before other fills (used for safety refill)
  const originalName = await this.nameInput().inputValue().catch(() => '');
  // Change email to avoid duplicate error
  if (await this.emailInput().isVisible().catch(() => false)) {
    await this.emailInput().fill(`clone${Date.now()}@testkylas.com`);
  }
  // Change phone — Indian format: starts 6/7/8/9, 10 digits total
  if (await this.phoneInput().isVisible().catch(() => false)) {
    const newPhone = faker.helpers.arrayElement(['6','7','8','9']) + faker.string.numeric(9);
    await this.phoneInput().clear();
    await this.phoneInput().fill(newPhone);
  }
  // Safety: contacts check lastName, companies check name — refill if cleared
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

---

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

---

### 6. Note add/delete with baseline-relative count assertion (L28/CR17 pattern)

**CRITICAL** — always capture baseline BEFORE adding notes; never hardcode counts.

```typescript
// In the test (or inline in a page method):
// 1. Open Notes panel
await restrictedPage
  .locator('button.btn.btn-transparent:has(svg #paint0_linear_972_2654)')
  .first().click();
await restrictedPage.waitForTimeout(500);

// 2. Capture baseline BEFORE adding anything
const baselineCount = await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count();

// 3. Add first note (to keep)
await restrictedPage.locator('textarea.notes-textarea').click();
await restrictedPage.waitForTimeout(1000);
await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to keep');
await restrictedPage.waitForTimeout(500);
await restrictedPage.getByText('Add', { exact: true }).click();
await restrictedPage.waitForTimeout(1500);

// 4. Add second note (to delete)
await restrictedPage.locator('textarea.notes-textarea').click();
await restrictedPage.waitForTimeout(1000);
await restrictedPage.getByRole('textbox', { name: 'Rich Text Editor, main' }).fill('Note to delete');
await restrictedPage.waitForTimeout(500);
await restrictedPage.getByText('Add', { exact: true }).click();
await restrictedPage.waitForTimeout(1500);

// 5. Assert +2 relative to baseline
expect(await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count()).toBe(baselineCount + 2);

// 6. Delete newest note (notes are newest-first)
const lastNoteEllipsis = restrictedPage.locator('div.row.pt-2.pl-2.pr-2')
  .first().locator('button[data-toggle="dropdown"]');
await lastNoteEllipsis.click();
await restrictedPage.waitForTimeout(300);
await restrictedPage.locator('.dropdown-menu.show .dropdown-item').filter({ hasText: 'Delete' }).click();
await restrictedPage.waitForTimeout(500);
await restrictedPage.locator('button#confirm.btn-danger').waitFor({ state: 'visible', timeout: 5000 });
await restrictedPage.locator('button#confirm.btn-danger').click();
await restrictedPage.waitForTimeout(1500);

// 7. Assert +1 relative to baseline
expect(await restrictedPage.locator('div.row.pt-2.pl-2.pr-2').count()).toBe(baselineCount + 1);

// 8. Verify note text via CKEditor iframes (skip active editor)
const checkNoteText = async (text: string): Promise<boolean> =>
  restrictedPage.evaluate((t) => {
    for (const iframe of Array.from(document.querySelectorAll('iframe'))) {
      if (iframe.title?.includes('Rich Text Editor')) continue;
      try { if (iframe.contentDocument?.body?.innerText?.includes(t)) return true; } catch {}
    }
    return false;
  }, text);
expect(await checkNoteText('Note to delete')).toBe(false);
expect(await checkNoteText('Note to keep')).toBe(true);
```

---

### 7. Add deal from modal (pipeline selection + product row + part payments + response listener)

```typescript
// WHY: Pipeline locator — nth(2) targets the visible React Select inside the deal modal
const pipelineControl = this.page.locator('div').filter({ hasText: /^Search pipeline$/ }).nth(2);
await pipelineControl.click();
await this.page.getByText('Default Deal Pipeline', { exact: true })
  .waitFor({ state: 'visible', timeout: 10000 });
await this.page.getByText('Default Deal Pipeline', { exact: true }).click();

// Add product row (DealsPage helper)
await dealsPage.addProductRow();

// Add 2 part payment installments
await dealsPage.addPartPayments(2);

// WHY: ALWAYS set up response listener BEFORE clicking save
const dealIdPromise = this.page.waitForResponse(
  (res) =>
    (res.url().includes('/deals') || res.url().includes('/deal')) &&
    res.request().method() === 'POST' &&
    (res.status() === 200 || res.status() === 201),
  { timeout: 30000 }
).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.id ?? body?.data?.id ?? body?.dealId ?? null;
}).catch(() => null);

await this.page.locator('#editEntityModal button.save-button').click();
await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
const dealId = await dealIdPromise;
```

Without product, fill estimated value as fallback:
```typescript
const estimatedValueInput = this.page.locator('[id="1_21_input_estimatedValue"]');
if (await estimatedValueInput.isVisible().catch(() => false)) {
  await estimatedValueInput.fill('50000');
}
```

---

### 8. Add contact from modal — exact field IDs (captured from live DOM)

When adding a contact from a company or lead detail page modal:

```typescript
// Modal title check
await expect(this.page.locator('#editEntityModal .modal-title')).toHaveText('Add Contact', { timeout: 5000 });

// WHY: These IDs are from the company/lead "Add Contact" modal — not the standalone contact form
await this.page.locator('[id="0_12_input_firstName"]').fill(contactData.firstName);
await this.page.locator('[id="0_13_input_lastName"]').fill(contactData.lastName);

// Email — click Add Email button first (scoped to modal to avoid page-level ambiguity)
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Email' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_11_input_email_0"]').fill(contactData.email);

// Phone — same pattern
await this.page.locator('#editEntityModal button').filter({ hasText: 'Add Phone' }).first().click();
await this.page.waitForTimeout(500);
await this.page.locator('[id="1_12_input_phone_0"]').fill(contactData.phone);

// WHY: Set up response listener BEFORE save
const contactIdPromise = this.page.waitForResponse(
  (res) => res.url().includes('/v1/contacts') && res.request().method() === 'POST' &&
    (res.status() === 200 || res.status() === 201),
  { timeout: 30000 }
).then(async (res) => {
  const body = await res.json().catch(() => ({}));
  return body?.id ?? body?.data?.id ?? null;
}).catch(() => null);

await this.page.locator('#editEntityModal button.save-button').click();
await this.page.locator('#editEntityModal').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => null);
const contactId = await contactIdPromise;
```

**Standalone contact create form IDs differ:** `input[name="firstName"]`, `input[name="emails[0].value"]`  
**Edit mode email/phone IDs:** `[id="1_11_input_email_0"]`, `[id="1_12_input_phone_0"]`

---

### 9. Custom Fields pattern (generic helpers + per-module constants + environment safety)

Built 2026-07-08 for Lead's 9 custom fields (Text, Paragraph, Number, PickList, MultiPickList,
Checkbox, Date, DateTimePicker, URL). **Read this before adding custom-field support to any other
module (Contacts/Companies/Deals/Meetings/Tasks) — reuse the BasePage methods, don't re-implement
them.**

**Extended 2026-07-21/22** with 2 more field types — Company Lookup / Contact Lookup
(`cfCompanyLookup`/`cfContactLookup`, live server-side RBAC-scoped searches, NOT a static
picklist) — see the Known Issues entry above for the full L20/L21/L30/L31 story and the
9 bugs found while building them. `BasePage.selectLookupCustomField()` deliberately does
NOT delegate to `selectRandomFromSearchableReactSelect()` — that method types `exactValue`
as the search term, which breaks for Contact Lookup where the search token (first name)
differs from the option's full display text (first + last name).

**Where things live, and why:**

| Piece | Lives in | Why |
|---|---|---|
| Fill/select/assert methods for each of the 9 field *types* | `BasePage.ts` (generic, reusable) | Parameterized by a raw Kylas field-name **string** (e.g. `"TextField"`), not by any typed constant — so every module can call the exact same methods unchanged. |
| Detail-page date/date-time display formatters | `BasePage.ts`, `protected` (`formatCustomFieldDetailDate`, `formatCustomFieldDetailDateTime`) | The rendered format (`"Jul 13, 2026"` / `"Jul 13, 2026 at 10:30 am"`) is a **Kylas-platform convention**, not Lead-specific — confirmed live. `protected` (not `private`) so subclasses can call them directly. |
| The exact field **names** for one module (e.g. `LEAD_CUSTOM_FIELD_NAMES`) | that module's own factory (e.g. `leadFactory.ts`) | Each module defines and owns its own `<MODULE>_CUSTOM_FIELD_NAMES` constant — **mirror this pattern per module, never import one module's constant into another's.** Each entity gets these fields added independently and by hand; a shared constant would create false coupling and collision risk the moment two modules' field sets diverge (different names, or one module getting a field type the other doesn't have yet). |
| The `LeadCustomFieldData` interface + `generateLeadCustomFieldData()` | `leadFactory.ts` | Same reasoning — module-owned data shape, not shared. |
| The actual fill/verify call sites | `LeadsPage.fillLeadCustomFields()` (private) + `LeadsPage.assertLeadCustomFieldsOnDetail()` (public) | Each module gets its own thin `fill<Entity>CustomFields()` / `assert<Entity>CustomFieldsOnDetail()` wrapper that calls the generic BasePage methods with its own `<MODULE>_CUSTOM_FIELD_NAMES` constant. |

**The environment-safety contract (non-negotiable for every new fill method):**

Custom fields get added to one entity, on one environment, by hand — QA today, Stage/Prod later,
often weeks apart, with identical names once added. Every BasePage custom-field method therefore:
1. Checks DOM presence first (`isCustomFieldPresent()` — an `input[id$=...], textarea[id$=...]`
   suffix match, count > 0).
2. If absent: logs a clear `logger.info(...)` line naming the field and stating **why** it's being
   skipped (so CI output is self-explanatory without reading source), then returns — **never
   throws**.
3. If present: fills/selects/asserts normally.

This means the exact same call site (e.g. `fillLeadCustomFields()`, wired into both
`fillLeadForm()` and `fillEditForm()`) starts working the moment the fields exist in a new
environment — **zero code changes required**. Do not add a "does this environment have custom
fields" branch anywhere else; the presence check inside each BasePage method is the only gate.

**Locator strategy — match by suffix, not the numeric prefix:**

Kylas's live custom-field ids look like `7_11_input_customFieldValues.cfTextField`. The numeric
prefix (`7_11`) was confirmed live (2026-07-08, three independent passes: fresh create-form, the
same form after a full reload, and an edit-form on an existing record) to be a static per-render
wrapper index — identical across all three. `customFieldInputLocator()` still matches on the
**suffix** (`_input_customFieldValues.cf<Name>`) rather than the full id, scoped to
`input[id$=...], textarea[id$=...]` — this is strictly safer at zero extra cost (the numeric
prefix could in principle change; the suffix cannot) and, critically, **avoids a real collision**:
react-dates renders an accessibility `<p id="DateInput__screen-reader-message-<the real input's
id>">` next to every Date/DateTimePicker field, which — being built by prefixing the real input's
own id — *also* ends with the same suffix and breaks an unscoped `[id$=...]` match. Confirmed live
the hard way; don't drop the tag-name scoping when reusing this pattern.

**DateTimePicker is two independent widgets, not one:** a `SingleDatePicker` (react-dates, same
widget as the plain `Date` field and `QuotationsPage.selectDateInPicker()`) for the date half, plus
a **separate** `rc-time-picker` (same widget already handled in `MeetingsPage.fillTimePicker()` /
`CallLogsPage`) for time — the time input starts `disabled` and only becomes enabled once a date is
picked. Don't assume a "DateTimePicker"-named field uses one combined widget just because the name
suggests it; confirm live per field.

**Validation mechanisms differ per field — don't assume one applies to all:**
- Some fields validate client-side, inline, on blur (`.invalid-feedback`/`.help-text.error`) —
  confirmed for `TextField` (max length) and `UrlField` (malformed URL).
- Some fields have **no client-side check at all** and are only rejected server-side on Save, via a
  **generic** toast that never names the field (`assertFormErrorToast()`) — confirmed for
  `ParagraphText` (its length limit exists only in the raw API error response, never in the UI).
- Some fields (e.g. a native `<input type="number">`) make an invalid value **impossible to enter
  via the UI at all** — Playwright's `fill()` itself throws on non-numeric text, and a real browser
  blocks the keystrokes too. Don't manufacture a fake negative-test scenario for these; skip them
  explicitly with a comment saying why (see `leadFactory.ts`'s `generateLeadCustomFieldInvalidUrl`
  region for the precedent).

**Reference implementation to copy from:** `src/modules/leads/LeadsPage.ts`
(`fillLeadCustomFields()`, `assertLeadCustomFieldsOnDetail()`, the `showRequiredToggle`/
`openOtherDetailsFormSection()` visibility-gating pair) + `src/data/factories/leadFactory.ts`
(`LEAD_CUSTOM_FIELD_NAMES`, `LeadCustomFieldData`, `generateLeadCustomFieldData()`) +
`src/core/BasePage.ts`'s "Custom Field Helpers" section. When Contacts/Companies/Deals get their
own custom fields, start by reading these three files, not by re-deriving the pattern from scratch.

**One toggle gotcha worth knowing before you copy `openOtherDetailsFormSection()`-style
visibility-gating elsewhere:** the "Show Required & Important Fields" toggle's on/off state is
**not** re-initialized per form open — it persists across sessions (server/localStorage-backed).
`disableRequiredFieldsToggle()` used to click it unconditionally whenever visible; fixed to check
`showRequiredToggleCheckbox().isChecked()` first, because a blind click on an *already-off* toggle
flips it back **on**, hiding the very section you're trying to reach. If another module's
equivalent toggle has the same persistence behavior, apply the same idempotency check.

---

### 10. Custom field Internal Name vs Label — renaming a field's display label is always safe

Confirmed live (2026-07-08) by inspecting the actual field edit dialog at
`/setup/fields/leads/list` (Settings → Customizations → Form Fields → Lead) — not inferred from the
API response alone. Kylas custom fields have **two separate identifiers**:

- **Label** — the user-facing display name (e.g. "Text Field"). Editable anytime by an admin.
- **Internal Name** — e.g. `cfTextField`. Set once at field creation and **architecturally
  impossible to change afterward**: the field's own Edit dialog exposes only a "Display Name"
  input (plus Description, Is Filterable, Is Sortable) — there is no "Internal Name" field
  present anywhere in that form, not merely disabled.

All Lead custom-field locators in this codebase (`customFieldInputLocator()` in `BasePage.ts`, the
`LEAD_CUSTOM_FIELD_NAMES` constants in `leadFactory.ts`) are built on the **Internal Name**, and so
is the app's own API — `customFieldValues` in a lead's GET response is keyed by `cf<Name>`
(confirmed via the raw API response, e.g. `customFieldValues.cfTextField`), not by the label. This
means **renaming a custom field's display label in the app is always safe and requires zero code
changes** on this side.

**One real exception, not a rename:** if a field is *deleted and recreated* with a different
internal name, that would break every locator built on the old name — but that's a field
re-creation, not a rename, and a separate, much rarer risk. Worth remembering if a field's
"identity" (not just its label) ever genuinely changes.
