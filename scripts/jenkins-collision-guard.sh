#!/bin/bash
# ============================================================================
# jenkins-collision-guard.sh
# Refuses to let a Jenkins run touch a shared Kylas account while a GitHub
# Actions run that drives the same account is in any not-yet-finished state:
#   queued, in_progress, waiting (environment approval), pending (GitHub's documented
#   status for a run held back, which is also where a second run of a workflow in the
#   same concurrency group, such as kylas-prod with cancel-in-progress false, waits)
#   and requested.
# These are the documented `status` values of the "List workflow runs" REST endpoint
# (docs.github.com/en/rest/actions/workflow-runs) that mean "not completed yet".
#
# Usage: bash scripts/jenkins-collision-guard.sh <prod|qa|staging> [--dry-run]
#   prod    -> checks main.yml and prod.yml   (both drive the PROD account)
#   qa      -> checks qa.yml and dev.yml      (dev.yml also runs against QA)
#   staging -> checks stage.yml, sandbox.yml and staging-promotion-gate.yml
#              (all three use the STAGING_* secrets)
# The environment argument is the one the Jenkins run actually resolved to, not
# the one its GitHub twin uses.
#
# Environment:
#   GIT_TOKEN (or PIPELINE_TOKEN)  the github-credentials PAT; needs Actions read
#   GITHUB_REPOSITORY              default akashrn1801/kylas-playwright-framework
#   API_BASE                       default https://api.github.com (override for offline tests)
#
# Exit codes: 0 clear (or --dry-run) | 1 collision, or any failure to find out | 2 usage
#
# FAILS CLOSED, BY DESIGN: a non-200 response, a network error, a missing token
# or an unparseable body all refuse the run. A guard that says "clear" when it
# could not look would be worse than no guard.
# --dry-run performs the same read-only checks and prints the verdict, but
# always exits 0 (and tolerates a missing token), for offline testing.
# ============================================================================
set -u

usage() {
  echo "Usage: bash scripts/jenkins-collision-guard.sh <prod|qa|staging> [--dry-run]" >&2
  exit 2
}

ENV_NAME="${1:-}"
[ -z "$ENV_NAME" ] && usage
shift
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) usage ;;
  esac
done

case "$ENV_NAME" in
  prod) WORKFLOWS="main.yml prod.yml" ;;
  qa) WORKFLOWS="qa.yml dev.yml" ;;
  staging) WORKFLOWS="stage.yml sandbox.yml staging-promotion-gate.yml" ;;
  *)
    echo "Unsupported env '$ENV_NAME' (expected prod, qa or staging)" >&2
    exit 2
    ;;
esac

REPO="${GITHUB_REPOSITORY:-akashrn1801/kylas-playwright-framework}"
API_BASE="${API_BASE:-https://api.github.com}"
TOKEN="${GIT_TOKEN:-${PIPELINE_TOKEN:-}}"
STATUSES="queued in_progress waiting pending requested"

if [ -z "$TOKEN" ] && [ "$DRY_RUN" -eq 0 ]; then
  echo "[collision-guard] REFUSING: no GIT_TOKEN/PIPELINE_TOKEN available, cannot check GitHub Actions (fail closed)." >&2
  exit 1
fi

TMP_BODY="$(mktemp)"
trap 'rm -f "$TMP_BODY"' EXIT

HITS=""
FAILURES=""

echo "[collision-guard] env=$ENV_NAME repo=$REPO workflows=[$WORKFLOWS] statuses=[$STATUSES] dry_run=$DRY_RUN"

for wf in $WORKFLOWS; do
  for status in $STATUSES; do
    url="$API_BASE/repos/$REPO/actions/workflows/$wf/runs?status=$status&per_page=100"
    # The token goes through a curl config on a pipe, never argv, so it cannot
    # show up in a process listing.
    if [ -n "$TOKEN" ]; then
      code="$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" |
        curl -sS --connect-timeout 10 --max-time 30 --config - \
          -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
          -o "$TMP_BODY" -w '%{http_code}' "$url" 2>"$TMP_BODY.err")"
    else
      code="$(curl -sS --connect-timeout 10 --max-time 30 \
        -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
        -o "$TMP_BODY" -w '%{http_code}' "$url" 2>"$TMP_BODY.err")"
    fi
    curl_rc=$?
    rm -f "$TMP_BODY.err"

    if [ "$curl_rc" -ne 0 ] || [ "$code" != "200" ]; then
      snippet="$(head -c 200 "$TMP_BODY" 2>/dev/null | tr '\n' ' ')"
      FAILURES="${FAILURES}  $wf status=$status -> HTTP ${code:-none} (curl rc=$curl_rc) ${snippet}"$'\n'
      continue
    fi

    parsed="$(node -e '
      const fs = require("fs");
      let body;
      try { body = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { console.log("PARSE_ERROR"); process.exit(0); }
      const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : null;
      if (runs === null || typeof body.total_count !== "number") { console.log("PARSE_ERROR"); process.exit(0); }
      if (body.total_count > runs.length) console.log("MORE\t" + body.total_count);
      for (const r of runs) console.log(["RUN", r.html_url, r.status, r.created_at, r.head_branch].join("\t"));
    ' "$TMP_BODY" 2>/dev/null)"

    if [ -z "$parsed" ] && [ ! -s "$TMP_BODY" ]; then
      FAILURES="${FAILURES}  $wf status=$status -> empty response body"$'\n'
      continue
    fi
    if echo "$parsed" | grep -q '^PARSE_ERROR'; then
      FAILURES="${FAILURES}  $wf status=$status -> HTTP 200 but the body is not a workflow-runs list"$'\n'
      continue
    fi
    if echo "$parsed" | grep -q '^MORE'; then
      HITS="${HITS}  $wf status=$status -> more runs than one page returned ($(echo "$parsed" | grep '^MORE' | cut -f2))"$'\n'
    fi
    while IFS=$'\t' read -r tag run_url run_status created branch; do
      [ "$tag" = "RUN" ] || continue
      HITS="${HITS}  $run_url  [$wf, status=$run_status, branch=$branch, created=$created]"$'\n'
    done <<<"$parsed"
  done
done

if [ -n "$FAILURES" ]; then
  echo "[collision-guard] Could not verify GitHub Actions state:" >&2
  printf '%s' "$FAILURES" >&2
fi
if [ -n "$HITS" ]; then
  echo "[collision-guard] GitHub Actions run(s) driving the $ENV_NAME account right now:" >&2
  printf '%s' "$HITS" >&2
fi

if [ -n "$HITS" ] || [ -n "$FAILURES" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[collision-guard] DRY-RUN: a real run would REFUSE (collision or unverifiable); exiting 0."
    exit 0
  fi
  echo "[collision-guard] REFUSING to start: wait for those runs to finish (or fix the API access), then re-run." >&2
  exit 1
fi

echo "[collision-guard] Clear: no queued, in-progress, waiting, pending or requested run of [$WORKFLOWS]."
exit 0
