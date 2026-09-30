<!--
Checkboxes below are drawn from docs/CONTRIBUTING_TESTS.md's three checklists.
Only check what's actually true — an unchecked box is fine if it genuinely
doesn't apply (say why in a comment), but don't check a box you haven't
actually verified.
-->

## What does this PR do?

<!-- One or two sentences. Link an issue/ticket if there is one. -->

## Type of change

- [ ] Test change in an existing module (checklist A)
- [ ] New module (checklist B)
- [ ] Feature that mutates shared, account-wide app config (checklist C)
- [ ] Framework/infrastructure change (not test-authoring — CI, scripts, docs)

## Checklist A — existing-module test changes
(skip if not applicable)

- [ ] Every new/changed test carries at least one real `@tag` (`@smoke`/`@regression`/`@prodSafe`) — never `@prodSafe` on a test that creates/edits/deletes data
- [ ] Imports `test`/`expect` from `src/fixtures/index.ts`, not `@playwright/test` directly (unless this is `login.spec.ts`)
- [ ] Uses a factory (`generateXxxData()`/`generateAdminXxxData()`/`generateSharedXxxData()`) — no hardcoded test data
- [ ] No `waitForTimeout()` anywhere (blocked by `scripts/hooks/pre-commit`, but double-check)
- [ ] Any raw navigation/list-readiness assertion is wrapped in the right recovery combinator (`withSessionExpiryRecovery()`/`withRateLimitRecovery()`/`armResponseWaitWithRecovery()` as applicable — see docs/CONTRIBUTING_TESTS.md §A.5)
- [ ] Ran `npx playwright test --project=chromium --list` before and after — confirmed the test-count delta is exactly what's expected (see §A.6; `npm run check:test-counts` if `config/expected-test-counts.json` has been regenerated)
- [ ] `locator-reviewer` has reviewed any new/changed locator
- [ ] No locator lives in a test file — only in the page object

## Checklist B — new module
(skip if not applicable)

- [ ] Factory field names match the real API field name, not the UI label
- [ ] Page object follows the fixed 10-section order, extends `BasePage`
- [ ] UI/RBAC spec naming matches `.github/scripts/detect-tests.sh`'s real, current convention
- [ ] `deriveModuleFromFile()` (`src/notifications/ReportParser.ts`) produces the module name you expect — added a `SINGULAR_TO_CANONICAL_MODULE_NAME` entry if this module's spec filenames use a singular form while its directory uses plural
- [ ] Added the `test:<module>` npm script
- [ ] Added this module to README.md's Project Overview
- [ ] Added a `known-issues.md` entry (even a one-line "no deviations" note)
- [ ] `npm run check:conventions` and `npm run check:test-counts` (after regenerating the baseline) both pass

## Checklist C — shared, account-wide app config feature
(skip if not applicable)

- [ ] Each consumer gets a dedicated custom field/config value — not a shared one two tests could race on
- [ ] Config-mutating tests use the entity's lock-wrapped `test` object; read-only tests use plain `baseTest` from `src/fixtures/index.ts` — classified per-test, not per-file
- [ ] UI+RBAC files that share this config are structurally guaranteed to land in the same CI shard (a fixed matrix, or registered in `config/sharedConfigSuites.json` so `scripts/plan-shards.ts` excludes them from ordinary bin-packing)
- [ ] Any new `globalSetup` HTTP call this feature adds has a bounded transient-retry (429/5xx only)
- [ ] `test.describe.configure({ mode: 'serial' })` is scoped to the smallest block that genuinely needs atomicity, not a whole file
- [ ] Added/updated the shared-config-suite's entry in `config/sharedConfigSuites.json`

## Never-do check (all PRs)

- [ ] Did not edit a git hook to bypass a block
- [ ] Did not change `.github/workflows/*`, any `Jenkinsfile*`, or `playwright.config.ts` without flagging it for explicit human review in this PR's description
- [ ] Did not raise a timeout instead of root-causing a flaky test
- [ ] Did not run any git operation as an automated agent (commit/push/merge/etc. — the human operator does all git)

## Verification evidence

<!--
Paste real command output, not a description — e.g.:
- `npx tsc --noEmit` output
- `npm run lint` output
- `npm run check:conventions` output
- `npx playwright test --project=chromium --list` before/after counts
- Real test-run output for anything you touched
-->
