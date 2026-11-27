import { Page } from '@playwright/test';
import { logger } from './logger';

/**
 * The Kylas "Keyboard shortcuts" announcement (2026-11-27, dev smoke run 45807808557: 15 of 51 failed with "a modal or
 * overlay is open over the page ('Do almost anything in Kylas with Ctrl K')"). Probed live on QA for admin and restricted:
 * `div.shortcuts-intro[role=dialog]` (aria-labelledby `shortcuts-intro-title`) with Try it now / See all shortcuts /
 * Maybe later / Shortcut settings; no close X, no "don't show again". It shows on every page load and navigation until
 * "Maybe later" is clicked, which stores `kylas.keyboardShortcuts = {"seen":[<userId>]}` in the browser (carried by
 * storageState, not saved on the server: a brand-new login shows it again).
 *
 * Only this exact pop-up is touched: the container class AND the exact title must match. Any other overlay, including
 * the plan-upgrade modal, is left alone and still fails by name (BasePage.findBlockingOverlay).
 */
export const CTRL_K_POPUP_TITLE = 'Do almost anything in Kylas with Ctrl K';
const POPUP = '[role="dialog"].shortcuts-intro';
const LATER_BUTTON = `${POPUP} .shortcuts-intro__later`;

/** True when the Ctrl K pop-up is visible right now (title checked exactly). Never waits, never throws. */
export async function isCtrlKAnnouncementOpen(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(
      ({ selector, title }) => {
        const box = document.querySelector(selector);
        if (!box) return false;
        const r = box.getBoundingClientRect();
        const st = getComputedStyle(box);
        if (r.width <= 0 || r.height <= 0 || st.visibility === 'hidden' || st.display === 'none') return false;
        const heading = document.getElementById(box.getAttribute('aria-labelledby') || '') ?? box.querySelector('h1, h2, h3, h4, [role="heading"]');
        return (heading?.textContent || '').replace(/\s+/g, ' ').trim() === title;
      },
      { selector: POPUP, title: CTRL_K_POPUP_TITLE }
    );
  } catch {
    return false;
  }
}

/**
 * Clicks "Maybe later" once on the Ctrl K pop-up if it is open. `waitMs` 0 (the page-ready guard) is a single presence
 * check with no waiting, so a page without the pop-up pays no timeout; the login passes a bound because the pop-up shows a few
 * seconds after the first page loads. Returns true when it was dismissed. Never throws.
 */
export async function dismissCtrlKAnnouncement(page: Page, waitMs = 0): Promise<boolean> {
  try {
    if (waitMs > 0) await page.locator(POPUP).first().waitFor({ state: 'visible', timeout: waitMs }).catch(() => undefined);
    if (!(await isCtrlKAnnouncementOpen(page))) return false;
    await page.locator(LATER_BUTTON).first().click({ timeout: 3000 });
    await page.locator(POPUP).first().waitFor({ state: 'hidden', timeout: 3000 });
    logger.info('Dismissed the Ctrl K announcement pop-up');
    return true;
  } catch {
    return false;
  }
}
