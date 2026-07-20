import { config } from '../../config/config';
import { Page, Locator, Response, expect, test } from '@playwright/test';
import { logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import {
  isSignInUrl,
  tryRecoverSessionForPage,
  isPageRegisteredForRecovery,
  armSessionExpirySignal,
} from '../auth/authManager';
import { safeWaitForURL } from '../utils/navigation';

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
    if (isPageRegisteredForRecovery(this.page) && isSignInUrl(this.page.url())) {
      logger.warn(
        `Navigation to "${url}" landed on a signIn/login page — attempting one-time session recovery`
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
      if (!isPageRegisteredForRecovery(this.page) || !isSignInUrl(this.page.url())) {
        throw error;
      }
      logger.warn(
        `"${description}" failed while on a signIn/login page — attempting one-time session recovery`
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
      if (!isPageRegisteredForRecovery(this.page) || !isSignInUrl(this.page.url())) {
        throw error;
      }
      logger.warn(
        `Filling "${description}" failed while on a signIn/login page — attempting one-time session recovery`
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

  async waitForVisible(locator: Locator, timeout = 30000): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
  }

  async waitForHidden(locator: Locator, timeout = 30000): Promise<void> {
    await locator.waitFor({ state: 'hidden', timeout });
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
    await safeWaitForURL(this.page, urlPattern, timeout);
  }

  // ─── Assertion Helpers ────────────────────────────────────

  async assertVisible(locator: Locator, description = 'element', timeout = 30000): Promise<void> {
    logger.info(`Asserting visible: ${description}`);
    await expect(locator).toBeVisible({ timeout });
  }

  async assertText(locator: Locator, expectedText: string): Promise<void> {
    logger.info(`Asserting text: ${expectedText}`);
    await expect(locator).toHaveText(expectedText);
  }

  async assertUrl(expectedUrl: string | RegExp): Promise<void> {
    logger.info(`Asserting URL: ${expectedUrl}`);
    await expect(this.page).toHaveURL(expectedUrl);
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
      .evaluateAll((els: any[]) => els.map((el) => el.name || el.id || 'unknown'));

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
    await expect(
      toast.first(),
      `Expected an error toast containing "${expectedMessageSubstring}" in ${context}, but it never appeared`
    ).toBeVisible({ timeout: config.timeouts.expect });
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

  private customFieldInputLocator(fieldName: string): Locator {
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
    const suffix = `_input_customFieldValues.cf${fieldName}`;
    return this.page.locator(`input[id$="${suffix}"], textarea[id$="${suffix}"]`);
  }

  private async isCustomFieldPresent(fieldName: string): Promise<boolean> {
    return (await this.customFieldInputLocator(fieldName).count()) > 0;
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
    moduleName: string
  ): Promise<void> {
    const presence = await Promise.all(fieldNames.map((name) => this.isCustomFieldPresent(name)));
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
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'fill');
      return;
    }
    await this.fill(this.customFieldInputLocator(fieldName), value, `custom field: ${description}`);
  }

  async setCheckboxCustomField(
    fieldName: string,
    checked: boolean,
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'checkbox toggle');
      return;
    }
    const checkbox = this.customFieldInputLocator(fieldName);
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
    description = fieldName
  ): Promise<string | null> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'picklist selection');
      return null;
    }
    const control = this.customFieldInputLocator(fieldName).locator(
      'xpath=ancestor::div[contains(@class,"__control")]'
    );
    return this.selectRandomFromSingleReactSelect(control, `Custom field "${description}"`);
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
    // WHY: bounded — confirmed live (2026-07-08) that an unbounded version of
    // this loop can hang for the entire test timeout if a chip's remove
    // button doesn't detach the chip on click (stale reference/re-render
    // race). A field realistically holds at most the total live option
    // count worth of chips, so that count plus headroom is a safe, generous
    // bound that still fails fast and loudly instead of hanging silently.
    const maxChipsToClear = 50;
    let clearedCount = 0;
    let existingChip = control.locator('.is-invalid__multi-value__remove').first();
    while (
      (await existingChip.isVisible({ timeout: 1000 }).catch(() => false)) &&
      clearedCount < maxChipsToClear
    ) {
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
      await this.page.waitForTimeout(150);
      existingChip = control.locator('.is-invalid__multi-value__remove').first();
      clearedCount++;
    }
    if (clearedCount >= maxChipsToClear) {
      throw new Error(
        `${description}: still had chips to clear after ${maxChipsToClear} removal attempts — a chip's remove button may not be detaching it`
      );
    }
    // WHY: defense in depth — the loop above exits based on isVisible()
    // checks that can theoretically race a re-render; confirm zero chips
    // actually remain rather than only trusting the loop's own exit
    // condition, so an incomplete clear fails loudly here instead of
    // silently producing a wrong total that only surfaces later as a
    // confusing detail-page verification mismatch.
    const remainingChips = await control.locator('.is-invalid__multi-value__remove').count();
    if (remainingChips > 0) {
      throw new Error(
        `${description}: ${remainingChips} chip(s) still present after the clear loop reported done — clearing is unreliable`
      );
    }

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
    const minSelect = Math.min(2, allOptionTexts.length);
    const selectCount =
      minSelect + Math.floor(Math.random() * (allOptionTexts.length - minSelect + 1));
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
  // QuotationsPage.selectDateInPicker() — confirmed live (2026-07-08) that
  // Lead's "Date" custom field uses the identical widget.
  //
  // WHY read-the-calendar instead of guess-a-direction: an earlier version
  // of this method tried "search forward N months, then reset and search
  // backward N months" — this failed live in a case where the target date
  // exactly equaled the field's current value (zero navigation should have
  // been needed) yet the calendar had opened on a month 6 months away in
  // EITHER direction from that value, disproving the assumption that the
  // calendar always starts on the field's current value's month. Guessing
  // a starting position and a search direction is fundamentally the wrong
  // approach when the starting position isn't reliably knowable in advance.
  // CallLogsPage.selectDateInPicker() (proven across 43 passing tests)
  // solves this correctly: read the aria-labels of whatever day cells are
  // ACTUALLY rendered right now, parse their real month/year, and navigate
  // toward the target relative to that — no assumption about the starting
  // point required, because the direction is recomputed from reality on
  // every iteration. Ported here with a fallback identical to CallLogsPage's:
  // if 24 navigations still don't find it, type the date directly into the
  // input as MM/DD/YYYY rather than continuing to click blindly.
  async selectDateCustomField(
    fieldName: string,
    date: Date,
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'date selection');
      return;
    }
    const input = this.customFieldInputLocator(fieldName);
    await this.click(input, `custom field date input: ${description}`);
    const label = this.formatCustomFieldDateLabel(date);
    const dayCell = this.page.locator(`.SingleDatePicker td[aria-label="${label}"]`);
    const forwardButton = this.page.getByLabel('Move forward to switch to the next month.');
    const backwardButton = this.page.getByLabel('Move backward to switch to the previous month.');

    let found = await dayCell.isVisible({ timeout: 1500 }).catch(() => false);
    const targetMonthKey = date.getFullYear() * 12 + date.getMonth();
    let attempts = 0;
    while (!found && attempts < 24) {
      // WHY: confirmed live (2026-07-16 root-cause pass) — react-dates keeps
      // THREE months' worth of `td[aria-label]` cells in the DOM
      // simultaneously (the visible month(s) plus a pre-rendered buffer
      // month for smooth forward/backward transitions), but only the ones
      // actually within the picker's own clipped, visible bounds are real —
      // the buffer month's cells are still real DOM nodes with a valid
      // aria-label, just off-screen. The previous version queried ALL cells
      // with no visibility filtering at all, so minVisibleMonth/
      // maxVisibleMonth were computed from a range up to a full month wider
      // than what was actually clickable — causing the direction decision
      // below to be wrong (or a false "already in range" conclusion) exactly
      // often enough to exhaust all 24 attempts without ever converging,
      // reproduced live as a consistent, slow fallback-to-typing on nearly
      // every custom-field date fill. Filtering to cells whose own bounding
      // rect falls inside the picker container's rect (confirmed live this
      // correctly excludes the buffer month while keeping the genuinely
      // visible one(s)) fixes the root cause instead of retrying around it.
      const visibleMonthKeys: number[] = await this.page.evaluate(() => {
        const container = document.querySelector(
          '[class*="SingleDatePicker_picker"]'
        ) as HTMLElement | null;
        const containerRect = container?.getBoundingClientRect() ?? null;
        return Array.from(document.querySelectorAll('.SingleDatePicker td[aria-label]'))
          .filter((cell) => {
            if (!containerRect) return true;
            const r = cell.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              r.left >= containerRect.left - 5 &&
              r.right <= containerRect.right + 5
            );
          })
          .map((cell) => {
            // WHY: strip status prefixes like "Selected. "/"Not available. "
            // before parsing — otherwise those cells are silently dropped.
            const cellLabel =
              cell.getAttribute('aria-label')?.replace(/^[A-Za-z ]+\.\s*/, '') ?? null;
            const parsed = cellLabel ? new Date(cellLabel) : null;
            return parsed && !isNaN(parsed.getTime())
              ? parsed.getFullYear() * 12 + parsed.getMonth()
              : null;
          })
          .filter((v): v is number => v !== null);
      });
      const backVisible = await backwardButton.isVisible().catch(() => false);
      const forwardVisible = await forwardButton.isVisible().catch(() => false);
      const minVisibleMonth = visibleMonthKeys.length ? Math.min(...visibleMonthKeys) : null;
      const maxVisibleMonth = visibleMonthKeys.length ? Math.max(...visibleMonthKeys) : null;
      const shouldGoBack =
        minVisibleMonth !== null && targetMonthKey < minVisibleMonth
          ? true
          : maxVisibleMonth !== null && targetMonthKey > maxVisibleMonth
            ? false
            : backVisible;
      if (shouldGoBack && backVisible) {
        await backwardButton.click();
      } else if (forwardVisible) {
        await forwardButton.click();
      } else if (backVisible) {
        await backwardButton.click();
      }
      await this.page.waitForTimeout(400);
      found = await dayCell.isVisible({ timeout: 1000 }).catch(() => false);
      attempts++;
    }
    if (!found) {
      logger.warn(
        `Custom field "${description}" (cf${fieldName}): day cell not found after ${attempts} calendar navigations — falling back to typing the date directly`
      );
      await this.page.keyboard.press('Escape');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      const yyyy = date.getFullYear();
      await input.click({ clickCount: 3 });
      await input.fill(`${mm}/${dd}/${yyyy}`);
      await this.page.keyboard.press('Tab');
    } else {
      await dayCell.click();
    }
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
    description = fieldName
  ): Promise<void> {
    if (!(await this.isCustomFieldPresent(fieldName))) {
      this.logCustomFieldSkipped(description, fieldName, 'date-time selection');
      return;
    }
    await this.selectDateCustomField(fieldName, date, description);

    const timeInput = this.page.locator(`[id$="_input_customFieldValues.cf${fieldName}_time"]`);
    await expect(
      timeInput,
      `Custom field "${description}" (cf${fieldName}): time input never became enabled after selecting a date`
    ).toBeEnabled({ timeout: config.timeouts.expect });
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
    await this.page.waitForTimeout(200);
    await columns
      .nth(1)
      .locator('li', { hasText: new RegExp(`^${minuteStr}$`) })
      .click();
    await this.page.waitForTimeout(200);
    await columns
      .nth(2)
      .locator('li', { hasText: new RegExp(`^${amPm}$`, 'i') })
      .click();
    await this.page.waitForTimeout(200);
    await this.page.keyboard.press('Escape');

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
    const valueLocator = this.page.locator(`[id="${containerId}"] .title`);
    await expect(
      valueLocator,
      `Expected "${description}" (container #${containerId}) to show "${expectedValue}" on the detail page, but it never appeared`
    ).toContainText(expectedValue, { timeout: config.timeouts.expect });
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
    const container = this.page.locator(`[id="${containerId}"] .with-details-multi-value`);
    const items = container.locator('li');
    await expect(
      items.first(),
      `"${description}" (container #${containerId}): expected at least one rendered value on the detail page, but none appeared`
    ).toBeVisible({ timeout: config.timeouts.expect });

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
    await expect(
      error.first(),
      `Expected validation error "${expectedMessage}" for custom field "${description}" (cf${fieldName}), but it never appeared`
    ).toBeVisible({ timeout: config.timeouts.expect });
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
