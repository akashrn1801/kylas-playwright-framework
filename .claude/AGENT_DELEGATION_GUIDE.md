# Agent Delegation Guide

> **Purpose:** Which of the 13 subagents in `.claude/agents/` to use for which task, and which guardrails are real hooks versus conventions you follow.
> **Read when:** delegating work to a subagent, or wondering what actually runs automatically.
> **Size budget:** 12k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Not auto-imported by `CLAUDE.md` — read on demand. Standing rules: [CLAUDE.md](../CLAUDE.md). Subagent definitions: `.claude/agents/*.md` (protected; never delete).

## What is a real automatic guardrail, and what is a convention

| Guardrail | Mechanism | Real? |
|---|---|---|
| `git push`, `git merge`, `gh pr merge`, `git pull origin <branch>` denied | `.claude/settings.json` `permissions.deny` | Real |
| `waitForTimeout()` in a staged line, and ESLint errors (incl. `no-explicit-any`) in staged `.ts` | `scripts/hooks/pre-commit` (install to `.git/hooks/`) | Real |
| `waitForTimeout()` / hardcoded URL checks on push | `scripts/hooks/pre-push` — a bash grep gate; it does **not** invoke any agent | Real |
| Reminder to run `locator-reviewer` after a Page Object/spec edit | `PostToolUse` hook (`.claude/settings.json`, matcher `Write\|Edit`) → `scripts/hooks/post-file-edit-locator-reminder.sh` | Real (a reminder, not an enforced run) |
| Run `flaky-test-auditor` + `enterprise-code-reviewer` before the user pushes | convention below | Convention |
| Run `failure-triage-investigator` first on any test failure | convention below | Convention |
| `agent_delegation` / `investigation_log` blocks in `.claude/settings.json` | not read by Claude Code | Inert (see [KI-26](../docs/KNOWN_ISSUES_ACTIVE.md)) |

## Conventions (follow them; nothing enforces them)

1. **Edited a Page Object or spec** → `locator-reviewer` on that file (static pass; live pass needs Playwright MCP approval).
2. **Before asking the user to push** → `flaky-test-auditor` + `enterprise-code-reviewer` on changed files (`git diff` read-only); any blocking finding stops the hand-off.
3. **A test failed** → `failure-triage-investigator` first, always: classify application bug vs code bug with evidence *before* any fix. App bug → [APPLICATION_BUGS.md](../APPLICATION_BUGS.md), test stays red. Locator → `self-healing-locator-scout`. Timing → `resilience-architect`. Coverage gap → `test-coverage-strategist`. Unsure/flaky → record confidence and what would raise it ([KNOWN_ISSUES_ACTIVE.md](../docs/KNOWN_ISSUES_ACTIVE.md)).
4. **An investigation found an uncovered flow** → `test-coverage-strategist` drafts the tests; a human reviews, never auto-merged.

## Manual delegation

| Request | Agent | Why |
|---|---|---|
| "Why is X failing?" | `failure-triage-investigator` | classify before fixing |
| "Fix the locator in Y" | `self-healing-locator-scout` | find the live element, ripple-check, propose |
| "Why is Z slow?" | `resilience-architect` | measure real timing, size timeouts from data |
| "Review this code" | `enterprise-code-reviewer` | conventions, types, error handling |
| "Ready to promote?" | `pipeline-guard` + `release-readiness-summarizer` | branch strategy, dependencies, open issues |
| "Clean up test data" | `test-data-lifecycle-manager` | QA/stage only, never prod |
| "Check dependencies" | `security-dependency-auditor` | audit + secret scan |
| "What's uncovered?" | `test-coverage-strategist` | new specs, flagged for review |
| "Accessibility" | `accessibility-auditor` | WCAG audit |
| "What's new in Playwright?" | `discovery-agent` | research only, never implements |

Invoke by plain request ("fix the broken locator in DealsPage.ts") or by name ("ask resilience-architect to measure the create-deal flow").

## Playwright MCP (live investigation)

Only `self-healing-locator-scout`, `resilience-architect`, `failure-triage-investigator` and `accessibility-auditor` may use it, gated behind approval, **QA and staging only — never production (`app.kylas.io`)**. Evidence goes under `.claude/evidence/<agent-name>/<date-slug>/` (kept out of git, never casually deleted); every finding cites a specific screenshot/snapshot. Report shape: environment, steps, evidence paths, observed behavior, conclusion, confidence.

## When there is no agent for it

- Understand the codebase: [CLAUDE.md](../CLAUDE.md) → the "task → read this" table.
- Was this investigated already: [docs/known-issues/README.md](../docs/known-issues/README.md), then `git log -S'<symbol>'` / `git blame`.
- Branch strategy and promotion commands: [README.md](../README.md).
