# ADR 0014 — Definitive errors are not retried; interact only on a real ready signal

> **Purpose:** Records three test-framework rules fixed on 2026-11-02 after the sandbox flake review.
> **Read when:** You add a retry, a click-then-verify loop, or a dropdown/panel interaction.
> **Size budget:** 4k chars (hard cap 60k)
> **Last verified:** 2026-11-02 @ 9e8a738

## Status
Accepted — 2026-11-02 (proven locally on QA and staging; sandbox CI not yet run)

## Context
- A 400 `000000` on lead/contact creates (staging, KI-58) was classified transient and the whole create retried 3 times: an outage became 3 h job timeouts.
- The lead Save click-verify used a 4 s window that started before the click; under CPU load it expired, the retry clicked the disabled in-flight button and failed on a lead that had been created (call-logs:721).
- The lead Notes panel was opened before the lead details loaded, so its list request lacked `targetEntityOwnerId` and got a 400 that the panel never repeats (leads.rbac:411).

## Decision
1. Only transport errors (no response), 429 and 5xx may be retried, with a log line (`src/utils/retryableStatus.ts`). A 400 is a definitive answer and fails at once with its status, code and message.
2. A click's effect is verified from its own consequence (request seen, or the button left the enabled state), measured from when the click resolved. Never re-click a disabled button. A save passes only with a captured, 2xx-confirmed id.
3. Open a panel or dropdown only after its data dependency is visibly loaded (e.g. the lead name in the header); do not reload-and-retry around a 4xx. If the app still answers 4xx, throw with the request as evidence (possible app issue).
4. React-select pickers go through `BasePage.openReactSelectAndWaitForOptions()`: it re-clicks only when no menu is open, and only waits when a menu is open but empty.

## Consequences
- Fewer hidden failures; a real backend outage now fails in one attempt.
- Remaining modules still use their own `.is-invalid__option` pickers (KI-59).

## Revert
Restore the per-page classifiers and the old click-verify; not advised.
