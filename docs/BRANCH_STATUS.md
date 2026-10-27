# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-27 @ 422ae55

Snapshot of 2026-10-27, from `git`/`gh` output the user confirmed. It decays: re-check before trusting.

## `feature/main-run-failures-20261021`

- 8 commits ahead of `origin/dev`; **no PR exists**. The last two, `bd59b79` and `422ae55`, are committed locally and **not yet pushed**.
- Contents: `b3e10bb` backend-rejected writes surfaced in validation errors and main-run failure classification · `a4ce53f` call-log edit save wait, meetings.rbac:139 · `b220296` meetings.rbac related-record selection · `f1858b0` P&S write-shape logging, reset-field-config re-auth · `d13481e` browser install 2 x 300 s · `a9f5372` apt mirror rewrite · `bd59b79` chore: git and gh deny rules (6 files: `.claude/settings.json` and 5 agent files) · `422ae55` docs: re-verification, KI-44, KI-43 move (17 files).
- Latest sandbox run: 40279659288 (`a9f5372`) passed all 14 jobs. It predates `bd59b79` and `422ae55`, which change only docs and `.claude/` config. Nobody has read its logs, so it is **unconfirmed** that the apt-mirror rewrite and the 2 x 300 s retry fired. Run 40277774212 (`d13481e`) was cancelled, not failed.
- `npx tsc --noEmit` passes; `npm run check:docs` passes (3 size warnings).

## Still open

- No PR yet; the user opens it into `dev` after pushing the two new commits.
- Install steps (mirror rewrite, 2 x 300 s attempts, leftover-apt-get kill, 570 s budget): needs a read of run 40279659288's logs; KI-37 stays unverified until then.
- KI-43 (staging search index) is open pending confirmation from the Kylas team; the 2026-10-26 pass is evidence of recovery, not proof. A leftover `Probe-IndexLag-*` deal on staging needs cleaning up.
- KI-44 (`CompaniesPage.captureCompanyIdFromResponse()`, bare `includes('companies')`) is latent, to be fixed on a separate branch.
- The Quotation report deployment claim is unverified: `ReportsPage.ts` says stage/prod confirmed 2026-09-03 and also QA-only as of 2026-09-09.
- `check:docs` compares "Last verified" with file mtime, which a checkout or reset resets, so a clean checkout can show false errors (analysis delivered, script not changed).
- `docs/known-issues/sharding-and-locks.md` (2026-10-07 entries) still says "Commit: not committed yet"; not checkable without git.
- Registry entries `products-put-500-00903002` and `contacts-post-400-000000-empty` carry a `KI-TBD` placeholder `kiRef`.
