#!/bin/bash
# formfields-attempt-gate.sh — thin wrapper, kept so sandbox.yml's call stays `bash .github/scripts/formfields-attempt-gate.sh ff|reset`.
# The logic is formfields-attempt-gate.js next to it (Node fetch, no gh/jq: the Playwright container image has neither,
# canary run 45379221092; plain node because this step runs before npm ci). It prints skip=true|false to $GITHUB_OUTPUT
# and always exits 0; if node itself cannot start, this wrapper writes skip=false (run normally) so the gate can only
# ever save time, never hide a test run.
# Usage: bash .github/scripts/formfields-attempt-gate.sh ff|reset   (env: see the .js header)
set -u
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
node "$(dirname "$0")/formfields-attempt-gate.js" "${1:-}" || true
if [ "$OUT" != "/dev/stdout" ] && ! grep -q '^skip=' "$OUT" 2>/dev/null; then
  echo "::warning title=formFields attempt gate::the gate script did not report — running normally (never skipping on uncertainty)"
  echo "skip=false" >> "$OUT"
fi
exit 0
