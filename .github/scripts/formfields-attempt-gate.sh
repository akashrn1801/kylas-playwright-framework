#!/bin/bash
# ============================================================================
# formfields-attempt-gate.sh
# Decides, on a RE-RUN of a workflow run (github.run_attempt > 1), whether a
# formFields matrix job or the field-config reset job can skip itself. Added
# 2026-11-03 for sandbox.yml (ADR 0015).
#
# WHY: re-running one failed core shard in the Actions UI also re-runs its
# dependents: every formFields matrix job (80-110 min each), the reset and the
# merge. A formFields entity that already passed in an earlier attempt of this
# run has nothing to prove again; its blob/misc-errors artifacts from that
# attempt stay in the run and are merged by merge-and-report.
#
# Usage: bash .github/scripts/formfields-attempt-gate.sh ff|reset
#   ff    needs env JOB_NAME (exact job name, e.g. "playwright-formFields (lead)"),
#         ARTIFACT_NAME (that entity's blob artifact), LABEL (for log lines)
#   reset (no extra env) skips when no formFields job ran tests in THIS attempt
# Both need GH_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID,
# GITHUB_RUN_ATTEMPT, GITHUB_OUTPUT; optional DETECT_JOB_NAME (see below).
#
# Prints skip=true|false to $GITHUB_OUTPUT and ALWAYS exits 0. Any doubt (API
# error, odd answer, artifact missing) means skip=false, i.e. run exactly as
# today: this gate may only ever save time, never hide a test run.
#
# "Re-run all jobs": the detect job then runs again in the new attempt, so its
# job entry carries run_attempt == the current attempt. That is treated as a
# deliberate full re-run and nothing is skipped (UNVERIFIED: how GitHub reports
# a job that was NOT re-run; if it also showed run_attempt == current, nothing
# would ever be skipped, which is the safe direction).
# The test step name prefix "Run formFields tests for " is shared with
# sandbox.yml's formFields job: keep both in sync.
# ============================================================================
set -u
set -o pipefail

MODE="${1:?mode required: ff | reset}"
REPO="${GITHUB_REPOSITORY:-}"
RUN_ID="${GITHUB_RUN_ID:-}"
ATTEMPT="${GITHUB_RUN_ATTEMPT:-1}"
OUT="${GITHUB_OUTPUT:-/dev/stdout}"
DETECT_JOB_NAME="${DETECT_JOB_NAME:-detect target + shard plan}"
TEST_STEP_PREFIX="Run formFields tests for "
FF_JOB_PREFIX="playwright-formFields ("

emit() { echo "skip=$1" >> "$OUT"; }
run_normally() { echo "$1"; emit false; exit 0; }
fail_open() { echo "::warning title=formFields attempt gate::$1 — running normally (never skipping on uncertainty)"; emit false; exit 0; }

if ! [[ "$ATTEMPT" =~ ^[0-9]+$ ]] || [ "$ATTEMPT" -le 1 ]; then
  run_normally "First attempt: nothing to skip."
fi
[ -n "$REPO" ] && [ -n "$RUN_ID" ] || fail_open "GITHUB_REPOSITORY / GITHUB_RUN_ID missing"

# JSON array of {name, conclusion, run_attempt, steps:[{name, conclusion}]} for one attempt.
attempt_jobs() {
  gh api --paginate "repos/$REPO/actions/runs/$RUN_ID/attempts/$1/jobs?per_page=100" \
    --jq '.jobs[] | {name, conclusion, run_attempt, steps: [(.steps // [])[] | {name, conclusion}]}' | jq -s '.'
}

CURRENT=$(attempt_jobs "$ATTEMPT") || fail_open "could not read the jobs of attempt $ATTEMPT"
FULL_RERUN=$(echo "$CURRENT" | jq --arg d "$DETECT_JOB_NAME" --argjson a "$ATTEMPT" 'any(.[]; .name == $d and .run_attempt == $a)') \
  || fail_open "could not parse the jobs of attempt $ATTEMPT"
if [ "$FULL_RERUN" = "true" ]; then
  run_normally "Attempt $ATTEMPT re-ran '$DETECT_JOB_NAME' too (Re-run all jobs): nothing is skipped."
fi

if [ "$MODE" = "reset" ]; then
  COUNTS=$(echo "$CURRENT" | jq --arg p "$FF_JOB_PREFIX" --arg s "$TEST_STEP_PREFIX" '
    [.[] | select(.name | startswith($p))] as $ff
    | { total: ($ff | length),
        ran: ([$ff[] | select(any(.steps[]; (.name | startswith($s)) and .conclusion != null and .conclusion != "skipped"))] | length) }') \
    || fail_open "could not count the formFields jobs of attempt $ATTEMPT"
  TOTAL=$(echo "$COUNTS" | jq '.total'); RAN=$(echo "$COUNTS" | jq '.ran')
  [ "$TOTAL" -gt 0 ] || fail_open "no formFields job found in attempt $ATTEMPT"
  if [ "$RAN" -eq 0 ]; then
    echo "::notice title=Field-config reset skipped::no formFields job ran tests in attempt $ATTEMPT ($TOTAL skipped as already passed); the earlier attempt's reset result stands"
    emit true
  else
    run_normally "$RAN of $TOTAL formFields job(s) ran tests in attempt $ATTEMPT: reset runs."
  fi
  exit 0
fi

[ "$MODE" = "ff" ] || fail_open "unknown mode '$MODE'"
JOB_NAME="${JOB_NAME:?JOB_NAME required}"; ARTIFACT_NAME="${ARTIFACT_NAME:?ARTIFACT_NAME required}"; LABEL="${LABEL:-$JOB_NAME}"

N=$((ATTEMPT - 1))
while [ "$N" -ge 1 ]; do
  PRIOR=$(attempt_jobs "$N") || fail_open "could not read the jobs of attempt $N"
  PASSED=$(echo "$PRIOR" | jq --arg j "$JOB_NAME" --arg s "$TEST_STEP_PREFIX" \
    'any(.[]; .name == $j and .conclusion == "success" and any(.steps[]; (.name | startswith($s)) and .conclusion == "success"))') \
    || fail_open "could not parse the jobs of attempt $N"
  if [ "$PASSED" = "true" ]; then
    # The skipped job uploads nothing, so the merge needs that attempt's artifact to still exist.
    ALIVE=$(gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts?name=$ARTIFACT_NAME&per_page=100" \
      --jq '[.artifacts[] | select(.expired == false)] | length') || fail_open "could not list the artifacts of the run"
    if [ "${ALIVE:-0}" -gt 0 ]; then
      echo "::notice title=formFields $LABEL skipped::formFields $LABEL already passed in attempt $N — skipped (artifact $ARTIFACT_NAME from that attempt is used by the merge)"
      echo "formFields $LABEL already passed in attempt $N — skipped"
      emit true
      exit 0
    fi
    run_normally "formFields $LABEL passed in attempt $N but artifact $ARTIFACT_NAME is gone (expired/deleted): running it again."
  fi
  N=$((N - 1))
done
run_normally "formFields $LABEL did not pass in any earlier attempt: running normally."
