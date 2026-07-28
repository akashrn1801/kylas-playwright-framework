import { Page } from '@playwright/test';
import { config } from '../../config/config';

// WHY this file exists — read before ever writing `page.waitForURL(...)` directly:
//
// Playwright's page.waitForURL() defaults to `waitUntil: 'load'` when not
// explicitly overridden. 'load' waits for EVERY resource on the page —
// images, third-party embeds/chat-widget iframes, analytics beacons,
// tracking pixels — to finish, not just the URL changing. Under real CI
// conditions (headless, extension-free, occasionally a resource that never
// completes) this can hang for the ENTIRE configured timeout even though the
// navigation itself succeeded in milliseconds.
//
// This exact bug class independently appeared THREE times in this codebase —
// BasePage.ts's own waitForUrl() (fixed 2026-07-07), globalSetup.ts (fixed
// 2026-07-19 after two consecutive stage.yml CI failures), and
// fixtures/index.ts's navigateAndConfirmLoggedIn() (found the same day,
// still live on every single test's fixture setup, surfacing as an opaque
// "Test timeout of 120000ms exceeded while setting up 'adminPage'"/
// 'restrictedPage'" with zero indication the real cause was a stuck 'load'
// event) — before finally being consolidated here. Each prior occurrence was
// only found after it caused a real, confusing CI failure, precisely because
// there was no single enforcement point: the fix kept being silently
// reintroduced by copy-pasting a plain `page.waitForURL(...)` call into a new
// file instead of reusing the one place that already got it right.
//
// THE RULE: every URL-wait in this codebase — anywhere, in any file, for any
// purpose — goes through this function (or BasePage.waitForUrl(), which
// delegates to it), never a bare `page.waitForURL(...)` call written inline.
// If you are about to type `page.waitForURL(`, stop and call
// `safeWaitForURL` instead. Page objects that extend BasePage should use
// `this.waitForUrl(...)`; anything that does NOT extend BasePage (auth
// infrastructure like globalSetup.ts/authManager.ts/fixtures/index.ts, or any
// future non-page-object code) should import and call `safeWaitForURL`
// directly — that's exactly why this lives as a standalone utility function
// and not only as a BasePage method.
export async function safeWaitForURL(
  page: Page,
  urlPattern: string | RegExp | ((url: URL) => boolean),
  timeout: number = config.timeouts.navigation
): Promise<void> {
  await page.waitForURL(urlPattern, { timeout, waitUntil: 'domcontentloaded' });
}
