# CLAUDE.md — Router

> **Purpose:** The only file loaded into every session: standing rules, key commands, a "task → read this" table, and the Definition of Done. Everything else is read on demand.
> **Read when:** always (it is auto-loaded). Keep it a router — detail belongs in `docs/`.
> **Size budget:** 10k chars (hard cap 60k)
> **Last verified:** 2026-10-06 @ 1bd03cc

Playwright + TypeScript E2E suite for Kylas Sales CRM (UI + RBAC, per-env CI). Branches: `feature/* → dev → qa → stage → prod → main` (+ `sandbox` pre-PR). Never push/merge — the user does all git.

## Task → read this (do not read more than the row says)

| If you are… | Read |
|---|---|
| adding/changing a test in an existing module | [docs/CONTRIBUTING_TESTS.md](docs/CONTRIBUTING_TESTS.md) §A, then [docs/PATTERNS.md](docs/PATTERNS.md) |
| adding a new module / a shared-account-config feature | [docs/CONTRIBUTING_TESTS.md](docs/CONTRIBUTING_TESTS.md) §B / §C, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/adr/](docs/adr/README.md) |
| triaging a CI/test failure | [docs/RUNBOOK.md](docs/RUNBOOK.md) → [docs/KNOWN_ISSUES_ACTIVE.md](docs/KNOWN_ISSUES_ACTIVE.md) |
| touching workflows, sharding, locks | [docs/CI_PIPELINES.md](docs/CI_PIPELINES.md), [docs/known-issues/sharding-and-locks.md](docs/known-issues/sharding-and-locks.md) |
| touching the email / run history | [docs/REPORTING.md](docs/REPORTING.md) |
| needing structure / how it fits together | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| asking "has this broken before?" | [docs/known-issues/README.md](docs/known-issues/README.md) (topic index) |
| asking "why was it built this way?" | [docs/adr/README.md](docs/adr/README.md) |
| unsure what a term means | [docs/GLOSSARY.md](docs/GLOSSARY.md) |
| suspecting a real Kylas product bug | [APPLICATION_BUGS.md](APPLICATION_BUGS.md) |
| delegating to a subagent (13 in `.claude/agents/`) | [.claude/AGENT_DELEGATION_GUIDE.md](.claude/AGENT_DELEGATION_GUIDE.md) |
| onboarding a human / setup / git workflow | [README.md](README.md) |

## Key commands

`npx tsc --noEmit` · `npm run lint` · `npm run check:conventions` · `npm run check:test-counts` (baseline: `npm run generate:test-counts`) · `npm run docs:refresh` · `npm run check:docs` · `ENV=qa npx playwright test <path> --project=chromium --workers=1` · `npm run new:module`. Use `npx playwright test <paths> <flags>` — not `npm run test:<module> -- <flags>` (args attach to the trailing `npm run notify`).

## Conventions

Import `test`/`expect` from `src/fixtures/index.ts` (never `@playwright/test`; sole exception `login.spec.ts`) · factories, never hardcoded data · locators only in page objects, which extend `BasePage` (10-section order) · `logger.*`, never `console.log` · every test has `@smoke`/`@regression`/`@prodSafe` (`@prodSafe` = read-only) · `test.setTimeout(480000)` on create/edit tests · no `any` (ESLint error, blocked pre-commit) · no `waitForTimeout()` (blocked pre-commit/pre-push) · commits `feat:`/`fix:`/`chore:`/`ci:`/`refactor:`/`docs:`.

## The 25 standing rules (apply to every change)

1. **Reuse before building** — check BasePage helpers/Lead–Contact patterns first; new generic logic goes in BasePage once.
2. **No unbounded click/fill/waitFor** — bounded timeout plus retry or fail fast (the React "click registers, nothing happens" race).
3. **Raw `expect()` in module files → `withSessionExpiryRecovery()`.** Every time.
4. **No hardcoded dropdown options/indexes/counts** — read options live.
5. **Fresh data for isolation** — RBAC/permission tests create their own record; never a random pre-existing one.
6. **Locators on internal field names, never display labels.**
7. **Presence-check anything env-conditional** (custom fields, flags); skip with a log line, never throw.
8. **One pass proves nothing** — re-run 3–5× in isolation before "fixed".
9. **Ripple-check shared code** — grep every consumer; change must be additive.
10. **No symptom patch without confirmed root cause**; if unreproducible, label it "hardened, root cause not confirmed".
11. **Unrelated bug found → stop and report**; neither fix nor ignore silently.
12. **Live evidence over assumption**; old conclusions decay.
13. **No commits/pushes/merges without explicit permission.**
14. **Docs carry real evidence** (error text, IDs, counts) — and follow the Definition of Done below.
15. **ID capture uses a versioned `/v1/<module>/` path**, excludes `/reports/`, never a bare substring.
16. **Session expiry has several symptoms** (`/signIn`, "Forbidden" page, silent `waitForResponse` timeout) — use `isSessionExpiryPage()` and `armResponseWaitWithRecovery()`; extend the combinators, don't add a 6th mechanism.
17. **"Unique today" is not unique tomorrow** — narrowest reliable scope.
18. **Fix a bug class everywhere** (grep) and record deliberate leftovers in the active-issues file.
19. **Retry budgets sized per environment from measured latency**; exhaustion fails loudly, never guesses.
20. **Environment-scoping conclusions decay** — re-verify "qa-only"/"small dataset" claims.
21. **A clean local run doesn't disprove a load-dependent flake** — defensive hardening, labeled.
22. **Never log a sensitive field's raw value** (`password|token|secret|api key`) — redact.
23. **CI differs per branch** — check which pipeline actually protects the change ([docs/CI_PIPELINES.md](docs/CI_PIPELINES.md)).
24. **Reports/logs are overwritten by later runs** — copy evidence before re-running.
25. **Verify git state (`reflog`, `stash list`, `fetch`) before concluding work is lost.**

Full mechanics for each rule are in [docs/PATTERNS.md](docs/PATTERNS.md); ripple/session-expiry/lock history in [docs/known-issues/](docs/known-issues/README.md).

## Definition of Done — a task is not done until all six are true

1. `npm run docs:refresh` run — test counts, module table, tag counts, shard plan and the CI matrix are regenerated from the real repo (never type them; `npm run generate:test-counts` first if the suite changed).
2. One line added to [CHANGELOG.md](CHANGELOG.md) (newest first).
3. Issue found → entry in [docs/KNOWN_ISSUES_ACTIVE.md](docs/KNOWN_ISSUES_ACTIVE.md). Issue closed → ≤15-line summary moved to its `docs/known-issues/<topic>.md` and the active entry deleted.
4. Design decision made or reversed → ADR added or updated in `docs/adr/`.
5. `Last verified` updated on every doc you touched (date + `git rev-parse --short HEAD`).
6. `npm run check:docs` passes (add `-- --live` before a PR).

Size policy (why this file stays small): every doc has a size budget; the full policy and the incident template are in [docs/CONTRIBUTING_TESTS.md](docs/CONTRIBUTING_TESTS.md#size-policy). Never `@`-import a large file here — imports load into every session.
