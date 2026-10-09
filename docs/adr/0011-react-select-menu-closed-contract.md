# ADR 0011 — A react-select pick must end with its menu verified closed

> **Purpose:** Records the one shared primitive that closes a still-open react-select menu after a pick, and why swallowed hidden-waits are not allowed.
> **Read when:** Adding or changing any helper that picks from a react-select (`.is-invalid__menu`), or triaging "subtree intercepts pointer events" with a `css-1dsbpcp` node.
> **Size budget:** 8k chars (hard cap 60k)
> **Last verified:** 2026-10-09 @ 0c719fe

## Status
Accepted — 2026-10-08. Confirmed on QA for Units (CI run 37778400646) and, locally with `--retries=0`, for DB27 and both Call Logs tests (2026-10-08). Not yet seen in CI ([KI-35](../KNOWN_ISSUES_ACTIVE.md)).

## Context
QA run 37733648349 failed in shards 1, 2, 4, 5 with the same error: `<div class="css-1dsbpcp"></div> from <div class="css-…"> subtree intercepts pointer events`. That div is the full-viewport blocker (`position: fixed; inset: 0`) of an open react-select menu.
- Kylas's checkbox-style multi-selects (P&S Units, Assign Dashboard assignees, Call Log Customer Emotion) keep the menu open after a pick on QA. Pick-to-"set" gap in every QA log: 10.1–10.4 s (the old `waitFor('hidden', expect).catch()` timing out). Same picks on stage: ~0.3 s.
- Failure screenshots show the open menu with the chip already selected (Assign Dashboard: "Restricted User"; Call Logs: Customer Emotion list over the Save footer).
- `selectRandomFromSearchableReactSelect()` and the P&S helper swallowed the timeout; Call Logs "closed" the menu with a synthetic `click()` on `#callLogModal`, which react-select ignores (it closes on blur/Escape).

## Decision
`BasePage.ensureReactSelectMenuClosed(description, control?)`: wait 1.5 s for a natural close; if still open, focus the control's input and press Escape (only when open: Escape on a closed menu clears the value); wait for hidden; otherwise throw naming the field. No `.catch` around the check. Migrated: P&S `selectFromReactSelect`, `selectRandomFromSearchableReactSelect` (Dashboard assignees, Contact company), Call Logs Customer Emotion. Other call sites are listed in KI-35.

## Consequences
- Saves ~8.5 s per Units pick on QA (the 10 s wait is gone).
- A menu that stays open now fails at the pick, naming the field, instead of at an unrelated later click.
- Escape did not dismiss the Assign Dashboard modal or the Call Log panel in the live runs (Save worked afterwards). It is unknown whether Escape ran at all: the primitive does not log which path it took.
- Stage's 0.3 s close vs QA's never closing is observed, not explained (a frontend build difference is a hypothesis).

- **Extended 2026-10-09:** the primitive now replaces every other swallowed menu-hidden wait (BasePage single/multi-select and lookup helpers, Quotations, Tasks, Contacts, Companies, Deals, Meetings, Reports). A new rule in `scripts/check-test-conventions.ts` (`no-swallowed-react-select-menu-wait`) flags `waitFor({ state: 'hidden' }).catch(...)` on a menu locator unless the handler rethrows or it sits inside the primitive. Risk: the `.is-invalid__menu` locator is page-wide, so an unrelated menu left open on purpose would now be Escaped, or fail the pick.

## How to revert
Restore the inline `waitFor({ state: 'hidden' }).catch(...)` at the call sites, delete the method and remove the convention rule.

## Commit(s)
Not committed (user commits).
