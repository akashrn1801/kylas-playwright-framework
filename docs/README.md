# Docs Index

> **Purpose:** One-line map of every document in this folder and when to open it.
> **Read when:** You do not know which doc answers your question.
> **Size budget:** 6k chars (hard cap 60k)
> **Last verified:** 2026-10-27 @ a9f5372

| Doc | Purpose | Read when |
|---|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Modules, page objects, fixtures, auth, locks, sharding, CI flow | Learning how the framework fits together |
| [CONTRIBUTING_TESTS.md](./CONTRIBUTING_TESTS.md) | Adding tests or modules, touch / don't touch, Definition of Done, size policy | Before any test or module change |
| [PATTERNS.md](./PATTERNS.md) | Short numbered do/don't rules | Writing page-object or spec code |
| [RUNBOOK.md](./RUNBOOK.md) | Symptom → cause → first check for CI failures | A run failed |
| [CI_PIPELINES.md](./CI_PIPELINES.md) | Workflows, shard planner, formFields sequencing, secrets, timeouts | Touching CI, or judging what "green" covers |
| [REPORTING.md](./REPORTING.md) | Email, history ledger, error reports | Touching `src/notifications/` or debugging an email |
| [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md) | Open issues only | Before investigating a flake or failure |
| [known-issues/README.md](./known-issues/README.md) | Resolved history by topic | Looking for how a past bug was fixed |
| [adr/README.md](./adr/README.md) | Architecture decision records | Asking why something is built this way |
| [BRANCH_STATUS.md](./BRANCH_STATUS.md) | Dated snapshot of the current branch: PR, CI result, follow-ups | Starting a session on a feature branch |
| [GLOSSARY.md](./GLOSSARY.md) | Terms and abbreviations | A term is unfamiliar |

**Git and gh commands quoted in any doc** (RUNBOOK's `gh run view` and `git fetch`, PATTERNS P50's `git reflog`/`git stash list`/`git fetch`, the `Commit: unknown — see git log -S...` lines in `known-issues/`, README's workflow commands) are for the human operator. Claude Code and every agent never run a `git` or `gh` command, read-only ones included: they ask the user to run it and paste the output.

Outside this folder: [../README.md](../README.md) (onboarding), [../CLAUDE.md](../CLAUDE.md) (router and rules), [../CHANGELOG.md](../CHANGELOG.md), [../.claude/AGENT_DELEGATION_GUIDE.md](../.claude/AGENT_DELEGATION_GUIDE.md).
