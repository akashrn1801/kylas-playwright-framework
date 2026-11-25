# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-11-25 @ 00e069d

Snapshot of 2026-11-25. Git facts come from the maintainer's statements; re-check before trusting.

## `feature/framework-hardening-20261104` (first-attempt hardening, [ADR 0016](./adr/0016-first-attempt-hardening-framework-wide.md))

- **Final state:** B-1 to B6, the rerun shard, the email redesign (donut, solid tiles, preview tools; [REPORTING](./REPORTING.md)) and the Playwright container are committed. Last sandbox run with evidence here, with `vars.PLAYWRIGHT_IMAGE` on (paths `/__w/`): run 45553181980, #239 on staging: 942 passed (DB14 flaky, L54 passed on the rerun), 1 skipped of 943. DB14 and L54 were fixed afterwards (CHANGELOG); a later run replaces this line.
- **Left out on purpose:**
  - `reports.rbac.spec.ts:248`: an id-based locator.
  - The other create-then-search tests that could use `waitForRecordSearchable` (`leads.spec` 1387 and 1509, `leads.rbac` 1468 and 1577, `quotations.rbac:451`, `meetings.rbac:301`).
  - Quotations serial mode.
  - The container for the other workflows (only sandbox uses it).
  - A 429 policy (shared backoff with `Retry-After`) for the Kylas API: #239's 690 429s were Sentry telemetry, none from the Kylas API.
  - The Kylas bug report (kept outside the repo).
- **B6/B8 plan (2026-11-16, not fixed):** `MeetingsPage.saveEditedMeeting` swallows the modal-hidden wait and sleeps 1 s; `TasksPage.saveEditedTask` waits only for the modal to close; `BasePage.fillTextLikeCustomField` and siblings skip a missing field with a log line; no test verifies Customer Emotion after save; CL24 (`call-logs.spec.ts:582`) unconditional `test.skip`, reason contradicted by locators-and-timing.md: re-verify. KI-65.
- **Run window:** the 4 h window is strict for short local runs; scale it to the selected tests, or document `SESSION_MIN_REMAINING_FOR_RUN_MS` in RUNBOOK.
- **Auth:** sandbox only: `renew-session` logs out once and logs in fresh when under 4 h is left (ADR 0017 amendment); qa/stage/main never log out. 429 on headless re-login in the refresh cascade: recorded, not fixed.

## `feature/ci-rerun-shard-20261103` (fully contained in the hardening branch)

- Per the maintainer (2026-11-19): no separate PR; one PR `feature/framework-hardening-20261104` -> `dev`, then delete the CI branch. Contents: formFields attempt gate, `rerun-failed` shard behind `vars.RERUN_SHARD == 'on'`, combined report/email/history ([ADR 0015](./adr/0015-skip-passed-formfields-on-rerun-and-rerun-shard.md)); follow-ups in [CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md).

## Still open

- [KI-58](./KNOWN_ISSUES_ACTIVE.md): staging create 400 `000000` with e-mail/phone. [KI-52](./KNOWN_ISSUES_ACTIVE.md) to KI-55: known app bugs and watch items; the tests stay green until Kylas fixes them.
- Jenkins sharded-path items (KI-45 to KI-47, KI-48/49/51) were not re-checked.
- `check:docs` compares "Last verified" with the commit author date; a checkout or reset can show false errors.
