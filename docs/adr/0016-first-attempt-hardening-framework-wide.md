# ADR 0016 — First-attempt hardening: measure first, real ready signals, no hidden retries

> **Purpose:** Records the decisions of the 2026-11 framework-hardening work (batches B0–B8) so each batch adds to one place; extends [ADR 0014](0014-definitive-errors-and-ready-signals.md) without changing it.
> **Read when:** Changing waits, retries, login/session handling or the measurement settings listed below.
> **Size budget:** 12k chars (hard cap 60k)
> **Last verified:** 2026-11-04 @ 4c10d24

## Status
Proposed — 2026-11-04. B0 (measurement) and S1/S2 are in the code; S3 and the later batches are listed in "Planned" and not implemented. Nothing here is proven under the 10-worker sandbox load yet.

## Decisions (B0)
- **A test that passes on retry or on the rerun shard is a framework/test problem** until a network log proves a backend error on the exact request; even then the load is reduced, the failure is not hidden.
- **`RETRY_COUNT=0` is honoured** (`config/config.ts`). Before, `|| 1` turned 0 into 1, so a first-attempt baseline could not be measured. Unset or invalid still gives 1; CI never sets 0, so CI behaviour is unchanged.
- **Waits name themselves.** A response-wait timeout in `armResponseWaitWithRecovery` now says what it awaited, how long it waited and the limit; `waitForListReady` logs which signal ended the wait (`list response`, `list table visible`, `rate-limit page`) and after how many ms. Messages and logs only: no timeout, retry or outcome changed.
- **The staging baseline is the sandbox run** (10 workers, `--retries=0`). QA did not reproduce the failures (37 of 37 first-attempt passes before the local run was stopped), so no local staging or throttle run is made.

## Decisions (S1/S2, 2026-11-04)
- **S1: one session check, in globalSetup only.** Each role's saved state is validated once by `GET /v1/products/layout?view=create` with its bearer token (`tokenAcceptedByApi`; 2xx = usable, 401/403 = not usable, transport/429/5xx retried up to 3 tries per ADR 0014 §1, any other status fails with status and body). Workers no longer open the app to "validate" (the removed `AuthManager.isSessionValid` reported all workers as expired within one second of a fresh login and sent them all to re-login). A real expiry still works: a 401 or a `/signIn` redirect clears the state file (`fixtures/index.ts`) and the next `getContextForRole` logs in.
- **S2: login slots.** At most 2 logins at once per machine, across worker processes (`src/auth/loginGate.ts`, atomic mkdir slots, stale after 4 min, wait bounded at 3 min and failing with the holders). It replaces the random 0-3 s sleep before the restricted login in `fixtures/index.ts`. It limits one machine only; cross-job pacing is S3.
- **Login errors are named and 4xx is definitive.** `loginHeadless` and the globalSetup UI login retry only a transport error, 429 or 5xx (3 tries); a 400 such as `{"code":"000004","message":"Database error"}` fails at once with status, code and message. Fewer parallel logins is the fix, not another attempt.
- Proof so far: offline fake API (200, 401, 429-then-200, 500-then-200, 429 x3, 400); 6 processes competing for slots never exceeded 2; QA `--repeat-each=3 --workers=3`, 18 of 18 passed first attempt with no session-expiry log line. Not yet measured: the 10-worker staging run.

## Planned (decided in the plan, not yet implemented; each moves to Decisions when done)
- S3 staggered formFields/core job starts (workflow change; the diff is shown to the owner first).
- New retries only for reads/idempotent calls and only per ADR 0014 §1 (transport, 429, 5xx; never 400); the three existing create retries stay.
- `saveAndAwait` and `clickWhenReady` helpers; fixed sleeps replaced by the app's own signal; CO12 as in the plan (no reload workaround, fail fast with the app error).
