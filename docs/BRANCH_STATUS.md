# Branch Status

> **Purpose:** Where the current feature branch stands (PR, CI result, open questions); a dated snapshot, not a rulebook.
> **Read when:** You start a session on this branch, or need to know what is unmerged and unproven.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-10-29 @ 9e60850

Snapshot of 2026-10-31. Git facts come from the maintainer's statements; it decays: re-check before trusting.

## `feature/leads-coverage-gaps-20261030`

- Four commits pushed (foundation, page objects, tests, docs; last `3373bfe`). Sandbox run 41066366856 on staging: all passed except two new lead tests: the duplicate e-mail test (staging uniqueness was NONE, now EMAIL_PHONE; the test now checks the setting first) and `attachPipelineFromDetail` (not reproducible, 10/10 on staging; hardened, [KI-56](./KNOWN_ISSUES_ACTIVE.md), root cause not confirmed).
- **Uncommitted (this working tree):** `uniqueValues.ts` (unique e-mail/phone for the lead, contact and company factories, clone flows and `LeadApi`), the lead `has-duplicates` pre-check (`GET /leads/has-duplicates`; a duplicate fails loudly, an endpoint that does not answer OK is skipped with a warning, no `@prodSafe` test creates a lead), and their doc updates.
- **Checked live 2026-10-31 (QA and staging, one run each, no repeats; sandbox CI is the stability proof):**
  - QA 6/6 pass: duplicate e-mail, attach pipeline, lead create with all fields, lead with pipeline stage, contact create, company create.
  - Staging 1/6: company create passes; lead and contact creates fail with 400 `000000`, including the duplicate-e-mail and attach-pipeline tests (they create a lead first).
  - Probe on staging (unique e-mail and phone, `has-duplicates` false): name only 200; e-mail only, phone only, both 400. The unique values did not fix it: [KI-58](./KNOWN_ISSUES_ACTIVE.md), backend/config suspected, not a test-data problem.
- **Next:** commit the working tree; have staging's lead/contact create checked (backend log for the failed requests, uniqueness config); sandbox CI after that.

## Still open

- [KI-58](./KNOWN_ISSUES_ACTIVE.md): staging create 400 `000000` with e-mail/phone. [KI-56](./KNOWN_ISSUES_ACTIVE.md): needs the failed run's trace if it recurs.
- **Follow-up, separate branch (not changed here):** the lead/contact UI create classifies any generic-error 400 (`000000`, no field errors) as `TransientLeadSaveError` / the contact equivalent and retries the whole create up to 3 times. A 400 is not transient; it hid KI-58 behind retries (staging: 3 identical 400s per create). Revisit what counts as transient and fail on the first definitive 400.
- [KI-52](./KNOWN_ISSUES_ACTIVE.md) to KI-55: lead coverage known app bugs and watch items; the tests stay green until Kylas fixes them.
- Jenkins sharded-path items ([KI-45](./KNOWN_ISSUES_ACTIVE.md) to KI-47) and KI-48/49/51 carry over from the previous snapshot (2026-10-29) and were not re-checked.
- `check:docs` compares "Last verified" with the commit author date; a checkout or reset can show false errors.
