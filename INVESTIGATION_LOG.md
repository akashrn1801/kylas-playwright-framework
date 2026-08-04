# Investigation Log

**Purpose:** Permanent record of all agent investigations, findings, and classifications. Prevents re-investigating the same dead ends and builds institutional memory.

**Format:** Each entry includes date, agent, what was investigated, findings, and any classification (app bug / code bug / uncertain).

---

## Investigation Entries

### Template for New Entries

```
## [YYYY-MM-DD] [Agent Name] — [Issue/Finding Title]

**Environment:** [qa/staging/prod]  
**Triggered by:** [link to bug report, failure, or manual request]  
**Investigation period:** [start] to [end]

### Findings
- [Finding 1 with evidence]
- [Finding 2 with evidence]
- [Finding N]

### Classification
- **Type:** [app bug / code bug / uncertain / feature gap / coverage gap / documentation gap]
- **Confidence:** [high / medium / low]
- **What would raise it:** [if low/medium, describe what evidence would make this high-confidence]

### Root Cause (if confirmed)
[Exact mechanism found via code inspection, live reproduction, or network trace]

### Action Taken
- [Fix applied / Test written / Issue filed / Documentation updated / Accepted as known limitation]
- **Commit:** [hash if fix was applied, or link to issue if filed]

### Related Investigations
- [[other-investigation-slug]] — [how they're related]

---
```

## Index (Most Recent First)

*Entries will be added here as investigations complete. Newest at top.*

(No entries yet — framework being set up 2026-08-01.)

---

## Quick Reference by Agent

### flaky-test-auditor findings
*Link to any investigations this agent ran*

### locator-reviewer findings
*Link to any investigations this agent ran*

### self-healing-locator-scout findings
*Link to any investigations this agent ran*

### resilience-architect findings
*Link to any investigations this agent ran*

### enterprise-code-reviewer findings
*Link to any investigations this agent ran*

### pipeline-guard findings
*Link to any investigations this agent ran*

### security-dependency-auditor findings
*Link to any investigations this agent ran*

### test-coverage-strategist findings
*Link to any investigations this agent ran*

### failure-triage-investigator findings
*Link to any investigations this agent ran*

### discovery-agent findings
*Link to any investigations this agent ran*

### test-data-lifecycle-manager findings
*Link to any investigations this agent ran*

### release-readiness-summarizer findings
*Link to any investigations this agent ran*

### accessibility-auditor findings
*Link to any investigations this agent ran*

---

## How to Use This Log

1. **Before investigating something:** Search this log to see if it's been investigated before
2. **When an agent completes:** Agent reports findings here (format above)
3. **To understand a past decision:** Find the investigation that led to it, see the full evidence trail
4. **To find patterns:** Search by classification (all "app bugs", all "code bugs", all "uncertain") to spot recurring issues
5. **When someone asks "is this known?":** This log is the source of truth

---

## Known Limitations & Accepted Unknowns

*(Add here any findings classified as "uncertain" or "known limitation" that are too important to let slip into obscurity)*

(None documented yet as of 2026-08-01.)

