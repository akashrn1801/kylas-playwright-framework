#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# apply_fixes.sh — patches QuotationsPage.ts, quotations.rbac.spec.ts, fixtures/index.ts
# Run from project root:  bash apply_fixes.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e
ROOT="$(pwd)"
QP="$ROOT/src/modules/quotations/QuotationsPage.ts"
SPEC="$ROOT/tests/rbac/quotations.rbac.spec.ts"
FIX="$ROOT/src/fixtures/index.ts"

echo "▶ Checking files exist..."
for f in "$QP" "$SPEC" "$FIX"; do
  [ -f "$f" ] || { echo "NOT FOUND: $f"; exit 1; }
done
echo "✓ All files found"

# ─── backup ───────────────────────────────────────────────────────────────────
cp "$QP"   "$QP.bak"
cp "$SPEC" "$SPEC.bak"
cp "$FIX"  "$FIX.bak"
echo "✓ Backups created (.bak)"

# ─── helper: Python inline replace (exact string, no regex hell) ───────────────
patch() {
  local file="$1"
  local old="$2"
  local new="$3"
  python3 - "$file" "$old" "$new" <<'PYEOF'
import sys
file, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(file).read()
if old not in src:
    print(f"  ✗ PATCH TARGET NOT FOUND in {file}")
    print(f"  Looked for: {old[:80]!r}")
    sys.exit(1)
count = src.count(old)
if count > 1:
    print(f"  ✗ AMBIGUOUS: found {count} occurrences — patch not applied")
    sys.exit(1)
open(file, 'w').write(src.replace(old, new, 1))
PYEOF
}

# ═════════════════════════════════════════════════════════════════════════════
# FIX 1 — performSearch: dismiss modal + collapse tooltip before click
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "▶ FIX 1 — performSearch overlay guard..."
patch "$QP" \
'  private async performSearch(value: string): Promise<void> {
    logger.info(`Searching quotation: ${value}`);
    await this.fill(this.searchInput(), value, '"'"'search input'"'"');
    await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes('"'"'search'"'"') && r.request().method() === '"'"'POST'"'"' && r.status() === 200,
        { timeout: 15000 },
      ).catch(() => null),
      this.click(this.page.locator('"'"'svg:has(#clip-Ic_Search)'"'"').first(), '"'"'search icon'"'"'),
    ]);
    try {
      await this.page.locator('"'"'.spinner, .loader, .loading'"'"').last().waitFor({ state: '"'"'hidden'"'"', timeout: 10000 });
    } catch {
      // loader may not exist
    }
  }' \
'  private async performSearch(value: string): Promise<void> {
    logger.info(`Searching quotation: ${value}`);

    // WHY: Modal or tooltip overlays intercept pointer events on the search icon.
    const modal = this.page.locator('"'"'#editEntityModal'"'"');
    const isModalVisible = await modal.isVisible().catch(() => false);
    if (isModalVisible) {
      await modal.waitFor({ state: '"'"'hidden'"'"', timeout: 15000 });
    }

    // WHY: .portal-element tooltips float above the list and block clicks — move mouse away.
    await this.page.mouse.move(0, 0);
    await this.page.waitForTimeout(300);

    await this.fill(this.searchInput(), value, '"'"'search input'"'"');

    await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().includes('"'"'search'"'"') && r.request().method() === '"'"'POST'"'"' && r.status() === 200,
        { timeout: 15000 },
      ).catch(() => null),
      this.page.locator('"'"'svg:has(#clip-Ic_Search)'"'"').first().click({ timeout: 15000 }),
    ]);

    try {
      await this.page.locator('"'"'.spinner, .loader, .loading'"'"').last().waitFor({ state: '"'"'hidden'"'"', timeout: 10000 });
    } catch {
      // loader may not exist
    }
  }'
echo "✓ FIX 1 applied"

# ═════════════════════════════════════════════════════════════════════════════
# FIX 2 — errorToast: "Uhoh" → regex /uh.?oh/i  (matches "Uh oh" with space)
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "▶ FIX 2 — errorToast selector..."
patch "$QP" \
'  private readonly errorToast = (): Locator =>
    this.page.locator('"'"'.rrt-middle-container'"'"').filter({ hasText: '"'"'Uhoh'"'"' });' \
'  private readonly errorToast = (): Locator =>
    this.page.locator('"'"'.rrt-middle-container'"'"').filter({ hasText: /uh.?oh/i });'
echo "✓ FIX 2 applied"

# ═════════════════════════════════════════════════════════════════════════════
# FIX 3 — addRandomProduct: scope options to modal when modal is open
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "▶ FIX 3 — addRandomProduct modal-scoped options..."
patch "$QP" \
'    const productControl = productInput.locator('"'"'xpath=ancestor::div[contains(@class,"is-invalid__control")]'"'"');
    await productControl.click();
    await productInput.fill('"'"'a'"'"');
    await this.page.locator('"'"'.is-invalid__option'"'"').first().waitFor({ state: '"'"'visible'"'"', timeout: 10000 });
    const options = this.page.locator('"'"'.is-invalid__option'"'"');
    const count = await options.count();
    const randomIndex = Math.floor(Math.random() * Math.min(count, 10));
    const productName = (await options.nth(randomIndex).innerText()).trim();
    await options.nth(randomIndex).click();
    await this.page.locator('"'"'.is-invalid__menu'"'"').waitFor({ state: '"'"'hidden'"'"', timeout: 10000 }).catch(() => {});
    await this.productQuantityInput(row).fill('"'"'1'"'"');
    logger.success(`Added product: ${productName}`);
  }' \
'    const productControl = productInput.locator('"'"'xpath=ancestor::div[contains(@class,"is-invalid__control")]'"'"');
    await productControl.click();
    await productInput.fill('"'"'a'"'"');

    // WHY: When modal is open, scope options to #editEntityModal to avoid picking
    // up stale dropdowns from elsewhere on the page.
    const modalOpen = await this.page.locator('"'"'#editEntityModal'"'"').isVisible().catch(() => false);
    const optionsLocator = modalOpen
      ? this.page.locator('"'"'#editEntityModal .is-invalid__option'"'"')
      : this.page.locator('"'"'.is-invalid__option'"'"');

    await optionsLocator.first().waitFor({ state: '"'"'visible'"'"', timeout: 15000 });
    const count = await optionsLocator.count();
    const randomIndex = Math.floor(Math.random() * Math.min(count, 10));
    const productName = (await optionsLocator.nth(randomIndex).innerText()).trim();
    await optionsLocator.nth(randomIndex).click();
    await this.page.locator('"'"'.is-invalid__menu'"'"').waitFor({ state: '"'"'hidden'"'"', timeout: 10000 }).catch(() => {});
    await this.productQuantityInput(row).fill('"'"'1'"'"');
    logger.success(`Added product: ${productName}`);
  }'
echo "✓ FIX 3 applied"

# ═════════════════════════════════════════════════════════════════════════════
# FIX 4 — T10 spec: add settle wait before searchQuotation
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "▶ FIX 4 — T10 settle wait before search..."
patch "$SPEC" \
'    // Restricted user should now see the quotation
    await restrictedQuotationsPage.goToQuotationsList();
    await restrictedQuotationsPage.searchQuotation(adminData.quotationNumber);' \
'    // Restricted user should now see the quotation
    await restrictedQuotationsPage.goToQuotationsList();
    // WHY: List needs a moment to render before search input is interactive.
    await restrictedPage.waitForTimeout(1500);
    await restrictedQuotationsPage.searchQuotation(adminData.quotationNumber);'
echo "✓ FIX 4 applied"

# ═════════════════════════════════════════════════════════════════════════════
# FIX 5 — T25 spec: wait for chips to mount before counting
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "▶ FIX 5 — T25 wait for chips before count..."
patch "$SPEC" \
'    if (id) {
      await restrictedPage.goto(`${config.appUrl}/sales/quotations/details/${id}`);
    } else {
      await restrictedQuotationsPage.searchAndOpenQuotation(adminData.quotationNumber);
    }

    // Deal chip visible (deal is shared via ownership) — deal selected randomly
    const chips25 = restrictedPage.locator(".related-entity-container");
    if (await chips25.count() === 0) throw new Error("No entity chips on detail page");' \
'    if (id) {
      await restrictedPage.goto(`${config.appUrl}/sales/quotations/details/${id}`, {
        waitUntil: '"'"'domcontentloaded'"'"',
      });
      // WHY: React entity chips mount asynchronously — wait for first one before counting.
      await restrictedPage.locator('"'"'.related-entity-container'"'"').first()
        .waitFor({ state: '"'"'visible'"'"', timeout: 15000 });
    } else {
      await restrictedQuotationsPage.searchAndOpenQuotation(adminData.quotationNumber);
      await restrictedPage.locator('"'"'.related-entity-container'"'"').first()
        .waitFor({ state: '"'"'visible'"'"', timeout: 15000 });
    }

    // Deal chip visible (deal is shared via ownership) — deal selected randomly
    const chips25 = restrictedPage.locator(".related-entity-container");
    if (await chips25.count() === 0) throw new Error("No entity chips on detail page");'
echo "✓ FIX 5 applied"

# ═════════════════════════════════════════════════════════════════════════════
# FIX 6 — fixtures/index.ts: retry page.goto on restrictedPage (3 attempts)
# ═════════════════════════════════════════════════════════════════════════════
echo ""
echo "▶ FIX 6 — restrictedPage goto retry..."
patch "$FIX" \
'    // WHY: Stagger restricted user initialization on GHA to avoid concurrent session conflicts
    if (process.env.CI) await page.waitForTimeout(Math.floor(Math.random() * 3000));
    await page.goto(config.appUrl, { waitUntil: '"'"'domcontentloaded'"'"' });
    await page.waitForURL(/sales\//, { timeout: config.timeouts.navigation });' \
'    // WHY: Stagger restricted user initialization on GHA to avoid concurrent session conflicts
    if (process.env.CI) await page.waitForTimeout(Math.floor(Math.random() * 3000));
    // WHY: QA env has intermittent TCP timeouts under parallel load — mirror AuthManager 3-retry pattern.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(config.appUrl, { waitUntil: '"'"'domcontentloaded'"'"', timeout: 60000 });
        break;
      } catch (e) {
        if (attempt === 3) throw e;
        logger.warn(`restrictedPage goto attempt ${attempt} failed — retrying in 3s`);
        await page.waitForTimeout(3000);
      }
    }
    await page.waitForURL(/sales\//, { timeout: config.timeouts.navigation });'
echo "✓ FIX 6 applied"

# ─── done ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo "✅  All 6 fixes applied successfully"
echo "════════════════════════════════════════"
echo ""
echo "Run tests:"
echo "  rm -rf src/auth/storageStates/ && npx playwright test --project=chromium --reporter=list 2>&1 | tee test-output.txt"
