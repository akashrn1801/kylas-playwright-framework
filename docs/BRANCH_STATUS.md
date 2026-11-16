# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 9e60850

Snapshots of 2026-11-03 (rerun shard) and 2026-10-31 (Leads); the Jenkins part is from 2026-10-28. Git facts come from the maintainer's statements and the session-start log; re-check before trusting.

## `feature/framework-hardening-20261104` (first-attempt hardening, [ADR 0016](./adr/0016-first-attempt-hardening-framework-wide.md))

- B-1 to B5 committed. B3 sandbox: all green but company formFields (staging login 400 `000004`; now retried + job stagger, ADR 0017). Watch `reports.spec:866` (flaky; get its trace). B4/B5 proof open. **Follow-up:** on staging, "headless re-auth did not stick" and the UI-login escalation ran ~3 min. Not on QA; now logs whether the API accepts the new token. Check on staging after the sandbox run.
- **B6/B8 plan, recorded 2026-11-16 (not fixed; sandbox 42064754304 follow-ups):** (1) `MeetingsPage.saveEditedMeeting` swallows the modal-hidden wait (`.catch(() => {})`) and sleeps 1 s: no response check. (2) `TasksPage.saveEditedTask` waits only for the modal to close: no response check. (3) Q14 "owner field on detail page after create" (`quotations.spec.ts:202`) was a first-attempt flake, cause not found; suspects: `goToQuotationDetail` ends its detail-GET wait in `.catch(() => null)`, so a failed or late GET is silently ignored (a defect on its own), and `assertOwnerOnDetailPage` uses a raw `expect` without `withSessionExpiryRecovery`. (4) `QuotationsPage.clickEllipsisEdit` has no callers (dead code, kept). (5) B8, hidden defect: `BasePage.fillTextLikeCustomField` (and the sibling custom-field helpers) skip a field that is not in the DOM yet with only a log line, so a test can pass without filling it; not changed in B6, needs a decision on presence checks vs a ready wait. (6) B8: no test verifies Customer Emotion after save: add a check of the saved values (detail page or API) against pre-selected + newly picked options. (7) CL24 (`call-logs.spec.ts:582`): unconditional `test.skip` (2026-08-03, "no backend validation") yet locators-and-timing.md records a validation-locator fix that day and the README entry it cites is missing; re-verify on staging, then un-skip or document. Also open: KI-65.

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
