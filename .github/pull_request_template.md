<!--
Checkboxes are drawn from docs/CONTRIBUTING_TESTS.md. Only check what is
actually true — an unchecked box is fine if it does not apply (say why in a
comment); never check a box you have not verified.
-->

## What does this PR do?

<!-- One or two sentences. Link an issue/ticket if there is one. -->

## Type of change

- [ ] Test change in an existing module (checklist A)
- [ ] New module (checklist B)
- [ ] Feature that mutates shared, account-wide app config (checklist C)
- [ ] Framework/infrastructure change (CI, scripts, docs)

## Checklist A — existing-module test changes
(skip if not applicable)

- [ ] Every new/changed test carries a real `@tag` (`@smoke`/`@regression`/`@prodSafe`) — never `@prodSafe` on a test that creates/edits/deletes data
- [ ] `test`/`expect` imported from `src/fixtures/index.ts` (not `@playwright/test`, except `login.spec.ts`)
- [ ] Factories used (`generateXxxData()` / `generateAdminXxxData()` / `generateSharedXxxData()`) — no hardcoded data
- [ ] No `waitForTimeout()`; no locator in a test file
- [ ] Raw navigation/list-readiness assertions wrapped in the right combinator (`withSessionExpiryRecovery()` / `withRateLimitRecovery()` / `armResponseWaitWithRecovery()`)
- [ ] `--list` before/after diffed; `npm run check:test-counts` passes (baseline regenerated if the change was deliberate)
- [ ] `locator-reviewer` reviewed any new/changed locator

## Checklist B — new module
(skip if not applicable)

- [ ] Factory property names match the real API field names, not UI labels
- [ ] Page object follows the 10-section order and extends `BasePage`
- [ ] Spec naming matches `.github/scripts/detect-tests.sh`; `deriveModuleFromFile()` yields the expected module name (`SINGULAR_TO_CANONICAL_MODULE_NAME` entry added if needed)
- [ ] `test:<module>` npm script added
- [ ] `npm run check:conventions` and `npm run check:test-counts` pass

## Checklist C — shared, account-wide config feature
(skip if not applicable)

- [ ] Each consumer has a dedicated field/config value
- [ ] Config-mutating tests use the lock-wrapped `test`; read-only tests use plain `baseTest` — classified per test
- [ ] UI+RBAC files are structurally guaranteed to share a shard (fixed matrix and `config/sharedConfigSuites.json`; `npm run check:formfields-matrix-sync` passes)
- [ ] New `globalSetup` HTTP calls have a bounded transient retry (429/5xx only)
- [ ] `.serial` scoped to the smallest block that needs atomicity

## Definition of Done (all PRs — docs stay current)

- [ ] `npm run docs:refresh` run (test counts, module table, tag counts, shard plan, CI matrix regenerated — nothing typed by hand)
- [ ] One line added to `CHANGELOG.md`
- [ ] Issue found → `docs/KNOWN_ISSUES_ACTIVE.md`; issue closed → ≤15-line summary moved to its `docs/known-issues/<topic>.md` and the active entry deleted
- [ ] Design decision made/reversed → ADR added or updated in `docs/adr/`
- [ ] `Last verified` updated on every doc touched
- [ ] `npm run check:docs` passes (`-- --live` before merge)

## Never-do check (all PRs)

- [ ] Did not edit a git hook to bypass a block
- [ ] Did not change `.github/workflows/*`, any `Jenkinsfile*` or `playwright.config.ts` without flagging it for explicit human review here
- [ ] Did not raise a timeout instead of root-causing a flaky test
- [ ] Did not run git write operations as an automated agent

## Verification evidence

<!--
Paste real output, not a description: `npx tsc --noEmit`, `npm run lint`,
`npm run check:conventions`, `npm run check:docs`, `--list` before/after,
and real test-run output for anything you touched.
-->
