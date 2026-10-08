# Changelog

> **Purpose:** Newest-first, one line per significant change to the framework, CI and docs.
> **Read when:** You need to know when something changed, or you finished work (Definition of Done step 2: add one line).
> **Size budget:** 30k chars (hard cap 60k)
> **Last verified:** 2026-10-08 @ 2576128

Format: `- YYYY-MM-DD — <type>: <what> (<hash>)`. Detail lives in git history and in `docs/known-issues/`, `docs/adr/`. Older months are compressed to one line per theme.

## Unreleased

- 2026-10-08 — fix: `selectFromReactSelect()` (Products & Services) closes a still-open react-select menu with Escape and fails loudly, naming the field, if it stays open — the Units overlay blocked the Active toggle click (QA run 37733648349; KI-35 part 1; not verified on QA; uncommitted)
- 2026-10-08 — ci: sandbox runs only the formFields entities selected by changed files (entity spec/lock files, direct-import page objects/factories; shared files and escalated runs select all); matrix, split guard and expected blob count follow the selection; qa/stage/main unchanged (run 37753304635; KI-38; ADR 0002 amendment; uncommitted)
- 2026-10-08 — fix: install script terminates a leftover `apt-get` after a timed-out attempt, adds `DPkg::Lock::Timeout 60` and a 570 s total budget so retries cannot collide with the dpkg lock (run 37753304635; cause not confirmed; KI-37; uncommitted)
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
