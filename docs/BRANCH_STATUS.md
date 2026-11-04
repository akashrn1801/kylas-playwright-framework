# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 9e60850

Snapshots of 2026-11-03 (rerun shard) and 2026-10-31 (Leads); the Jenkins part is from 2026-10-28. Git facts come from the maintainer's statements and the session-start log; they decay: re-check before trusting.

## `feature/ci-rerun-shard-20261103` (cut from `dev`, nothing committed, nothing run on GitHub)

- **Built (sandbox.yml only):** formFields attempt gate, `rerun-failed` shard behind `vars.RERUN_SHARD == 'on'`, combined report/email/history, manual `rerun-failed.yml`, email review fixes ([ADR 0015](./adr/0015-skip-passed-formfields-on-rerun-and-rerun-shard.md), [REPORTING](./REPORTING.md) 3.1). Offline checks pass (`check:rerun`, `check:failure-labels`, actionlint); the UNVERIFIED GitHub behaviours are in the ADR. **Next:** review the diff, commit, run sandbox with `RERUN_SHARD` off, then on.
- **Follow-ups (seen, deliberately not changed):** JobStats lists only the latest attempt's jobs, so a re-run's job-minutes exclude the earlier attempt; the email's "Artifacts:" line shows a runner path, not a link; a manual rerun's email shows the original build number but links to the manual run; the merged HTML report stays the first run (only `results.json` is combined); rerun misc errors are uploaded but not aggregated; the manual workflow needs `run-meta-*` (sandbox runs only); qa/stage/main are not wired; Jenkins is not covered. `withRateLimitRecovery` reloads on the 'Something is broken' screen too; review whether that should fail fast (ADR 0014).

## `feature/leads-coverage-gaps-20261030` (PR #684, merged into `dev`)

- Four commits pushed (last `3373bfe`). Sandbox run 41066366856 on staging: all passed except two new lead tests: duplicate e-mail (staging uniqueness was NONE, now EMAIL_PHONE; the test checks the setting first) and attach-pipeline (not reproducible; removed 2026-11-02, KI-56 closed in [rbac-and-test-isolation.md](./known-issues/rbac-and-test-isolation.md), root cause not confirmed).
- **Uncommitted at the 2026-10-31 snapshot:** `uniqueValues.ts` (unique e-mail/phone for lead, contact, company factories, clone flows, `LeadApi`) and the lead `has-duplicates` pre-check (a duplicate fails loudly, a non-OK endpoint is skipped with a warning, no `@prodSafe` test creates a lead).
- **Live 2026-10-31 (one run each; sandbox CI is the proof):** QA 6/6 pass. Staging 1/6: company create passes; lead and contact creates fail 400 `000000`. Probe: name only 200; e-mail only, phone only, both 400, so unique values did not fix it: [KI-58](./KNOWN_ISSUES_ACTIVE.md), backend/config suspected.
- **Next:** have staging's lead/contact create checked (backend log, uniqueness config); sandbox CI after that.

## Still open

- [KI-58](./KNOWN_ISSUES_ACTIVE.md): staging create 400 `000000` with e-mail/phone. The attach-pipeline test (KI-56) was removed 2026-11-02.
- 400 `000000` is no longer classified transient (ADR 0014, 2026-11-02); the sandbox run is the proof.
- [KI-52](./KNOWN_ISSUES_ACTIVE.md) to KI-55: lead coverage known app bugs and watch items; the tests stay green until Kylas fixes them.
- Jenkins sharded-path items ([KI-45](./KNOWN_ISSUES_ACTIVE.md) to KI-47) and KI-48/49/51 carry over from the previous snapshot (2026-10-29) and were not re-checked.
- `check:docs` compares "Last verified" with the commit author date; a checkout or reset can show false errors.
