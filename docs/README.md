# Docs Index

> **Purpose:** One-line map of every document in this folder and when to open it.
> **Read when:** You do not know which doc answers your question.
> **Size budget:** 6k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

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
| [GLOSSARY.md](./GLOSSARY.md) | Terms and abbreviations | A term is unfamiliar |

Outside this folder: [../README.md](../README.md) (onboarding), [../CLAUDE.md](../CLAUDE.md) (router and rules), [../APPLICATION_BUGS.md](../APPLICATION_BUGS.md) (product bugs), [../CHANGELOG.md](../CHANGELOG.md), [../.claude/AGENT_DELEGATION_GUIDE.md](../.claude/AGENT_DELEGATION_GUIDE.md).
