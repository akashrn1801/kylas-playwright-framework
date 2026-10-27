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
#   - per attempt: 300 s (was 180 s, see "Slow mirror" below)
#   - 2 attempts, 5 s backoff, last attempt clamped to the remaining budget
#     => at most TOTAL_BUDGET_SECONDS (570 s), inside the workflows' step-level
#     `timeout-minutes: 10`, which stays as the backstop.
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
# Slow mirror (sandbox run 39934344278, jobs shard 2 attempt 1, formFields deal
# and company attempt 2): all 3 attempts timed out at 180 s, every time inside
# the `apt-get install` package download from azure.archive.ubuntu.com (the
# 25.9 MB set of fonts/glib/nss/xvfb), never in the browser download. The
# mirror was slow, not dead (the 20 s stall timeout never fired): a healthy job
# on the same run needed "Fetched 25.9 MB in 2min 0s (216 kB/s)", 139 s for the
# whole step. apt keeps the debs it already fetched, so a retry resumes (20.5 MB
# then 11.8 MB left on attempts 2 and 3). Fewer, longer attempts therefore let a
# slow download finish: attempt 1 gets 300 s, attempt 2 the rest of the budget
# (about 245 s). Each attempt now logs its elapsed time so a slow mirror is
# visible even when the install succeeds.
#
# Apt mirror override (default on; APT_MIRROR_OVERRIDE=off disables it, or change
# the default below). On ubuntu-24.04 runners apt reads
# "URIs: mirror+file:///etc/apt/apt-mirrors.txt", and every download in our logs
# (799 Get: lines, security pocket included) came from azure.archive.ubuntu.com.
# That mirror regularly degrades to a trickle that apt's timeouts cannot catch
# because the connection stays alive: 5 of 21 installs were slow in sandbox run
# 39934344278 (159 kB/s, 216 kB/s, three jobs stalled). Before the install,
# with --with-deps, every file under /etc/apt that names azure.archive.ubuntu.com
# is rewritten to http://archive.ubuntu.com/ubuntu/ (the security pocket moves
# with it: same archive, apt signature checks unchanged), each changed file is
# logged with its matching lines before and after, and if an azure reference
# survives a rewrite that changed at least one file the script fails with an
# ::error::. If nothing references azure, it logs that and carries on. A rewrite
# that could not be written (no permission) only warns: the bounded attempts
# below stay the backstop. APT_DIR and APT_SUDO exist for the smoke tests only.
#
# Unsupported runner OS (2026-10-20, main run 39456246717): on ubuntu 26.04
# Playwright 1.60.0 prints "Cannot install dependencies for ubuntu26.04-x64 ...
# Error: Playwright does not support chromium on ubuntu26.04-x64" and exits
# non-zero within seconds. That is deterministic, so the script stops after the
# first such failure instead of burning all attempts. Only a FAILED attempt is
# inspected: "BEWARE: your OS is not officially supported" alone is a warning
# that also prints on installs that go on to succeed, so it is not a trigger.
#
# apt-level timeouts: with --with-deps, a 20 s per-connection stall timeout and
# 2 retries are written to /etc/apt/apt.conf.d/99-ci-timeouts. That catches a
# stalled mirror connection but NOT every kind of hang (the cause of the
# 2026-10-07 hang is unknown), so the outer `timeout` is the guarantee and the
# apt options only make the common stall recover sooner.
# ============================================================================
set -u

INSTALL_CMD="${INSTALL_CMD:-npx playwright install chromium}"
ATTEMPT_TIMEOUT_SECONDS="${ATTEMPT_TIMEOUT_SECONDS:-300}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-2}"
BACKOFF_BASE_SECONDS="${BACKOFF_BASE_SECONDS:-5}"
TOTAL_BUDGET_SECONDS="${TOTAL_BUDGET_SECONDS:-570}"
KILL_GRACE_SECONDS=15
MIN_ATTEMPT_SECONDS="${MIN_ATTEMPT_SECONDS:-30}"
VERSION_CMD="${VERSION_CMD:-npx --no-install playwright --version}"
ATTEMPT_LOG=$(mktemp)
trap 'rm -f "$ATTEMPT_LOG"' EXIT
REAP_APT="${REAP_APT:-auto}"
APT_MIRROR_OVERRIDE="${APT_MIRROR_OVERRIDE:-on}"
APT_DIR="${APT_DIR:-/etc/apt}"
APT_SUDO="${APT_SUDO-sudo}"

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

# True when the attempt log shows Playwright refusing this OS (deterministic).
unsupported_os_in_log() {
  grep -qE 'does not support [a-z-]+ on |Cannot install dependencies for [^ ]+ with Playwright' "$ATTEMPT_LOG"
}

# Print the final "unsupported OS" error and exit non-zero.
fail_unsupported_os() {
  local os pw
  os=$(grep -oE 'does not support [a-z-]+ on [^ ]+' "$ATTEMPT_LOG" | head -1 | sed 's/.* on //')
  [ -n "$os" ] || os=$(grep -oE 'dependencies for [^ ]+' "$ATTEMPT_LOG" | head -1 | sed 's/.* for //')
  # shellcheck disable=SC1091
  [ -n "$os" ] || os=$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-unknown}")
  # shellcheck disable=SC2086 # VERSION_CMD is intentionally word-split
  pw=$($VERSION_CMD 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  echo "::error title=Playwright does not support this runner OS::Playwright ${pw:-<unknown version>} does not support this runner OS (${os}): a re-run will not help. Pin runs-on to a supported image (see docs/RUNBOOK.md) or upgrade Playwright."
  exit 1
}

# Rewrite azure.archive.ubuntu.com to archive.ubuntu.com under $APT_DIR and
# verify. Logs every changed file. Exits 1 only when a rewrite changed at least
# one file and an azure reference still survives.
rewrite_apt_mirror() {
  if [ "$APT_MIRROR_OVERRIDE" = "off" ]; then
    echo "apt mirror override is off (APT_MIRROR_OVERRIDE=off): leaving $APT_DIR as configured"
    return 0
  fi
  local host_re='azure\.archive\.ubuntu\.com' files f changed=0 left sum_before sum_after
  # shellcheck disable=SC2086 # APT_SUDO is empty or "sudo" (word-split on purpose)
  files=$($APT_SUDO grep -rIl -e "$host_re" "$APT_DIR" 2>/dev/null)
  if [ -z "$files" ]; then
    echo "apt mirror: nothing to rewrite (no azure.archive.ubuntu.com reference under $APT_DIR)"
    return 0
  fi
  while IFS= read -r f; do
    echo "apt mirror: rewriting $f to http://archive.ubuntu.com/ubuntu/ (before):"
    # shellcheck disable=SC2086
    $APT_SUDO grep -n -e "$host_re" "$f" | sed 's/^/    /'
    # shellcheck disable=SC2086
    sum_before=$($APT_SUDO cksum "$f" 2>/dev/null)
    # shellcheck disable=SC2086
    if $APT_SUDO sed -i -E "s#https?://${host_re}/ubuntu/?#http://archive.ubuntu.com/ubuntu/#g" "$f"; then
      # shellcheck disable=SC2086
      sum_after=$($APT_SUDO cksum "$f" 2>/dev/null)
      if [ "$sum_before" != "$sum_after" ]; then
        changed=$((changed + 1))
        echo "apt mirror: $f (after):"
        # shellcheck disable=SC2086
        $APT_SUDO grep -n -e 'archive\.ubuntu\.com' "$f" | sed 's/^/    /'
      else
        echo "apt mirror: $f unchanged (no URL of the expected form)"
      fi
    else
      echo "::warning::apt mirror: could not rewrite $f"
    fi
  done <<<"$files"
  # shellcheck disable=SC2086
  left=$($APT_SUDO grep -rIn -e "$host_re" "$APT_DIR" 2>/dev/null)
  if [ -z "$left" ]; then
    echo "apt mirror: rewrote $changed file(s); no azure.archive.ubuntu.com reference left under $APT_DIR"
    return 0
  fi
  if [ "$changed" -ge 1 ]; then
    echo "::error title=apt mirror rewrite incomplete::azure.archive.ubuntu.com is still referenced under $APT_DIR after rewriting $changed file(s): ${left//$'\n'/ | }"
    exit 1
  fi
  echo "::warning::apt mirror: could not rewrite any file, azure.archive.ubuntu.com stays in use (relying on the bounded attempts)"
  return 0
}

FLAGS="$*"
if [[ " $FLAGS " == *" --with-deps "* ]]; then
  if printf 'Acquire::http::Timeout "20";\nAcquire::https::Timeout "20";\nAcquire::Retries "2";\nDPkg::Lock::Timeout "60";\n' \
    | sudo tee /etc/apt/apt.conf.d/99-ci-timeouts >/dev/null 2>&1; then
    echo "apt timeouts configured (20s per connection, 2 retries, 60s dpkg lock wait)"
  else
    echo "::warning::could not write /etc/apt/apt.conf.d/99-ci-timeouts — relying on the per-attempt timeout only"
  fi
  rewrite_apt_mirror
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
  : >"$ATTEMPT_LOG"
  # Process substitution (not a pipe): a leftover child holding the pipe open
  # after a timeout must not stall the script behind `tee`.
  attempt_started=$SECONDS
  # shellcheck disable=SC2086 # INSTALL_CMD and FLAGS are intentionally word-split
  timeout -k "$KILL_GRACE_SECONDS" "$limit" $INSTALL_CMD $FLAGS > >(tee "$ATTEMPT_LOG") 2>&1
  rc=$?
  echo "Playwright browser install: attempt $attempt/$MAX_ATTEMPTS took $((SECONDS - attempt_started))s (exit $rc)"
  if [ "$rc" -eq 0 ]; then
    echo "Playwright browser install succeeded on attempt $attempt"
    exit 0
  fi
  if [ "$rc" -ne 124 ] && [ "$rc" -ne 137 ]; then
    sleep 1 # let the tee in the process substitution flush the attempt's last lines
    if unsupported_os_in_log; then
      fail_unsupported_os
    fi
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
