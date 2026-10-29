#!/bin/bash
# ============================================================================
# jenkins-resolve-selection.sh
# Which tests a Jenkins branch runs, chosen the way that branch's GitHub
# workflow twin chooses them, and how the sharded engine must run them.
#
# Usage: bash scripts/jenkins-resolve-selection.sh <branch>
# Prints key=value lines on stdout (everything else goes to stderr):
#   sel_grep      tag filter for the core track ('' = none), e.g. @smoke
#   sel_paths     explicit spec paths for the core track ('' = none)
#   core_mode     run  the core track runs (sel_grep / sel_paths narrow it, empty = full suite)
#                 none the selection has no core files (only formFields paths): skip the core track
#   ff_mode       all      every formFields entity, full UI+RBAC pair (qa/stage/main)
#                 list     only ff_list entities, full pair (sandbox)
#                 matching only entities that have tests matching sel_grep, run
#                          with that grep (dev/prod: GitHub runs them inside its one job)
#                 none     no formFields track
#   ff_list       comma separated entities when ff_mode=list
#   ff_grep       grep applied to each formFields entity ('' = none)
#   workers       core --workers value, or "dynamic" (sandbox: decided from the test count)
#   test_timeout  core --timeout in ms, 0 = flag omitted
#   label         human readable summary
#
# Twin of each branch (docs/CI_PIPELINES.md, .github/workflows/*):
#   main    main.yml    full suite, plan-shards, formFields matrix   --workers=2 --timeout=90000
#   stage   stage.yml   full suite, plan-shards, formFields matrix   --workers=2 --timeout=120000
#   qa      qa.yml      --grep @regression, plan-shards, formFields  --workers=2 --timeout=120000
#   dev     dev.yml     --grep @smoke, one job                       --workers=1 --timeout=90000
#   prod    prod.yml    --grep @prodSafe, one job                    --workers=2 --timeout=90000
#   sandbox sandbox.yml detect-tests.sh (+ split-formfields-target.sh) workers 2 if >50 tests else 1, no --timeout
#   other   (a feature branch) no GitHub twin: full suite like main, QA timeout 120000
#
# sandbox: detect-tests.sh diffs against origin/dev. If this checkout cannot compare with
# origin/dev (origin/dev not fetched, or no diff against it) the script FAILS (exit 1): "could
# not compare" is not "nothing changed", and answering --grep @smoke would let a change that
# needs the full regression pass on smoke only. --grep @smoke stays only for the genuine case
# detect-tests.sh intends: the diff works and lists no changed files. CHANGED_FILES in the
# environment overrides the diff (detect-tests.sh's own test hook) and skips these checks.
# ============================================================================
set -u

BRANCH="${1:-}"
[ -z "$BRANCH" ] && {
  echo "Usage: bash scripts/jenkins-resolve-selection.sh <branch>" >&2
  exit 2
}

SEL_GREP=""
SEL_PATHS=""
CORE_MODE="run"
FF_MODE="all"
FF_LIST=""
FF_GREP=""
WORKERS="2"
TEST_TIMEOUT="90000"
LABEL=""

case "$BRANCH" in
  main)
    LABEL="full suite (main.yml)"
    ;;
  stage)
    TEST_TIMEOUT="120000"
    LABEL="full suite (stage.yml)"
    ;;
  qa)
    SEL_GREP="@regression"
    TEST_TIMEOUT="120000"
    LABEL="--grep @regression (qa.yml)"
    ;;
  dev)
    SEL_GREP="@smoke"
    FF_MODE="matching"
    FF_GREP="@smoke"
    WORKERS="1"
    LABEL="--grep @smoke (dev.yml)"
    ;;
  prod)
    SEL_GREP="@prodSafe"
    FF_MODE="matching"
    FF_GREP="@prodSafe"
    LABEL="--grep @prodSafe (prod.yml)"
    ;;
  sandbox)
    WORKERS="dynamic"
    TEST_TIMEOUT="0"
    if [ -z "${CHANGED_FILES+x}" ]; then
      if ! git rev-parse --verify -q origin/dev >/dev/null 2>&1; then
        echo "[select] ERROR: origin/dev is not visible in this checkout, so the sandbox selection cannot compare this branch with dev. Not falling back to --grep @smoke (that would mean 'nothing changed'). Fetch origin/dev and re-run." >&2
        exit 1
      fi
      if ! git diff --name-only origin/dev...HEAD >/dev/null 2>&1; then
        echo "[select] ERROR: git diff origin/dev...HEAD failed (no common history with dev?), so the changed files are unknown. Not falling back to --grep @smoke or to HEAD~1." >&2
        exit 1
      fi
    fi
    FF_OUT="$(mktemp)"
    DETECT_LOG="$(mktemp)"
    TARGET="$(BASE_BRANCH=dev FORMFIELDS_ENTITIES_OUT="$FF_OUT" bash .github/scripts/detect-tests.sh 2>"$DETECT_LOG" | tail -1)"
    cat "$DETECT_LOG" >&2
    DETECT_FF="$(grep '^formfields_entities_json=' "$FF_OUT" 2>/dev/null | cut -d'=' -f2- || true)"
    rm -f "$FF_OUT" "$DETECT_LOG"
    if [ -z "$TARGET" ] || [ -z "$DETECT_FF" ]; then
      echo "[select] detect-tests.sh produced no target or no formFields entity list - refusing to guess" >&2
      exit 1
    fi
    if [ "$TARGET" = "--grep @regression" ]; then
      SEL_GREP="@regression"
      FF_MODE="list"
      FF_LIST="$(node -e 'const l = JSON.parse(process.argv[1]).filter((e) => e !== "none"); console.log(l.join(","))' "$DETECT_FF")"
      LABEL="--grep @regression, escalated (sandbox.yml)"
    elif [[ "$TARGET" == --grep\ * ]]; then
      SEL_GREP="${TARGET#--grep }"
      FF_MODE="matching"
      FF_GREP="$SEL_GREP"
      LABEL="${TARGET} (sandbox.yml)"
    else
      SPLIT="$(bash .github/scripts/split-formfields-target.sh "$TARGET")" || {
        echo "[select] split-formfields-target.sh failed for '$TARGET'" >&2
        exit 1
      }
      SEL_PATHS="$(echo "$SPLIT" | grep '^rest_target=' | cut -d'=' -f2-)"
      FF_LIST="$(echo "$SPLIT" | grep '^formfields_entities=' | cut -d'=' -f2-)"
      if [ -n "$FF_LIST" ]; then FF_MODE="list"; else FF_MODE="none"; fi
      # An empty rest_target must NOT mean "no filter" (that is the whole suite).
      if [ -z "$SEL_PATHS" ]; then CORE_MODE="none"; fi
      LABEL="selected paths (sandbox.yml): ${TARGET}"
    fi
    ;;
  *)
    TEST_TIMEOUT="120000"
    LABEL="full suite (no GitHub twin; QA timeouts)"
    ;;
esac

echo "sel_grep=$SEL_GREP"
echo "sel_paths=$SEL_PATHS"
echo "core_mode=$CORE_MODE"
echo "ff_mode=$FF_MODE"
echo "ff_list=$FF_LIST"
echo "ff_grep=$FF_GREP"
echo "workers=$WORKERS"
echo "test_timeout=$TEST_TIMEOUT"
echo "label=$LABEL"
