# ADR 0012 — Jenkins runs like its GitHub twin: one sharded engine, account locks, a collision guard

> **Purpose:** Records why and how Jenkins shards a branch's run, which branches and triggers may do it, and how Jenkins runs are kept from colliding with each other and with GitHub runs.
> **Read when:** You change the base `Jenkinsfile`'s sharded path, `scripts/jenkins-*`, the account or heavy-run lock, the collision guard, or `KYLAS_SHARDED_BRANCHES`.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-28 @ 566df8c

## Status
Accepted — 2026-10-28. Checked offline only (Groovy syntax, scripts against stubs, the mode rules run with stubbed steps). No sharded Jenkins build has run: [KI-47](../KNOWN_ISSUES_ACTIVE.md).

## Context
- The base `Jenkinsfile` ran one unsharded `playwright test --workers=2` per build. The only full Jenkins run on record (`main` #8, 2026-09-10) took 316 minutes (about 27 of them waiting at the approval gate) for 515 tests; the suite is now 932. The GitHub twins shard with `scripts/plan-shards.ts` and a per-entity formFields track ([ADR 0002](0002-formfields-carve-out-from-sharding.md), [ADR 0003](0003-file-atomic-shard-planner.md), [ADR 0007](0007-sequence-formfields-after-core.md)).
- Nothing stopped two Jenkins jobs (`main` and `prod` use the same PROD credentials) or a Jenkins job and a GitHub run from driving one account at once. The `kylas-*` concurrency groups only see GitHub runs ([ADR 0009](0009-field-config-reset-and-account-lock.md)). Two `main`/`prod` builds were parked at the approval gate together on 2026-10-20.
- The branch-to-environment rule only knew `stage` and `prod`/`main`; `sandbox` fell through to QA while `sandbox.yml` and `Jenkinsfile.sandbox` use staging.
- This host is a 12-core, 31 GiB laptop that also runs a desktop. On 2026-10-27, 12.6 GiB was application memory, 7.1 GiB ZFS cache; one sampled chromium worker used about 0.63-0.78 GiB. A snapshot, not a limit: it was taken while a hung local Playwright run (chromium, firefox and webkit, 19 h, load 16 on 12 cores) was still active, so it overstates normal use.

## Decision
- **Parity per branch.** `scripts/jenkins-resolve-selection.sh` gives each branch its twin's selection, workers and `--timeout`, reusing `detect-tests.sh` and `split-formfields-target.sh` for sandbox and `plan-shards.ts` for core shards. One function, `kylasEnvFor()`, maps branch to environment (stage and sandbox: staging; prod and main: prod; else QA).
- **Which builds shard.** Only branches in the Jenkins global variable `KYLAS_SHARDED_BRANCHES` (unset: none), and only when the build may run tests at all: `prod` and `main` on any trigger, every other branch on a manual build. `KYLAS_SHARDING=off` turns it off everywhere. "Listed" chooses how a permitted run executes, never whether it runs.
- **One engine.** Core shards from `plan-shards.ts` are dealt across `CORE_LANES` lanes (1-4, default 2); formFields entities run after the core track in any result, across `FF_LANES` lanes, never in a core shard. Each shard/entity has its own workspace, `.env`, `storageStates` and `.locks`, and the same source stash.
- **Locks and guard.** Every Jenkins test run, sharded or not, in all five Jenkinsfiles, takes `lock('kylas-<env>-account')` (Lockable Resources) after the approval gate, then runs `scripts/jenkins-collision-guard.sh` (fail closed; statuses queued, in_progress, waiting, pending, requested; workflows of the same environment). Sharded runs add `lock('jenkins-heavy-run')`, always inside the account lock. The guard re-runs before the formFields phase and the reset. The reset runs in a `finally` whenever the formFields phase started. Merge, history and notify run outside both locks.
- **Marking.** Sharded runs carry `lanes` in the history record (excluded from duration estimates); `SHARDED_TEST` runs with `TEST_GREP`/`FF_ENTITIES` are marked partial in the email.

## Consequences
- Good: sharded wall-clock (estimate, unmeasured: about 5-6.5 h versus 8.6-11 h for 932 tests); no overlap between Jenkins runs; a visible refusal instead of a silent overlap.
- Cost: lanes bound concurrency on this laptop (default 2 lanes x 2 workers = 4 workers per track; at most 4 lanes x 2 = 8); a second sharded run waits. A refused guard blocks a run, including when the GitHub API or the PAT fails.
- Not covered: GitHub cannot see Jenkins, so dispatching `main.yml`/`prod.yml` while a Jenkins run holds the account is still possible ([KI-46](../KNOWN_ISSUES_ACTIVE.md)).
- Per-shard `npm ci` is repeated in every workspace (about 5 s in main #14's log).

## Rejected
- **Shard on any trigger when listed:** an automatic sandbox push would skip Install, Setup and the approval, and collide with GitHub's sandbox run.
- **Hand-rolled filesystem lock:** the heartbeat and stale-claim bugs in [ADR 0005](0005-heartbeat-based-lock.md) are the cost; Lockable Resources is installed.
- **Fail-open guard, or `--grep @smoke` when `origin/dev` is missing:** "could not check" is not "nothing there".
- **GitHub-side check of Jenkins:** needs workflow edits, which were ruled out.
- **Six or more lanes (GitHub runs 10-11 jobs):** memory and the 429 history ([ADR 0007](0007-sequence-formfields-after-core.md)).
- **More workers in one job:** the worker-level re-login collision is unconfirmed (KI-17), and every extra worker adds to the memory use above.

## How to revert
Set `KYLAS_SHARDING=off` (no commit), or unset `KYLAS_SHARDED_BRANCHES`. **This only disables sharding:** the account locks and the collision guard stay active on every Jenkins run, and sandbox stays on staging. If the PAT expires, the fail-closed guard refuses every Jenkins run and the kill switch does not help: renew the `github-credentials` token. Full revert: restore the base `Jenkinsfile`'s `Run Tests` stage without `withAccountLock`, remove the other four Jenkinsfiles' `withAccountLock` wrappers, delete `scripts/jenkins-*`, the `lanes` and `scoped` fields (`RunHistory.ts`, `syncHistory.ts`, `ShardCompleteness.ts`, `EmailTemplate.ts`).

## Commit(s)
Not committed yet.
