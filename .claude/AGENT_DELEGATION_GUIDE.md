# Agent Delegation Guide

## Auto-Triggered Delegation Chains

This framework uses a series of automatic chains to ensure no bad code lands and no real bugs get masked.

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
   - App bug → report filed (do not mask)
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

- **Need to understand the codebase?** Read `.claude/` reference files (architecture, patterns, known issues)
- **Need to check if something's already been done?** Search `INVESTIGATION_LOG.md` for prior investigations
- **Need to know branch strategy?** See `GIT_WORKFLOW.md` (not memory/assumption)
- **Need to understand why something was built this way?** Check `git blame` + commit message for that line

