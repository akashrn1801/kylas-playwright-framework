# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 9e60850

Snapshot of 2026-11-03 (the Jenkins-branch part is from 2026-10-28). Git facts come from the maintainer's statements and the session-start log; it decays: re-check before trusting.

## `feature/ci-rerun-shard-20261103` (cut from `dev`, nothing committed, nothing run on GitHub)

- **Built (sandbox.yml only):** formFields attempt gate, `rerun-failed` shard behind `vars.RERUN_SHARD == 'on'`, combined report/email/history, manual `rerun-failed.yml`, email review fixes ([ADR 0015](./adr/0015-skip-passed-formfields-on-rerun-and-rerun-shard.md), [REPORTING](./REPORTING.md) 3.1). Offline checks pass (`check:rerun`, `check:failure-labels`, actionlint); the UNVERIFIED GitHub behaviours are listed in the ADR. **Next:** review the diff, commit, run sandbox with `RERUN_SHARD` off, then on.
- **Follow-ups (seen, deliberately not changed):** JobStats lists only the latest attempt's jobs, so a re-run's job-minutes exclude the earlier attempt; the email's "Artifacts:" line shows a runner path, not a link; a manual rerun's email shows the original build number but links to the manual run; the merged HTML report stays the first run (only `results.json` is combined); rerun misc errors are uploaded but not aggregated; the manual workflow needs `run-meta-*` (sandbox runs only); qa/stage/main are not wired; Jenkins is not covered. `withRateLimitRecovery` reloads on the 'Something is broken' screen too; review whether that should fail fast instead (ADR 0014).

## Still open

- **Investigated, fix committed (`02fc52e`), not run on QA:** GitHub qa run 40477938102 (2026-10-27): `deals.rbac.spec.ts:342`, `quotations.spec.ts:620` / `:640` were QA backend DNS failures ([KI-49](./KNOWN_ISSUES_ACTIVE.md)). Fix: Contacts/Companies/Leads/Deals create flows report status/code/message, Quotations layout fail-fast, bounded `BasePage.fill()`, a registry signature. Unverified on QA.
- [KI-48](./KNOWN_ISSUES_ACTIVE.md): Quotation create form crash (PROD run 40637702829).
- [KI-47](./KNOWN_ISSUES_ACTIVE.md): QA test runs of the sharded path ([RUNBOOK](./RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 6; step 5, the linter, is done). Until they pass, leave `KYLAS_SHARDED_BRANCHES` unset.
- [KI-45](./KNOWN_ISSUES_ACTIVE.md): confirm the wall-clock stamps on the next real approval. [KI-46](./KNOWN_ISSUES_ACTIVE.md): check Jenkins before dispatching `main.yml`/`prod.yml` by hand.
- [KI-37](./KNOWN_ISSUES_ACTIVE.md): the install-log read is done (sandbox run 40454948545: mirror rewrite and a healthy install confirmed); the retry, kill and budget paths stay stub-tested, so KI-37 is no longer an open item here.
- `check:docs` compares "Last verified" with file mtime, which a checkout or reset resets, so a clean checkout can show false errors.
- Open items carried from the previous snapshot (KI-43, KI-44, the Quotation deployment claim, `KI-TBD` registry refs) were not re-checked today; see [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md).
