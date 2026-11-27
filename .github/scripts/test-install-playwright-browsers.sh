#!/bin/bash
# Smoke test of the apt mirror rewrite in install-playwright-browsers.sh (npm run check:apt-mirror).
# Runs the real script against a throwaway APT_DIR with APT_SUDO empty and INSTALL_CMD=true, so nothing
# under the real /etc/apt is read or written and no browser is downloaded.
set -u
SCRIPT="$(cd "$(dirname "$0")" && pwd)/install-playwright-browsers.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAILED=0

run_case() { # name, expected exit, expected output regex, files created by the setup function
  local name="$1" want_rc="$2" want_re="$3" setup="$4" out rc
  rm -rf "$WORK/apt"; mkdir -p "$WORK/apt/apt.conf.d" "$WORK/apt/sources.list.d"
  "$setup" "$WORK/apt"
  out=$(APT_DIR="$WORK/apt" APT_SUDO='' INSTALL_CMD=true REAP_APT=off bash "$SCRIPT" --with-deps 2>&1); rc=$?
  if [ "$rc" -eq "$want_rc" ] && grep -qE "$want_re" <<<"$out"; then
    echo "PASS  $name"
  else
    echo "FAIL  $name (exit $rc, wanted $want_rc, output must match: $want_re)"; printf '%s\n' "${out//$'\n'/$'\n'      }" | sed '1s/^/      /'; FAILED=$((FAILED + 1))
  fi
}
no_host_left() { ! grep -rIqE '(azure|[a-z0-9-]+\.ec2)\.archive\.ubuntu\.com' "$WORK/apt"; }
check() { if "$@"; then echo "PASS  $CASE_NAME: $CHECK_NAME"; else echo "FAIL  $CASE_NAME: $CHECK_NAME"; FAILED=$((FAILED + 1)); fi; }

setup_azure() {
  printf 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n' >"$1/apt-mirrors.txt"
  printf 'Types: deb\nURIs: https://azure.archive.ubuntu.com/ubuntu\nSuites: noble\n' >"$1/sources.list.d/ubuntu.sources"
}
setup_ec2() { # the failing log: "Get:1 file:/etc/apt/apt-mirrors.txt Mirrorlist" -> us-east-2.ec2
  printf 'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n' >"$1/apt-mirrors.txt"
  printf 'Types: deb\nURIs: mirror+file:///etc/apt/apt-mirrors.txt\nSuites: noble\n' >"$1/sources.list.d/ubuntu.sources"
}
setup_both() { setup_azure "$1"; printf 'http://eu-west-1.ec2.archive.ubuntu.com/ubuntu/\n' >>"$1/apt-mirrors.txt"; }
setup_none() { printf 'http://archive.ubuntu.com/ubuntu/\n' >"$1/apt-mirrors.txt"; }

run_case "azure mirror is rewritten"                0 'rewrote 2 file\(s\); no azure/ec2 archive.ubuntu.com reference left' setup_azure
run_case "ec2 mirror in apt-mirrors.txt is rewritten" 0 'rewriting .*apt-mirrors.txt to http://archive.ubuntu.com/ubuntu/'   setup_ec2
run_case "azure and ec2 together"                   0 'rewrote 2 file\(s\); no azure/ec2 archive.ubuntu.com reference left' setup_both
run_case "nothing to rewrite"                       0 'nothing to rewrite \(no azure/ec2 archive.ubuntu.com reference'      setup_none

# content checks after the ec2 case
rm -rf "$WORK/apt"; mkdir -p "$WORK/apt/apt.conf.d" "$WORK/apt/sources.list.d"; setup_ec2 "$WORK/apt"
APT_DIR="$WORK/apt" APT_SUDO='' INSTALL_CMD=true REAP_APT=off bash "$SCRIPT" --with-deps >/dev/null 2>&1
CASE_NAME="ec2 content"
CHECK_NAME="apt-mirrors.txt now names archive.ubuntu.com"; check grep -q '^http://archive.ubuntu.com/ubuntu/' "$WORK/apt/apt-mirrors.txt"
CHECK_NAME="priority suffix kept";                         check grep -q 'priority:1' "$WORK/apt/apt-mirrors.txt"
CHECK_NAME="no azure/ec2 host left anywhere";             check no_host_left
CHECK_NAME="99-ci-timeouts written under APT_DIR";        check test -s "$WORK/apt/apt.conf.d/99-ci-timeouts"

# override off leaves the files alone
rm -rf "$WORK/apt"; mkdir -p "$WORK/apt/apt.conf.d" "$WORK/apt/sources.list.d"; setup_ec2 "$WORK/apt"
out=$(APT_MIRROR_OVERRIDE=off APT_DIR="$WORK/apt" APT_SUDO='' INSTALL_CMD=true bash "$SCRIPT" --with-deps 2>&1)
CASE_NAME="override off"; CHECK_NAME="reports it and leaves the ec2 host"
override_left_alone() { grep -q 'override is off' <<<"$out" && grep -q 'ec2.archive' "$WORK/apt/apt-mirrors.txt"; }
check override_left_alone

[ "$FAILED" -eq 0 ] && echo "check:apt-mirror - all checks passed" || echo "check:apt-mirror - $FAILED FAILED"
[ "$FAILED" -eq 0 ]
