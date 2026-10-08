#!/bin/bash
# ============================================================================
# install-playwright-browsers.sh
# Installs the Playwright Chromium browser with a hard time bound per attempt
# and a bounded retry, so a stalled `apt-get update` fails fast instead of
# silently burning the whole job timeout.
#
# Usage: bash .github/scripts/install-playwright-browsers.sh [--with-deps]
#
# Why: sandbox run 37669596623 — 2 of 6 formFields jobs printed their last apt
# line at 18:48:57Z and then nothing until the 180-minute job timeout cancelled
# them (3h00m, zero tests run). The step had no timeout of its own.
#
# Values (measured, not guessed): healthy install steps took 24-33 s on run
# 37466967016 (11 jobs) and 47 s / 85 s / 129 s on run 37669596623. So:
#   - per attempt: 180 s (1.4x the slowest healthy install seen, 129 s)
#   - 3 attempts, 5 s then 10 s backoff => at most ~9.25 minutes, inside the
#     workflows' step-level `timeout-minutes: 10`, which stays as the backstop.
# Both are overridable for testing only (INSTALL_CMD, ATTEMPT_TIMEOUT_SECONDS,
# MAX_ATTEMPTS, BACKOFF_BASE_SECONDS).
#
# apt-level timeouts: with --with-deps, a 20 s per-connection stall timeout and
# 2 retries are written to /etc/apt/apt.conf.d/99-ci-timeouts. That catches a
# stalled mirror connection but NOT every kind of hang (the cause of the
# 2026-10-07 hang is unknown), so the outer `timeout` is the guarantee and the
# apt options only make the common stall recover sooner.
# ============================================================================
set -u

INSTALL_CMD="${INSTALL_CMD:-npx playwright install chromium}"
ATTEMPT_TIMEOUT_SECONDS="${ATTEMPT_TIMEOUT_SECONDS:-180}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
BACKOFF_BASE_SECONDS="${BACKOFF_BASE_SECONDS:-5}"

FLAGS="$*"
if [[ " $FLAGS " == *" --with-deps "* ]]; then
  if printf 'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "2";\n' \
    | sudo tee /etc/apt/apt.conf.d/99-ci-timeouts >/dev/null 2>&1; then
    echo "apt timeouts configured (20s per connection, 2 retries)"
  else
    echo "::warning::could not write /etc/apt/apt.conf.d/99-ci-timeouts — relying on the per-attempt timeout only"
  fi
fi

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  echo "Playwright browser install: attempt $attempt/$MAX_ATTEMPTS (limit ${ATTEMPT_TIMEOUT_SECONDS}s)"
  # shellcheck disable=SC2086 # INSTALL_CMD and FLAGS are intentionally word-split
  timeout -k 15 "$ATTEMPT_TIMEOUT_SECONDS" $INSTALL_CMD $FLAGS
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "Playwright browser install succeeded on attempt $attempt"
    exit 0
  fi
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "::warning::Playwright browser install attempt $attempt/$MAX_ATTEMPTS timed out after ${ATTEMPT_TIMEOUT_SECONDS}s (exit $rc)"
  else
    echo "::warning::Playwright browser install attempt $attempt/$MAX_ATTEMPTS failed (exit $rc)"
  fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    sleep $((BACKOFF_BASE_SECONDS * attempt))
  fi
  attempt=$((attempt + 1))
done

echo "::error title=Playwright browser install failed::all $MAX_ATTEMPTS attempts failed or timed out (last exit $rc) — no tests were run. This is a runner/network problem; re-run the failed jobs."
exit 1
