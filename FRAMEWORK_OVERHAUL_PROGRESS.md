# Framework Reliability Overhaul — Progress Tracking

**Branch:** `chore/framework-reliability-overhaul-20260801`  
**Start Date:** 2026-08-01  
**Current Status:** Task 0 — Setup in progress

---

## Task Checklist

### Task 0 — Create working branch and progress-tracking file
- [x] Create branch off `dev` (`chore/framework-reliability-overhaul-20260801`)
- [ ] Create `FRAMEWORK_OVERHAUL_PROGRESS.md` (this file)
- [ ] Create `.claude/agents/` directory
- [ ] Update `FRAMEWORK_OVERHAUL_PROGRESS.md` after finishing items
- [ ] Commit work locally after each completed item
- [ ] **Status:** In progress — file created, awaiting next steps

### Task 1 — Install and connect Playwright MCP for live browser investigation
- [ ] Install Playwright MCP server
- [ ] Confirm connection and available tools
- [ ] **Status:** Pending — awaiting Task 0 completion

### Task 2 — Write/refresh `CLAUDE.md`
- [x] Refactored CLAUDE.md from 175KB → 11.2KB (under 40k limit)
- [x] Extracted engineering-checklist.md (25 standing rules)
- [x] Extracted architecture.md (file layout, fixtures, auth flow)
- [x] Extracted reference-patterns.md (canonical code patterns)
- [x] Extracted known-issues.md (documented bugs and investigations)
- [x] Extracted cicd-reference.md and module-status.md
- [x] Added framework overhaul context to main CLAUDE.md
- [x] Documented 13-agent delegation chains and auto-triggers
- [x] Documented Playwright MCP scope and evidence protocol
- [x] Added "When You're Stuck" guidance linking to agents
- [x] **Status:** ✅ COMPLETE — Commit c554ddd

### Task 3 — Create 13 specialized subagents in `.claude/agents/`

#### Subagent 1: `flaky-test-auditor`
- [ ] Agent created and registered
- [ ] Read-only tools configured
- [ ] Description and system prompt finalized
- [ ] **Status:** Pending

#### Subagent 2: `locator-reviewer`
- [ ] Agent created and registered
- [ ] Tools configured (Read, Grep, Glob, MCP pending)
- [ ] **Status:** Pending

#### Subagent 3: `self-healing-locator-scout`
- [ ] Agent created and registered
- [ ] MCP tools gated behind approval
- [ ] **Status:** Pending

#### Subagent 4: `resilience-architect`
- [ ] Agent created and registered
- [ ] MCP tools gated behind approval
- [ ] **Status:** Pending

#### Subagent 5: `enterprise-code-reviewer`
- [ ] Agent created and registered
- [ ] Tools configured
- [ ] **Status:** Pending

#### Subagent 6: `pipeline-guard`
- [ ] Agent created and registered
- [ ] Read-only git commands enforced
- [ ] **Status:** Pending

#### Subagent 7: `security-dependency-auditor`
- [ ] Agent created and registered
- [ ] **Status:** Pending

#### Subagent 8: `test-coverage-strategist`
- [ ] Agent created and registered
- [ ] Write permissions scoped to new spec files only
- [ ] **Status:** Pending

#### Subagent 9: `failure-triage-investigator`
- [ ] Agent created and registered
- [ ] MCP tools gated behind approval
- [ ] **Status:** Pending

#### Subagent 10: `discovery-agent`
- [ ] Agent created and registered
- [ ] **Status:** Pending

#### Subagent 11: `test-data-lifecycle-manager`
- [ ] Agent created and registered
- [ ] Hard scope limit: never prod
- [ ] **Status:** Pending

#### Subagent 12: `release-readiness-summarizer`
- [ ] Agent created and registered
- [ ] **Status:** Pending

#### Subagent 13: `accessibility-auditor`
- [ ] Agent created and registered
- [ ] MCP tools gated behind approval
- [ ] **Status:** Pending

### Task 4 — Set up hooks in `.claude/settings.json`
- [ ] Add hard permission deny for `git push`, `git merge`, `gh pr merge`
- [ ] Configure pre-commit hook (block `waitForTimeout()`)
- [ ] Configure pre-push hook (flaky-test-auditor + enterprise-code-reviewer)
- [ ] Configure post-file-edit hook (locator-reviewer)
- [ ] **Status:** Pending

### Task 5 — Wire up automatic delegation
- [ ] Document orchestration chains in `CLAUDE.md`
- [ ] Create agent activation reference table
- [ ] **Status:** Pending

### Task 6 — Test the setup for real
- [ ] Deliberately introduce `waitForTimeout()` and verify pre-commit hook blocks it
- [ ] Run `flaky-test-auditor` on `CallLogsPage.ts` and `QuotationsPage.ts`
- [ ] Once MCP approved, run `resilience-architect` on a slow flow
- [ ] **Status:** Pending

### Task 7 — Create `INVESTIGATION_LOG.md`
- [ ] Create running log file
- [ ] Document format for all agent findings
- [ ] **Status:** Pending

---

## Currently In Progress

**Item:** Task 3 (Subagent 1) — Build `flaky-test-auditor` agent  
**Next Action:** Write first agent definition in `.claude/agents/flaky-test-auditor.md`

---

**Tasks Completed:**
- ✅ Task 0 — Setup branch and progress tracking (commit 8c61643)
- ✅ Task 1 — Install Playwright MCP and verify tools available (commit automatic)
- ✅ Task 2 — Refactor CLAUDE.md and extract reference files (commit c554ddd)

---

## Key Files Created/Modified This Session

- `FRAMEWORK_OVERHAUL_PROGRESS.md` — this file
- `.claude/agents/` — (to be created)
- Additional files tracked as work progresses

---

## Notes & Blockers

- **CLAUDE.md size alert:** Current size is 175KB (well over the 40k limit). Task 2 must refactor this into separate files.
- **Branch strategy:** Confirmed `feature/* → dev → qa → stage → prod → main` per `GIT_WORKFLOW.md`
- **MCP Approval:** Task 1 approval required before agents 3, 4, 9, 13 can use Playwright MCP tools

---

## Agent Activation Summary (to be detailed in Task 5)

| Agent | Activation | Status |
|---|---|---|
| `flaky-test-auditor` | Auto/Hook/Manual | — |
| `locator-reviewer` | Hook/Auto/Manual | — |
| `self-healing-locator-scout` | Chained/Manual | — |
| `resilience-architect` | Manual (MCP-gated) | — |
| `enterprise-code-reviewer` | Hook/Auto/Manual | — |
| `pipeline-guard` | Manual | — |
| `security-dependency-auditor` | Periodic/Manual | — |
| `test-coverage-strategist` | Chained | — |
| `failure-triage-investigator` | Chained/Auto | — |
| `discovery-agent` | Periodic/Manual | — |
| `test-data-lifecycle-manager` | Auto/Manual | — |
| `release-readiness-summarizer` | Manual | — |
| `accessibility-auditor` | Manual (MCP-gated) | — |

