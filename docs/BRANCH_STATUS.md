# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 9e60850

Snapshots of 2026-11-03 (rerun shard) and 2026-10-31 (Leads); the Jenkins part is from 2026-10-28. Git facts come from the maintainer's statements and the session-start log; re-check before trusting.

## `feature/framework-hardening-20261104` (first-attempt hardening, [ADR 0016](./adr/0016-first-attempt-hardening-framework-wide.md))

- B-1 to B5 committed. B3 sandbox: all green but company formFields (staging login 400 `000004`; now retried + job stagger, ADR 0017). Watch `reports.spec:866` (flaky; get its trace). B4/B5 proof open. **Follow-up:** on staging, "headless re-auth did not stick" and the UI-login escalation ran ~3 min. Not on QA; now logs whether the API accepts the new token. Check on staging after the sandbox run.
- **B6/B8 plan, recorded 2026-11-16 (not fixed):** (1) `MeetingsPage.saveEditedMeeting` swallows the modal-hidden wait and sleeps 1 s: no response check. (2) `TasksPage.saveEditedTask` waits only for the modal to close. (3) Q14 owner field (`quotations.spec.ts:202`): flake, cause not found; suspects `goToQuotationDetail` ending its GET wait in `.catch(() => null)` and `assertOwnerOnDetailPage` without `withSessionExpiryRecovery`. (4) `QuotationsPage.clickEllipsisEdit` has no callers. (5) `BasePage.fillTextLikeCustomField` and siblings skip a field not yet in the DOM with only a log line. (6) No test verifies Customer Emotion after save. (7) CL24 (`call-logs.spec.ts:582`) unconditional `test.skip`, reason contradicted by locators-and-timing.md: re-verify. Also KI-65.
- **Auth follow-ups 2026-11-17:** CI: one session-renew step at workflow start, before shards (needs workflow review; a login cannot extend a live session and CI never logs out, ADR 0017), and `reports/<env>/session-info.json` must reach the notify job to show in the email. 429 on headless re-login during the refresh cascade (9 tests, probe run 05:42Z): recorded, not fixed.

## `feature/ci-rerun-shard-20261103` (cut from `dev`, nothing committed, nothing run on GitHub)

- **Built (sandbox.yml only):** formFields attempt gate, `rerun-failed` shard behind `vars.RERUN_SHARD == 'on'`, combined report/email/history, manual `rerun-failed.yml`, email review fixes ([ADR 0015](./adr/0015-skip-passed-formfields-on-rerun-and-rerun-shard.md), [REPORTING](./REPORTING.md) 3.1). Offline checks pass (`check:rerun`, `check:failure-labels`, actionlint); the UNVERIFIED GitHub behaviours are in the ADR. **Next:** review the diff, commit, run sandbox with `RERUN_SHARD` off, then on.
- Follow-ups for this branch moved to [CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md).

## Still open

- Leads coverage gaps (PR #684, merged into `dev`): details moved to [CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md).
- [KI-58](./KNOWN_ISSUES_ACTIVE.md): staging create 400 `000000` with e-mail/phone. The attach-pipeline test (KI-56) was removed 2026-11-02.
- 400 `000000` is no longer classified transient (ADR 0014, 2026-11-02); the sandbox run is the proof.
- [KI-52](./KNOWN_ISSUES_ACTIVE.md) to KI-55: lead coverage known app bugs and watch items; the tests stay green until Kylas fixes them.
- Jenkins sharded-path items ([KI-45](./KNOWN_ISSUES_ACTIVE.md) to KI-47) and KI-48/49/51 carry over from the previous snapshot (2026-10-29) and were not re-checked.
- `check:docs` compares "Last verified" with the commit author date; a checkout or reset can show false errors.
