# Agent Delegation Guide (full detail)

Imported from `CLAUDE.md`. See that file for the condensed agent list and the rest of the standing rules.

## Auto-Triggered Delegation Chains

### Chain 1: New/Edited Code File

When you edit a Page Object (`src/modules/**/*.ts`) or test spec (`tests/**/*.spec.ts`):

1. **Post-file-edit hook** → `locator-reviewer` (static pass, fast)
2. If zero blocking findings → flow continues
3. If blocking findings → file flagged for review
4. User re-runs after fixing

### Chain 2: Pre-Push Gate

When you attempt to push:

1. **Pre-push hook** → `flaky-test-auditor` + `enterprise-code-reviewer`
2. Both scan changed files (via `git diff`)
3. If ANY blocking findings → push blocked, clear report shown
4. Fix and retry

### Chain 3: Test Failure Detection

When a test fails (reported or observed mid-run):

1. **Automatic trigger** → `failure-triage-investigator` (runs first, always)
2. Classifies root cause: app bug vs code bug
3. Based on classification, hands off:
   - App bug → report filed (do not mask) — see `APPLICATION_BUGS.md`
   - Locator broken → `self-healing-locator-scout`
   - Timing issue → `resilience-architect`
   - Coverage gap → `test-coverage-strategist`
   - Uncertain/flaky → documents confidence + what would raise it

### Chain 4: After Investigation Finding

When any investigation agent (resilience, locator, etc.) finds an uncovered flow or new edge case:

1. **Automatic trigger** → `test-coverage-strategist`
2. Writes new tests for the gap
3. Tests flagged for human review (never auto-merged)

---

## Manual Delegation (On Request)

| Request | Use Agent | Why |
|---|---|---|
| "Why is X test failing?" | `failure-triage-investigator` | Always classify before attempting fix |
| "Fix the locator in Y" | `self-healing-locator-scout` | Find real element live, ripple-check, propose |
| "Why is Z slow?" | `resilience-architect` | Measure real timing, size timeout by data |
| "Review this code" | `enterprise-code-reviewer` | Check conventions, types, errors |
| "Ready to promote?" | `pipeline-guard` + `release-readiness-summarizer` | Verify branch strategy, dependencies, outstanding issues |
| "Cleanup test data" | `test-data-lifecycle-manager` | Remove orphaned records (QA/stage only, never prod) |
| "Check for vuln updates" | `security-dependency-auditor` | Audit dependencies + scan for leaks |
| "What's missing in coverage?" | `test-coverage-strategist` | Manually request new test suite |
| "Check accessibility" | `accessibility-auditor` | WCAG audit (if relevant to project) |
| "Track new patterns" | `discovery-agent` | What's new in Playwright/TypeScript? |

---

## How to Invoke

### Auto-Triggers
No action needed — hooks and test-failure detection run automatically.

### Manual Triggers

**Via natural language:**
```
"Fix the broken locator in DealsPage.ts line 234"
→ Automatically matches to `self-healing-locator-scout`

"Is this code ready to push?"
→ Automatically matches to `enterprise-code-reviewer` (or just run pre-push hook)

"Why did this test fail?"
→ Automatically routes to `failure-triage-investigator`
```

**Via explicit agent naming (if needed):**
```
"Ask self-healing-locator-scout to find the correct element for saveButton"
"Ask resilience-architect to investigate timing on the create-deal flow"
"Ask pipeline-guard to verify branch readiness before promotion to dev"
```

---

## What Prevents Disaster

| Scenario | Gate | Outcome |
|---|---|---|
| Someone commits `waitForTimeout(` | pre-commit hook | Commit blocked, clear message |
| Someone introduces unbounded click | pre-push gate (`flaky-test-auditor`) | Push blocked, finding reported |
| Someone silently patches a flaky test | Chain 3 (`failure-triage-investigator` first) | Root cause determined; if app bug, test stays red |
| Someone assumes a locator is "just broken" | Chain 3 handoff → `self-healing-locator-scout` | Real element found live, stability verified |
| Someone deploys without checking dependencies | Manual gate (`release-readiness-summarizer`) | Report shows outstanding HIGH/CRITICAL vulns |
| Someone skips RBAC testing | Chain 4 handoff → `test-coverage-strategist` | Coverage gap flagged; new RBAC tests written |

---

## Not an Agent? Do It Yourself

- **Need to understand the codebase?** Read `CLAUDE.md` and its imported `.claude/` reference files (architecture, patterns, known issues).
- **Need to check if something's already been done?** Search `.claude/known-issues.md` for prior investigations.
- **Need to know branch strategy?** See `README.md` (not memory/assumption).
- **Need to understand why something was built this way?** Check `git blame` + commit message for that line.

---

## Hooks (real, installed to `.git/hooks/`, tracked in `scripts/hooks/`)

- **Hard deny** (Claude Code permission layer): `git push`, `git merge`, `gh pr merge`.
- **Pre-commit hook (verified working):** blocks commits containing the `waitForTimeout()` anti-pattern. Exit code 1, clear error message.
- **Pre-push hook (verified working):** validates code quality before pushing (checks for `waitForTimeout()`, warns on hardcoded URLs).
- **Post-file-edit auto-trigger for `locator-reviewer`:** implemented as a real Claude Code `PostToolUse` hook (`.claude/settings.json`, matcher `Write|Edit`, calling `scripts/hooks/post-file-edit-locator-reminder.sh`) that injects a reminder to invoke `locator-reviewer` when a Page Object or spec file is touched.

## Playwright MCP (Live Browser Investigation)

Installed 2026-08-01. Enables live app inspection for subagents. **Scope:**
- Only agents 3 (`self-healing-locator-scout`), 4 (`resilience-architect`), 9 (`failure-triage-investigator`), 13 (`accessibility-auditor`) have MCP access (gated behind approval).
- Must follow the evidence-directory protocol: `.claude/evidence/{agent-name}/{date-slug}/`.
- Evidence saved locally, never ephemeral (kept out of git via `.gitignore`, but never deleted casually).
- All findings must cite specific screenshots/snapshots, not speculation.
- Standard report template: environment, steps, evidence paths, observed behavior, conclusion, confidence.
- **Disabled for Production** (`app.kylas.io`). QA and stage only.
