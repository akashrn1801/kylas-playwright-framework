# Contributing Tests

> **Purpose:** Task-shaped checklists for changing this suite — existing module, new module, shared account-wide config feature — plus the touch / don't-touch list, pre-commit checklist, Definition of Done and the docs size policy.
> **Read when:** before adding or changing anything under `tests/` or `src/modules/`, before closing out any task, and before adding or growing a doc.
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Rule numbers (R1–R25) refer to the 25 standing rules in [CLAUDE.md](../CLAUDE.md); mechanics for each pattern are in [PATTERNS.md](./PATTERNS.md). Every citation below names a real file — if it looks wrong the file moved; trust the file (rule 12).

---

## A. Adding or changing tests in an EXISTING module

1. **Tag every test**: `@smoke` (navigation/happy path), `@regression` (full functional + RBAC), `@prodSafe` (read-only). A test that creates, edits or deletes data is never `@prodSafe` — `prod.yml`/`Jenkinsfile.prod` run against real production (see [CI_PIPELINES.md](./CI_PIPELINES.md)). `npm run check:conventions` enforces the tag.
2. **Import `test`/`expect` from `src/fixtures/index.ts`**, never `@playwright/test` — sole exception `tests/ui/dashboard/login.spec.ts`. Shared-config-suite files import the entity's lock-wrapped `test` instead (§C.2).
3. **Factories, not literals**: `generateXxxData()` (restricted user's own), `generateAdminXxxData()` (`ADM<ts>`), `generateSharedXxxData()` (`SHR<ts>`) in `src/data/factories/`. The prefix exists because QA/staging data is never cleaned, so only a distinguishing prefix makes an RBAC negative assertion trustworthy (R5).
4. **No `waitForTimeout()`** — blocked by `scripts/hooks/pre-commit` (new lines only) and `pre-push`. Wait on a condition (R2).
5. **Pick the right recovery combinator** (all in `src/core/BasePage.ts`):
   - `withSessionExpiryRecovery()` — any raw `expect(...).toBeVisible/toHaveText/toHaveURL` you write in a module file (R3).
   - `withRateLimitRecovery()` — the app's "Whoa! Too many requests at once!" page and the generic "Something is broken here" error-boundary page can replace any screen under CI load; see [ADR 0008](./adr/0008-error-page-recovery.md) and `clickDetailPageTab()` / `waitForEntityListPage()` for shipped examples.
   - `armResponseWaitWithRecovery()` — arm a `waitForResponse()` *before* the triggering click (R16); example `DealsPage.clickAddDeal()`.
   - When two apply, nest rate-limit OUTER: `withRateLimitRecovery(() => withSessionExpiryRecovery(...))` (`FormFieldsConfigPage.open()`).
6. **Before/after `--list` diff.** Any change that could add/remove/duplicate a test: `npx playwright test --project=chromium --list` before and after. `npm run check:test-counts` compares against `config/expected-test-counts.json`; after a deliberate change run `npm run generate:test-counts` and commit the baseline.
7. **Locators only in page objects** (`src/modules/<module>/<Module>Page.ts`), keyed to internal names (R6). Run `locator-reviewer` on new locators — the `PostToolUse` hook (`scripts/hooks/post-file-edit-locator-reminder.sh`) reminds you.
8. **Test labels**: per-module prefix + next free number — grep the file *and its UI/RBAC sibling* before choosing ([PATTERNS.md](./PATTERNS.md) test-label rule).
9. **Extra Playwright flags**: call `npx playwright test <paths> <flags>` directly; `npm run test:<module> -- <flags>` appends the flags to the trailing `npm run notify` instead.
10. **Never trust one green run** (R8) — 3–5 isolated runs for a fix; for load-dependent suspects, remember R21.

---

## B. Adding a NEW module

Start with `npm run new:module` (`scripts/new-module.ts` scaffolds factory + page object + spec skeletons and prints its own manual checklist), then:

1. **Factory** — `src/data/factories/<module>Factory.ts` with the three generators. **Name TypeScript properties after the real API field** (inspect the DOM `name`/`id`), not the on-screen label (a Reports incident swapped two labels — [PATTERNS.md](./PATTERNS.md)).
2. **Page object** — extends `BasePage`, fixed 10-section order, locators as lazy arrow functions ([ARCHITECTURE.md](./ARCHITECTURE.md)).
3. **Specs** — `tests/ui/<module>/<module>.spec.ts` and `tests/rbac/<module>.rbac.spec.ts` (or a `tests/rbac/<module>/` folder). Read `.github/scripts/detect-tests.sh` before naming files: it is the live source of truth for what sandbox CI auto-selects, including a singular→plural table for `src/data/factories/<Entity>Factory.ts`.
4. **Module display name** — `deriveModuleFromFile()` in `src/notifications/ReportParser.ts` capitalizes only the first letter of the directory name. If spec filenames use the singular while the directory is plural (Form-Field-Limit style), add a `SINGULAR_TO_CANONICAL_MODULE_NAME` entry or Module Analytics shows a phantom module.
5. **`package.json`** — add `test:<module>` following the existing pattern.
6. **Docs** — no hand edits to counts: run `npm run generate:test-counts` then `npm run docs:refresh`. Add a topic section in `docs/known-issues/` only if the module has a real incident; if it is structurally different from every other module (like Products & Services), record every deliberate deviation in [known-issues/products-and-services.md](./known-issues/products-and-services.md)-style form so nobody "normalizes" it back.
7. `npm run check:conventions`, `npm run check:test-counts`, `npx tsc --noEmit`, `npm run lint` all clean.

---

## C. Adding a feature that mutates SHARED, ACCOUNT-WIDE app config

(Like Form Field Limits — one global setting that every test touching that field sees.) Highest blast radius in this repo; read [known-issues/sharding-and-locks.md](./known-issues/sharding-and-locks.md) first.

1. **A dedicated field per consumer** ([ADR 0001](./adr/0001-dedicated-custom-fields.md)) — removing the shared resource beats any locking scheme layered over it.
2. **Cross-process lock, mutating tests only.** `src/` lock factory `tests/ui/formFields/formFieldLockFactory.ts` (heartbeat staleness + FIFO fairness — [ADR 0005](./adr/0005-heartbeat-based-lock.md)). Classify **per test**: anything calling `configureFieldLimit()` / `configureFieldRegex()` / `clearFieldConfiguration()` or otherwise writing the config uses the entity's lock-wrapped `test`; read-only tests use plain `baseTest` from `src/fixtures/index.ts`. Wrong either way = needless serialization or the original race.
3. **A file lock protects only one filesystem.** Sharded CI runs shards on separate VMs, so the lock alone is not enough → **UI+RBAC co-located** by a fixed matrix job, never by Playwright's count-based `--shard` ([ADR 0002](./adr/0002-formfields-carve-out-from-sharding.md)). Register the suite in `config/sharedConfigSuites.json` (read by `scripts/plan-shards.ts`) and keep the workflows' `run-formfields-tests` matrix in step — `npm run check:formfields-matrix-sync` verifies.
4. **`globalSetup` HTTP calls** you add need a bounded transient retry (429/5xx only, never masking a real 4xx) — `withTransientRetry()` in `src/auth/globalSetup.ts`.
5. **`.serial` scope** — smallest block needing atomicity (per field-type / category), never a whole file: serial mode re-runs the entire block when any test fails ([ADR 0006](./adr/0006-serial-sub-blocks.md)).
6. **Fill only what the assertion needs** — the `{minimal, onlyCustomField}` fill options; reject-path tests never go through `createXxx()` ([PATTERNS.md](./PATTERNS.md)).
7. **Sequencing** — formFields shards run after the core shards ([ADR 0007](./adr/0007-sequence-formfields-after-core.md)); a new shared-config feature inherits that only if it joins the same job.

---

## What to touch / what NOT to touch

| Touch freely (in scope of a test task) | Touch only with an explicit human review (flag it in the PR) | Never |
|---|---|---|
| `tests/**`, `src/modules/**`, `src/data/factories/**`, the new module's `package.json` script, docs under `docs/` | `.github/workflows/*`, any `Jenkinsfile*`, `playwright.config.ts`, `config/sharedConfigSuites.json`, `scripts/hooks/*`, shared `BasePage.ts` / `src/fixtures/index.ts` / `src/auth/*` (ripple-check every consumer first, R9) | edit a hook to bypass its block · raise a timeout instead of root-causing (R10) · hand-type any figure a script generates · add a 6th session-recovery mechanism (extend the combinators) · `page.route()` + `route.fetch()` interception (breaks saves against this backend) · Playwright `dependencies` projects for "run after everything" (silently bypass `--grep`) · import a large doc into `CLAUDE.md` · run git write operations as an agent (R13) |

Also not yours to widen without the live-evidence bar: `errorFilters.ts`'s "known background noise" list (it can bury a real outage) and the transient-network allowlist in `BasePage.fillSearchAndWaitForOptions()`.

---

## Pre-commit checklist

Run in this order; all must be clean before you ask for a commit.

1. `npx tsc --noEmit` · `npm run lint` · `npm run check:conventions`
2. `npm run check:test-counts` (regenerate with `npm run generate:test-counts` after a deliberate suite change)
3. The specific tests you touched, isolated, 3× (R8); `--list` before/after for structural changes
4. Definition of Done below, ending with `npm run check:docs`

**Proposed hook change (not applied — your decision).** `scripts/hooks/pre-commit` exits early when no `.ts` file is staged, so a docs-only commit never reaches any check. To run the (offline, fast) docs guard whenever docs or the scripts that generate them are staged, insert this *before* the existing `STAGED_FILES=...` line, then re-install the hook into `.git/hooks/`:

```diff
+# Docs guard: budgets, headers, dead links, generated figures (offline tier, ~seconds)
+if git diff --cached --name-only | grep -qE '^(docs/|CLAUDE\.md|README\.md|CHANGELOG\.md|APPLICATION_BUGS\.md|\.claude/AGENT_DELEGATION_GUIDE\.md|config/expected-test-counts\.json|\.github/workflows/)'; then
+    echo "📚 Checking docs..."
+    npm run check:docs --silent || { echo "❌ COMMIT BLOCKED: check:docs failed (run: npm run docs:refresh, then npm run check:docs)"; exit 1; }
+fi
+
 echo "🔍 Checking for waitForTimeout() anti-pattern..."
```

Trade-offs: adds a few seconds on doc-touching commits only; the `--live` tier (extra `--list` runs) is deliberately left to PR time. A CI step running `npm run check:docs -- --live` is the other option.

---

## Definition of Done

A task is not done until all six are true (also in [CLAUDE.md](../CLAUDE.md) and `.github/pull_request_template.md`):

1. `npm run docs:refresh` — regenerates every `<!-- GEN:* -->` block (test counts, module table, tag counts, shard plan, CI workflow matrix) from the real repo. Never type these figures. (Run `npm run generate:test-counts` first if the suite changed.)
2. One line in [CHANGELOG.md](../CHANGELOG.md), newest first.
3. Issue found → [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md). Issue closed → ≤15-line summary into its `docs/known-issues/<topic>.md`, delete the active entry.
4. Design decision made or reversed → ADR in `docs/adr/` (new number; supersede, never rewrite history).
5. `Last verified: <YYYY-MM-DD> @ <short commit>` updated on every doc you touched.
6. `npm run check:docs` passes (`-- --live` before a PR).

## Size policy

Why: Claude Code warns when instruction files are large and a fresh session otherwise burns its budget reading history. Only `CLAUDE.md` (≈10k chars) loads automatically; everything else is read on demand, one topic at a time.

| Rule | Value |
|---|---|
| Per-doc budget | declared in its header (`Size budget`); ~40k max for anything an agent may load, ~30k for topic files; **60k hard cap, enforced** |
| Warning | `check:docs` warns at ≥70% of budget, fails over budget |
| Active issues file | open items only; an entry is ≤8 lines |
| Generated figures | never hand-typed; `GEN` blocks only |

**Incident entry template** (topic files; max ~900 chars; **no log excerpts, timelines, run IDs or ruled-out theories — they live in git history**):

```markdown
### <short title> — <date>
- **Symptom:** one or two sentences; exact short error text in backticks
- **Root cause:** the confirmed mechanism and the durable lesson
- **Fix:** what changed, `Class.method()` named in backticks
- **Revert:** how to undo (file/function), or "n/a — detection/doc only"
- **Commit:** `<short hash>`
```

(Backticked error strings ≥25 chars and `Class.method()` names are matched by `src/notifications/KnownIssuesIndex.ts` to link CI failures to history — keep them.)

**Rotation — when a topic file reaches 70% of its budget** (≈21k of 30k; `check:docs` warns): (1) pick the oldest ~half of its incidents by date; (2) move them verbatim to `docs/known-issues/<topic>-<YYYY>-<MM>.md` (the month range of what moved — e.g. a September-2026 slice of `sharding-and-locks`) <!-- ref-ok -->, with its own header (new `Last verified`, same budget); (3) leave a one-line "Older entries: [file]" pointer at the top of the parent; (4) add the new file to `docs/known-issues/README.md`; (5) run `npm run check:docs`. Entries are compressed over time, never deleted for space alone; deleting one needs its replacement lesson recorded in the topic's top summary or [PATTERNS.md](./PATTERNS.md).

## Never do

- Edit a git hook to bypass a block it enforces — fix the hook, with human review.
- Change workflows, Jenkinsfiles or `playwright.config.ts` without flagging it for review (every such change here was prepared as a diff for a human).
- Raise a timeout to make a flaky test pass (R10).
- Run any git write operation as an automated agent (R13).
