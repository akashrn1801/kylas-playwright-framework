# Agent Delegation Guide

> **Purpose:** Which of the 13 subagents in `.claude/agents/` to use for which task, and which guardrails are real hooks versus conventions you follow.
> **Read when:** delegating work to a subagent, or wondering what actually runs automatically.
> **Size budget:** 12k chars (hard cap 60k)
> **Last verified:** 2026-10-27 @ a9f5372

Not auto-imported by `CLAUDE.md` — read on demand. Standing rules: [CLAUDE.md](../CLAUDE.md). Subagent definitions: `.claude/agents/*.md` (do not delete; a convention, no hook or permission enforces it).

## What is a real automatic guardrail, and what is a convention

| Guardrail | Mechanism | Real? |
|---|---|---|
| Every `git` and `gh` command denied for Claude Code and all subagents, read-only ones included (`Bash(git *)`, `Bash(gh *)`, the absolute `/usr/bin` and `/bin` paths, `env git *` / `env gh *`; the older push/merge/pull denies stay); agents ask the user for the output and give the exact command | `.claude/settings.json` `permissions.deny` (no git/gh allow rule remains in `settings.local.json`) | Real for the command forms Claude issues; not a security boundary (see below) |
| `waitForTimeout()` in a staged line, and ESLint errors (incl. `no-explicit-any`) in staged `.ts` | `scripts/hooks/pre-commit` (install to `.git/hooks/`) | Real |
| `waitForTimeout()` on push blocks; a hardcoded-URL match only warns | `scripts/hooks/pre-push` — a bash grep gate; it does **not** invoke any agent | Real |
| Reminder to run `locator-reviewer` after a `.ts` edit under `src/modules/` or a `tests/*/*.spec.ts` edit (needs `jq`) | `PostToolUse` hook (`.claude/settings.json`, matcher `Write\|Edit`) → `scripts/hooks/post-file-edit-locator-reminder.sh` | Real (a reminder, not an enforced run) |
| Run `flaky-test-auditor` + `enterprise-code-reviewer` before the user pushes | convention below | Convention |
| Run `failure-triage-investigator` first on any test failure | convention below | Convention |
| `agent_delegation` / `investigation_log` blocks in `.claude/settings.json` | not read by Claude Code | Inert (see [KI-26](../docs/KNOWN_ISSUES_ACTIVE.md)) |

**Limits of the git/gh deny** (per the Claude Code permissions docs, read 2026-10-27; the deny was not exercised with a test command because running git is itself forbidden here). A Bash rule matches the command text Claude issues, after compound commands are split (`&&`, `||`, `;`, pipes, `$(...)`, subshells: a deny applies if any part matches) and after `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, bare `xargs` and leading `VAR=x` assignments are stripped. It does not match `bash -c`/`sh -c` wrappers, `watch`/`flock`/`setsid`/`npx`-style runners, quoting tricks, or `xargs` with flags, so it is not a security boundary; a sandbox or a PreToolUse hook that inspects the full command is the stronger option. It also does not reach a child process of an allowed command: `npm run check:docs` (which runs git internally), the git hooks and the `detect-tests.sh` step in CI still run git. A deny in `.claude/settings.json` wins over an allow in `.claude/settings.local.json`.

## Conventions (follow them; nothing enforces them)

1. **Edited a Page Object or spec** → `locator-reviewer` on that file (static pass; live pass needs Playwright MCP approval).
2. **Before asking the user to push** → `flaky-test-auditor` + `enterprise-code-reviewer` on changed files (the user supplies the list, or runs `git diff --name-only origin/<base-branch>...HEAD` and pastes it; agents never run git); any blocking finding stops the hand-off.
3. **A test failed** → `failure-triage-investigator` first, always: classify application bug vs code bug with evidence *before* any fix. App bug → record it in the product-bug list kept outside the repo, test stays red. Locator → `self-healing-locator-scout`. Timing → `resilience-architect`. Coverage gap → `test-coverage-strategist`. Unsure/flaky → record confidence and what would raise it ([KNOWN_ISSUES_ACTIVE.md](../docs/KNOWN_ISSUES_ACTIVE.md)).
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

Only `self-healing-locator-scout`, `resilience-architect`, `failure-triage-investigator`, `accessibility-auditor`, `locator-reviewer` (live pass) and `test-data-lifecycle-manager` list it in `tools:`, gated behind approval. QA and staging: `test-data-lifecycle-manager` states QA/stage only; `self-healing-locator-scout` says production only with explicit approval, otherwise hand off to a human (`app.kylas.io`). Evidence path `.claude/evidence/<agent-name>/<YYYY-MM-DD-HHmm-module>/` is defined by `self-healing-locator-scout`, `resilience-architect` and `locator-reviewer` (no ignore rule covers the folder); every finding cites a specific screenshot/snapshot. Report shape: environment, steps, evidence paths, observed behavior, conclusion, confidence.

## When there is no agent for it

- Understand the codebase: [CLAUDE.md](../CLAUDE.md) → the "task → read this" table.
- Was this investigated already: [docs/known-issues/README.md](../docs/known-issues/README.md), then ask the user to run `git log -S'<symbol>'` / `git blame <file>:<line>` and paste the output (agents never run git).
- Branch strategy and promotion steps: the "Git workflow" section of [README.md](../README.md) (commands there are for the human operator).
