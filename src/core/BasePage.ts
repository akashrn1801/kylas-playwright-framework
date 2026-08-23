import { config } from '../../config/config';
import { Page, Locator, Response, expect, test } from '@playwright/test';
import { logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import {
  isSessionExpiryPage,
  tryRecoverSessionForPage,
  isPageRegisteredForRecovery,
  armSessionExpirySignal,
} from '../auth/authManager';
import { safeWaitForURL } from '../utils/navigation';

// See BasePage.customFieldSuffix()'s own comment for what these mean and why
// this is an opt-in parameter rather than an unconditional dual-match.
export type CustomFieldSuffixStyle = 'legacy' | 'plain';

export class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ─── Navigation ───────────────────────────────────────────

  // WHY mid-test session recovery lives here too (added 2026-07-20): this is
  // the single most-used navigation primitive in the codebase (44+ call
  // sites across every module) — click()/fill() already had this same
  // recovery (2026-07-09), but a raw goto() landing on /signIn was never
  // covered. Confirmed live: quotations.rbac.spec.ts's "restricted user
  // should edit shared quotation when deal is accessible" failed exactly
  // this way (session genuinely expired server-side ~24 minutes in, mid-
  // test) — the test used a raw `restrictedPage.goto()` bypassing this
  // method entirely, which is the actual reason click()/fill()'s existing
  // recovery couldn't save it. Deliberately reuses tryRecoverSessionForPage()
  // as-is — no new login logic, no new timeout values, no assumption about
  // WHEN expiry happens (it reacts to the actual redirect, never a guessed
  // duration) — because goto() doesn't throw on a redirect the way a failed
  // click/fill does, the check has to happen AFTER the navigation resolves,
  // not in a catch block. Gated on isPageRegisteredForRecovery() for the same
  // reason click()/fill() now are (see that function's own comment) — a
  // plain @playwright/test `page` (e.g. login.spec.ts) intentionally lands on
  // signIn as its own tested condition and must never trigger this.
  async navigateTo(url: string): Promise<void> {
    logger.info(`Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    if (isPageRegisteredForRecovery(this.page) && (await isSessionExpiryPage(this.page))) {
      logger.warn(
        `Navigation to "${url}" landed on a signIn/login or Forbidden page — attempting one-time session recovery`
      );
      // WHY no retry loop here: tryRecoverSessionForPage() already navigates
      // back to `url` internally after re-authenticating, and throws (never
      // silently returns) if it's still on signIn or hits a permission-denied
      // page afterward — that throw propagates straight out of this method,
      // failing the test loudly instead of masking a genuine problem.
      await tryRecoverSessionForPage(this.page, url);
    }
  }

  // WHY this exists (2026-07-20, Gap 2 of today's session-expiry audit — see
  // authManager.ts's own comment on armSessionExpirySignal() for the fuller
  // background): a raw `page.waitForResponse(predicate, {timeout})` used to
  // capture a save's response/ID is blind to mid-test session expiry —
  // confirmed live twice (leads.rbac.spec.ts:398, call-logs.spec.ts:305)
  // waiting out the FULL configured timeout before giving up. This is a
  // deliberately MINIMAL, drop-in replacement for that one call, not a
  // restructuring of the surrounding code: every existing call site keeps
  // its own `.then(extractId).catch(() => null)` chain exactly as-is — only
  // the innermost `this.page.waitForResponse(predicate, {timeout})` becomes
  // `this.armResponseWaitWithRecovery(predicate, description, timeout)`.
  // This matters for a subtle but real reason: some call sites (confirmed in
  // TasksPage.saveDetailedTask()) arm TWO independent waitForResponse
  // listeners racing the SAME single trigger click — wrapping the trigger
  // action itself (rather than just the arming call) would risk a caller
  // double-invoking that trigger. Keeping the trigger action exactly where
  // it already lives in each caller sidesteps that risk entirely.
  //
  // WHY this deliberately does NOT try to resume the original request: by
  // the time expiry is detected, the confirmed observed behavior is a
  // full-page redirect to /signIn — any create-form/modal that triggered the
  // request is already gone from the DOM. Blindly retrying would have
  // nothing left to retry against. Instead: recover the session immediately
  // (so whatever runs next — later steps in the same test, or Playwright's
  // own outer retry — starts fresh) and fail FAST (typically ~1-2s once the
  // expiry signal fires) instead of waiting out the full timeout. Both real
  // occurrences today already self-healed via Playwright's own outer retry —
  // this cuts the wasted time on the failing attempt from 30-60s to ~1-2s,
  // without pretending to achieve same-attempt recovery it can't safely do
  // here. For the subset of top-level workflow methods where same-attempt
  // recovery IS safe (self-starting, no assumed prior UI state), see
  // withSessionExpiryRetry() below instead — that's the mechanism that
  // achieves genuine invisible-to-the-test recovery, layered on TOP of this
  // one, not a replacement for it.
  //
  // WHY this method doesn't itself track "was expiry detected" for any
  // outer caller: see withSessionExpiryRetry() below — it arms its OWN,
  // independent armSessionExpirySignal() covering the whole workflow, rather
  // than relying on a flag this method would set. Found via deliberate
  // reproduction that a flag set only AFTER this method's own (slow, ~10s+)
  // recovery completed could arrive too late relative to a DIFFERENT, faster
  // code path elsewhere in the same workflow reacting to the same underlying
  // failure (e.g. assertNoFormErrors() reading a toast within ~1.5s) — see
  // armSessionExpirySignal()'s own updated comment in authManager.ts for the
  // full race and its fix.
  protected armResponseWaitWithRecovery(
    predicate: (response: Response) => boolean,
    description: string,
    timeout = 30000
  ): Promise<Response> {
    const responsePromise = this.page.waitForResponse(predicate, { timeout });

    // WHY: a page never registered for recovery (e.g. login.spec.ts's plain
    // `page` fixture) gets the exact pre-existing behavior, unchanged — see
    // isPageRegisteredForRecovery()'s own comment for why this check exists.
    if (!isPageRegisteredForRecovery(this.page)) {
      return responsePromise;
    }

    const urlBeforeAction = this.page.url();
    const signal = armSessionExpirySignal(this.page);

    return Promise.race([
      responsePromise.then((response) => {
        signal.cancel();
        return response;
      }),
      signal.promise.then(async () => {
        signal.cancel();
        logger.warn(
          `${description}: session expiry detected while waiting for a response — recovering ` +
            `session and failing fast instead of waiting out the full ${timeout}ms timeout`
        );
        await tryRecoverSessionForPage(this.page, urlBeforeAction);
        throw new Error(
          `${description}: session expired while waiting for a response — session has been ` +
            `recovered, but the original in-flight request cannot be resumed (its triggering ` +
            `page state is gone). Retry the calling action.`
        );
      }),
    ]).finally(() => {
      // WHY both branches also cancel: whichever branch loses the race must
      // still remove its listeners — an uncancelled response-side listener
      // is harmless (GC'd with the promise), but an uncancelled signal
      // listener would keep watching this page for the rest of the test,
      // an unbounded resource leak for a per-call helper. `.finally()` here
      // is a defensive backstop in case a future edit removes one of the
      // inline `signal.cancel()` calls above.
      signal.cancel();
    });
  }

  // WHY this exists (2026-07-20, Gap 2's other half): a subset of top-level
  // workflow methods (confirmed via a dedicated investigation across all 8
  // page-object files before writing this) are genuinely SAFE to retry from
  // scratch on a confirmed session expiry — they are "self-starting" (open
  // their own form/navigate themselves, assume no prior UI state) and,
  // critically, the call chain proved a real session expiry always
  // surfaces as a clean HTTP 400/401-shaped rejection (auth middleware
  // rejects before any business logic/DB write runs) — so re-invoking with
  // the SAME input can never create a duplicate record. NOT applied
  // blanket-wide: share/reassign/clone/add-from-panel methods assume the
  // page is already on a specific entity's detail view (confirmed NOT
  // self-starting across every module) and would fail worse if blindly
  // retried after a recovery navigation — those rely on
  // armResponseWaitWithRecovery() above instead, not this method.
  //
  // WHY it checks a synchronous, event-driven signal rather than retrying on
  // any thrown error: a genuinely different failure (a real validation
  // error, a real timeout) must never be blindly retried; only a CONFIRMED
  // session-expiry event allows a second attempt. WHY this arms its OWN
  // armSessionExpirySignal() (covering the whole workflowFn call) instead of
  // relying on a flag set by a nested armResponseWaitWithRecovery() call:
  // found via deliberate reproduction — an earlier version used a WeakMap
  // flag that armResponseWaitWithRecovery() set only AFTER fully awaiting
  // its own recovery (tryRecoverSessionForPage(), a real re-login, 10+
  // seconds). That arrived too late for a workflow shaped like
  // LeadsPage.saveLead(): it arms an ID-capture promise WITHOUT awaiting it
  // yet, then runs OTHER code (assertNoFormErrors()) that reacts to the same
  // underlying failure much faster (~1.5s, a DOM toast-check) — reproduced
  // live, that faster code threw and propagated out of the whole workflow
  // before the flag had been set, so the retry never fired despite this
  // being a genuine, confirmed expiry. `hasFired()` is a synchronous boolean
  // toggled the INSTANT the browser reports the underlying 401/redirect
  // event — Playwright's `page.on(...)` callbacks fire immediately, with no
  // awaited chain in between, which always precedes any JS-level reaction
  // to that same event (the network event fires before the app's JS can
  // process the response and render anything). Checking it here, armed for
  // the ENTIRE workflowFn call, is race-free regardless of how slow any
  // NESTED recovery attempt inside workflowFn is. Bounded to exactly one
  // retry, matching every other recovery mechanism in this codebase
  // (click/fill/navigateTo all retry at most once).
  //
  // WHY the caller must build its own clone of any mutable input INSIDE
  // workflowFn, not this method: confirmed live that LeadsPage/ContactsPage
  // helpers mutate their `data` parameter in place mid-fill (e.g.
  // `data.timezone`, `data.address`) — if attempt 1 fails partway through,
  // by the time this method's catch block runs, the caller's outer `data`
  // reference may already be mutated. This method has no way to know the
  // shape of any given caller's data or how to clone it correctly — the
  // caller must construct a fresh, unmutated copy at the TOP of `workflowFn`
  // itself (e.g. `const attemptData = { ...data };`) so attempt 2 always
  // starts from the same clean input as attempt 1, never attempt 1's
  // partially-mutated leftovers.
  // WHY this explicitly calls tryRecoverSessionForPage() itself, rather than
  // trusting the nested armResponseWaitWithRecovery() call's own (now
  // abandoned) recovery to have finished: found via the same deliberate
  // reproduction as above — the code path that threw first (e.g.
  // assertNoFormErrors()) leaves the NESTED recovery's promise chain
  // (inside the still-unawaited leadIdPromise) running in the background,
  // unobserved. Retrying workflowFn() immediately, without this method's own
  // explicit, AWAITED recovery, risks starting the retry before the session
  // is actually fresh, or racing the abandoned chain's own later
  // `page.goto()` mid-retry. Calling tryRecoverSessionForPage() here is not
  // wasted duplicate work: authManager.ts's loginAndSaveState() already
  // dedupes concurrent logins for the same role (an in-memory Map + cross-
  // process file lock) — a second concurrent call simply awaits the first
  // one's in-flight promise rather than logging in twice.
  protected async withSessionExpiryRetry<T>(
    workflowFn: () => Promise<T>,
    description: string
  ): Promise<T> {
    if (!isPageRegisteredForRecovery(this.page)) {
      return workflowFn();
    }
    const urlBeforeAttempt = this.page.url();
    const signal = armSessionExpirySignal(this.page);
    try {
      const result = await workflowFn();
      return result;
    } catch (error) {
      if (!signal.hasFired()) {
        throw error;
      }
      logger.warn(
        `${description}: session expiry was detected during this workflow — recovering session ` +
          `and retrying the whole operation once`
      );
      await tryRecoverSessionForPage(this.page, urlBeforeAttempt);
      return await workflowFn();
    } finally {
      signal.cancel();
    }
  }

  // WHY this exists (2026-07-23 session-expiry architecture overhaul): a
  // full-codebase grep found 80 RAW `expect(...).toBeVisible/toHaveText/
  // toHaveURL` calls written directly in module page objects (Contacts 18,
  // Companies 19, Deals 23, Leads 12, CallLogs 4, Tasks 3, Quotations 1),
  // every one silently unprotected by the mid-test session-expiry recovery
  // that click()/fill()/navigateTo()/assertUrl() each hand-roll their own
  // copy of. A CENTRALIZED, zero-call-site-action fix was attempted first
  // (a page.route() network interceptor that would heal a 401 before the
  // page's own JS ever saw it) — confirmed via decisive live A/B testing
  // that route.fetch(), which that approach requires to inspect a
  // response's status before deciding whether to fulfill it, gets a
  // meaningful fraction of ordinary, non-401 Kylas API requests rejected
  // with a generic 400 by the real backend (isolated precisely: the exact
  // same test passes clean with the route handler removed AND with it
  // registered-but-forced-to-continue()-only, and only fails once
  // route.fetch() is actually used) — so that approach is not viable for
  // this backend and was abandoned, not shipped.
  //
  // This is the fallback design: not a return to copy-pasting the same
  // 10-line block at all 80 sites, but ONE shared, DRY implementation of
  // the exact same catch-recover-retry shape click() already uses,
  // wrapping a single caller-supplied Playwright call. Every call site
  // becomes a one-line change (`this.withSessionExpiryRecovery(() => ...)`),
  // which is the mechanical, low-risk part of the retrofit — the LOGIC
  // itself still lives in exactly one place, so a future fix to the
  // recovery mechanism (like click()'s own two historical bug fixes) only
  // needs to change this method, not 80+ call sites individually.
  protected async withSessionExpiryRecovery<T>(fn: () => Promise<T>): Promise<T> {
    // WHY captured BEFORE fn() runs, not inside the catch block — same
    // reasoning as click()'s identical comment: by the time an exception is
    // caught here, the page may already be on /signIn (that's the trigger
    // condition itself), so deriving "where to go back to" at that point
    // would just point back at signIn.
    const urlBeforeCall = this.page.url();
    try {
      return await fn();
    } catch (error) {
      if (!isPageRegisteredForRecovery(this.page) || !(await isSessionExpiryPage(this.page))) {
        throw error;
      }
      logger.warn(
        'A wrapped call failed while on a signIn/login or Forbidden page — attempting one-time session recovery'
      );
      await tryRecoverSessionForPage(this.page, urlBeforeCall);
      return await fn();
    }
  }

  async reloadPage(): Promise<void> {
    logger.info('Reloading page');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  async getPageTitle(): Promise<string> {
    return await this.page.title();
  }

  async getCurrentUrl(): Promise<string> {
    return this.page.url();
  }

  // ─── Click Actions ────────────────────────────────────────

  async click(locator: Locator, description = 'element', force = false): Promise<void> {
    logger.info(`Clicking: ${description}`);
    // WHY: captured BEFORE the action, not inside the catch block — by the
    // time an exception is caught here, the page may already be on
    // /signIn (that's the trigger condition itself), so deriving "where to
    // go back to" at that point would just point back at signIn.
    const urlBeforeAction = this.page.url();
    try {
      // WHY: Explicit timeout prevents silent infinite hang when an element never renders.
      // Without a timeout, waitFor inherits the test timeout (up to 600s) — the test
      // then hangs until Playwright teardown instead of failing with an actionable error.
      await locator.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      await locator.click({ timeout: 15000, force });
    } catch (error) {
      // WHY: mid-test session recovery (2026-07-09) — confirmed live and via
      // CI logs that Kylas's QA backend occasionally returns a spurious
      // auth-recognition failure on an unrelated request, which the app's
      // own frontend responds to by redirecting to /signIn — unrelated to
      // the actual ~12h token lifetime. Gated strictly on actually being on
      // that URL right now (never on "any error") so a real RBAC denial —
      // which this app expresses as an in-page toast, confirmed via
      // CallLogsPage's own permission-error handling, never a redirect —
      // can't be mistaken for this. tryRecoverSessionForPage() itself
      // throws (not returns false) if it lands on a permission-denied page
      // after recovering, so that case still surfaces as a real failure
      // here too. The retry below is the same, unwrapped Playwright call —
      // no second recovery attempt, no swallowing — so a failure on retry
      // (including a second redirect) propagates directly as a genuine error.
      // WHY the registration check (added 2026-07-20, found via deliberate
      // stress-testing, not a reported bug): without it, any test using a
      // plain @playwright/test `page` (e.g. login.spec.ts, whose own flows
      // legitimately start on/return to signIn) would get a confusing "Page
      // was not registered for session recovery" instead of its real error,
      // the moment a click ever failed while genuinely on that page's
      // expected signIn state. See isPageRegisteredForRecovery()'s own
      // comment for the full explanation.
      if (!isPageRegisteredForRecovery(this.page) || !(await isSessionExpiryPage(this.page))) {
        throw error;
      }
      logger.warn(
        `"${description}" failed while on a signIn/login or Forbidden page — attempting one-time session recovery`
      );
      await tryRecoverSessionForPage(this.page, urlBeforeAction);
      await locator.waitFor({ state: 'visible', timeout: config.timeouts.navigation });
      await locator.click({ timeout: 15000, force });
    }
  }

  async clickByText(text: string): Promise<void> {
    logger.info(`Clicking by text: ${text}`);
    await this.page.getByText(text).click();
  }

  // ─── Input Actions ────────────────────────────────────────

  // WHY (2026-07-20, real credential leakage confirmed and fixed): `fill()`
  // used to unconditionally log the literal value being typed, with no
  // exception for sensitive fields — `LoginPage.enterPassword()` calls
  // `this.fill(passwordInput, password, 'password field')` with the REAL
  // `QA_ADMIN_PASSWORD`/`QA_RESTRICTED_PASSWORD` from `.env` (used by
  // `login.spec.ts`'s two happy-path tests), so the actual plaintext
  // password was being written to every log file from any run that includes
  // that file — confirmed present in 5 historical log files. Grepped the
  // entire codebase for every OTHER place a credential/token could leak the
  // same way: `authManager.ts`'s own login flow (`globalSetup.ts` +
  // `_doLogin()`) fills the password via a raw, un-logged locator call and
  // was already safe; no token/cookie/session-id value is ever passed to a
  // logger call anywhere else. This is the only real leak.
  // Deliberately NOT masking email/username here — confirmed both
  // `QA_ADMIN_EMAIL`/`QA_RESTRICTED_EMAIL` are `@mailinator.com` disposable
  // test addresses (a public inbox service, not real PII), and this
  // codebase already logs plenty of fake-but-real-looking generated emails
  // for created test entities everywhere else — masking only the login
  // email here would be inconsistent for near-zero security benefit and
  // would cost real debuggability on login-flow failures.
  private static readonly SENSITIVE_FIELD_PATTERN = /password|passwd|pwd|secret|token|api[_-]?key/i;

  // WHY description-based, not a DOM `type="password"` query: the only
  // known sensitive call site already passes an accurate description
  // ('password field'), and this codebase's own convention is descriptive
  // `description` strings at every fill() call site — checking the string
  // is synchronous and adds zero latency to the many thousands of ordinary
  // fill() calls in a full suite run. A DOM-attribute check would need an
  // extra async round-trip on every single call to protect against a
  // scenario (a password-type field with a misleading description) that a
  // full grep of every locator in this codebase confirmed does not exist
  // today (`#input_password` is the only password field anywhere, and its
  // one call site already describes itself accurately).
  private isSensitiveFieldDescription(description: string): boolean {
    return BasePage.SENSITIVE_FIELD_PATTERN.test(description);
  }

  async fill(locator: Locator, value: string, description = 'field'): Promise<void> {
    const sensitive = this.isSensitiveFieldDescription(description);
    logger.info(`Filling ${description} with: ${sensitive ? '[REDACTED]' : value}`);
    // WHY: see click()'s identical comment — must capture before the try.
    const urlBeforeAction = this.page.url();
    try {
      await locator.waitFor({ state: 'visible' });
      await locator.clear();
      await locator.fill(value);
    } catch (error) {
      // WHY: same mid-test session recovery as click() above — see that
      // method's comment for the full rationale. Kept as a single,
      // non-recursive retry of the exact same calls. Same registration
      // check as click() too — see isPageRegisteredForRecovery()'s comment.
      if (!isPageRegisteredForRecovery(this.page) || !(await isSessionExpiryPage(this.page))) {
        throw error;
      }
      logger.warn(
        `Filling "${description}" failed while on a signIn/login or Forbidden page — attempting one-time session recovery`
      );
      await tryRecoverSessionForPage(this.page, urlBeforeAction);
      await locator.waitFor({ state: 'visible' });
      await locator.clear();
      await locator.fill(value);
    }
  }

  async selectOption(locator: Locator, value: string, description = 'dropdown'): Promise<void> {
    logger.info(`Selecting ${value} in ${description}`);
    await locator.waitFor({ state: 'visible' });
    await locator.selectOption(value);
  }

  // WHY (2026-07-17): shared, robust random-option selector — kills a bug class
  // found in 7 places across 5 modules (Deals/Tasks/Meetings/Call-logs), each of
  // which picked a random option from an open react-select menu then did an
  // UNBOUNDED `textContent()` + `.click()`. Two live-confirmed failure modes:
  //  (1) a churning/detaching option list makes the unbounded read or click
  //      auto-wait for a stable node and ride the FULL 480s test timeout — an
  //      ~8-min hard hang instead of failing fast (no `actionTimeout` is set in
  //      playwright.config.ts); and
  //  (2) one specific option index can be persistently non-actionable while
  //      other indices in the SAME list work — so retrying the same index is
  //      futile and only the outer test-level retry saves it.
  // This bounds BOTH the read and the click to 15000ms (the exact value
  // DealsPage's earlier `.click()` fix already used — mirrored, not invented)
  // and RE-ROLLS to a fresh random index each attempt, so a transient bad option
  // is replaced rather than re-hit — recovering within the test's first attempt.
  // Caller must ensure the options are already visible. `maxOptions` caps the
  // random range (for the existing `Math.min(count, 5)` call sites); `force`
  // passes through to the click. Returns the selected option's trimmed text.
  protected async selectRandomOptionWithRetry(
    options: Locator,
    description: string,
    opts: { maxOptions?: number; force?: boolean } = {}
  ): Promise<string> {
    const total = await options.count();
    if (total === 0) {
      throw new Error(`${description}: no options available to select`);
    }
    const range = opts.maxOptions ? Math.min(total, opts.maxOptions) : total;
    let selectedText = 'unknown';
    let selectedIndex = -1;
    let done = false;
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      const idx = Math.floor(Math.random() * range);
      const option = options.nth(idx);
      logger.info(`${description}: attempting index ${idx} of ${total} (attempt ${attempt}/3)`);
      try {
        selectedText = (await option.textContent({ timeout: 15000 }))?.trim() ?? 'unknown';
        await option.click({ timeout: 15000, force: opts.force ?? false });
        selectedIndex = idx;
        done = true;
      } catch (error) {
        lastError = error;
        logger.info(
          `${description}: read/click on index ${idx} failed (attempt ${attempt}/3), retrying with a fresh index: ${String(error)}`
        );
      }
    }
    if (!done) {
      throw new Error(
        `${description}: failed to select any of ${total} options after 3 attempts — ${String(lastError)}`
      );
    }
    // WHY (confirmed live 2026-07-27, Deals D35 "add existing contact" investigation):
    // this method previously returned immediately after the click, with no wait for
    // the react-select's own menu-close state transition — the same click-registers-
    // before-state-commits race already root-caused elsewhere in this codebase
    // (DealsPage.cloneDeal(), TasksPage.selectReactSelectOption()). Confirmed via a
    // real log timeline: a caller that saves immediately after this method returns
    // (DealsPage.addContactToDeal()) logged a 2ms gap between "option selected" and
    // "clicking save," and the save silently persisted with no contact attached
    // despite reporting success. Mirrors the wait already used by
    // selectRandomFromSingleReactSelect()/selectRandomFromSearchableReactSelect() —
    // a real readiness signal (the library's own state transition), bounded and
    // non-fatal so a slow-to-close menu can never turn a working selection into a
    // failure.
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* menu may already be gone, or this control doesn't use this menu class */
      });
    logger.success(`${description} selected: "${selectedText}" (index ${selectedIndex} of ${total})`);
    return selectedText;
  }

  // WHY (Fix 2, 2026-07-17): a deliberately NARROW list of network-layer error
  // signatures that mean "the request never reached/completed against the
  // server" — i.e. genuinely transient and safe to retry for an idempotent GET
  // search. Confirmed live: ERR_NAME_NOT_RESOLVED (a DNS blip failed a
  // /v1/companies/lookup search and cost a full test attempt). The rest are the
  // same connection-level class (interface changed, connection dropped/refused/
  // timed out, host unreachable) — all "no server response was produced", never
  // a decision the server made. Deliberately EXCLUDES anything indicating a real
  // response (HTTP 4xx/5xx — the server DID answer) and ERR_ABORTED (a
  // navigation cancel, not a failure). Do not widen this without evidence a new
  // signature is genuinely transient — a false inclusion would silently retry a
  // real, non-transient problem.
  private static readonly TRANSIENT_NETWORK_ERROR_PATTERNS: RegExp[] = [
    /ERR_NAME_NOT_RESOLVED/i,
    /ERR_INTERNET_DISCONNECTED/i,
    /ERR_NETWORK_CHANGED/i,
    /ERR_CONNECTION_RESET/i,
    /ERR_CONNECTION_REFUSED/i,
    /ERR_CONNECTION_TIMED_OUT/i,
    /ERR_ADDRESS_UNREACHABLE/i,
  ];

  private isTransientNetworkError(errorText: string): boolean {
    return BasePage.TRANSIENT_NETWORK_ERROR_PATTERNS.some((re) => re.test(errorText));
  }

  // WHY (Fix 2, 2026-07-17): fills a react-select's live-search input to trigger
  // a backend lookup, waits for options to appear, and — if the lookup's backend
  // request fails with a TRANSIENT network error (the list above) and the options
  // therefore never load — waits a short beat and RE-TRIGGERS the search, up to a
  // bounded number of attempts. This targets the specific, confirmed failure mode
  // from the overnight run (a brief DNS blip failed the company-search request and
  // cost a whole first-attempt test failure that only Playwright's outer retry
  // recovered). It is NOT a blind timeout bump: each attempt keeps the same
  // bounded wait; we only re-search when a transient network error was actually
  // observed on an API request during that attempt. A brief 1-3s blip thus becomes
  // invisible (the test passes within its FIRST attempt); a genuine extended
  // outage still fails, and fails reasonably fast (bounded attempts — worst case
  // ~3 × wait, no infinite retry). A non-transient failure (zero real results, or
  // an HTTP 4xx/5xx where the server responded) is NOT retried — it falls straight
  // through to a loud throw.
  protected async fillSearchAndWaitForOptions(
    searchInput: Locator,
    options: Locator,
    searchTerm: string,
    description: string
  ): Promise<void> {
    const maxAttempts = 3;
    // WHY 1500ms: sized to the observed blip duration, not a guess — the run's
    // DNS errors resolved within a couple of seconds; 1.5s lets a brief blip
    // clear before re-searching without materially slowing the genuine-outage
    // give-up path. Only ever paid when a transient error was actually seen.
    const transientRetryWaitMs = 1500;
    let lastTransient: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Scoped listener armed BEFORE triggering the search so the failure event
      // can't be missed; records the transient error text synchronously, then is
      // removed in `finally`. Matches only backend API requests (/v1.. /v9..) so
      // a transient failure on an unrelated static asset doesn't trigger a retry.
      let transientErr: string | null = null;
      const onRequestFailed = (req: import('@playwright/test').Request): void => {
        const err = req.failure()?.errorText ?? '';
        if (/\/v[1-9]\//.test(req.url()) && this.isTransientNetworkError(err)) {
          transientErr = err;
        }
      };
      this.page.on('requestfailed', onRequestFailed);

      let optionsAppeared = false;
      try {
        if (attempt > 1) {
          await searchInput.fill('');
          await this.page.waitForTimeout(200);
        }
        await searchInput.fill(searchTerm);
        optionsAppeared = await options
          .first()
          .waitFor({ state: 'visible', timeout: config.timeouts.expect })
          .then(() => true)
          .catch(() => false);
      } finally {
        this.page.off('requestfailed', onRequestFailed);
      }

      if (optionsAppeared) {
        return;
      }

      lastTransient = transientErr;
      if (lastTransient && attempt < maxAttempts) {
        logger.warn(
          `${description}: live search hit a transient network error (${lastTransient}) and options never loaded — waiting ${transientRetryWaitMs}ms and re-triggering search (attempt ${attempt}/${maxAttempts})`
        );
        await this.page.waitForTimeout(transientRetryWaitMs);
        continue;
      }

      // No transient error seen (a real, non-transient failure — genuinely zero
      // results, or a server 4xx/5xx), or retries exhausted on a persistent
      // outage. Stop and fail loudly + fast, never hang chasing an unreachable
      // network.
      break;
    }

    throw new Error(
      `${description}: live search for "${searchTerm}" returned no options after ${maxAttempts} attempt(s)` +
        (lastTransient ? ` — last transient network error: ${lastTransient}` : '')
    );
  }

  // ─── Wait Helpers ─────────────────────────────────────────

  // WHY these route through withSessionExpiryRecovery() (2026-07-23): these
  // generic wait/assert helpers are used broadly across module page objects
  // — exactly the shape of call that was found completely unprotected from
  // mid-test session expiry (see withSessionExpiryRecovery()'s own comment
  // for the fuller history). One-line change, same combinator every other
  // retrofitted call site uses.
  async waitForVisible(locator: Locator, timeout = 30000): Promise<void> {
    await this.withSessionExpiryRecovery(() => locator.waitFor({ state: 'visible', timeout }));
  }

  async waitForHidden(locator: Locator, timeout = 30000): Promise<void> {
    await this.withSessionExpiryRecovery(() => locator.waitFor({ state: 'hidden', timeout }));
  }

  async waitForUrl(
    urlPattern: string | RegExp | ((url: URL) => boolean),
    timeout = config.timeouts.navigation
  ): Promise<void> {
    logger.info(`Waiting for URL: ${urlPattern}`);
    // WHY: delegates to the shared safeWaitForURL() utility (2026-07-19) —
    // see src/utils/navigation.ts for the full history of why this exists and
    // why nothing in this codebase should ever call page.waitForURL()
    // directly. This was the FIRST place this bug class was fixed
    // (2026-07-07); it's now the canonical entry point every BasePage
    // subclass uses, and non-BasePage code (globalSetup.ts, authManager.ts,
    // fixtures/index.ts) calls safeWaitForURL() directly for the same reason.
    await this.withSessionExpiryRecovery(() => safeWaitForURL(this.page, urlPattern, timeout));
  }

  /**
   * Waits for an entity detail page to genuinely settle — URL match, then a
   * confirmed GET response for that entity — with one bounded reload-and-
   * retry if the entity response never arrives.
   *
   * WHY this exists (confirmed live via 2 real reproductions, 2026-07-27,
   * same investigation): every `waitForXDetailsPage()` across Deals/
   * Companies/Contacts/Leads/Tasks/Quotations independently duplicated the
   * same shape — `waitForUrl()` (which resolves the FIRST moment the URL
   * matches, with no guarantee it stays matching) followed by an entity-GET
   * response wait wrapped in `.catch(() => null)`. Under heavy load, the
   * app's own client-side router can bounce away from the just-matched URL
   * (observed live landing on "Default Dashboard") before that GET ever
   * fires — the silent catch swallowed this completely, letting every
   * caller proceed as if navigation succeeded on a page that was never
   * actually the entity's detail page. The real failure then surfaced much
   * later, and much less legibly, as a generic element-not-found timeout
   * with no signal pointing at the actual cause (e.g. a Quotations-panel
   * test burning the full 480s test timeout with zero diagnostic trail).
   *
   * Mirrors the exact reload-and-retry shape already proven for
   * `assertRightPanelIconVisible()`/`LeadsPage.markLeadAsStage()` — one
   * canonical implementation instead of six independently-drifting copies,
   * same reasoning as `withSessionExpiryRecovery()` itself. Returns the real
   * `Response` (never null) so callers needing extra checks on it (e.g.
   * Quotations' 404-means-"does not exist" handling) can inspect it
   * directly — throws (does not re-swallow) if the retry also fails.
   *
   * @param urlPattern         The detail page's URL pattern (e.g. `/sales\/deals\/details\//`).
   * @param responsePredicate  Matches the entity's own GET response (e.g. `/\/v1\/deals\/\d+$/`).
   * @param description        Human-readable label for logs (e.g. "Deal details").
   */
  protected async waitForEntityDetailPage(
    urlPattern: RegExp,
    responsePredicate: (res: Response) => boolean,
    description: string
  ): Promise<Response> {
    await this.waitForUrl(urlPattern, 20000);
    await this.page.waitForLoadState('domcontentloaded');

    const attempt = (): Promise<Response> =>
      this.armResponseWaitWithRecovery(responsePredicate, `${description} GET response`, 15000);

    try {
      return await attempt();
    } catch (error) {
      logger.warn(
        `${description}: entity GET response not observed within 15000ms (possible navigation drift) — reloading and retrying once: ${String(error)}`
      );
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.waitForUrl(urlPattern, 20000);
      return await attempt();
    }
  }

  /**
   * Waits for an entity LIST page to genuinely settle — the list table
   * actually visible, with one bounded reload-and-retry if it silently
   * never renders (same navigation-drift mechanism and evidence as
   * {@link waitForEntityDetailPage} — see its own comment for the full
   * background). One canonical implementation shared by Deals/Companies/
   * Contacts/Leads' near-identical `waitForListReady()` methods.
   *
   * WHY the response-wait branch is a PLAIN `page.waitForResponse()`, not
   * `armResponseWaitWithRecovery()` (fixed 2026-07-28, found via live
   * evidence from a real full-suite run, not speculation): the previous
   * version raced `armResponseWaitWithRecovery(...).catch(() => null)`
   * against `tableLocator.waitFor(...).catch(() => null)`. `Promise.race`
   * never cancels its LOSING branch — only abandons it. Since the table
   * almost always becomes visible before the list GET response predicate is
   * even checked, the response branch is nearly always the loser. But
   * `armResponseWaitWithRecovery()` internally calls `armSessionExpirySignal()`
   * (see authManager.ts), which attaches `page.on('response')`/
   * `page.on('framenavigated')` listeners directly on the shared Playwright
   * `Page` — and those listeners are only detached via that promise's OWN
   * internal `signal.cancel()`, which only fires once ITS OWN race (real
   * response vs. expiry signal) settles. An abandoned loser's race never
   * gets a chance to settle that way, so the listeners stay attached to the
   * page for up to `config.timeouts.navigation` (60000ms) after this method
   * has already returned and the caller has moved on to something else
   * entirely — a "zombie" listener with a 60-SECOND live window.
   *
   * CONFIRMED live (2026-07-28, real full-suite run on qa, not reproduced
   * synthetically): `deals.rbac.spec.ts`'s "admin shares deal Quotation
   * permission..." test calls `goToContactsList()`→create contact→
   * `goToCompaniesList()`→create company→`goToDealsList()`. A genuine
   * mid-test session expiry hit during the `goToDealsList()` navigation. The
   * log showed TWO zombie listeners — from the EARLIER, already-returned
   * `goToContactsList()`'s and `goToCompaniesList()`'s own `waitForListReady()`
   * calls — firing their OWN independent recovery ("Contacts list response:
   * session expiry detected...", "Companies list response: session expiry
   * detected...") within 3ms of each other, CONCURRENTLY with
   * `navigateTo()`'s own live recovery for the deals-list navigation. Three
   * concurrent `tryRecoverSessionForPage()` calls then raced on the same
   * page, each targeting a DIFFERENT stale captured URL (contacts list,
   * companies list, deals list) — leaving the page's final state
   * unpredictable and causing the test's next real step (`createDeal()`,
   * which assumes it's on the deals list) to fail. This is a deterministic
   * race, not flakiness: it reproduces EVERY time a genuine expiry lands
   * within the 60s zombie window after any `goToXList()` call, which is why
   * the failing test always self-heals on Playwright's own retry (a fresh
   * attempt starts with a newly-recovered token, so the trigger condition —
   * expiry landing mid-suite — doesn't recur inside that one attempt).
   *
   * FIX: use a plain, listener-free `page.waitForResponse()` for the race's
   * response branch instead. This is 100% behavior-preserving for the
   * method's actual purpose (list-readiness detection: use the GET response
   * OR the table, whichever settles first) — the only thing removed is the
   * unused, dangerous side-channel expiry-signal arming. Expiry protection
   * for this method is NOT lost: if a real expiry happens while this race is
   * running, the table-visibility branch also fails to observe the list
   * table (a page mid-redirect to /signIn never shows it), the race times
   * out on both branches, and `assertTableVisible()` below — already wrapped
   * in `withSessionExpiryRecovery()`, which is a synchronous try/catch/retry
   * with NO lingering listener of its own — correctly detects and recovers.
   * That gives this method exactly ONE code path responsible for expiry
   * recovery instead of two, which can no longer race each other.
   *
   * @param responsePredicate  Matches the list's own GET response (e.g. `/v1/deals` GET 200).
   * @param tableLocator       The list table/grid locator (e.g. `this.dealTable()`). Locators
   *                           are safe to reuse across the retry-after-reload — they always
   *                           re-query the live DOM, never go stale like an element handle.
   * @param description        Human-readable label for logs (e.g. "Deals").
   */
  protected async waitForEntityListPage(
    responsePredicate: (res: Response) => boolean,
    tableLocator: Locator,
    description: string
  ): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await Promise.race([
      this.page
        .waitForResponse(responsePredicate, { timeout: config.timeouts.navigation })
        .catch(() => null),
      tableLocator.waitFor({ state: 'visible', timeout: config.timeouts.navigation }).catch(() => null),
    ]);

    const assertTableVisible = (): Promise<void> =>
      this.withSessionExpiryRecovery(() =>
        expect(tableLocator, `${description} list table should be visible`).toBeVisible({
          timeout: config.timeouts.navigation,
        })
      );

    try {
      await assertTableVisible();
    } catch (error) {
      logger.warn(
        `${description} list table not visible within ${config.timeouts.navigation}ms (possible navigation drift) — reloading and retrying once: ${String(error)}`
      );
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await assertTableVisible();
    }
  }

  // ─── Assertion Helpers ────────────────────────────────────

  async assertVisible(locator: Locator, description = 'element', timeout = 30000): Promise<void> {
    logger.info(`Asserting visible: ${description}`);
    await this.withSessionExpiryRecovery(() => expect(locator).toBeVisible({ timeout }));
  }

  async assertText(locator: Locator, expectedText: string): Promise<void> {
    logger.info(`Asserting text: ${expectedText}`);
    await this.withSessionExpiryRecovery(() => expect(locator).toHaveText(expectedText));
  }

  async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    logger.info(`Asserting URL: ${expectedUrl}`);
    const urlBeforeAssertion = this.page.url();
    try {
      await expect(this.page).toHaveURL(expectedUrl);
    } catch (error) {
      // WHY: mid-test session recovery — same gap class as click()'s own
      // recovery (2026-07-09), found live in a full-suite stage run
      // (2026-07-23): call-logs.rbac.spec.ts:337 hit a session expiry,
      // recovered once via navigateTo()'s own recovery, successfully
      // reloaded the target list page (confirmed by the page object's own
      // readiness checks passing) — then expired AGAIN within THIS
      // assertion's 10s poll window. assertUrl() is a bare `expect()` with
      // no recovery wiring at all, unlike click()/fill()/navigateTo(), so a
      // second, later expiry here had nothing to catch it. Same guard as
      // click(): gated strictly on actually being on signIn right now (never
      // "any failure"), so a genuine URL-assertion failure (wrong page,
      // wrong entity) still fails immediately, unretried.
      if (!isPageRegisteredForRecovery(this.page) || !(await isSessionExpiryPage(this.page))) {
        throw error;
      }
      logger.warn(
        `assertUrl(${expectedUrl}) failed while on a signIn/login or Forbidden page — attempting one-time session recovery`
      );
      await tryRecoverSessionForPage(this.page, urlBeforeAssertion);
      await expect(this.page).toHaveURL(expectedUrl);
    }
  }

  // ─── Utility ──────────────────────────────────────────────

  async takeScreenshot(name: string): Promise<void> {
    logger.info(`Taking screenshot: ${name}`);
    await this.page.screenshot({
      path: `test-results/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  async isVisible(locator: Locator): Promise<boolean> {
    return await locator.isVisible();
  }

  async getText(locator: Locator): Promise<string> {
    await locator.waitFor({ state: 'visible' });
    return (await locator.textContent()) || '';
  }
  async assertNoFormErrors(context = 'form'): Promise<void> {
    logger.info(`Checking for validation errors in ${context}`);

    // WHY: Wait briefly for any error messages to appear after save action
    await this.page.waitForTimeout(1500);

    // Field level errors
    const fieldErrors = await this.page
      .locator('input.is-invalid, select.is-invalid, textarea.is-invalid')
      .evaluateAll((els: (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[]) =>
        els.map((el) => el.name || el.id || 'unknown')
      );

    // Inline validation messages
    const inlineErrors = await this.page
      .locator('.invalid-feedback:visible, .error-message:visible, .alert-danger:visible')
      .allTextContents();

    // Toast/notification errors
    const toastErrors = await this.page
      .locator(
        '.toast, .toast-error, .toast-danger, .notification-error, [class*="toast"][class*="error"], [class*="alert"][class*="error"], .Toastify__toast--error, .swal2-error'
      )
      .allTextContents();

    // Any visible error containers — use specific selectors to avoid false positives
    // WHY: [class*="error"] is too broad — matches React Select is-invalid__ classes
    // which contain currency values (INR). Use only known error container classes.
    const errorContainers = await this.page
      .locator(
        '.error-container:visible, .form-error:visible, .field-error:visible, .alert.alert-danger:visible'
      )
      .allTextContents();

    const allErrors = [...inlineErrors, ...toastErrors, ...errorContainers]
      .map((e) => e.trim())
      .filter((e) => e.length > 0);

    if (allErrors.length > 0 || fieldErrors.length > 0) {
      throw new Error(
        `Validation errors found in ${context}:\n` +
          `Fields with errors: ${fieldErrors.join(', ')}\n` +
          `Error messages: ${allErrors.join(' | ')}`
      );
    }

    logger.success(`No validation errors found in ${context}`);
  }

  async assertFormErrorToast(expectedMessageSubstring: string, context = 'form'): Promise<void> {
    logger.info(`Asserting error toast in ${context}: "${expectedMessageSubstring}"`);
    const toast = this.page
      .locator('.toastr.rrt-error .rrt-middle-container, .rrt-middle-container')
      .filter({ hasText: expectedMessageSubstring });
    await this.withSessionExpiryRecovery(() =>
      expect(
        toast.first(),
        `Expected an error toast containing "${expectedMessageSubstring}" in ${context}, but it never appeared`
      ).toBeVisible({ timeout: config.timeouts.expect })
    );
    logger.success(`Error toast confirmed in ${context}: "${expectedMessageSubstring}"`);
  }

  // ─── Custom Field Helpers (generic — reusable across entities/modules) ────
  // WHY: Kylas custom fields currently exist only on specific entities in
  // specific environments (e.g. these 9 Lead custom fields, QA-only as of
  // 2026-07-08) and are expected to be added to more entities/environments
  // later with identical names/types. Every method below checks DOM presence
  // first and skips gracefully — with a clear log explaining why — when a
  // field is absent, so the exact same call site starts working the moment
  // the field is added elsewhere, with zero code changes required.
  //
  // Methods are parameterized by the raw Kylas field name (e.g. "TextField")
  // rather than typed to any one entity, so Contacts/Companies/Deals can
  // reuse them unchanged when they get their own custom fields later.

  // 'legacy' = `_input_customFieldValues.cf<Name>` (Lead/Deal/Contact/Company/
  // Quotation/Task's detailed form). 'plain' = `_input_cf<Name>` (Meeting,
  // Call Log). See customFieldSuffix()'s own comment for why this is an
  // opt-in parameter rather than an unconditional dual-match.

  // WHY two suffix conventions, not one (2026-07-29 child-entity investigation):
  // Lead/Deal/Contact/Company, Quotations, and Task's detailed form all use
  // `_input_customFieldValues.cf<Name>` ("legacy" below), but Meetings and
  // Call Logs were confirmed live to use the shorter `_input_cf<Name>`
  // ("plain") — no "customFieldValues." segment.
  //
  // WHY an opt-in parameter defaulting to "legacy", not an unconditional
  // dual-match: an unconditional match (an earlier version of this change)
  // is provably safe in effect — it only adds match alternatives, never
  // removes the existing one — but it means every existing Lead/Deal/
  // Contact/Company call site would silently take a DIFFERENT code path
  // than before (matching two selectors instead of one), even though the
  // result happens to be identical today. Explicit approval was required
  // before landing that: existing call sites must take the exact same code
  // path, byte for byte, as before this entire child-entity effort started.
  // Defaulting the parameter to 'legacy' guarantees that — every call site
  // in this codebase that doesn't pass 'plain' explicitly (i.e. every
  // Lead/Deal/Contact/Company/Quotation/Task call today) resolves to
  // EXACTLY the single-suffix locator that existed before this parameter
  // was added. Only Meeting's (and later Call Log's) own new calls pass
  // 'plain' explicitly.
  private customFieldSuffix(fieldName: string, suffixStyle: CustomFieldSuffixStyle): string {
    return suffixStyle === 'plain'
      ? `_input_cf${fieldName}`
      : `_input_customFieldValues.cf${fieldName}`;
  }

  private customFieldInputLocator(
    fieldName: string,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Locator {
    // WHY: matches by suffix, not the full id — the numeric prefix Kylas
    // generates (e.g. "7_11_input_...") was confirmed live (2026-07-08) to be
    // a static per-render wrapper index, not something that varies by field,
    // pipeline, or context. Matching on the suffix alone is exactly as
    // reliable today and removes any dependency on that prefix ever staying
    // the same, at no extra cost.
    //
    // WHY scoped to input/textarea: confirmed live (2026-07-08) — react-dates
    // renders an accessibility <p id="DateInput__screen-reader-message-<the
    // input's own id>"> alongside a Date/DateTimePicker field, which (being
    // built by prefixing the real input's id) ALSO ends with this same
    // suffix and breaks strict-mode uniqueness. Every one of the 9 field
    // types is either an <input> or a <textarea> (ParagraphText) — excluding
    // every other tag removes this collision without narrowing which real
    // fields can match.
    const suffix = this.customFieldSuffix(fieldName, suffixStyle);
    return this.page.locator(`input[id$="${suffix}"], textarea[id$="${suffix}"]`);
  }

  private async isCustomFieldPresent(
    fieldName: string,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Promise<boolean> {
    return (await this.customFieldInputLocator(fieldName, suffixStyle).count()) > 0;
  }

  // WHY: PART C (2026-07-15) — a DEDICATED-TEST-level skip mechanism, built
  // for the first time here (not a retrofit of an existing thing — only the
  // per-field, silently-graceful isCustomFieldPresent() above existed
  // before, already reused automatically by every generic fill method).
  // A dedicated custom-field test's own detail-page assertion
  // (assertLeadCustomFieldsOnDetail()/assertContactCustomFieldsOnDetail())
  // intentionally THROWS rather than skips when a field is missing — a
  // silent skip there would hide the fact that verification never ran, for
  // methods whose only callers are the handful of dedicated tests that
  // always expect these fields to exist. This method is the counterpart at
  // the OUTER, whole-test level: called once, right after the relevant
  // create/edit form is open (custom-field inputs don't exist in the DOM
  // before then), it checks whether ANY of the module's fields are present
  // at all, and skips the entire test with a clear reason if none are —
  // rather than letting the test proceed only to fail loudly and
  // confusingly at the assertion step on an environment (e.g. Stage/Prod
  // today) that simply doesn't have these fields yet.
  protected async skipDedicatedCustomFieldTestIfAbsent(
    fieldNames: string[],
    moduleName: string,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Promise<void> {
    const presence = await Promise.all(
      fieldNames.map((name) => this.isCustomFieldPresent(name, suffixStyle))
    );
    const anyPresent = presence.some(Boolean);
    test.skip(
      !anyPresent,
      `No ${moduleName} custom fields present in this environment — skipping dedicated custom-field test`
    );
  }

  private logCustomFieldSkipped(description: string, fieldName: string, action: string): void {
    logger.info(
      `Custom field "${description}" (cf${fieldName}) not found in this environment — skipping ${action}. ` +
        'This field is expected to exist on QA today and on Stage/Prod later with an identical name; ' +
        'no code change will be required when it is added there.'
    );
  }

  // WHY: TextField, ParagraphText, Number (as a string), and UrlField all
  // render as a plain <input>/<textarea> and are filled identically via
  // Playwright's fill() — one parameterized method instead of four
  // near-duplicates. Callers convert non-string values (e.g. Number) to a
  // string before calling.
  async fillTextLikeCustomField(
    fieldName: string,
    value: string,
    description = fieldName,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName, suffixStyle))) {
      this.logCustomFieldSkipped(description, fieldName, 'fill');
      return;
    }
    await this.fill(
      this.customFieldInputLocator(fieldName, suffixStyle),
      value,
      `custom field: ${description}`
    );
  }

  async setCheckboxCustomField(
    fieldName: string,
    checked: boolean,
    description = fieldName,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName, suffixStyle))) {
      this.logCustomFieldSkipped(description, fieldName, 'checkbox toggle');
      return;
    }
    const checkbox = this.customFieldInputLocator(fieldName, suffixStyle);
    const isChecked = await checkbox.isChecked().catch(() => false);
    if (isChecked !== checked) {
      await this.click(checkbox, `custom field checkbox: ${description}`);
    }
  }

  // WHY: shared by any single-select react-select control, custom field or
  // standard field alike — selectPicklistCustomField() below is a thin,
  // presence-checked wrapper for custom fields; standard fields that are
  // always present (e.g. Lead's Campaign/Source) call this directly with
  // their own control locator instead of duplicating the open/read/click
  // sequence. Returns the value actually selected — never hardcode which
  // option exists, always read the live menu.
  protected async selectRandomFromSingleReactSelect(
    control: Locator,
    description: string
  ): Promise<string> {
    await this.click(control, `react-select control: ${description}`);
    const options = this.page.locator('.is-invalid__menu .is-invalid__option');
    await options.first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const optionTexts = (await options.allInnerTexts()).map((t) => t.trim());
    if (optionTexts.length === 0) {
      throw new Error(
        `${description}: react-select opened but has zero live options — cannot select a value`
      );
    }
    const randomIndex = Math.floor(Math.random() * optionTexts.length);
    const selectedValue = optionTexts[randomIndex];
    await options.nth(randomIndex).click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* menu may already be gone */
      });
    logger.success(`${description} set to: ${selectedValue}`);
    return selectedValue;
  }

  // WHY: for async-search react-select lookups where options are NOT
  // available immediately on click but only after typing against a live
  // backend search — confirmed live (2026-07-16) Contact's Company field
  // requires 3+ typed characters before returning real results ("Type
  // atleast 3 characters..." shown below that threshold). Selects a
  // genuinely random option from whatever the CURRENT session's live search
  // actually returns, same "never hardcode which option exists" reasoning as
  // selectRandomFromSingleReactSelect above — this is also what makes
  // admin-vs-restricted-user selection correctly role-scoped with no
  // explicit role branching: each role's own live search naturally returns
  // only what that role can see, confirmed live to genuinely differ between
  // roles for the identical search term.
  // WHY: exact-match anchor for selecting among live-search/lookup options by
  // name — shared with DealsPage's own selectFirstOptionFromDropdown(),
  // which had a private, duplicated copy of this exact same regex-escape
  // logic before this method also needed it. Moved here rather than left
  // duplicated, per "no duplicated logic" — DealsPage now delegates to this.
  protected escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // WHY this exists (2026-08-11, found via a real test failure): a Products
  // & Services test hand-rolled `page.request.get(buildApiUrl(...))` to
  // verify persisted data — this app has NO cookie-based session at all
  // (confirmed repeatedly elsewhere in this codebase), so Playwright's
  // `APIRequestContext` (which only carries browser-context cookies) never
  // attaches the required `Authorization: Bearer <token>` header, and every
  // such call gets a 403 regardless of whether the underlying data is
  // correct — live-confirmed via a full network trace. `DealsPage`'s own
  // `fetchCurrentDealApiData()` already solved this correctly (extract the
  // JWT from `localStorage` inside the page context, decode it, `fetch()`
  // with the real bearer token attached) but was Deal-specific and private.
  // Generalized here so any module needing an authenticated read-only API
  // check can reuse this instead of a third hand-rolled copy — per rule 1
  // (reuse/generalize before building a new instance of the same shape).
  async fetchAuthenticatedApiData(url: string): Promise<Record<string, unknown> | null> {
    const result = await this.page.evaluate(async (fetchUrl) => {
      try {
        const raw = localStorage.getItem('token');
        if (!raw) return { ok: false as const, reason: 'no-token-in-localStorage' };
        const payload = JSON.parse(atob(raw.split('.')[1]));
        const accessToken = payload?.data?.accessToken;
        if (!accessToken) return { ok: false as const, reason: 'no-accessToken-in-decoded-token' };
        const res = await fetch(fetchUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const bodyText = await res.text().catch(() => '');
        if (!res.ok) {
          return {
            ok: false as const,
            reason: 'http-error',
            status: res.status,
            body: bodyText.slice(0, 500),
          };
        }
        let json: Record<string, unknown> | null = null;
        try {
          json = JSON.parse(bodyText);
        } catch {
          /* leave json null — reported as a distinct reason below */
        }
        return { ok: true as const, data: json };
      } catch (e) {
        return { ok: false as const, reason: 'exception', message: String(e) };
      }
    }, url);

    if (!result.ok) {
      const detail =
        result.reason === 'http-error'
          ? `HTTP ${result.status}${result.body ? ` — ${result.body}` : ''}`
          : result.reason === 'exception'
            ? result.message
            : result.reason;
      logger.warn(`fetchAuthenticatedApiData: GET ${url} did not return usable data (${detail})`);
      return null;
    }
    return result.data;
  }

  // WHY this exists (2026-07-30, found via a real CI failure): every
  // share/reassign flow across Lead/Deal/Contact/Company independently
  // duplicated the same shape — fill a user-search input, wait up to 5-10s
  // for an exact-match `.is-invalid__option`, ONE attempt, no retry. A real
  // CI run showed this failing for a genuinely-just-created user
  // ("User 1"), a plausible transient search-index propagation lag (the
  // same class already retried elsewhere in this codebase, e.g.
  // CallLogsPage.searchAndSelectEntity()) — the single-attempt wait had no
  // chance to recover. Extracted here (rather than fixed independently in
  // 7 places) so the retry logic lives in exactly one place — matches this
  // codebase's own established precedent for consolidating a duplicated,
  // independently-drifting shape (see safeWaitForURL()'s own history).
  protected async selectUserOptionWithRetry(
    userInput: Locator,
    searchTerm: string,
    exactName: string,
    maxAttempts = 3
  ): Promise<void> {
    const userItem = this.page
      .locator('.is-invalid__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(exactName)}\\s*$`) })
      .first();
    let found = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      found = await userItem
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (found) break;
      logger.warn(
        `User search: "${exactName}" not found on attempt ${attempt}/${maxAttempts} — retrying`
      );
      await userInput.fill('', { timeout: config.timeouts.expect }).catch(() => {});
      await this.page.waitForTimeout(500);
      await userInput.fill(searchTerm, { timeout: config.timeouts.expect });
      await this.page.waitForTimeout(800);
    }
    if (!found) {
      throw new Error(`User search: "${exactName}" did not appear after ${maxAttempts} attempts`);
    }
    await userItem.click({ timeout: config.timeouts.expect });
  }

  // WHY: for async-search react-select lookups where options are NOT
  // available immediately on click but only after typing against a live
  // backend search — confirmed live (2026-07-16) Contact's Company field
  // requires 3+ typed characters before returning real results ("Type
  // atleast 3 characters..." shown below that threshold). Selects a
  // genuinely random option from whatever the CURRENT session's live search
  // actually returns, same "never hardcode which option exists" reasoning as
  // selectRandomFromSingleReactSelect above — this is also what makes
  // admin-vs-restricted-user selection correctly role-scoped with no
  // explicit role branching: each role's own live search naturally returns
  // only what that role can see, confirmed live to genuinely differ between
  // roles for the identical search term.
  //
  // WHY the optional exactValue param (2026-07-16) — mirrors DealsPage's
  // selectFirstOptionFromDropdown()'s own exactName pattern: for tests where
  // the selected entity's specific identity matters (e.g. a Contact's
  // associated Company must be a freshly-created, KNOWN company so it can
  // also be independently shared/verified), picking randomly from whatever
  // exists live is unsafe — its ownership/share-state is uncontrolled.
  // Passing neither preserves the original random-pick behavior unchanged.
  protected async selectRandomFromSearchableReactSelect(
    control: Locator,
    searchInput: Locator,
    searchTerm: string,
    description: string,
    exactValue?: string
  ): Promise<string> {
    await this.click(control, `react-select control: ${description}`);
    const options = this.page.locator('.is-invalid__menu .is-invalid__option');
    // WHY (Fix 2, 2026-07-17): trigger the live backend search with a targeted
    // retry on transient DNS/connection errors — see fillSearchAndWaitForOptions.
    // Previously this was a bare `searchInput.fill()` + a single bounded
    // `waitFor`, so a brief DNS blip that failed the lookup request cost the whole
    // first test attempt (only Playwright's outer retry recovered it — see #59).
    await this.fillSearchAndWaitForOptions(searchInput, options, exactValue ?? searchTerm, description);

    if (exactValue) {
      const exactOption = options
        .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(exactValue)}\\s*$`) })
        .first();
      await exactOption.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      await exactOption.click();
      await this.page
        .locator('.is-invalid__menu')
        .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
        .catch(() => {
          /* menu may already be gone */
        });
      logger.success(`${description} selected: "${exactValue}" (exact match)`);
      return exactValue;
    }

    const optionTexts = (await options.allInnerTexts()).map((t) => t.trim());
    if (optionTexts.length === 0) {
      throw new Error(
        `${description}: search for "${searchTerm}" returned zero live options — cannot select a value`
      );
    }
    const randomIndex = Math.floor(Math.random() * optionTexts.length);
    const selectedValue = optionTexts[randomIndex];
    await options.nth(randomIndex).click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* menu may already be gone */
      });
    logger.success(`${description} set to: ${selectedValue}`);
    return selectedValue;
  }

  // WHY: returns the selected value (rather than void) because PickList
  // options are read live from the DOM and never hardcoded — the caller
  // needs to know what was actually picked in order to verify it later.
  // Returns null when the field is absent, so callers can tell "skipped"
  // apart from "selected an empty-looking value".
  async selectPicklistCustomField(
    fieldName: string,
    description = fieldName,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Promise<string | null> {
    if (!(await this.isCustomFieldPresent(fieldName, suffixStyle))) {
      this.logCustomFieldSkipped(description, fieldName, 'picklist selection');
      return null;
    }
    const control = this.customFieldInputLocator(fieldName, suffixStyle).locator(
      'xpath=ancestor::div[contains(@class,"__control")]'
    );
    return this.selectRandomFromSingleReactSelect(control, `Custom field "${description}"`);
  }

  /**
   * Search-and-select a value in a custom LOOKUP field (an entity-select
   * react-select backed by a live server search, e.g. Lead's "Company
   * Lookup" / "Contact Lookup").
   *
   * Lives in BasePage — not a module page object — so ANY module that gains a
   * lookup-type custom field later (Contacts, Companies, Deals, …) reuses this
   * unchanged, exactly as `fillTextLikeCustomField` / `selectPicklistCustomField`
   * are already shared. It is parameterized by the raw Kylas field name, never
   * typed to one entity.
   *
   * Behaviour mirrors the other per-field helpers: if the field is absent on
   * this environment it logs a clear skip line and returns `null` (never
   * throws), so a caller can tell "skipped" apart from "selected".
   *
   * WHY this does token-search-then-exact-select itself rather than delegating
   * to {@link selectRandomFromSearchableReactSelect}: that helper types the
   * `exactValue` as the search term, which only works when the string typed to
   * search equals the option's display text (true for a company, whose `name`
   * is a single field). For an entity lookup that is generally FALSE — e.g. a
   * contact's option renders as "First Last" but the server search matches a
   * single name token, so typing the full "First Last" returns nothing
   * (confirmed live 2026-07-21). This method therefore types the caller's
   * `searchTerm` (a token) and selects by `exactValue` separately. It still
   * reuses the SAME lower-level primitives — the menu-scoped
   * `.is-invalid__menu .is-invalid__option` locator (never the page-wide
   * `.is-invalid__option` Issue-1 flake pattern), `fillSearchAndWaitForOptions`
   * (transient-network retry + `config.timeouts.expect`), and the anchored
   * exact-match regex via `escapeRegExp` — and deliberately does NOT touch
   * `selectRandomFromSearchableReactSelect` or its ContactsPage consumer.
   *
   * @param fieldName   Internal Kylas field name (e.g. "CompanyLookup").
   * @param searchTerm  Token typed to trigger the live server search. May
   *                    differ from the option's display text (e.g. a name
   *                    fragment for a contact whose option is "First Last").
   * @param exactValue  Exact option text to select from the results. Provide
   *                    for deterministic selection of a KNOWN entity (required
   *                    for RBAC tests); omit to pick a random result.
   * @param description Human-readable label for logs (defaults to fieldName).
   * @returns The selected value, or `null` if the field is absent (skipped).
   */
  async selectLookupCustomField(
    fieldName: string,
    searchTerm: string,
    exactValue?: string,
    description = fieldName
  ): Promise<string | null> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'lookup selection');
      return null;
    }
    const label = `Custom field "${description}"`;
    const input = this.customFieldInputLocator(fieldName);
    const control = input.locator('xpath=ancestor::div[contains(@class,"__control")]');
    // Open by clicking the control div (NOT the input): the "Search ..."
    // placeholder overlays the input and intercepts pointer events on first
    // open (confirmed live 2026-07-21).
    await this.click(control, `lookup control: ${description}`);
    // Menu-scoped options locator — never the page-wide `.is-invalid__option`
    // (the documented Issue-1 flake source).
    const options = this.page.locator('.is-invalid__menu .is-invalid__option');
    // Type the search TOKEN (may differ from the option display text) and wait
    // for results, reusing the transient-network retry + config timeouts.
    await this.fillSearchAndWaitForOptions(input, options, searchTerm, label);

    if (exactValue) {
      // WHY log count + presence: on a data-heavy environment the token search
      // could in principle return more matches than one truncated page shows —
      // if the intended entity is truncated out, this surfaces it in the output
      // rather than only as an opaque "option not visible" timeout below.
      const optionTexts = (await options.allInnerTexts()).map((t) => t.trim());
      const present = optionTexts.some((t) => t === exactValue.trim());
      logger.info(
        `${label}: token "${searchTerm}" returned ${optionTexts.length} option(s); ` +
          `exact target "${exactValue}" present in returned list: ${present}`
      );
      const exactOption = options
        .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(exactValue)}\\s*$`) })
        .first();
      await exactOption.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      await exactOption.click();
      await this.page
        .locator('.is-invalid__menu')
        .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
        .catch(() => {
          /* menu may already be gone */
        });
      logger.success(`${label} selected: "${exactValue}" (exact match)`);
      return exactValue;
    }

    const optionTexts = (await options.allInnerTexts()).map((t) => t.trim());
    if (optionTexts.length === 0) {
      throw new Error(
        `${label}: token "${searchTerm}" returned zero live options — cannot select a value`
      );
    }
    const randomIndex = Math.floor(Math.random() * optionTexts.length);
    const selectedValue = optionTexts[randomIndex];
    await options.nth(randomIndex).click();
    await this.page
      .locator('.is-invalid__menu')
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* menu may already be gone */
      });
    logger.success(`${label} set to: ${selectedValue}`);
    return selectedValue;
  }

  /**
   * Assert that a specific entity is NOT selectable in a custom lookup field —
   * the core RBAC check (a restricted user must not be able to see/select an
   * admin-owned, non-shared entity; visibility is enforced server-side by the
   * lookup endpoint).
   *
   * Lives in BasePage for the same reuse reason as {@link selectLookupCustomField}.
   *
   * WHY this asserts a SPECIFIC option's absence rather than an empty menu:
   * these lookups always render an ever-present "Add to <field> Lookup"
   * create-on-the-fly entry after any search, so the menu is never truly empty
   * even when zero real entities match (confirmed live 2026-07-21). Asserting
   * "the menu is empty" would therefore be wrong; the robust check is "no
   * option whose exact text equals `entityName` is present", anchored so a
   * superstring can't slip through.
   *
   * WHY it first awaits the live lookup response: without it, the option could
   * be absent simply because the async search has not returned yet — a false
   * pass. We arm the response wait AFTER opening the control (so the empty
   * on-open lookup can't satisfy it) but BEFORE typing, and await it before
   * the absence assertion. `config.timeouts.expect` throughout, consistent with
   * the reused helper's timeout philosophy (no hardcoded values).
   *
   * @param fieldName   Internal Kylas field name (e.g. "CompanyLookup").
   * @param searchTerm  Text typed to trigger the live search for `entityName`.
   * @param entityName  Exact entity name that must NOT appear as an option.
   * @param description Human-readable label for logs (defaults to fieldName).
   */
  async assertLookupCustomFieldOptionAbsent(
    fieldName: string,
    searchTerm: string,
    entityName: string,
    description = fieldName
  ): Promise<void> {
    const input = this.customFieldInputLocator(fieldName);
    const control = input.locator('xpath=ancestor::div[contains(@class,"__control")]');
    // WHY click the control div, not the input: the "Search ..." placeholder
    // overlays the input and intercepts pointer events on first open — same
    // reason selectRandomFromSearchableReactSelect clicks the control.
    await this.click(control, `lookup control: ${description}`);
    // Arm BEFORE typing so we can be sure the server search returned before we
    // assert absence. Non-fatal (.catch) — the exact-option assertion below is
    // the real check; this only removes the "asserted too early" race.
    const searchReturned = this.page
      .waitForResponse(
        (res) => /\/lookup(\?|$)/i.test(res.url()) && res.request().method() === 'GET',
        { timeout: config.timeouts.expect }
      )
      .catch(() => null);
    await input.fill(searchTerm);
    await searchReturned;
    const namedOption = this.page
      .locator('.is-invalid__menu .is-invalid__option')
      .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(entityName)}\\s*$`) });
    await expect(
      namedOption,
      `Lookup "${description}": entity "${entityName}" should NOT be selectable for this user (RBAC)`
    ).toBeHidden({ timeout: config.timeouts.expect });
    // WHY close the menu (confirmed live 2026-07-21): unlike the select path,
    // this assertion never picks an option, so the react-select menu stays
    // OPEN — and an open menu overlaps and intercepts pointer events on the
    // NEXT lookup control on the same form (e.g. asserting Company Lookup then
    // Contact Lookup). Escape collapses it; the hidden-wait keeps the next
    // interaction from racing the close animation.
    await input.press('Escape');
    await this.page
      .locator('.is-invalid__menu')
      .first()
      .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
      .catch(() => {
        /* menu may already be gone */
      });
    logger.success(
      `Lookup "${description}": entity "${entityName}" correctly not selectable (RBAC-scoped)`
    );
  }

  // WHY: shared by any multi-select react-select control, custom field or
  // standard field alike — mirrors selectRandomFromSingleReactSelect's
  // reuse pattern above. selectMultiPicklistCustomField() below is a thin,
  // presence-checked wrapper for custom fields; standard fields that are
  // always present (e.g. Lead's "Products or Services") call this directly
  // with their own control locator. Confirmed live (2026-07-08) this also
  // works correctly for lookup-backed multi-selects (Products or Services
  // searches real Product records under the hood) — not just static-option
  // ones — because clearing existing chips first reliably repopulates the
  // menu with whatever was just freed up, regardless of how the option list
  // itself is sourced.
  //
  // Selects a RANDOM COUNT between 2 and however many options actually
  // exist live — computed from the live option count, never a fixed number.
  // WHY extracted into its own standalone method (2026-08-11, PS10 fix —
  // Group B staging-run investigation): originally inline only inside
  // selectRandomFromMultiValueReactSelect() below. Needed standalone so a
  // caller can guarantee a multi-select field starts genuinely empty
  // WITHOUT also picking a new random set immediately after — e.g. clearing
  // a Lead's "Products or Services" field of whatever fillLeadRequirement()'s
  // own random create-time pick happened to attach, before then attaching
  // one specific, named fixture product deterministically. Pure
  // extract-method refactor — the loop body, bounds, and error messages are
  // byte-for-byte unchanged; selectRandomFromMultiValueReactSelect() below
  // now calls this instead of running the same loop inline, with zero
  // behavior change to that method's own callers.
  async clearAllChipsFromMultiSelect(control: Locator, description: string): Promise<void> {
    // WHY: bounded — confirmed live (2026-07-08) that an unbounded version of
    // this loop can hang for the entire test timeout if a chip's remove
    // button doesn't detach the chip on click (stale reference/re-render
    // race). A field realistically holds at most the total live option
    // count worth of chips, so that count plus headroom is a safe, generous
    // bound that still fails fast and loudly instead of hanging silently.
    const maxChipsToClear = 50;
    // WHY a bounded number of outer "settle rounds" wrapping the inner
    // per-chip removal loop, not just a single pass (fixed 2026-08-23, real
    // PS10/sandbox-build-144 recurrence — see
    // .claude/sandbox-build-144-task-b-chip-clearing.md): the real CI
    // failure's own stack trace proved the inner loop legitimately reached
    // zero chips (it never hit the maxChipsToClear exhaustion path below,
    // which throws a different message) — the defense-in-depth recheck
    // immediately afterward then found 5 chips present again. That is
    // chips REAPPEARING after a genuine zero-read, under real `--workers=2`
    // backend contention, not chips failing to detach. A single local
    // `clickEditIcon()` only waits for the edit modal's container to become
    // visible, not for the Requirement section's own async product data to
    // finish hydrating — under enough backend latency, this method can
    // start (and finish) its inner loop before that hydration completes,
    // then have the real saved chips land moments later.
    const maxSettleRounds = 4;
    const STABILITY_WINDOW_MS = 1000;
    let clearedCount = 0;
    for (let round = 1; round <= maxSettleRounds; round++) {
      let existingChip = control.locator('.is-invalid__multi-value__remove').first();
      while (
        (await existingChip.isVisible({ timeout: 1000 }).catch(() => false)) &&
        clearedCount < maxChipsToClear
      ) {
        // WHY captured BEFORE the click, then polled for a genuine decrease
        // (fixed 2026-08-23 — a blind fixed-duration sleep here was caught
        // by this session's own pre-commit anti-pattern hook): removing a
        // chip triggers an async React re-render of the whole chip list —
        // a fixed 150ms pause was just hoping that commit lands before the
        // next loop iteration re-reads the list. expect.poll() genuinely
        // retries the real chip count until it actually drops, the exact
        // condition being waited for, instead of guessing a duration.
        const chipCountBeforeRemoval = await control
          .locator('.is-invalid__multi-value__remove')
          .count();
        await existingChip.click({ timeout: 5000 });
        // WHY: confirmed live (2026-07-08) — clicking a chip's remove button
        // also bubbles into the control's own click handler and pops the
        // options menu open, which then renders on top of (and blocks clicks
        // on) the remaining chips' remove buttons. Close it before the next
        // removal attempt so it never gets the chance to intercept a click.
        const menuOpen = await this.page
          .locator('.is-invalid__menu')
          .isVisible({ timeout: 500 })
          .catch(() => false);
        if (menuOpen) {
          await this.page.keyboard.press('Escape');
        }
        await expect
          .poll(() => control.locator('.is-invalid__multi-value__remove').count(), { timeout: 3000 })
          .toBeLessThan(chipCountBeforeRemoval);
        existingChip = control.locator('.is-invalid__multi-value__remove').first();
        clearedCount++;
      }
      if (clearedCount >= maxChipsToClear) {
        throw new Error(
          `${description}: still had chips to clear after ${maxChipsToClear} removal attempts — a chip's remove button may not be detaching it`
        );
      }
      // WHY a real `waitFor('visible')` TIMING OUT is the SUCCESS case here
      // (mirrors the proven stability-window idiom in
      // reference-patterns.md §18, applied to the symmetric "reached zero"
      // direction instead of "menu opened"): if no chip's remove icon
      // becomes visible again within the window, the zero state genuinely
      // held — a real, condition-based check, not a fixed-duration blind
      // sleep. If one DOES reappear, loop back into another settle round
      // (re-clearing whatever just landed) instead of trusting a zero-read
      // that a moment later turned out to be premature.
      const reappeared = await control
        .locator('.is-invalid__multi-value__remove')
        .first()
        .waitFor({ state: 'visible', timeout: STABILITY_WINDOW_MS })
        .then(() => true)
        .catch(() => false);
      if (!reappeared) {
        return;
      }
    }
    // WHY: defense in depth — after exhausting every settle round, confirm
    // zero chips actually remain rather than only trusting the loop's own
    // exit condition, so a genuinely unstable field fails loudly here
    // instead of silently producing a wrong total that only surfaces later
    // as a confusing detail-page verification mismatch.
    const remainingChips = await control.locator('.is-invalid__multi-value__remove').count();
    if (remainingChips > 0) {
      throw new Error(
        `${description}: ${remainingChips} chip(s) still present after ${maxSettleRounds} settle rounds — clearing is unreliable`
      );
    }
  }

  async selectRandomFromMultiValueReactSelect(
    control: Locator,
    description: string
  ): Promise<string[]> {
    // WHY: confirmed live (2026-07-08 update-path investigation) — on edit,
    // this field already has chips selected from create. Without clearing
    // them first, newly-clicked options ADD to the existing selection
    // instead of replacing it (confirmed by the math: an edit that selected
    // 4 new options produced 8 total selected — the union of the old 4 and
    // the new 4). An update must replace, not accumulate, so remove every
    // existing chip before selecting the new set.
    await this.clearAllChipsFromMultiSelect(control, description);

    // WHY: this very first open always happens with zero chips selected
    // (the chip-clearing block above guarantees it) — clicking the control
    // div itself is safe here since there's no remove icon anywhere inside
    // it yet to accidentally hit. Once at least one chip exists, later
    // reopen-clicks in the loop below switch to clicking the control's own
    // <input> instead — see that comment for why.
    const controlInput = control.locator('input').first();
    await this.click(control, `multi-select control: ${description}`);
    const menuOptions = this.page.locator('.is-invalid__menu .is-invalid__option');
    await menuOptions.first().waitFor({ state: 'visible', timeout: config.timeouts.expect });
    const allOptionTexts = (await menuOptions.allInnerTexts()).map((t) => t.trim());
    if (allOptionTexts.length === 0) {
      throw new Error(
        `${description}: multi-select opened but has zero live options — cannot select values`
      );
    }
    // WHY capped at 5 (2026-08-07): confirmed live — with no upper bound
    // beyond the live option count, this genuinely selected 45 of 50 live
    // "Products or Services" options in one real QA run, taking ~38s of
    // real, successful, one-chip-per-click selections (not a hang or a
    // stuck retry loop — verified live via temporary instrumentation that
    // the chip count and click count moved in perfect 1:1 lockstep the
    // entire time, zero discrepancies). QA/staging Product/option data grows
    // unboundedly (the same documented pattern as everywhere else in this
    // codebase), so the uncapped range could keep growing indefinitely. A
    // test only needs to prove "multi-select genuinely works," not exercise
    // every live option — 5 is generous headroom above the existing
    // minSelect=2 floor while bounding worst-case runtime.
    const maxSelect = 5;
    const minSelect = Math.min(2, allOptionTexts.length);
    const cappedMax = Math.min(maxSelect, allOptionTexts.length);
    const selectCount = minSelect + Math.floor(Math.random() * (cappedMax - minSelect + 1));
    const toSelect = [...allOptionTexts].sort(() => Math.random() - 0.5).slice(0, selectCount);

    const selected: string[] = [];
    for (const optionText of toSelect) {
      // WHY: the options menu can close after each selection on a multi-select —
      // reopen it before every pick rather than assuming it stays open.
      //
      // WHY this reopen click targets the control's own <input>, never the
      // control div: confirmed live (2026-07-08) via document.elementFromPoint()
      // instrumentation — Playwright's default click() targets the CENTER of
      // an element's bounding box, and the control div's box grows as chips
      // accumulate. Once enough chips wrap onto multiple lines, that center
      // point can drift directly onto a previously-added chip's own "x"
      // remove icon (a sibling element layered inside the same control div)
      // instead of empty control space — silently un-selecting that chip
      // instead of reopening the menu. This was the actual root cause of the
      // "chip drop" flake previously attributed to an unconfirmed app-level
      // React race (see CLAUDE.md's "Lead multi-select fields ('chip drop')
      // — root-caused and fixed" entry). The input is a distinct
      // child DOM node with its own small bounding box that never overlaps a
      // chip's remove icon, so clicking it is immune to this collision
      // regardless of how many chips are already selected. It's only safe to
      // use here (not for the very first open above) because by this point
      // at least one chip already exists, so the input is no longer covered
      // by the empty-state placeholder text.
      const menuOpen = await this.page
        .locator('.is-invalid__menu')
        .isVisible()
        .catch(() => false);
      if (!menuOpen) {
        await this.click(controlInput, `multi-select control: ${description}`);
        await this.page
          .locator('.is-invalid__menu .is-invalid__option')
          .first()
          .waitFor({ state: 'visible', timeout: config.timeouts.expect });
      }
      const option = this.page
        .locator('.is-invalid__menu .is-invalid__option')
        .filter({ hasText: optionText })
        .first();
      await option.click();
      await this.page.waitForTimeout(200);

      // WHY: confirmed live (2026-07-08) — a click here can silently fail to
      // register a new chip (e.g. a stale menu reference during rapid
      // sequential selections under load), producing a widget with fewer
      // values selected than this method believed it selected. That
      // discrepancy previously only surfaced much later, confusingly, during
      // detail-page verification — confirm the chip actually landed before
      // trusting it, and retry once if it didn't.
      const chipLanded = (locator: string) =>
        control
          .locator('.is-invalid__multi-value__label')
          .filter({ hasText: locator })
          .first()
          .isVisible({ timeout: 2000 })
          .catch(() => false);

      if (!(await chipLanded(optionText))) {
        logger.warn(
          `${description}: chip for "${optionText}" did not appear after clicking — retrying once`
        );
        const menuOpenForRetry = await this.page
          .locator('.is-invalid__menu')
          .isVisible()
          .catch(() => false);
        if (!menuOpenForRetry) {
          await this.click(controlInput, `multi-select control: ${description}`);
          await this.page
            .locator('.is-invalid__menu .is-invalid__option')
            .first()
            .waitFor({ state: 'visible', timeout: config.timeouts.expect });
        }
        await this.page
          .locator('.is-invalid__menu .is-invalid__option')
          .filter({ hasText: optionText })
          .first()
          .click();
        await this.page.waitForTimeout(200);
        if (!(await chipLanded(optionText))) {
          throw new Error(
            `${description}: chip for "${optionText}" still did not appear after a retry — selection is unreliable`
          );
        }
      }
      selected.push(optionText);
    }
    await this.page.keyboard.press('Escape');

    // WHY: confirmed live (2026-07-08) — every individual chip can verify as
    // landed at the moment it's clicked (the per-click check above), yet a
    // later selection or the closing Escape can still cause an earlier chip
    // to silently drop before Save — a lead selected 7 options with every
    // one individually confirmed, but only 5 were actually present by the
    // time the form was saved. Re-verify the FULL final set together, after
    // the whole sequence and Escape complete, so this gap is caught here —
    // at the point of fill, with full context — instead of surfacing later
    // as a confusing detail-page verification mismatch.
    const finalChipCount = await control.locator('.is-invalid__multi-value__label').count();
    if (finalChipCount !== selected.length) {
      const finalChipTexts = await control
        .locator('.is-invalid__multi-value__label')
        .allInnerTexts();
      throw new Error(
        `${description}: selected ${selected.length} values [${selected.join(', ')}] but only ${finalChipCount} chip(s) remain in the control after the full selection completed: [${finalChipTexts.join(', ')}] — some selections were silently dropped`
      );
    }

    logger.success(`${description} set to: ${selected.join(', ')}`);
    return selected;
  }

  // WHY: presence-checked wrapper for custom fields — resolves the control
  // from the custom-field id suffix, then delegates to
  // selectRandomFromMultiValueReactSelect() for the actual interaction. Returns
  // null vs [] would be ambiguous with "selected nothing"; [] covers both
  // "skipped" and "field had zero options" cases identically for this
  // method's existing callers, matching its prior behavior.
  async selectMultiPicklistCustomField(
    fieldName: string,
    description = fieldName
  ): Promise<string[]> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'multi-picklist selection');
      return [];
    }
    const control = this.customFieldInputLocator(fieldName).locator(
      'xpath=ancestor::div[contains(@class,"__control")]'
    );
    return this.selectRandomFromMultiValueReactSelect(control, `Custom field "${description}"`);
  }

  private formatCustomFieldDateLabel(date: Date): string {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  // WHY: matches the react-dates SingleDatePicker pattern already proven in
  // QuotationsPage.selectDateInPicker()/DealsPage.selectDateInPicker() —
  // confirmed live (2026-08-10) that custom Date/DateTimePicker fields use
  // the IDENTICAL widget (same `.SingleDatePicker td[aria-label]` cell
  // structure, same aria-label format via the byte-identical
  // formatDateForCalendarLabel()/formatCustomFieldDateLabel() functions,
  // same forward-navigation button text) — not a different component.
  //
  // WHY the simple forward-only loop, replacing an earlier, more elaborate
  // bidirectional-navigation version (fixed 2026-08-10 — see
  // PRODUCTS_AND_SERVICES_PROGRESS.md): that version computed the
  // currently-visible month range via a bounding-rect-filtered DOM read and
  // decided forward-vs-backward from it, specifically to handle a
  // once-observed edge case (target date === field's already-set value, yet
  // the calendar opened months away). Live evidence this session showed
  // that elaborate version failing 100% of the time in real custom-field
  // test runs (always exhausting 24 attempts, always falling back to typing
  // the date as text) — while this exact simple shape, used unmodified in
  // Quotations/Deals for years of real runs, never fails. Per this
  // codebase's own rule 12 (live evidence over assumption/inference), the
  // proven-in-practice simple shape wins over the theoretically-more-robust
  // but actually-broken one. The typing-fallback is KEPT (not deleted) as a
  // defensive safety net in case a custom field's calendar ever opens
  // further than 24 months from the target — never observed live, but a
  // real fallback for an untested edge case is safer than none.
  async selectDateCustomField(
    fieldName: string,
    date: Date,
    description = fieldName,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName, suffixStyle))) {
      this.logCustomFieldSkipped(description, fieldName, 'date selection');
      return;
    }
    const input = this.customFieldInputLocator(fieldName, suffixStyle);
    await this.click(input, `custom field date input: ${description}`);
    const label = this.formatCustomFieldDateLabel(date);
    const dayCell = this.page.locator(`.SingleDatePicker td[aria-label="${label}"]`);
    const forwardButton = this.page.getByLabel('Move forward to switch to the next month.');
    await forwardButton.waitFor({ state: 'visible', timeout: config.timeouts.expect });

    // WHY 400ms, not the 1000ms this shape uses in Quotations/Deals' own
    // separate, untouched native date-pickers (fixed 2026-08-10, per the
    // user's own speed investigation — see PRODUCTS_AND_SERVICES_PROGRESS.md):
    // custom-field dates are always generated 0-30 days out and the
    // calendar always opens on the current month, so at most ONE forward
    // click is ever needed — the real cost was an unconditional ~1000ms
    // wasted wait on the FIRST (usually-failing, when a click IS needed)
    // check, timed out on the FULL budget every time since a failed
    // `waitFor` can't resolve early. Real observed render time for a
    // genuinely-visible cell is well under 100ms (measured live this
    // session) — 400ms keeps a real ~4x safety margin over that while
    // roughly halving the worst-case (one-navigation) total time. Scoped to
    // only this method's own two checks — does not touch the
    // 1000ms value the sibling native-field methods still use.
    let found = false;
    try {
      await dayCell.waitFor({ state: 'visible', timeout: 400 });
      found = true;
    } catch {
      found = false;
    }
    let attempts = 0;
    while (!found && attempts < 24) {
      await forwardButton.click();
      try {
        await dayCell.waitFor({ state: 'visible', timeout: 400 });
        found = true;
      } catch {
        attempts++;
      }
    }
    // WHY this retry-with-reopen exists (found live, 2026-08-10, during the
    // user's own navigation-speed investigation — see
    // PRODUCTS_AND_SERVICES_PROGRESS.md's CRITICAL entry): a real,
    // intermittent (~30-50% of real create+edit cycles observed) failure
    // where `dayCell.click()` throws "element was detached from the DOM"
    // after the cell was correctly found — always on the EDIT flow's FIRST
    // calendar-driven interaction (Date or DateTimePicker), never on
    // create. Live DOM instrumentation DISPROVED the original suspected
    // mechanism ("previous field's calendar didn't finish closing before
    // this one opened"): all of a Deal's SingleDatePicker widgets (13-16+
    // observed live, one per part-payment row plus the two custom fields)
    // are PERMANENTLY mounted and merely CSS-hidden — they never add/remove
    // from the DOM as "open"/"closed", so there is no calendar-closing race
    // to wait out. A 6-second idle-window mutation-observer probe
    // immediately after the payment-status-change step (fillEditForm()'s
    // step right before custom fields) also showed ZERO DOM mutations,
    // ruling out a simple "wait longer" fix.
    //
    // WHY only ONE retry attempt, not several: a first version of this fix
    // tried 3 reopen-and-retry attempts before falling back to typing.
    // Real verification (12 real create+edit cycles, 7 of which hit this
    // condition) showed the retry never once helped — 0 of 21 individual
    // click attempts (7 occurrences × 3 attempts each) succeeded; every
    // single occurrence exhausted all 3 attempts and fell through to
    // typing regardless. This is real evidence the condition, once
    // triggered, is SUSTAINED across the whole multi-second retry window
    // for that field — not a one-moment blip a quick re-click can dodge.
    // (The exact trigger is still not pinned down with full certainty;
    // the leading theory is fillEditForm()'s preceding rapid-fire field
    // fills — name, utm, 4 text-like custom fields, all ~60-120ms apart,
    // far faster than a real user — leaving a React re-render lagging
    // behind into the edit session's first calendar interaction.) Given
    // retries provably added ~8s of pure waste with zero observed benefit,
    // this keeps exactly one cheap attempt (in case a future occurrence
    // ever is transient) then defers immediately to the already-proven
    // typing fallback, rather than wasting time repeating an approach the
    // real data says doesn't work.
    const clickDayCellOnce = async (): Promise<boolean> => {
      try {
        await dayCell.click({ timeout: 5000 });
        return true;
      } catch {
        logger.warn(
          `Custom field "${description}" (cf${fieldName}): day cell click failed (likely a detached/re-rendered cell, confirmed sustained rather than momentary — see BasePage's selectDateCustomField comment) — falling back to typing the date directly`
        );
        return false;
      }
    };

    if (!found) {
      logger.warn(
        `Custom field "${description}" (cf${fieldName}): day cell not found after ${attempts} calendar navigations — falling back to typing the date directly`
      );
    } else if (await clickDayCellOnce()) {
      logger.success(`Custom field "${description}" date set to: ${date.toDateString()}`);
      return;
    }
    await this.page.keyboard.press('Escape');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const yyyy = date.getFullYear();
    await input.click({ clickCount: 3 });
    await input.fill(`${mm}/${dd}/${yyyy}`);
    await this.page.keyboard.press('Tab');
    logger.success(`Custom field "${description}" date set to: ${date.toDateString()}`);
  }

  // WHY: confirmed live (2026-07-08) — DateTimePicker is NOT the same single
  // widget as Date. It pairs the same SingleDatePicker for its date half with
  // a SEPARATE rc-time-picker widget for time (identical to the one already
  // handled in MeetingsPage.fillTimePicker()/CallLogsPage) — the time input
  // starts disabled and only becomes enabled once a date has been picked.
  async selectDateTimeCustomField(
    fieldName: string,
    date: Date,
    description = fieldName,
    suffixStyle: CustomFieldSuffixStyle = 'legacy'
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName, suffixStyle))) {
      this.logCustomFieldSkipped(description, fieldName, 'date-time selection');
      return;
    }
    await this.selectDateCustomField(fieldName, date, description, suffixStyle);

    // WHY the same suffixStyle for the time half — confirmed live (2026-07-29)
    // Meetings/Call Logs' DateTimePicker time input follows the same "plain"
    // suffix as the date half (e.g. "..._input_cfDateTimePicker_time").
    const timeSuffix = this.customFieldSuffix(`${fieldName}_time`, suffixStyle);
    const timeInput = this.page.locator(`[id$="${timeSuffix}"]`);
    const timeInputEnabled = await timeInput
      .isEnabled({ timeout: 5000 })
      .catch(() => false);
    if (!timeInputEnabled) {
      logger.warn(
        `Custom field "${description}" (cf${fieldName}): time input did not become enabled within 5s — proceeding cautiously`
      );
    }
    // WHY: force — the rc-time-picker input sits behind a clock icon that can
    // intercept the click at its exact center, same as confirmed live in the
    // investigation that produced this method.
    await this.click(timeInput, `custom field time input: ${description}`, true);
    await this.page.waitForSelector('.rc-time-picker-panel', { timeout: config.timeouts.expect });

    const hour12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
    const hourStr = String(hour12).padStart(2, '0');
    const minuteStr = String(date.getMinutes()).padStart(2, '0');
    const amPm = date.getHours() < 12 ? 'am' : 'pm';
    const columns = this.page.locator('.rc-time-picker-panel:visible .rc-time-picker-panel-select');
    await columns
      .nth(0)
      .locator('li', { hasText: new RegExp(`^${hourStr}$`) })
      .click();
    await columns
      .nth(1)
      .locator('li', { hasText: new RegExp(`^${minuteStr}$`) })
      .click();
    await columns
      .nth(2)
      .locator('li', { hasText: new RegExp(`^${amPm}$`, 'i') })
      .click();
    await this.page.keyboard.press('Escape');
    // WHY: wait for actual DOM state change (panel hiding) instead of blind wait
    // confirmed live in MeetingsPage.fillTimePicker() — rc-time-picker closes
    // and unhides the underlying field when Escape is pressed
    await this.page
      .waitForSelector('.rc-time-picker-panel', { state: 'hidden', timeout: 3000 })
      .catch(() => {});

    logger.success(
      `Custom field "${description}" date-time set to: ${date.toDateString()} ${hourStr}:${minuteStr} ${amPm}`
    );
  }

  // WHY: matches the detail-page display format confirmed live (2026-07-08)
  // on the Lead entity: a date custom field renders as "Jul 13, 2026", and a
  // date-time custom field renders as the same date format plus
  // " at h:mm am/pm" (lowercase am/pm, no leading zero on hour — the
  // rc-time-picker default). This is a Kylas-platform rendering convention,
  // not something specific to Lead, so it lives here (protected, not
  // private) rather than in LeadsPage — ready for Contacts/Companies/Deals
  // to call once they get their own Date/DateTimePicker custom fields,
  // instead of re-deriving the same format independently.
  protected formatCustomFieldDetailDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  protected formatCustomFieldDetailDateTime(date: Date): string {
    const datePart = this.formatCustomFieldDetailDate(date);
    const hour12 = date.getHours() % 12 === 0 ? 12 : date.getHours() % 12;
    const minuteStr = String(date.getMinutes()).padStart(2, '0');
    const amPm = date.getHours() < 12 ? 'am' : 'pm';
    return `${datePart} at ${hour12}:${minuteStr} ${amPm}`;
  }

  // WHY: shared by any single-value detail-page field, custom or standard —
  // assertCustomFieldOnDetail() below is a thin wrapper that prefixes the
  // custom-field "cf" convention; standard fields (e.g. Lead's Currency,
  // Budget) call this directly with their own container id (confirmed live
  // 2026-07-08 — standard fields use the exact same `[id="X"] .title`
  // read-only-info markup, just without the "cf" prefix). Render-race safe
  // by design — uses Playwright's auto-retrying toContainText() instead of
  // a one-shot textContent()/innerText() read. This framework already
  // tracked down a real bug class where a one-shot read raced React's
  // re-render after a GET response resolved (see the assert*Updated fixes
  // across Companies/Contacts/Deals/Leads/Quotations); do not reintroduce
  // that pattern here.
  async assertFieldOnDetailByContainerId(
    containerId: string,
    expectedValue: string,
    description: string
  ): Promise<void> {
    // Reveal the field's carousel slide if it's on a paged detail section
    // (no-op otherwise). Not strictly required for toContainText — which reads
    // textContent even on a display:none slide — but kept for consistency and
    // so the value is genuinely visible when this passes.
    await this.revealDetailCarouselSlideFor(containerId);
    const valueLocator = this.page.locator(`[id="${containerId}"] .title`);
    // WHY wrapped (2026-07-29): this raw expect() was a pre-existing gap —
    // every other page-level assertion in this file routes through
    // withSessionExpiryRecovery() (see assertFormErrorToast() just above),
    // but this one didn't. Same reasoning applies: a mid-wait session expiry
    // would otherwise time out here with no recovery attempt at all.
    await this.withSessionExpiryRecovery(() =>
      expect(
        valueLocator,
        `Expected "${description}" (container #${containerId}) to show "${expectedValue}" on the detail page, but it never appeared`
      ).toContainText(expectedValue, { timeout: config.timeouts.expect })
    );
    logger.success(`"${description}" verified on detail page: "${expectedValue}"`);
  }

  async assertCustomFieldOnDetail(
    fieldName: string,
    expectedValue: string,
    description = fieldName
  ): Promise<void> {
    await this.assertFieldOnDetailByContainerId(
      `cf${fieldName}`,
      expectedValue,
      `Custom field "${description}"`
    );
  }

  /**
   * Ensure the detail-page field identified by `containerId` is on the ACTIVE
   * carousel slide before it is asserted.
   *
   * WHY this is needed: some detail-page sections (e.g. Lead's "Other Details")
   * render as a Bootstrap carousel — when there are more custom fields than fit
   * one slide, the extras are paged onto further slides. Confirmed live
   * (2026-07-21) that inactive slides stay ATTACHED in the DOM but `display:none`.
   * That means:
   *   - `toContainText` assertions read `textContent` and still match a field on
   *     an inactive slide (so they never strictly needed this), BUT
   *   - `toBeVisible`-based assertions (the multi-value field check) FAIL when
   *     their field is paged onto an inactive slide.
   * Calling this before either kind of assertion makes the field genuinely
   * visible first — a no-op when the field is already active, and a no-op when
   * the section is not a carousel at all (single-page modules like Contacts
   * today), so it is safe to call defensively everywhere.
   *
   * Navigation is direction-aware: this carousel does NOT cycle (confirmed live
   * 2026-07-21 — "next" on the last slide is inert), so it clicks "next" or
   * "prev" toward the target slide's index. Bounded by the actual slide count;
   * a carousel whose target slide never activates fails fast with a clear error
   * rather than looping forever.
   *
   * @param containerId id of the field's detail container (e.g. "cfCompanyLookup").
   */
  protected async revealDetailCarouselSlideFor(containerId: string): Promise<void> {
    const container = this.page.locator(`[id="${containerId}"]`);
    const slide = container.locator(
      'xpath=ancestor::div[contains(@class,"carousel-item")][1]'
    );
    // Not inside a carousel (single-page section) → nothing to navigate.
    if ((await slide.count()) === 0) return;
    const slideIsActive = async (): Promise<boolean> =>
      /\bactive\b/.test((await slide.getAttribute('class')) ?? '');
    if (await slideIsActive()) return;

    // WHY the token-boundary match (not contains(@class,"carousel")): the
    // slide itself is a `.carousel-item`, whose class STRING contains the
    // substring "carousel" — a plain contains() would wrongly select the slide
    // as the "carousel" and find zero inner slides. Matching the standalone
    // class token " carousel " selects the real outer carousel container
    // ("… active carousel slide") and never a "carousel-item".
    const carousel = container.locator(
      'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " carousel ")][1]'
    );
    const items = carousel.locator('.carousel-item');
    const slideCount = await items.count();
    // Index of the slide that actually contains our field.
    const targetIndex = await items.evaluateAll(
      (nodes, id) => nodes.findIndex((n) => n.querySelector(`[id="${id}"]`) !== null),
      containerId
    );
    if (targetIndex < 0) return; // defensive — slide.count() > 0 means it's present
    const nextChevron = carousel.locator('a.chevron[data-slide="next"]').first();
    const prevChevron = carousel.locator('a.chevron[data-slide="prev"]').first();
    // WHY direction-aware (confirmed live 2026-07-21 that this carousel does NOT
    // cycle — "next" on the last slide is inert): move toward the target slide's
    // index using the correct chevron. Recomputed each iteration so a miss self-
    // corrects; bounded by the real slide count.
    for (let i = 0; i < slideCount; i++) {
      if (await slideIsActive()) return;
      const activeIndex = await items.evaluateAll((nodes) =>
        nodes.findIndex((n) => n.classList.contains('active'))
      );
      const chevron = targetIndex > activeIndex ? nextChevron : prevChevron;
      await chevron.click({ timeout: config.timeouts.expect });
      // Wait on the target slide's own `active` class rather than a fixed sleep:
      // the transition is animated and its duration isn't ours to assume. A miss
      // (target not reached yet) times out and the next iteration re-navigates.
      await expect(slide)
        .toHaveClass(/\bactive\b/, { timeout: config.timeouts.expect })
        .catch(() => {
          /* not on the target slide yet — recompute and advance next iteration */
        });
    }
    if (await slideIsActive()) return;
    throw new Error(
      `revealDetailCarouselSlideFor: field container "${containerId}" was never brought onto the active carousel slide after ${slideCount} navigation attempt(s) — the carousel may be broken`
    );
  }

  // WHY: shared by any multi-value detail-page field, custom or standard —
  // assertMultiPicklistCustomFieldOnDetail() below is a thin "cf"-prefixed
  // wrapper; standard fields (e.g. Lead's "Products or Services", confirmed
  // live 2026-07-08 to use the identical `.with-details-multi-value` markup
  // despite being a lookup field under the hood, not a static picklist)
  // call this directly with their own container id.
  //
  // WHY the truncation handling exists at all: confirmed live (2026-07-08) —
  // a multi-value field's detail-page display truncates to "first 2 values
  // (in the widget's own render order, NOT selection order) + (+N)" once
  // more than 2 are selected, and the remaining N values are not present
  // anywhere in the DOM — no title, no data attribute, no aria-label, no
  // tooltip or click-to-expand on the "+N" indicator (confirmed by dumping
  // every attribute on every node in the container). Asserting every
  // selected value is therefore impossible through this UI when there are
  // more than 2 — verify only what it actually exposes: exactly 2 rendered
  // values (each genuinely a member of what was selected) plus a correct
  // remaining count.
  async assertMultiValueFieldOnDetailByContainerId(
    containerId: string,
    expectedValues: string[],
    description: string
  ): Promise<void> {
    // Reveal the field's carousel slide if it's on a paged detail section
    // (no-op otherwise). REQUIRED here: this method's toBeVisible check below
    // fails if the field is paged onto an inactive (display:none) slide.
    await this.revealDetailCarouselSlideFor(containerId);
    const container = this.page.locator(`[id="${containerId}"] .with-details-multi-value`);
    const items = container.locator('li');
    // WHY wrapped (2026-07-29): same pre-existing gap as
    // assertFieldOnDetailByContainerId() above — see that method's comment.
    await this.withSessionExpiryRecovery(() =>
      expect(
        items.first(),
        `"${description}" (container #${containerId}): expected at least one rendered value on the detail page, but none appeared`
      ).toBeVisible({ timeout: config.timeouts.expect })
    );

    const rawTexts = await items.allInnerTexts();
    const itemTexts = rawTexts.map((t) => t.replace(/^,\s*/, '').trim());
    const isMoreCount = (t: string): boolean => /^\(\+\d+\)$/.test(t);
    const moreCountText = itemTexts.find(isMoreCount) ?? null;
    const visibleValues = itemTexts.filter((t) => !isMoreCount(t));

    if (!moreCountText) {
      // WHY: no truncation indicator present — the UI rendered every
      // selection, so every expected value must be among them.
      for (const value of expectedValues) {
        if (!visibleValues.includes(value)) {
          throw new Error(
            `"${description}" (container #${containerId}): expected "${value}" among rendered values [${visibleValues.join(', ')}], but it was missing`
          );
        }
      }
      logger.success(
        `"${description}" verified on detail page (no truncation): all ${expectedValues.length} values present`
      );
      return;
    }

    if (visibleValues.length !== 2) {
      throw new Error(
        `"${description}" (container #${containerId}): expected exactly 2 visible values before the truncation indicator, found ${visibleValues.length}: [${visibleValues.join(', ')}]`
      );
    }
    for (const value of visibleValues) {
      if (!expectedValues.includes(value)) {
        throw new Error(
          `"${description}" (container #${containerId}): rendered value "${value}" is not one of the selected values [${expectedValues.join(', ')}]`
        );
      }
    }
    const expectedMoreText = `(+${expectedValues.length - 2})`;
    if (moreCountText !== expectedMoreText) {
      throw new Error(
        `"${description}" (container #${containerId}): expected truncation indicator "${expectedMoreText}" (${expectedValues.length} total selected, 2 shown) but found "${moreCountText}"`
      );
    }
    logger.success(
      `"${description}" verified on detail page (truncated display): 2 of ${expectedValues.length} selected values shown, remaining count confirmed as ${moreCountText}`
    );
  }

  async assertMultiPicklistCustomFieldOnDetail(
    fieldName: string,
    expectedValues: string[],
    description = fieldName
  ): Promise<void> {
    await this.assertMultiValueFieldOnDetailByContainerId(
      `cf${fieldName}`,
      expectedValues,
      `Custom field "${description}"`
    );
  }

  // WHY: the inverse of assertNoFormErrors() — asserts a field-level
  // validation error DOES appear, scoped to the same selector convention
  // already used by LeadsPage.assertValidationError().
  async assertCustomFieldValidationError(
    fieldName: string,
    expectedMessage: string,
    description = fieldName
  ): Promise<void> {
    const error = this.page
      .locator('.invalid-feedback:visible, .help-text.error:visible')
      .filter({ hasText: expectedMessage });
    // WHY wrapped (2026-07-29): same pre-existing gap as
    // assertFieldOnDetailByContainerId() above — see that method's comment.
    await this.withSessionExpiryRecovery(() =>
      expect(
        error.first(),
        `Expected validation error "${expectedMessage}" for custom field "${description}" (cf${fieldName}), but it never appeared`
      ).toBeVisible({ timeout: config.timeouts.expect })
    );
    logger.success(
      `Custom field "${description}" validation error confirmed: "${expectedMessage}"`
    );
  }

  // ─── Form Section Helpers (generic — reusable across entities/modules) ────
  // WHY: confirmed live (2026-07-16) — Lead's and Contact's shared
  // #editEntityModal create/edit form renders each labeled section (Location,
  // Professional, Communication, ...) as its own <div class="data-container">
  // wrapping BOTH that section's own <h2> heading AND all of that section's
  // fields as descendants. The data-container's own `id` is a random,
  // per-render numeric value (NOT stable across page loads — never match on
  // it directly), but the section is reliably re-locatable by filtering for
  // the container that has a descendant heading with the section's exact,
  // stable text. This is the real mechanism the app uses to visually group
  // fields — confirmed by walking the DOM from known fields (Address,
  // Company Industry) up to their shared ancestor, not assumed from the nav
  // sidebar's scrollspy links (which only scroll to a section, they don't
  // encode which container belongs to which section).
  protected getFormSectionContainer(sectionHeading: string): Locator {
    return this.page
      .locator('#editEntityModal div.data-container')
      .filter({ has: this.page.getByRole('heading', { name: sectionHeading, exact: true }) });
  }

  // ─── GPS Address Helpers (generic — reusable across entities/modules) ─────
  // WHY: generalized out of MeetingsPage.ts (2026-07-15), which had this
  // logic private to itself. Confirmed live that Contact's address field
  // exposes the identical "Get GPS Address" trigger — a Google-Places-style
  // autocomplete search, not browser geolocation — so this is parameterized
  // by the actual address input to fill (never coupled to Meeting's own
  // "location" field) for Contact today and Lead/Company later.
  //
  // WHY section-scoped, not a bare page-wide text match (2026-07-16 Lead
  // hardening): confirmed live that Lead's form has TWO "Get GPS Address"
  // triggers with identical visible text — one for its own Address (Location
  // section) and one for Professional's Company Address — so an unscoped
  // `page.getByText(...)` throws a Playwright strict-mode violation the
  // moment Lead's form is in play. Scoping by the field's own SECTION
  // CONTAINER (via getFormSectionContainer above), not just a CSS class
  // difference between the two triggers, keeps this correct even if some
  // future section adds a third similarly-built trigger — a class-based fix
  // would only patch today's two known triggers, not the general case.
  protected getGpsAddressTrigger(sectionContainer: Locator): Locator {
    return sectionContainer.getByText('Get GPS Address', { exact: true });
  }

  private readonly gpsAddressSearchInput = (): Locator =>
    this.page.getByPlaceholder('Search for area, street name');

  private readonly gpsAddressPrediction = (): Locator =>
    this.page.locator('.autocomplete-prediction').first();

  // WHY: returns the value actually entered (GPS-selected prediction text OR
  // the manual fallback) — never hardcode/assume the GPS service's result,
  // since it's a live third-party lookup. Callers need this to verify the
  // saved entity's detail page against whatever genuinely ended up in the
  // field, not a guessed string.
  //
  // WHY sectionContainer defaults to the whole modal (2026-07-16 hardening):
  // callers with only one GPS trigger on their form (Contact, Meeting) can
  // still pass their own section container for defense-in-depth, but a
  // caller that omits it isn't left fully unscoped either — defaulting to
  // `#editEntityModal` (rather than the previous bare page-wide text lookup)
  // means even an unscoped caller fails loudly below if a second trigger
  // ever appears on their form, instead of a silent, ambiguous match.
  protected async fillAddressViaGpsOrManual(
    addressInput: Locator,
    manualAddress: string,
    description = 'address',
    sectionContainer: Locator = this.page.locator('#editEntityModal')
  ): Promise<string> {
    logger.info(`Filling ${description} via GPS lookup if available`);
    const gpsButton = this.getGpsAddressTrigger(sectionContainer);
    // WHY: fail loud, not silent (2026-07-16 hardening) — if this ever
    // resolves to more than one element, scoping has regressed (a new
    // trigger was added inside the same section, or the wrong/too-broad
    // container was passed in). Silently clicking `.first()` would risk
    // acting on the wrong field's trigger with no visible symptom.
    const gpsCount = await gpsButton.count();
    if (gpsCount > 1) {
      throw new Error(
        `${description}: expected at most one "Get GPS Address" trigger within the given section container, found ${gpsCount} — scope sectionContainer more tightly`
      );
    }
    const gpsVisible = gpsCount === 1 && (await gpsButton.isVisible().catch(() => false));
    if (gpsVisible) {
      await this.click(gpsButton, `Get GPS Address button (${description})`);
      await this.page.waitForTimeout(1500);
      // WHY: Kylas gates this feature behind a paid "Field Sales" addon on
      // some accounts/environments — confirmed live (Meetings module) this
      // shows a purchase-upsell dialog instead of the search box. Detect it
      // and fall through to manual entry rather than hanging on a search
      // input that will never appear.
      const addonDialog = await this.page
        .locator('text=purchase')
        .first()
        .isVisible()
        .catch(() => false);
      if (!addonDialog) {
        // WHY: the search API needs a real place-name fragment, not the
        // full manual address string — first comma-segment, capped short,
        // mirrors MeetingsPage's proven approach.
        const citySearch = manualAddress.split(',')[0].trim().substring(0, 10);
        await this.gpsAddressSearchInput().fill(citySearch);
        await this.page
          .waitForSelector('.autocomplete-prediction', { timeout: 5000 })
          .catch(() => null);
        const predictionsVisible = await this.gpsAddressPrediction()
          .isVisible()
          .catch(() => false);
        if (predictionsVisible) {
          await this.gpsAddressPrediction().click();
          await this.page.waitForTimeout(500);
          const gpsValue = await addressInput.inputValue().catch(() => '');
          logger.success(`GPS ${description} selected: ${gpsValue}`);
          return gpsValue;
        }
      }
    }
    await this.fill(addressInput, manualAddress, description);
    logger.info(`Manual ${description} entered: ${manualAddress}`);
    return manualAddress;
  }

  // ─── Product/Lookup Row Helpers (generic — reusable across entities/modules) ─────
  // WHY these live here rather than in ProductsAndServicesPage/DealsPage/
  // QuotationsPage: the design explicitly calls for generalized, locator-
  // parameterized helpers (not hardcoded to "the product field") so the next
  // module that needs the same interaction shape reuses these unchanged — the
  // same reuse reasoning already applied to selectLookupCustomField() and
  // selectRandomFromMultiValueReactSelect() above. Deals' and Quotations'
  // product-row "Add New" trigger is confirmed to share the identical
  // `span.add-new-product` selector; the row-search-then-select mechanic is
  // confirmed identical on both (Deals differs only in lacking Quotations'
  // row-indexed quantity/price/discount inputs, which is irrelevant to these
  // generic helpers — they only ever touch the product-id search control).

  /**
   * Adds a new product row to a Deal/Quotation form and searches for a
   * product by exact name.
   *
   * @param addRowTrigger The module's "Add New" product-row button (e.g.
   *                       `span.add-new-product`).
   * @param searchInput   The newly-added row's product search `<input>` —
   *                       NOT its ancestor control. This method derives the
   *                       control internally via the same
   *                       `xpath=ancestor::div[contains(@class,"is-invalid__control")]`
   *                       pattern already used by selectLookupCustomField().
   * @param optionList    The menu-scoped options locator (e.g.
   *                       `.is-invalid__menu .is-invalid__option`) — never the
   *                       page-wide `.is-invalid__option` (the documented
   *                       Issue-1 flake source).
   * @param name          Exact product name to search for and select.
   * @param expectFound
   *   `true`  → search, click the matching option, assert it renders as the
   *             row's selected value.
   *   `false` → search, assert NO matching option renders, then STOP. Caller
   *             must NOT proceed to save — the row is left intentionally
   *             incomplete, and saving an empty product row triggers an
   *             unrelated validation error. This method's contract for
   *             `expectFound: false` is "assert absence only," nothing more.
   */
  async addProductRowAndSearchByName(
    addRowTrigger: Locator,
    searchInput: Locator,
    optionList: Locator,
    name: string,
    expectFound: boolean
  ): Promise<void> {
    await this.click(addRowTrigger, 'Add New product row');
    const control = searchInput.locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
    // WHY click the control div, not the input: the "Search ..." placeholder
    // overlays the input and intercepts pointer events on first open — the
    // same confirmed race as selectLookupCustomField() and this app's own
    // Category/Units controls (live-confirmed 2026-08-10 on the Products &
    // Services create form).
    await this.click(control, `product row search control: ${name}`);

    if (expectFound) {
      await this.fillSearchAndWaitForOptions(
        searchInput,
        optionList,
        name,
        `Product row search: ${name}`
      );
      const exactOption = optionList
        .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(name)}\\s*$`) })
        .first();
      await exactOption.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      await exactOption.click();
      await this.page
        .locator('.is-invalid__menu')
        .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
        .catch(() => {
          /* menu may already be gone */
        });
      await expect(
        control,
        `Product row: expected "${name}" to render as the selected value after selection`
      ).toContainText(name, { timeout: config.timeouts.expect });
      logger.success(`Product row: selected "${name}"`);
      return;
    }

    // expectFound === false: assert absence, then stop.
    //
    // WHY arm a response wait BEFORE typing (mirrors
    // assertLookupCustomFieldOptionAbsent()'s identical reasoning): a
    // Playwright `toBeHidden()` check against a locator with ZERO current DOM
    // matches resolves TRUE INSTANTLY — "no elements matching = hidden" is
    // trivially satisfied the moment we check, with no polling wait at all,
    // regardless of the timeout passed in. Without first confirming the async
    // search actually returned, we'd get a false pass the instant we check —
    // before the (possibly slower) live lookup has had any chance to reveal
    // the option. Arm the wait before typing so the response event can't be
    // missed.
    //
    // WHY this specific URL pattern (`/v1/products/(search|lookup)`): the
    // Products module's OWN list/create/duplicate-check flows are confirmed
    // live to use `/v1/products/search` (POST) and `/v1/products/lookup`
    // (GET) — see PRODUCTS_AND_SERVICES_PROGRESS.md's live-investigation
    // entry. This module's own async product search is a strong, but NOT
    // independently network-captured, inference that the embedded row search
    // reuses one of these same two endpoints (Kylas's own convention is one
    // shared lookup endpoint per entity, reused across every embedding
    // context — the same convention selectLookupCustomField()/
    // selectRandomFromSearchableReactSelect() already rely on for Company/
    // Contact lookups). Flagged here as inferred hardening, not a proven
    // fact — verify live the first time this `expectFound: false` path
    // actually runs (Batch 8's inactive-product-absence tests), and widen/
    // correct this pattern then if the real embedded search hits something
    // else. Scoped to the real versioned path per rule 15 — never a bare
    // substring, and this pattern cannot match an unrelated `/reports/` call.
    const searchReturned = this.page
      .waitForResponse((res) => /\/v1\/products\/(search|lookup)(\?|$)/i.test(res.url()), {
        timeout: config.timeouts.expect,
      })
      .catch(() => null);
    await searchInput.fill(name);
    await searchReturned;
    const namedOption = optionList.filter({
      hasText: new RegExp(`^\\s*${this.escapeRegExp(name)}\\s*$`),
    });
    await expect(
      namedOption,
      `Product row: "${name}" should NOT be selectable (expected inactive/excluded)`
    ).toBeHidden({ timeout: config.timeouts.expect });
    logger.success(`Product row: confirmed "${name}" is not selectable, as expected`);
  }

  /**
   * Removes a product row from a Deal/Quotation form.
   *
   * WHY not called by any test written so far: per the design, this exists
   * for any FUTURE test that needs to check-absence-then-continue-with-the-
   * rest-of-the-form (the current inactive-product-absence tests deliberately
   * stop after asserting absence — see addProductRowAndSearchByName()'s own
   * `expectFound: false` contract — because continuing to save with an empty
   * row triggers an unrelated validation error).
   *
   * WHY this exact selector: confirmed live (2026-08-10) against a real
   * Deal's product row — the remove trigger is a bare FontAwesome icon,
   * `<i class="fas fa-times pr-2 pt-2 cursor-pointer">`, a sibling of the
   * row's Total field, NOT a `<button>`/`<svg>` and with no
   * "remove"/"delete" wording anywhere in its class or attributes — the
   * original guessed selector (button/aria-label/class-name-based) would
   * never have matched this real element. Scoped to `i.fa-times` within the
   * given row (not page-wide) since react-select's own clear-indicator
   * icons elsewhere in the row are real `<svg>` elements, not `<i>`, so
   * there's no collision risk from broadening slightly to any `fa-times`
   * icon inside this specific row.
   *
   * @param rowLocator The specific row to remove (e.g. a row wrapper `div`/`tr`
   *                    scoped to one product line item).
   */
  async removeProductRow(rowLocator: Locator): Promise<void> {
    const removeTrigger = rowLocator.locator('i.fa-times.cursor-pointer').first();
    const triggerCount = await removeTrigger.count();
    if (triggerCount === 0) {
      throw new Error(
        'removeProductRow: no remove/delete trigger found within the given row locator — ' +
          'this selector is unverified against the live DOM (see method comment); confirm the ' +
          'real element live before relying on this method.'
      );
    }
    await this.click(removeTrigger, 'remove product row');
    await rowLocator.waitFor({ state: 'hidden', timeout: config.timeouts.expect }).catch(() => {
      /* row may already be fully detached rather than merely hidden */
    });
    logger.success('Product row removed');
  }

  /**
   * Generic async-search-then-select, for lookup fields that filter as you
   * type (e.g. Lead's Requirement-section "Products or Services" field).
   * Different mechanic from addProductRowAndSearchByName() above — this is a
   * single lookup input with its own options menu, not a row-based list.
   *
   * WHY this takes raw locators rather than a field-name string (unlike
   * selectLookupCustomField()): this is the non-custom-field counterpart —
   * it must work for a plain, always-present control like Lead's Products
   * field, which has no `cf<Name>` custom-field id to key off. Any future
   * module's own plain lookup field reuses this unchanged.
   *
   * WHY the search term is the first word of `name`, not the full string:
   * mirrors LeadsPage.fillLeadLookupCustomFields()'s own
   * `name.trim().split(/\s+/)[0]` pattern exactly — the live server search
   * matches a single token, and typing a full multi-word name can return
   * zero results even though an exact-text option match on the full name
   * would otherwise succeed once results are showing.
   *
   * WHY `expectFound` (added 2026-08-10, for Lead's Products-field
   * inactive-fixture-absence check): mirrors
   * addProductRowAndSearchByName()'s identical contract — `false` types the
   * FULL name (not just the first token, unlike the found path) and asserts
   * it never becomes selectable, then stops; it never proceeds to select
   * anything, since a caller checking absence has nothing valid to select.
   * The absence-path's response-wait URL pattern
   * (`/v1/products/(search|lookup)`) is confirmed live (2026-08-10, via a
   * real network capture on Lead's own Products field:
   * `GET /v1/products/lookup?q=name:...`) to be the same endpoint
   * addProductRowAndSearchByName() already targets — not a fresh guess.
   *
   * @param lookupInput The lookup field's own `<input>` (its ancestor control
   *                     is derived internally, same as
   *                     addProductRowAndSearchByName()).
   * @param optionList  The menu-scoped options locator.
   * @param name        Exact option text to select (or to assert absent).
   * @param expectFound `true` → search+select+assert-selected; `false` →
   *                     assert absence only, then stop.
   */
  async searchAndSelectByName(
    lookupInput: Locator,
    optionList: Locator,
    name: string,
    expectFound: boolean
  ): Promise<void> {
    const control = lookupInput.locator(
      'xpath=ancestor::div[contains(@class,"is-invalid__control")]'
    );
    // WHY click the control div, not the input: identical confirmed race as
    // selectLookupCustomField() and addProductRowAndSearchByName() above.
    await this.click(control, `lookup control: ${name}`);

    if (expectFound) {
      // WHY search with the FULL name, not just its first word (fixed
      // 2026-08-23, real PS10 recurrence investigated live — see
      // .claude/product-search-index-lag-investigation.md): the original
      // `name.trim().split(/\s+/)[0]` was suspected but NOT actually caused
      // by search-index lag. Confirmed live via a direct diagnostic against
      // the real backend: searching this method's ONLY current caller's
      // typical search term (`[QA-Auto]`, the fixed prefix every Products &
      // Services test fixture shares, per this module's own "fixtures are
      // never deleted, real accumulation over time" design) returned
      // exactly 50 results — a hard backend page-size cap — sorted
      // alphabetically by product name, with the actual target fixture NOT
      // among them. Searching the SAME target's full name returned exactly
      // 1 result: the exact fixture. A shared, non-discriminating prefix
      // token gets crowded out by an ever-growing accumulated pool as this
      // environment's product data grows (rule 20) — this was never a
      // freshness/indexing-speed problem. The full name is exactly what the
      // sibling `addProductRowAndSearchByName()` already searches with
      // successfully for the same fixtures on Deals/Quotations — mirroring
      // that proven, working pattern rather than inventing a new one.
      await this.fillSearchAndWaitForOptions(
        lookupInput,
        optionList,
        name,
        `Search and select: ${name}`
      );
      const exactOption = optionList
        .filter({ hasText: new RegExp(`^\\s*${this.escapeRegExp(name)}\\s*$`) })
        .first();
      await exactOption.waitFor({ state: 'visible', timeout: config.timeouts.expect });
      await exactOption.click();
      await this.page
        .locator('.is-invalid__menu')
        .waitFor({ state: 'hidden', timeout: config.timeouts.expect })
        .catch(() => {
          /* menu may already be gone */
        });
      logger.success(`Search and select: selected "${name}"`);
      return;
    }

    // expectFound === false: assert absence, then stop. See
    // addProductRowAndSearchByName()'s identical branch for the full
    // reasoning on arming the response wait BEFORE typing.
    const searchReturned = this.page
      .waitForResponse((res) => /\/v1\/products\/(search|lookup)(\?|$)/i.test(res.url()), {
        timeout: config.timeouts.expect,
      })
      .catch(() => null);
    await lookupInput.fill(name);
    await searchReturned;
    const namedOption = optionList.filter({
      hasText: new RegExp(`^\\s*${this.escapeRegExp(name)}\\s*$`),
    });
    await expect(
      namedOption,
      `Lookup: "${name}" should NOT be selectable (expected inactive/excluded)`
    ).toBeHidden({ timeout: config.timeouts.expect });
    logger.success(`Lookup: confirmed "${name}" is not selectable, as expected`);
  }

  async getLoggedInUserName(role: 'admin' | 'restricted' = 'restricted'): Promise<string> {
    try {
      const namesFile = path.join(
        __dirname,
        '../auth/storageStates',
        process.env.ENV || 'qa',
        'userNames.json'
      );
      if (fs.existsSync(namesFile)) {
        const names = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
        if (names[role]) {
          return names[role];
        }
      }
    } catch (_e) {
      // fall through to DOM fallback
    }
    // DOM fallback
    await this.page.locator('.user-profile-dropdown').click();
    const nameLocator = this.page.locator('.user-info .user-name').first();
    await nameLocator.waitFor({ state: 'visible', timeout: 5000 });
    const name = await nameLocator.innerText();
    await this.page.keyboard.press('Escape');
    return name.trim();
  }
}
