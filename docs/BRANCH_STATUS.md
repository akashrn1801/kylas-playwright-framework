# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 9e60850

Snapshot of 2026-10-28. Git facts come from the maintainer's statements (`0f87be3`, `353da8f`, `02fc52e` and `9e60850` committed and pushed); it decays: re-check before trusting.

## `feature/jenkins-main-sharding-20261028`

- Cut from `dev` at `566df8c` (merge of PR #674). The Jenkins sharding work is committed as `0f87be3` (25 files, no PR). It covers the five Jenkinsfiles, `scripts/jenkins-*`, the `src/notifications/*` history and email changes, ADR 0012 and the related docs (KI-14/45/46/47).
- Second commit `353da8f` (6 files): the CO9 / CR17 notes fix (`tests/ui/companies/companies.spec.ts`, `tests/rbac/contacts.rbac.spec.ts`: `notesPanel()` instead of a one-shot placeholder-prone count; 5/5 on QA each, PROD flake not reproduced), KI-48 and the verified KI/status docs.
- Later commits (maintainer's statement): `02fc52e` (create failures report status/code/message, KI-49) and `9e60850` (P&S forms wait for custom-field definitions, KI-50). The branch is pushed: `9e60850` is on `origin/feature/jenkins-main-sharding-20261028`. The documentation and audit corrections made after that push are in the working tree, not committed.
- **Next:** let sandbox CI run, then the full sharded QA run with 2 core lanes ([RUNBOOK](./RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 6).
- Checked offline for the Jenkins work: `tsc`, the guard against a stub API, the plan helper, the selection script, Groovy syntax, `check:failure-labels`, and the maintainer's Jenkins linter run on all five files. Live 2026-10-28: an unsharded Jenkins sandbox build and sharded build 2 on QA completed. **Unproven:** two core lanes at once.

## Still open

- **Investigated, fix committed (`02fc52e`), not run on QA:** GitHub qa run 40477938102 (2026-10-27): `deals.rbac.spec.ts:342`, `quotations.spec.ts:620` / `:640` were QA backend DNS failures ([KI-49](./KNOWN_ISSUES_ACTIVE.md)). Fix: Contacts/Companies/Leads/Deals create flows report status/code/message, Quotations layout fail-fast, bounded `BasePage.fill()`, a registry signature. Unverified on QA.
- [KI-48](./KNOWN_ISSUES_ACTIVE.md): Quotation create form crash (PROD run 40637702829).
- [KI-47](./KNOWN_ISSUES_ACTIVE.md): QA test runs of the sharded path ([RUNBOOK](./RUNBOOK.md#jenkins-sharded-runs-setup-and-operation) step 6; step 5, the linter, is done). Until they pass, leave `KYLAS_SHARDED_BRANCHES` unset.
- [KI-45](./KNOWN_ISSUES_ACTIVE.md): confirm the wall-clock stamps on the next real approval. [KI-46](./KNOWN_ISSUES_ACTIVE.md): check Jenkins before dispatching `main.yml`/`prod.yml` by hand.
- [KI-37](./KNOWN_ISSUES_ACTIVE.md): the install-log read is done (sandbox run 40454948545: mirror rewrite and a healthy install confirmed); the retry, kill and budget paths stay stub-tested, so KI-37 is no longer an open item here.
- `check:docs` compares "Last verified" with file mtime, which a checkout or reset resets, so a clean checkout can show false errors.
- Open items carried from the previous snapshot (KI-43, KI-44, the Quotation deployment claim, `KI-TBD` registry refs) were not re-checked today; see [KNOWN_ISSUES_ACTIVE.md](./KNOWN_ISSUES_ACTIVE.md).
