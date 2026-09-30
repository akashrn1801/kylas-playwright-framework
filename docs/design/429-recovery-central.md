# Design proposal: centralizing 429 (rate-limit) recovery

**Status: DESIGN ONLY — not implemented.** This changes core behavior for the whole
suite (potentially every `BasePage`-derived navigation/list-readiness call, not just
formFields) and needs explicit approval before any code changes. Nothing in this
document has been applied.

## The problem, stated plainly

`withRateLimitRecovery()` (`src/core/BasePage.ts`) exists to catch the real Kylas app's
own "Whoa! Too many requests at once!" HTTP-429 error page — confirmed, via direct
`trace.zip`/screenshot evidence, to intermittently replace ANY screen mid-test under
real concurrent CI load (see `.claude/known-issues.md`'s 2026-09-29 formFields
lock-starvation entry for the original incident, and this session's own 4-item
follow-up fix for three MORE previously-uncovered call sites found the very next CI
run). Every time this has been found so far, it's been found the same way: a real CI
run fails, someone traces the failure to an unwrapped call site, and that ONE site gets
wrapped. There is no reason to believe this is the last one — the app-side 429 behavior
is a property of the BACKEND under load, not of any one page object, so in principle it
can surface at any navigation or list-read anywhere in the suite that this session's
own targeted investigations simply haven't happened to hit yet.

## Every current call site (real file:line, as of commit `1091c4b`)

`withRateLimitRecovery()` direct calls:

| # | File:line | Method | Wraps |
|---|---|---|---|
| 1 | `src/core/BasePage.ts:574` | `clickDetailPageTab()` | a tab-click, used only by formFields specs (confirmed via grep) |
| 2 | `src/core/BasePage.ts:988` | `waitForEntityListPage()`'s `assertTableVisible` closure | shared by Deals/Companies/Contacts/Leads/Tasks/Quotations/Products & Services |
| 3 | `src/modules/formFields/FormFieldsConfigPage.ts:274` | `open()` | the Form Fields list's own tab-active assertion |
| 4 | `src/modules/formFields/FormFieldsConfigPage.ts:315` | `searchField()` | the search-input fill |
| 5 | `src/modules/formFields/FormFieldsConfigPage.ts:361` | `openFieldForEdit()` | the field-row click |
| 6 | `src/modules/formFields/FormFieldsConfigPage.ts:369` | `openFieldForEdit()` | the post-navigation URL assertion |
| 7 | `src/modules/formFields/FormFieldsConfigPage.ts:382` | `openFieldForEdit()` | the Min-Length-visible assertion |
| 8 | `src/modules/productsAndServices/ProductsAndServicesPage.ts:419` | `goToCreateProductForm()` | the create-form-visible assertion |

**A separate, genuinely different mechanism — `armResponseWaitWithRecovery()`
(`src/core/BasePage.ts:123`) — is session-expiry-aware ONLY, not rate-limit-aware.**
Confirmed by reading its own implementation: it races a `waitForResponse()` against a
session-expiry signal (`armSessionExpirySignal()`), with zero 429/rate-limit page
check anywhere in it. It has 10+ real call sites across `DealsPage.ts`,
`ProductsAndServicesPage.ts`, and `BasePage.ts` itself (`waitForEntityDetailPage()` at
`BasePage.ts:873`) — including `DealsPage.clickAddDeal():805`, THIS SESSION'S OWN fix
for the Pipeline-dropdown "No Options" race. **That fix has no rate-limit protection at
all** — if the `/v1/pipelines/lookup` request itself gets 429'd under real concurrent
load, `armResponseWaitWithRecovery()` won't recognize it as anything special; the
promise just times out, `.catch(() => null)` swallows it, and `fillDealForm()`'s own
downstream `pipelineOption.waitFor()` (also unwrapped) is left to fail with no recovery
attempt at all. This is real, concrete evidence that today's per-call-site approach is
already inconsistent in a way nobody chose deliberately — two structurally similar
"wait for a response before proceeding" call sites (`FormFieldsConfigPage.open()` vs.
`DealsPage.clickAddDeal()`) ended up with two different recovery guarantees, purely
because they were fixed by two different investigations for two different original
symptoms.

## Design option A — push `withRateLimitRecovery()` into the shared navigation/list-ready helpers directly

Wrap the rate-limit check INSIDE `BasePage`'s own foundational methods instead of at
each call site:
- `click()` (`BasePage.ts:~351`) — already has session-expiry recovery in its catch
  block; add a rate-limit check there too.
- `fill()` — same.
- `waitForEntityDetailPage()`/`waitForEntityListPage()` — already partially covered
  (item #2 above); make it structural rather than a per-closure choice.
- `armResponseWaitWithRecovery()` itself — add a 429-page check to the SAME race it
  already runs for session expiry, so every one of its 10+ existing call sites gets
  rate-limit protection automatically, with zero changes to any of those call sites.

**Upside:** every current and FUTURE call site of these foundational methods inherits
protection automatically — closes the "next uncovered call site" problem at its root,
matching this codebase's own stated preference (CLAUDE.md rule 1: "build it once,
generically, in BasePage — not copy-pasted per module").

**Downside, the real one to weigh:** `click()`/`fill()` are the single highest-blast-
radius methods in the entire codebase — used by every page object, every module,
thousands of call sites. A change here is a change to the whole suite's behavior
simultaneously, not an incremental, independently-revertible per-site change like every
`withRateLimitRecovery()` addition so far has been. If the added check itself has ANY
bug (a false-positive page-state match, an added round-trip delay, an interaction with
another in-flight recovery), it now affects everything, not one formFields file. This
mirrors exactly the caution this codebase's own `known-issues.md` already documents for
`withSessionExpiryRecovery()`'s own history (5 independent partial-fix attempts before
the final, careful, `click()`-integrated design) — the SAME caution needs to apply
here, not a repeat of an earlier mistake with a different symptom.

## Design option B — a single new combinator, applied opt-in at (still individual, but consolidated) call sites

Keep `withRateLimitRecovery()` as an explicit, opt-in wrapper (as it is today), but
consolidate the SESSION-EXPIRY and RATE-LIMIT checks into one shared combinator
(`withNavigationRecovery()`, say) that both `click()`'s catch block AND
`armResponseWaitWithRecovery()` call into, so a future call site only has to remember
ONE combinator name to reach for, not choose between two (or forget the one that
doesn't apply to their specific case, as `DealsPage.clickAddDeal()`'s own gap above
shows can already happen). Existing explicit `withRateLimitRecovery()`/
`withSessionExpiryRecovery()` call sites are unaffected (still callable
individually) — this is additive, not a replacement.

**Upside:** closes the `armResponseWaitWithRecovery()` gap (the concrete, real gap
found above) without touching `click()`/`fill()`'s own already-hardened, high-blast-
radius logic at all — meaningfully smaller blast radius than Option A.

**Downside:** does NOT close the "next uncovered call site" problem for a genuinely NEW
raw assertion/click written outside any existing helper — still relies on a human
remembering to reach for the combinator, same as today.

## The double-wrapping / double-retry risk, and how to avoid it

Both `withRateLimitRecovery()` and `withSessionExpiryRecovery()` follow the identical
try/catch/detect/recover/retry-ONCE shape (by design — see `withRateLimitRecovery()`'s
own WHY comment: "the shape is deliberately identical... per the standing instruction
to reuse that shape"). Nesting them (`withRateLimitRecovery(() =>
withSessionExpiryRecovery(() => ...))`, the pattern already established in `open()`)
is safe TODAY because each one retries its OWN wrapped `fn()` exactly once on its OWN
detected condition — a 429 recovery-then-retry re-invokes the inner
`withSessionExpiryRecovery(...)` call fresh, which itself gets its own independent
one-shot retry budget if IT then hits session expiry. The real risk if this is
centralized is: if a future combined design collapses these into one function with two
independent internal retry loops that can each ALSO trigger the other's recovery
action, a single failing action could be retried up to 4 times (2×2) instead of the
expected ≤2 — silently multiplying a slow failure's total wall-clock cost, or worse,
retrying an action that has genuine side effects (a create/save) more times than
intended. **Any centralization design must make this bound explicit and testable** —
e.g., a single shared retry-attempt counter passed through both detection branches, or
an explicit maximum-total-attempts parameter — not two independently-unbounded nested
loops that happen to be safe today only because nobody has combined them into one
function yet.

## What evidence from the in-progress CI run (`1091c4b`) should decide the approach

This session's own 4-item fix (commit `1091c4b`) added `withRateLimitRecovery()` to 3
previously-uncovered call sites, found from exactly ONE real CI run's failures. The
run currently in progress for that same commit is the first real test of whether THAT
fix holds. Before choosing between Option A/B (or neither, if the problem turns out to
be rarer than feared):

1. **Does this run complete with zero NEW 429-shaped failures?** If yes, that's
   evidence the specific, already-found call sites were the only reachable ones under
   today's real CI concurrency — weakens the case for urgency, though not for
   eventual root-cause-level fixing.
2. **If it fails again, is the failure a genuinely NEW call site, or a recurrence of
   one of the 8 already listed above (meaning THIS fix itself has a bug)?** A new site
   is direct, concrete evidence FOR centralization (the "keep whack-a-moling
   individual sites" cost is compounding) — go re-read this document and revisit
   Option A vs. B with that new evidence in hand. A recurrence of an already-fixed site
   means investigate why the existing fix didn't hold (a nesting-order bug, a
   detection-pattern miss) before considering this a scope question at all.
3. **How many total 429-shaped failures has this exact mechanism caused across ALL
   real CI runs so far** (this session's original incident + this session's own
   4-item follow-up + whatever this in-progress run shows)? A rising count over
   successive runs (even as individual sites get fixed) is the strongest evidence this
   is a genuine backend-load property that will keep finding new call sites — the
   court case for Option A. A flat or falling count after each individual fix is
   evidence the existing incremental approach is actually keeping pace.

**This document deliberately stops here.** Whichever option is chosen, it should be
implemented as its own reviewed change, not folded into whatever discovers the next
call site.
