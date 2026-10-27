# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-27 @ a9f5372

Snapshot of 2026-10-27, from `git`/`gh` output the user confirmed. It decays: re-check before trusting.

## `feature/main-run-failures-20261021`

- 6 commits ahead of `origin/dev`, in sync with its remote branch; **no PR exists**.
- Contents: `b3e10bb` backend-rejected writes surfaced in validation errors and main-run failure classification · `a4ce53f` call-log edit save wait, meetings.rbac:139 · `b220296` meetings.rbac related-record selection · `f1858b0` P&S write-shape logging, reset-field-config re-auth · `d13481e` browser install 2 x 300 s · `a9f5372` apt mirror rewrite.
- Sandbox run 40279659288 (`a9f5372`) passed all 14 jobs. Nobody has read its logs, so it is **unconfirmed** that the apt-mirror rewrite and the 2 x 300 s retry actually fired. Run 40277774212 (`d13481e`) was cancelled, not failed.
- `npx tsc --noEmit` passes.

## Open questions

- Did the install steps (mirror rewrite, 2 x 300 s attempts, leftover-apt-get kill, 570 s budget) run as designed? Needs a read of run 40279659288's logs (KI-37 stays unverified until then).
- When does the user open the PR into `dev`?

## Resolved 2026-10-27

- Build #189 ledger record (KI-37 item 6): replaced in place with the complete 417-test record by `ci/reporting-history` commit `c922126`; nothing to mark. Detail in KI-37 and `docs/known-issues/sharding-and-locks.md`.
- `docs/REPORTING.md` §6.1 now documents failure-cause classification and `check:failure-labels`; `locators-and-timing.md` now says the Deals clone fallback closes via the header X.
- CHANGELOG now covers every commit from `f33aea0` to `a9f5372`.

## Known leftovers

- `check:docs` compares "Last verified" with file mtime, which a checkout or reset resets: a clean checkout can show false errors (analysis delivered to the user, no change made).
- `docs/known-issues/sharding-and-locks.md` (2026-10-07 entry) still says "Commit: not committed yet"; not re-verified, left as is.
- Registry entries `products-put-500-00903002` and `contacts-post-400-000000-empty` carry a `KI-TBD` placeholder `kiRef`.
