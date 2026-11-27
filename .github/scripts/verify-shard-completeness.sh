#!/bin/bash
# ============================================================================
# verify-shard-completeness.sh
# Compares the shard blob reports that actually arrived with the number
# expected, annotates the run, and writes reports/<env>/shard-completeness.json
# for `npm run history:sync` and `npm run notify` (src/notifications/
# ShardCompleteness.ts).
#
# Usage: bash .github/scripts/verify-shard-completeness.sh <env> <expected-core-shards> <formfields-shards>
#   env                    reports/<env>/ output dir (qa | staging | prod)
#   expected-core-shards   planned core shard count ('' / non-numeric => no file written)
#   formfields-shards      6 when the formFields track ran, else 0
#
# Always exits 0, BY DESIGN: every later step (merge, history sync, notify,
# reset, upload) must still run to report the partial result. Failing here
# would skip the merge and leave only a "report not available" email. The
# failure is made visible by the ::error:: annotation and, mainly, by the
# email/history handling of the JSON this writes.
# ============================================================================
set -u

ENV_NAME="${1:?env required}"
CORE="${2:-}"
FORMFIELDS="${3:-0}"
BLOB_DIR="${BLOB_DIR:-all-blob-reports}"

if ! [[ "$CORE" =~ ^[0-9]+$ ]] || ! [[ "$FORMFIELDS" =~ ^[0-9]+$ ]]; then
  echo "::warning::shard completeness not checked: expected core shards '$CORE' / formFields shards '$FORMFIELDS' are not numbers (a plan/detect output is missing) — not guessing"
  exit 0
fi

EXPECTED=$((CORE + FORMFIELDS))
ACTUAL=$(find "$BLOB_DIR" -maxdepth 1 -name '*.zip' 2>/dev/null | wc -l | tr -d ' ')
echo "Expected shard reports: $EXPECTED ($CORE rest-of-suite + $FORMFIELDS formFields) | Actually downloaded: $ACTUAL"

# WHY (2026-11-24, sandbox 45420781016): when the renew-session job fails every test job is SKIPPED, so no blob arrives and the
# email used to say only "Incomplete run". The workflow passes that job's result; a result other than success on an incomplete
# run is written as the cause, so the notification names it even if the renew-session-failed.json artifact is missing.
RENEW="${RENEW_SESSION_RESULT:-}"
CAUSE=""
if [ "$ACTUAL" -lt "$EXPECTED" ] && [ -n "$RENEW" ] && [ "$RENEW" != "success" ]; then
  CAUSE="renew-session:$RENEW"
fi

mkdir -p "reports/$ENV_NAME"
if [ -n "$CAUSE" ]; then
  printf '{"expected":%s,"reported":%s,"cause":"%s"}\n' "$EXPECTED" "$ACTUAL" "$CAUSE" > "reports/$ENV_NAME/shard-completeness.json"
else
  printf '{"expected":%s,"reported":%s}\n' "$EXPECTED" "$ACTUAL" > "reports/$ENV_NAME/shard-completeness.json"
fi

if [ -n "$CAUSE" ]; then
  echo "::error title=No test job ran::The renew-session job did not succeed (result: $RENEW), so the test jobs were skipped, not crashed: $ACTUAL of $EXPECTED shard reports exist. See that job's summary; the email names the cause."
elif [ "$ACTUAL" -lt "$EXPECTED" ]; then
  MISSING=$((EXPECTED - ACTUAL))
  echo "::error::Incomplete run — $MISSING of $EXPECTED shard(s) never uploaded a blob report (the job crashed, hung or was cancelled/timed out). Merged Total/Passed/Failed cover only $ACTUAL/$EXPECTED shards and UNDERSTATE the run. The email is marked INCOMPLETE and this run is excluded from history trends. Check the run's per-job status (Actions tab)."
else
  echo "All $EXPECTED shards reported successfully."
fi
exit 0
