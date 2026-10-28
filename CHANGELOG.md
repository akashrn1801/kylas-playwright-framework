# Changelog

> **Purpose:** Newest-first, one line per significant change to the framework, CI and docs.
> **Read when:** You need to know when something changed, or you finished work (Definition of Done step 2: add one line).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-28 @ 0f87be3

Format: `- YYYY-MM-DD — <type>: <what> (<hash>)`. Detail lives in git history and in `docs/known-issues/`, `docs/adr/`. Older months are compressed to one line per theme.

## Unreleased

- 2026-10-28 — fix: the CO9 (`companies.spec.ts`) and CR17 (`contacts.rbac.spec.ts`) note tests counted `div.row.pt-2.pl-2.pr-2` once, which also matches the Notes card's loading placeholder rows, so a new company's baseline read 3 instead of 0 (GitHub main run 40637702829, PROD, shard 4: `GET /v1/notes/relation` returned `totalElements: 0`, count read 3, expected 4, received 1); both now use the existing `BasePage.notesPanel()` pattern (settle, count the real `.note.card` rows, retrying `toHaveCount`). QA: 5/5 passes each (`--repeat-each=5`). The PROD flake is not reproduced, so this is hardening with the root cause inferred from the trace, not proven (pending)
- 2026-10-28 — docs: Jenkins sharding documented: ADR 0012, CI_PIPELINES 5.1 (environment map, triggers, locks, engine), RUNBOOK setup steps, KI-45/46/47 (KI-14 updated), REPORTING `lanes` and scoped-run marker, sharding-and-locks and ci-pipelines entries; the generated Jenkins matrix row no longer says "Sharded by planner: no" (pending)
- 2026-10-28 — ci: the Jenkins collision guard also checks the `pending` and `requested` run statuses (pending)
- 2026-10-28 — ci: `Jenkinsfile.prod` and `Jenkinsfile.staging` approver changed from `akashrn1801` (no such Jenkins user; the id is `akash.rn1801`) to `akashpersonal` (pending)
- 2026-10-28 — fix: Jenkins `sandbox` branch resolves to staging like `sandbox.yml` (one `kylasEnvFor()` rule replaces two copies of an if/else that fell through to QA) (pending)
- 2026-10-28 — ci: sharded Jenkins runs (`KYLAS_SHARDED_BRANCHES`, `KYLAS_SHARDING=off`, `CORE_LANES`/`FF_LANES`, `SHARDED_TEST` QA test path), `kylas-<env>-account` and `jenkins-heavy-run` locks and a GitHub collision guard on every Jenkins test run in all five Jenkinsfiles, field-config reset in a `finally`, approval wall-clock stamps, history `lanes` field, scoped-run email marker (pending)
- 2026-10-27 — docs: every doc touched since 2026-10-14 re-verified claim by claim against the code (read-only audits, findings re-checked by hand) and corrected, with the date bumped where every code-checkable claim checked out (history, run IDs and hashes can't be checked from code). Most corrections: `docs/REPORTING.md` (13: CI wiring, verdict order, email section order, history readers, new §6.1 on failure-cause classification and `check:failure-labels`), `.claude/AGENT_DELEGATION_GUIDE.md` (7), `docs/known-issues/locators-and-timing.md` (7, plus the Deals clone close via the header X), `docs/KNOWN_ISSUES_ACTIVE.md` (6), `docs/known-issues/form-fields.md` (5). The `check:docs` "Last verified older than file modification" errors (12 of 13) were a false positive: `scripts/check-docs.ts` compares the header date with file mtime, which a checkout or reset resets, so unchanged docs looked edited (script not changed; a git-based comparison is proposed). New KI-44: `CompaniesPage.captureCompanyIdFromResponse()` matches a bare `includes('companies')` outside `/reports/` (rule 15), latent and not reproduced, no code change; the Quotation-report deployment claim is now marked UNVERIFIED where it appears (`ReportsPage.ts` contradicts itself) (422ae55)
- 2026-10-27 — chore: Claude Code and every agent never run any `git` or `gh` command, read-only ones included, now enforced by `permissions.deny` rules in `.claude/settings.json` (`Bash(git *)`, `Bash(gh *)`, `/usr/bin` and `/bin` paths, `env git *` / `env gh *`; the older push/merge/pull denies stay) and the 21 git/gh allow rules removed from `.claude/settings.local.json`; `CLAUDE.md` rule 13, `docs/CONTRIBUTING_TESTS.md` R13, `README.md`, `.claude/AGENT_DELEGATION_GUIDE.md` and the pipeline-guard, failure-triage-investigator, enterprise-code-reviewer, flaky-test-auditor and self-healing-locator-scout agents now ask the user for git output with the exact command. Verified: a single `git status` was denied; `npm run check:docs`, which runs git internally, still works. Limits (Claude Code permissions docs): a rule matches the command text Claude issues, so `bash -c`/`sh -c`, `watch`/`flock`/`npx`-style runners, quoting tricks and `xargs` with flags can still get through, and child processes of allowed commands (npm scripts, hooks, CI) still run git; a sandbox or PreToolUse hook would be stronger (bd59b79)
- 2026-10-27 — docs: KI-43 (staging search index) shortened in `docs/KNOWN_ISSUES_ACTIVE.md` and its full detail moved to `docs/known-issues/rbac-and-test-isolation.md` ("OPEN (KI-43)"), adding sandbox run 38690038228 (55 failed, 20 flaky) and the 2026-10-15 live probe (a created deal never appeared in `GET /v1/search/deal/lookup` in 188 s: 90 of 90 polls empty) as evidence, plus a note that sandbox run 40279659288 passed all 14 jobs on a full `@regression` scope (evidence of recovery, unconfirmed; KI-43 stays open) (422ae55)
- 2026-10-26 — ci: the browser install first rewrites the azure apt mirror (`azure.archive.ubuntu.com`, security pocket included) to `archive.ubuntu.com` when run with `--with-deps`, logs each changed file and fails with an annotation if an azure reference survives a rewrite; `APT_MIRROR_OVERRIDE=off` disables it. Sandbox run 40279659288 on this commit: success, all 14 jobs; the mirror rewrite's own log lines were not inspected for this entry (a9f5372)
- 2026-10-26 — ci: browser install is 2 attempts x 300 s inside the unchanged 570 s budget (was 3 x 180 s) because of a slow apt mirror observed in sandbox run 39934344278; run 40277774212 on this commit was cancelled (d13481e)
- 2026-10-23 — fix: Products & Services custom-field writes are logged as FLAT or NESTED (`src/utils/productWriteShape.ts`) with a clear failure when the app drops the value; `reset-field-config` asks `GET /v1/users/me` first and re-authenticates a rejected admin token before reading any field (found in a local dry-run 2026-10-23). Sandbox run 39934344278 on this commit: failure, causes not examined for this entry (f1858b0)
- 2026-10-23 — fix: `meetings.rbac` related-record selection uses the opening list, then a single-word search, with an exact name match. Sandbox run 39903711894: failure, causes not examined for this entry (b220296)
- 2026-10-21 — fix: call-log edit save waits on the real PUT path with a retrying outcome assertion; `meetings.rbac:139` uses self-created shared records. Sandbox run 39601551444: failure, causes not examined for this entry (a4ce53f)
- 2026-10-21 — feat: a rejected write now reads `Backend rejected the save: <METHOD> <path> -> <status> <code>` before the form text (`BasePage.assertNoFormErrors`, `src/utils/failedWriteTracker.ts`); new failure signatures for main-run failures (`failureSignatures.json`, `FailureClassifier.ts`); `check:failure-labels` extended. Watch items in `products-and-services.md` and `rate-limits-and-error-pages.md`. Sandbox run 39561566335: failure, causes not examined for this entry (b3e10bb)
- 2026-10-20 — docs: runner pin and canary notes added to `docs/RUNBOOK.md` and `docs/CI_PIPELINES.md`; the docs generator now shows schedule-only workflows correctly (5151ce4)
- 2026-10-20 — ci: all 25 `runs-on` entries use `${{ vars.RUNNER_IMAGE || 'ubuntu-24.04' }}` (repo variable `RUNNER_IMAGE`, fallback `ubuntu-24.04`), because `ubuntu-latest` was moving to Ubuntu 26.04 where Playwright 1.60 failed (`does not support chromium on ubuntu26.04-x64`, main run 39456246717); new `runner-image-canary.yml` (manual plus Mondays 05:17 UTC) installs the browsers on four Playwright/image pairs and prints a VERDICT line per pair; the browser install script stops after the first unsupported-OS failure instead of retrying (e1ac803)
- 2026-10-18 — fix: the Deals clone fallback (`DealsPage.closeStaleCloneModal()`) closes the stale modal via its header X (`#editEntityModal button[data-dismiss="modal"]`) because the footer Cancel is a `<span>`, so the role locator never matched (stage run 39051544788 and 3 earlier runs); 5 s click and 10 s hidden bounds, each failure names its step (c07c7d0)
- 2026-10-17 — fix: the leads update test opens and verifies the lead by its captured ID; the by-name row click timed out on QA (6c0fc4c)
- 2026-10-16 — fix: skeleton-aware notes baseline, the company is shared in the D20 deal test, early recovery from the app's 429 page, clone-lead waits for the "Copy" last name (24b8213)
- 2026-10-16 — feat: failure-cause labels get plain-language evidence (registry notes, never raw code or stack text), a failed-vs-retry split in the banner and summary line, and the dated Kylas-team observation in the banner; documented in `docs/REPORTING.md` §6.1 (4cf365c)
- 2026-10-15 — feat: the email shows an evidence-backed suspected cause per failure (`FailureClassifier.ts`, `failureSignatures.json`; summary line and banner); hints only, verdict, health, counts and dedup key untouched (2c2de59)
- 2026-10-15 — fix: misc errors are joined to failed tests on a normalised title (all leading tags stripped on both sides, `normalizeTestTitle()`) (f33aea0)
- 2026-10-15 — fix: notification logs print recipient/cc counts and source (never addresses — a re-joined secret list is not masked in public logs); the empty-`NOTIFY_TO` warning now explains that a missing and an empty GitHub secret both expand to ''. Sandbox 38582148420: notify ran and sent to the `GMAIL_USER` fallback only because `NOTIFY_TO`/`NOTIFY_CC`/`NOTIFY_FROM_NAME` expanded empty (workflow mapping correct; secret value to check outside the repo); its 64 test failures are KI-43 (staging search index), not caused by the change.
- 2026-10-14 — chore: `npm run check:public-safe` (`scripts/check-public-safe.ts`) scans tracked text files for emails, the non-production app domain, private IPs and `*.svc.cluster.local`, including names split across comment lines; explicit per-reason allowlist; proposed pre-commit hook documented in `docs/CONTRIBUTING_TESTS.md`, not wired in. Currently fails only on the still-tracked `APPLICATION_BUGS.md` (clean once untracked).
- 2026-10-14 — chore: non-production hostnames removed from tracked docs/comments — `.claude/agents/*.md` use `<QA_APP_URL>` / `@<company-email-domain>`, `config/config.ts` comment uses `<QA_API_BASE_URL>`. `src/fixtures/index.ts` comment reworded. Left unchanged (behavioral): the non-production host match in `ErrorCollector.ts` and the pre-push hook's URL warning pattern.
- 2026-10-14 — chore: notification recipients/cc/sender name now come from `NOTIFY_TO`/`NOTIFY_CC`/`NOTIFY_FROM_NAME` (GitHub secrets in all 7 notify workflows; Jenkins credentials in `Jenkinsfile`, `Jenkinsfile.sandbox`); unset `NOTIFY_TO` warns and sends to `GMAIL_USER` only; footer address dropped; history-bot git identity env-overridable with a noreply default. No address remains in source.
- 2026-10-14 — chore: public-repo hygiene — `APPLICATION_BUGS.md` added to `.gitignore` (kept outside the repo); all references removed or reworded (docs, code comments, P&S spec/ReportsPage/CallLogsPage/FailureDetailBuilder strings); `check-docs`/`update-doc-numbers` no longer name the file and skip it when absent.
- 2026-10-09 — chore: `errorFilters.ts` allowlists `net::ERR_ABORTED` on Settings > Fields list GETs (`.../fields?sort=...&page=...`; 402 in qa 37897275025 / stage 37897319452 plus sandbox builds #189/#191, zero failures); HTTP 4xx/5xx on the same URL stays unexpected (synthetic classifier check). docs: `KNOWN_ISSUES_ACTIVE.md` pruned 29,988 → ~22k chars, KI-40/41/42 and the Call Logs re-open note moved to topic files as watch items (not reproduced, not claimed fixed); KI-34/36/37/38 checklists moved to `sharding-and-locks.md`.
- 2026-10-09 — fix: reports — `saveNewReport()` (existing 500/`01403004` retry) used for the Save in `reports.spec.ts:533` and `reports.rbac.spec.ts` R61 (stage 37778503008: `POST /v3/reports` 500 on attempt and retry); the drill-through retry now reloads the report (hardening, `reports.rbac.spec.ts:148`, cause not confirmed); `:1003` left unchanged
- 2026-10-09 — fix: P&S RBAC :161 waits the expect budget for the "Distribute Equally" banner when the deal has installments (hardening; qa 37733648349 PUT 400 `01001091`, cause not confirmed); :188 creates its own deal instead of a random one (stage "Invalid deal"); 3/3 local QA
- 2026-10-09 — fix: every remaining swallowed react-select menu-hidden wait uses `ensureReactSelectMenuClosed()`, and `check:conventions` flags new ones (`no-swallowed-react-select-menu-wait`); local QA ripple over Leads/Contacts/Deals/Tasks/Quotations/Companies/Meetings/Reports create+edit
- 2026-10-09 — fix: Deals clone verifies its outcome (clone POST 200/201 with an ID, then the deal opened by ID shows the submitted "Copy" name) instead of scanning for toasts, because on QA the failing AI-agent call (`/v1/ai-agent/workflows/subscribed`, per the user) shows a red toast that failed a successful clone; Cancel closes the Clone modal and the ellipsis calls are bounded; 3/3 local QA runs, not yet CI
- 2026-10-08 — fix: one `ensureReactSelectMenuClosed()` primitive (verify closed, Escape if open, throw naming the field) replaces swallowed hidden-waits for P&S Units, Dashboard assignees and Call Logs Customer Emotion; Deals clone closes via Cancel and its ellipsis open is bounded; ADR 0011, KI-35/39/40/41; DB27 and Call Logs pass live on QA, Deals clone run hit a signIn redirect (uncommitted)
- 2026-10-08 — ci: sandbox runs only the formFields entities selected by changed files (entity spec/lock files, direct-import page objects/factories; shared files and escalated runs select all); matrix, split guard and expected blob count follow the selection; qa/stage/main unchanged (run 37753304635; KI-38; ADR 0002 amendment; uncommitted)
- 2026-10-08 — fix: install script terminates a leftover `apt-get` after a timed-out attempt, adds `DPkg::Lock::Timeout 60` and a 570 s total budget so retries cannot collide with the dpkg lock (run 37753304635; cause not confirmed; KI-37; uncommitted)
- 2026-10-08 — fix: `selectFromReactSelect()` (Products & Services) closes a still-open react-select menu with Escape and fails loudly, naming the field, if it stays open — the Units overlay blocked the Active toggle click (QA run 37733648349; KI-35 part 1; not verified on QA; uncommitted)
- 2026-10-08 — fix: bound the browser install (3x180 s attempts, 10-min step timeout) in every workflow; incomplete runs (fewer shard reports than expected) now give an INCOMPLETE verdict/subject/banner, and their history record is marked `incomplete` and excluded from deltas, trends, recurring counts and duration estimates (run 37669596623; ADR 0010, KI-37; uncommitted)
- 2026-10-08 — fix: sandbox selective runs never run formFields tests on one shard: paths split by sharedConfigSuites prefixes (split-formfields-target.sh), per-entity matrix runs all 6 entities, run-tests skipped when only formFields selected, count guard (uncommitted; ADR 0002 amendment, KI-36)
- 2026-10-07 — docs: document dedicated form-field reset tool, per-account workflow concurrency and email line (ADR 0009; KI-10 moved to sharding-and-locks, new KI-34/KI-35); code/workflow changes of the same branch are uncommitted and unverified against a real run
- 2026-10-06 — fix: a 0-failed run is never ❌/Critical (verdict from this run only, health shown separately and floored at 50; context penalties capped at 15); recurring/trend history now same-branch+scope and one record per build, fixing 49 phantom recurring failures from re-run duplicates (Build #186)
- 2026-10-06 — docs: restructure into router CLAUDE.md + docs/ set, retire .claude/{known-issues,reference-patterns,architecture}.md, add docs:refresh/check:docs
- 2026-10-06 — fix: email "Related history" index now reads docs/KNOWN_ISSUES_ACTIVE.md + docs/known-issues/*.md and deep-links per file (KnownIssuesIndex, NotificationService, EmailTemplate)
- 2026-10-06 — chore: add scripts/check-docs.ts (`npm run check:docs`) and generated-figure blocks (`npm run docs:refresh`); repoint ~250 code/CI comments to the new doc locations (comment-only)

## 2026-10

- 2026-10-06 — fix: run formfields shards after core shards, skip unused product fixtures, record per-shard load signals (1bd03cc, ADR 0007)
- 2026-10-05 — fix: split RBAC serial blocks per section, recover from app error-boundary pages, compress known-issues (b90a885, ADR 0006/0008)

## 2026-09

- 2026-09-30 — fix: root-cause browser-closed list-readiness timeout, add contributor guide and guard-rail scripts (check:conventions, check:test-counts, new:module) (3d58073)
- 2026-09-29 — fix: scope lock to mutating tests, add 429 recovery, file-atomic shard planner, per-module reporting (bf32201, ADR 0003)
- 2026-09-29 — fix: resolve four residual timing issues; add job stats, retry breakdown and overlap detection to the email (1091c4b)
- 2026-09-29 — fix: transient-error retry for globalSetup product fixture calls (0195259)
- 2026-09-29 — fix: carve formFields out of sharding to stop cross-shard field-config races (6ec6e3f, ADR 0002)
- 2026-09-29 — fix: remove serial-mode skip cascade, fix afterAll timeout budget, honest retry reporting (9e35fc1)
- 2026-09-28 — fix: harden globalSetup token retry, sandbox shard-completeness check, module naming in reports (253afc3)
- 2026-09-28 — fix: dedicated custom fields to end cross-shard field-config collisions (ab06f5e, ADR 0001)
- 2026-09-28 — feat: Form Field Limit configuration tests for Lead, Contact, Company, Task, Deal, Products & Services (b9b88d7)
- 2026-09-10 — fix: notify false-alarm gating, Jenkins disableConcurrentBuilds, Quotations row-search wait, Reports drill-through retry (23d5233, 18b2c89, 08c54cc)
- 2026-09-09 — fix: suite-drift detection scoped by branch and test scope (7910c7e)
- 2026-09-09 — fix: skip Quotation entity-type report tests where not deployed; sharding order-dependency audit (6184a11)
- 2026-09-09 — fix: ellipsis-menu double-click bug and wrongPage navigation outcome (e8529d6)
- 2026-09-09 — fix: Jenkins per-stage timeouts replace pipeline-wide timeout (276d82f)
- 2026-09-09 — fix: shard qa/stage/sandbox/main CI to escape the 6h job ceiling, shard counts computed dynamically (cd22b91, 8e96dc8, a55e1e9)
- 2026-09-09 — fix: notify pipeline cannot misreport or crash silently on a bad run (d7de24c)
- 2026-09-08 — fix: PROD Build #4 failures; Hide Empty Fields tests across 8 modules (23818d0)
- 2026-09-05 — fix: revert stage workers=1 mitigation, timeout margin on qa/main (7e360e6)
- 2026-09-04 — feat: Cloned From field tests, dynamic CI duration estimates, Jenkins branch-to-test selection fix (09989be)
- 2026-09-03 — feat: Dashboard module (UI + RBAC) (7c5b992); fix: false drift alarm, R15/R48/R55 own-Lead data races (fa65807, b50a364, 253b950, 4c8dffd)

## 2026-08

- 2026-08-26 — fix: report-count verification accuracy, IST timezone, deadline-aware fixture timeout (aefd527); narrow time window option (02fe0a2)
- 2026-08-25 — fix: history-sync temp clone had no credentials, all pushes silently failed (4477e0f); backoff and permissions fixes (2324ca7, ad26f8a, 133e733)
- 2026-08-25 — fix: Build #147 flakes: Leads delete confirm, saveEditedCompany confirmation, R36/R64 report windows (9a34843, ef6b496, 0bc3795)
- 2026-08-24 — feat: redesigned notification email system (30e8870)
- 2026-08-23 — fix: Deals clone flakiness, Products chip-clearing race, product search truncation (31d93d0, aa49652)
- 2026-08-22 — feat: Reports module with run-count verification (0f46591)
- 2026-08-12 — docs/fix: README consolidation; waitForTimeout replaced by condition waits; Quotations ID capture (8202bea, 9185a7b, 0c5d3bf)
- 2026-08-09 — fix: root-cause six sandbox failures across Call Logs, Deals, Meetings, Quotations, Tasks (9c9a710)
- 2026-08-08 — fix: Task custom-field suffix bug, multi-select cap (95e602e)
- 2026-08-06 — fix: eliminate `any`, enforce no-explicit-any at pre-commit (5eaf7ae); docs consolidation (acb51b2)
- 2026-08-01 — chore: framework reliability overhaul: 13 subagents, hooks, agent delegation guide, CLAUDE.md split into .claude/ reference files (e181a6a..7e6b078)
- 2026-08-01 — feat: Meeting, Quotation, Call Log, Task custom fields; session-expiry hardening (26593ea, 40dc671)

## 2026-07

- 2026-07-29 — feat: Company custom fields; zombie session-expiry listener fix (beb1d42)
- 2026-07-28 — fix: shared buildApiUrl(), login URL normalization; sandbox default env switched to staging (0276029, 0971b3b, c85a7b3)
- 2026-07-27 — feat: Deal custom fields; navigation-drift fix across six modules (f395b14)
- 2026-07-22 — feat: Lead Company/Contact lookup custom fields and nine bug fixes (aec071e, 731b6c6)
- 2026-07-19 — fix: globalSetup login wait for staging CI (5039c0d)
- 2026-07-14 — feat: enterprise email reporting overhaul: failure clusters, health score, run-history ledger (f224a5c)
- 2026-07-08 — docs: README ground-up rewrite (9ac4e17)
- 2026-07-06 — test: Deals share/reassign/clone/add-contact/delete UI + RBAC (c9a4537)
- 2026-07-04 — fix: flaky RBAC tests, Jenkins timeout formula (b89cdd0)
- 2026-07-01 — fix: Jenkinsfile prod runs @prodSafe, main full suite (cbecda1)

## 2026-06

- Companies and Contacts modules full CRUD, share/reassign/clone, productivity panel (16a6c6d, 29b02ca)
- Quotations module and its serial mode for two-worker CI (b389e35, 0271e76)
- Meetings module; global misc-error capture; modern email template with module breakdown (6dbe2a5, d5de945, 798422b)
- Selective test runner for feature branches; Jenkinsfile.sandbox (bea17b5, c5c06f7)
- CI stabilization on GitHub Actions: two workers, staggered restricted sessions, API-first list readiness (26c4acd, ab5ad5a)
- Notify step added to all workflows and Jenkinsfile (a7dff5e, 533e79f)

## 2026-05

- 2026-05-30 — Deals module (d4b5d6d); Companies module (73fe067)
- 2026-05-23 — Per-branch GitHub Actions workflows, Jenkinsfile.qa, qa/prod pipelines, auto-promotion (28f49bc, 71429de, 5c0094f)
- 2026-05-22 — Per-environment credentials and isolated storage states (d8ff4ba)
- 2026-05-21 — Jenkins pipeline, multi-env support, AuthManager fixes (7463fe2, 58069bf)
- 2026-05-20 — Initial setup, login, Leads CRUD and RBAC (1f30285, 8795fe0, ff899de)
