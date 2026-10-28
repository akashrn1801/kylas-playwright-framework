# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-28 @ 566df8c

Snapshot of 2026-10-28. Git facts come from the session's start (branch, HEAD, clean tree) and the maintainer's statements; it decays: re-check before trusting.

## `feature/jenkins-main-sharding-20261028`

- Cut from `dev` at `566df8c` (merge of PR #674). The maintainer confirmed that before this work the base `Jenkinsfile` was identical on `dev`, `qa`, `stage`, `prod`, `main` and `sandbox`. Everything below is **uncommitted** in the working tree; no PR exists.
- Code: `Jenkinsfile` (sharded engine, locks, guard, approval stamps, one branch-to-environment rule: `sandbox` now staging); `Jenkinsfile.prod`/`.qa`/`.staging`/`.sandbox` (account lock + guard; approver `akashpersonal` in `.prod` and `.staging`); new `scripts/jenkins-collision-guard.sh`, `jenkins-resolve-selection.sh`, `jenkins-shard-plan.ts`, `jenkins-collect-shard.sh`; `RunHistory.ts`, `syncHistory.ts` (`lanes`), `ShardCompleteness.ts`, `EmailTemplate.ts` (scoped-run marker); `scripts/lib/docFigures.ts` (Jenkins row).
- Docs: ADR 0012, `CI_PIPELINES.md` 5.1, `RUNBOOK.md` setup section, KI-14/45/46/47, `REPORTING.md`, `sharding-and-locks.md`, `known-issues/ci-pipelines.md`, `CHANGELOG.md`.
- Checked offline only: `npx tsc --noEmit`, the guard against a stub API (all three environments, every status), the plan helper on real `plan-shards.ts` output (smoke, module, full suite), the selection script (every branch, sandbox incl. a failed fetch), Groovy syntax of all five Jenkinsfiles, `check:failure-labels`.
- The maintainer ran the Jenkins declarative linter twice on 2026-10-28: all five Jenkinsfiles validated. Sleep was disabled on the host on 2026-10-28 (KI-45).
- **Never run:** any sharded Jenkins build. A GitHub `main.yml` run was in progress during the work; no workflow file was touched.

## Still open

- [KI-47](./KNOWN_ISSUES_ACTIVE.md): QA test runs of the sharded path ([RUNBOOK](./RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) steps 5-6). Until they pass, leave `KYLAS_SHARDED_BRANCHES` unset.
- [KI-45](./KNOWN_ISSUES_ACTIVE.md): confirm the wall-clock stamps on the next real approval. [KI-46](./KNOWN_ISSUES_ACTIVE.md): check Jenkins before dispatching `main.yml`/`prod.yml` by hand.
- [KI-37](./KNOWN_ISSUES_ACTIVE.md): the install-log read is done (sandbox run 40454948545: mirror rewrite and a healthy install confirmed); the retry, kill and budget paths stay stub-tested, so KI-37 is no longer an open item here.
- `check:docs` compares "Last verified" with file mtime, which a checkout or reset resets, so a clean checkout can show false errors.
- Open items carried from the previous snapshot (KI-43, KI-44, the Quotation deployment claim, `KI-TBD` registry refs) were not re-checked today; see [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md).
