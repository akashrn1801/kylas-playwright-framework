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
# MAX_ATTEMPTS, BACKOFF_BASE_SECONDS, TOTAL_BUDGET_SECONDS, REAP_APT).
#
# Leftover apt-get (sandbox run 37753304635, job formFields (deal)): attempt 1
# hit the 180 s limit (exit 124); attempts 2 and 3 failed at once with "Could
# not get lock /var/lib/dpkg/lock-frontend. It is held by process 2708
# (apt-get)", the same pid both times. `timeout` only waits for its direct
# child (npx) and signals that child's process group; an apt-get started under
# `sudo` may sit outside that group, so it can outlive the attempt. That this
# is what happened is NOT confirmed (nothing logged the pid's parent). Two
# guards, both harmless if the cause was something else:
#   1. after a timed-out attempt, list and terminate leftover apt-get
#      (TERM, then KILL after 5 s). dpkg itself is never killed (killing it
#      mid-install leaves a half-configured package set).
#   2. `DPkg::Lock::Timeout "60"` in the same apt conf file, so a retry waits
#      up to 60 s for the dpkg lock instead of failing instantly. It sits
#      inside the attempt's own timeout.
# TOTAL_BUDGET_SECONDS (570) keeps the whole script under the step's 600 s:
# each attempt is clamped to the time left (minus the 15 s kill grace). The
# old "~9.25 min" figure ignored that grace; 3 x (180 + 15) + backoff would
# have touched 10 min.
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
TOTAL_BUDGET_SECONDS="${TOTAL_BUDGET_SECONDS:-570}"
KILL_GRACE_SECONDS=15
MIN_ATTEMPT_SECONDS="${MIN_ATTEMPT_SECONDS:-30}"
REAP_APT="${REAP_APT:-auto}"

# Terminate any apt-get still running after a timed-out attempt. Logs what it
# found. dpkg is deliberately left alone.
reap_leftover_apt() {
  local pids
  pids=$(pgrep -x apt-get 2>/dev/null | tr '\n' ' ')
  if [ -z "${pids// /}" ]; then
    echo "no leftover apt-get after the timed-out attempt"
    return 0
  fi
  echo "::warning::leftover apt-get after timed-out attempt (pids: $pids) — terminating"
  ps -o pid,ppid,pgid,etime,args -p "$(echo "$pids" | tr " " ",")" 2>/dev/null || true
  # shellcheck disable=SC2086 # pids is a space-separated pid list
  sudo kill -TERM $pids 2>/dev/null || true
  sleep 5
  pids=$(pgrep -x apt-get 2>/dev/null | tr '\n' ' ')
  if [ -n "${pids// /}" ]; then
    # shellcheck disable=SC2086
    sudo kill -KILL $pids 2>/dev/null || true
    sleep 1
  fi
}

FLAGS="$*"
if [[ " $FLAGS " == *" --with-deps "* ]]; then
  if printf 'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "2";\nDPkg::Lock::Timeout "60";\n' \
    | sudo tee /etc/apt/apt.conf.d/99-ci-timeouts >/dev/null 2>&1; then
    echo "apt timeouts configured (20s per connection, 2 retries, 60s dpkg lock wait)"
  else
    echo "::warning::could not write /etc/apt/apt.conf.d/99-ci-timeouts — relying on the per-attempt timeout only"
  fi
fi

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  remaining=$((TOTAL_BUDGET_SECONDS - SECONDS))
  limit=$ATTEMPT_TIMEOUT_SECONDS
  if [ "$limit" -gt $((remaining - KILL_GRACE_SECONDS)) ]; then
    limit=$((remaining - KILL_GRACE_SECONDS))
  fi
  if [ "$limit" -lt "$MIN_ATTEMPT_SECONDS" ]; then
    echo "::warning::stopping before attempt $attempt/$MAX_ATTEMPTS: only ${remaining}s left of the ${TOTAL_BUDGET_SECONDS}s budget"
    break
  fi
  echo "Playwright browser install: attempt $attempt/$MAX_ATTEMPTS (limit ${limit}s)"
  # shellcheck disable=SC2086 # INSTALL_CMD and FLAGS are intentionally word-split
  timeout -k "$KILL_GRACE_SECONDS" "$limit" $INSTALL_CMD $FLAGS
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "Playwright browser install succeeded on attempt $attempt"
    exit 0
  fi
  if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
    echo "::warning::Playwright browser install attempt $attempt/$MAX_ATTEMPTS timed out after ${limit}s (exit $rc)"
    if [ "$REAP_APT" = "always" ] || { [ "$REAP_APT" = "auto" ] && [[ " $FLAGS " == *" --with-deps "* ]]; }; then
      reap_leftover_apt
    fi
  else
    echo "::warning::Playwright browser install attempt $attempt/$MAX_ATTEMPTS failed (exit $rc)"
  fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    sleep $((BACKOFF_BASE_SECONDS * attempt))
  fi
  attempt=$((attempt + 1))
done

echo "::error title=Playwright browser install failed::no attempt succeeded (ran $((attempt - 1))/$MAX_ATTEMPTS, last exit ${rc:-none}) — no tests were run. This is a runner/network problem; re-run the failed jobs."
exit 1
