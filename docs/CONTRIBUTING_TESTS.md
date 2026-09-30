# Contributing Tests — Checklists

This is a task-shaped companion to `CLAUDE.md`'s 25 Standing Rules and README.md's
[§10 Contributing / Adding a New Module](../README.md#contributing--adding-a-new-module) —
it doesn't repeat what those already say, it gives three concrete checklists to run
through depending on what you're doing. Every item below cites the real file that
enforces or demonstrates it — if a citation looks wrong, the file has moved or changed
since this was written; trust the file, not this doc (`CLAUDE.md` rule 12).

Read this **before** adding or changing anything under `tests/` or `src/modules/`.

---

## A. Adding or changing tests in an EXISTING module

1. **Tag every test.** `@smoke` (navigation/happy-path only), `@regression` (full
   functional + RBAC), `@prodSafe` (read-only, safe against real production data).
   **A test that creates, edits, or deletes data is never `@prodSafe`** — `prod.yml`
   runs unsharded against the real production app; see `.github/workflows/prod.yml`'s
   own `@prodSafe`-only scope. Check `README.md`'s [§8 Test Tags](../README.md#test-tags)
   for the full definitions.
2. **Import `test`/`expect` from `src/fixtures/index.ts`, never `@playwright/test`
   directly** — the one deliberate exception is `tests/ui/dashboard/login.spec.ts`,
   which tests the login UI itself and must not depend on the auth machinery it's
   testing (see that file's own header comment). If you're adding a test to a
   shared-config-suite lock file (checklist C below), you'll import a THIRD `test`
   variant (the lock-wrapped one) instead — see C.2.
3. **Use factories, never hardcoded test data.** `src/data/factories/<module>Factory.ts`'s
   `generateXxxData()` for a restricted user's own data, `generateAdminXxxData()`
   (`ADM<timestamp>` prefix) for admin-only data, `generateSharedXxxData()`
   (`SHR<timestamp>` prefix) for data the admin creates specifically to share — see
   `.claude/architecture.md`'s "Test Data Factories" section for why the prefix+timestamp
   convention exists (a plain Faker name isn't enough on this codebase's never-cleaned
   QA/staging datasets).
4. **Condition-based waits only, never `waitForTimeout()`.** Enforced today by
   `scripts/hooks/pre-commit` (blocks any staged `+.*waitForTimeout(` line) and
   `scripts/hooks/pre-push` — see CLAUDE.md rule 2. If E2 below ships, this same check
   also runs pre-flight via `npm run check:conventions`.
5. **Wrap app-navigation/list-readiness calls in the right recovery combinator.** This
   codebase layers three, not one — pick the one(s) that actually apply:
   - `withSessionExpiryRecovery()` (CLAUDE.md rule 3) — mandatory on any RAW
     `expect(...).toBeVisible/toHaveText/toHaveURL` you write directly in a module file
     that isn't already wrapped by an existing `BasePage` helper.
   - `withRateLimitRecovery()` (`src/core/BasePage.ts` — see e.g. `clickDetailPageTab()`
     at line ~560 and `waitForEntityListPage()`'s `assertTableVisible` closure at line
     ~971 for two real, currently-shipped examples) — the app's own real, live HTTP-429
     "Whoa! Too many requests at once!" page can replace ANY screen mid-test under real
     concurrent CI load; this is not formFields-specific, it's a repo-wide risk. See
     `docs/design/429-recovery-central.md` for the current uncovered-call-site history
     and the proposed (not yet implemented) centralization design.
   - `armResponseWaitWithRecovery()` (`src/core/BasePage.ts`) — for arming a
     `waitForResponse()` predicate before a triggering click, with the identical
     session-expiry-aware recovery baked in. See `DealsPage.clickAddDeal()` for a real
     example (arms a wait for `/v1/pipelines/lookup` before the Add Deal button click).
   Compose `withRateLimitRecovery(() => withSessionExpiryRecovery(() => ...))` when both
   apply to the same raw assertion — nested with rate-limit OUTER — see
   `FormFieldsConfigPage.open()` for the established pattern.
6. **Before/after `--list` count check.** Any change that could plausibly add, remove,
   or duplicate a test (a new `describe` block, a refactor that splits/merges files, a
   fixture change) — run `npx playwright test --project=chromium --list` before AND
   after your change and diff the total. This is how every structural change in this
   codebase's own history has been verified (see `.claude/known-issues.md`'s repeated
   "confirmed via real `--list` runs, not assumed" pattern throughout). If E3 below
   ships, `npm run check:test-counts` automates the "after" half of this against a
   committed baseline.
7. **Run `locator-reviewer` on any new/changed locator.** Automatic: `.claude/settings.json`'s
   `PostToolUse` hook fires `scripts/hooks/post-file-edit-locator-reminder.sh` on every
   `Write`/`Edit` to a Page Object or spec file — follow its reminder. Manually invoke it
   for anything the hook might miss (e.g. a locator string built inside a test file
   itself, which shouldn't exist per rule below, but if you find one, that's the actual
   bug to fix, not a reason to skip review).
8. **Never put a locator in a test file** — all locators live in the page object
   (`src/modules/<module>/<Module>Page.ts`). If a test needs to assert on something the
   page object doesn't yet expose, add a method to the page object first.
9. **`npm run test:<module> -- <args>` gotcha** (`.claude/known-issues.md`'s Products &
   Services "Consolidated open items", #21): passthrough args silently attach to the
   LAST command in the `&&`-chained script (`... && npm run notify`), not the first. Use
   `npx playwright test <paths> <flags>` directly instead when you need extra flags.

---

## B. Adding a NEW module

Do everything in README.md's [§10](../README.md#contributing--adding-a-new-module)
checklist (factory → page object → UI tests → RBAC tests → npm script), plus the
following, which that section doesn't cover:

1. **Factory field names must match the real API field, not the UI label.**
   `.claude/reference-patterns.md` §19 documents a real, costly incident (Reports'
   "Report Type" label vs. its real `category` field, and vice versa for "Entity Type" vs.
   `reportType`) — confirm the real field/API name via live DOM inspection (`name`/`id`
   attribute) before naming a factory's TypeScript property, never assume the label and
   the field name match.
2. **Page object: the fixed 10-section order**, extending `BasePage` — `retryConfig` →
   locators → constructor → private helpers → navigation → form actions → search & open
   → edit actions → assertions → workflow wrappers. See `.claude/architecture.md`'s "Page
   Object Structure" section for why this fixed order exists (so any maintainer can jump
   into an unfamiliar page object already knowing where to look). Locators are always
   lazily-evaluated arrow functions (`private readonly foo = (): Locator => ...`), never
   captured eagerly at construction time.
3. **UI/RBAC spec naming that `.github/scripts/detect-tests.sh` auto-detects.** Read that
   script directly before naming your files — it is the actual, live source of truth, not
   a doc describing it. As of this writing it recognizes:
   - `tests/ui/<module>/*.spec.ts` (module = the directory name)
   - `tests/rbac/<module>.rbac.spec.ts` (flat file, module = filename minus
     `.rbac.spec.ts`) **or** `tests/rbac/<module>/*.rbac.spec.ts` (subfolder, module = the
     directory name — added 2026-09-28 specifically so RBAC files can be grouped the same
     way UI files already are; check the subfolder branch is checked BEFORE the flat-file
     branch in the script, since the flat-file regex would otherwise partially match a
     subfolder path too)
   - A factory at `src/data/factories/<Entity>Factory.ts` is mapped through a
     singular→plural table (`company`→`companies`, `contact`→`contacts`, `lead`→`leads`,
     `deal`→`deals`, `meeting`→`meetings`, `task`→`tasks`, `quotation`→`quotations`,
     `productsandservices`→ preserved camelCase, generic `${raw}s` fallback otherwise) —
     if your new module's name doesn't pluralize with a trailing `s`, this table needs a
     new entry or `detect-tests.sh` will silently pick the wrong directory.
   - `src/modules/**/*.ts` and `src/data/factories/**/*.ts` changes are ALSO checked
     against every `formFields` spec file's own import text (a live `grep -rl`, not a
     hardcoded entity list) — if your new module ever becomes a Form Field Limit
     consumer, this already covers it with zero further script changes.
4. **Module naming as `ReportParser.ts`/the notification pipeline expects.**
   `src/notifications/ReportParser.ts`'s `deriveModuleFromFile()` derives a module's
   display name from its directory, then **capitalizes only the first letter**
   (`rawName.charAt(0).toUpperCase() + rawName.slice(1)`) — so every module name in
   Module Analytics, the "CI Job Stats"/"Job Time Overlaps" sections, and anywhere else
   in the notification email is `Leads`/`Quotations`-style (capital first letter, rest
   unchanged), never all-lowercase or all-caps. This tripped up this exact repo's own
   verification tooling once already (a synthetic-data test written assuming lowercase
   module names failed until the capitalization was accounted for) — don't assume
   lowercase when writing anything that reads `ParsedReport.modules[]`.
   Separately, and more substantially: if your new module ships a **Form-Field-Limit-style
   feature** whose spec filenames use the entity's SINGULAR name
   (`leadFieldLimits.spec.ts`) while the module's own base directory uses the PLURAL form
   (`tests/ui/leads/`), you need an entry in `deriveModuleFromFile()`'s
   `SINGULAR_TO_CANONICAL_MODULE_NAME` map (see commit `253afc3` for the original
   incident this fixed — five real entities needed exactly this, Products & Services did
   not, because its filename already matches its directory name exactly). Skipping this
   makes Module Analytics show the feature as an entirely separate, unrelated-looking
   module instead of grouping under the real entity.
5. **`package.json` script** — `test:<module>`, following the existing pattern (see
   README §10 point 5).
6. **Docs** — a line in this repo's Project Overview / module-count table (see
   `README.md`), and a fresh module count from a real `--list` run, not an estimate.
7. **`known-issues.md` entry** — even a placeholder "built following the standard module
   pattern, no deviations" line, so a future reader knows this module was deliberately
   checked, not just forgotten. If your module IS structurally different from every
   other module (like Products & Services — see `.claude/architecture.md`'s dedicated
   "Products & Services — Deliberate Deviations" section), document every deviation
   there explicitly, the same way that entry does — a future session needs to know these
   are deliberate, not bugs to "fix" back to the standard shape.

---

## C. Adding a feature that mutates SHARED, ACCOUNT-WIDE app config

(Like Form Field Limits — a global, admin-configurable setting affecting every test that
touches the same field, not per-record test data.) This is the highest-blast-radius
category in this codebase, with a real, documented incident history
(`.claude/known-issues.md`'s "A cross-process lock only protects workers on the SAME
filesystem" entry) behind every rule below — read that whole entry before starting, not
just this summary.

1. **A dedicated custom field per consumer, not a shared one.** Commit `ab06f5e`
   ("use dedicated custom fields to eliminate cross-shard field-config collisions") ends
   this entire class of collision at its root — if two tests (or two ENTITIES) would
   otherwise fight over the same shared field, give each its own instead. This is
   cheaper and more robust than any locking scheme layered on top of a shared field —
   locking only protects processes on the SAME filesystem (see point 3 below); a
   dedicated field needs no coordination at all.
2. **The cross-process lock (`formFieldLockFactory.ts` — the generalized, parameterized
   successor to Lead's original hand-written `formFieldsTestLock.ts`, which is
   deliberately left untouched, not retrofitted) is acquired ONLY by tests that actually
   mutate the shared config** — never by read-only tests. Classify every test in your
   feature as one or the other, per-test, not per-file:
   - **Mutating** (needs the lock): any test that calls `configureFieldLimit()`,
     `configureFieldRegex()`, `clearFieldConfiguration()`, or any other method that
     writes to the account-wide field config. These use the entity's own lock-wrapped
     `test` object (e.g. `companyTest` in `companyFieldLimits.spec.ts` — imported from
     that module's own `<entity>FormFieldLock.ts`, itself built on
     `createFormFieldLock()`).
   - **Read-only / lock-free** (never needs the lock): a test that only READS the
     current config state without changing it (list-visible checks, "Add Field" button
     absence, row-not-clickable checks — see `.claude/reference-patterns.md` §25 for why
     these specifically never navigate to the individual field edit URL either). These
     use the plain `test as baseTest` import from `src/fixtures/index.ts` directly — see
     any formFields UI file's own `baseTest.describe('Navigation', ...)` block, or any
     RBAC file's own `baseTest.describe('...(read-only, lock-free)', ...)` block, for
     the real, live pattern.
   Get this classification wrong in either direction and you either (a) needlessly
   serialize a test that didn't need to be, or (b) reintroduce the exact race this whole
   mechanism exists to prevent.
3. **A cross-process file lock only protects workers on the SAME filesystem.** This is
   the single most important lesson from this feature's own incident history — GitHub
   Actions sharding runs each shard on an independent, ephemeral VM with its own
   separate disk. The lock in point 2 above is necessary but NOT sufficient by itself
   once sharding is involved — you also need **(4) UI+RBAC co-located in one shard**
   below, or an equivalent structural guarantee, or the lock's own correctness
   guarantee silently stops applying the moment two of your feature's files land on
   different shard machines.
4. **UI+RBAC co-located in one shard.** Commit `6ec6e3f` carves formFields tests out of
   the normal count-based `--shard=N/M` splitting entirely — every sharded workflow
   (`qa.yml`/`stage.yml`/`main.yml`/`sandbox.yml`) runs a separate, FIXED matrix job
   (`run-formfields-tests`) with one shard per entity, each running that entity's UI+RBAC
   file pair together explicitly, never through Playwright's own splitter. If your
   feature is the same shape (shared config, multiple files that must never be
   separated), you need the same kind of fixed-pairing carve-out, not a hope that
   Playwright's own chunking happens to keep them together (see `.claude/known-issues.md`'s
   2026-09-09 "Sharding order-dependency audit" for why `fullyParallel: true` gives zero
   file-boundary guarantee on its own — only `test.describe.configure({mode:'serial'})`
   keeps a BLOCK atomic within one shard, and that's still not the same as guaranteeing
   two SEPARATE FILES land on the same shard).
5. **`scripts/plan-shards.ts`'s exclusion, and the fixed formFields workflow matrix.**
   The "rest of suite" dynamic shard planner (see that file's own header comment)
   hardcodes an exclusion for `ui/formFields/`/`rbac/formFields/` — deliberately NOT a
   CLI flag, so no future workflow edit can accidentally let those files leak back into
   count-based bin-packing. If your shared-config feature needs the same protection, add
   its own path prefix(es) to that same hardcoded list (or, if E1 has shipped by the time
   you read this, to `config/sharedConfigSuites.json` instead — check which exists).
6. **`globalSetup.ts`'s transient-retry pattern** (commit `0195259`) — if your feature's
   own `globalSetup` work (fixture creation, reference-data loading) makes real HTTP
   calls, wrap them the same way `ensureProductFixtures()`'s calls are wrapped: a bounded
   retry on genuine transient responses (HTTP 429/5xx) only, never masking a real 4xx.
   Real, evidence-based motivation: raising this feature's own CI job count (via point 4
   above) measurably raised concurrent `globalSetup` login/fixture-creation pressure and
   caused a real, reproduced 429 on the straggler job — see `.claude/known-issues.md`'s
   dated 2026-09-29 entry for the full incident.
7. **`test.describe.configure({ mode: 'serial' })` — when it's used, and its real cost.**
   Every formFields UI file's field-mutating sub-blocks (Text/Number/Paragraph limits,
   Regex format rules, Cache behavior, Cleanup) and every RBAC file's single top-level
   block use `.serial` — genuine defense-in-depth (same-shard interleaving protection),
   layered ON TOP of point 4's structural cross-shard guarantee, not a replacement for
   it. The real cost: Playwright's serial mode retries the WHOLE block from the top on
   ANY single test's failure — including tests that already passed on attempt 1, rerun
   unconditionally (see `.claude/known-issues.md`'s "Retry-count discrepancy" entry for a
   real, confirmed instance of exactly this inflating a run's reported retry count far
   beyond its actual failure count). Scope `.serial` to the smallest block that
   genuinely needs atomicity (per-field-type sub-block, not the whole file) to limit
   this cost's blast radius — this was a deliberate, explicit fix applied to this
   feature's own UI files (see `known-issues.md`'s "removed serial-mode skip cascade" entry).

---

## Never do

- **Edit a git hook to bypass a block it's designed to enforce.** If a hook is wrong,
  fix the hook (with human review — see below), don't work around it.
- **Change `.github/workflows/*`, any `Jenkinsfile*`, or `playwright.config.ts` without
  human review.** These affect every branch's CI, not just your own change — every
  change to these in this codebase's own history has been prepared as a diff for human
  review, never applied unilaterally (see `.claude/known-issues.md`'s repeated
  "NEEDS HUMAN REVIEW"-equivalent framing, e.g. the sharding/carve-out work).
- **Raise a timeout to make a flaky test pass instead of root-causing it.** CLAUDE.md
  rule 10: if reproducible, root-cause it with real evidence; if not reproducible, do a
  real code review for plausible failure modes and apply a defensive hardening fix
  clearly labeled as such — never silently bump a number and move on.
- **Use `waitForTimeout()` anywhere**, ever — see `scripts/hooks/pre-commit`'s hard
  block.
- **Run any git operation** (add, commit, push, merge, stash, checkout, reset, restore,
  or `gh pr merge`) as an automated agent. The human operator does all git, always —
  CLAUDE.md rule 13.
