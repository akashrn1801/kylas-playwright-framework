#!/bin/bash
# ============================================================================
# escalate-selective-target.sh
# Decides whether a selective (path) target from detect-tests.sh is too big to
# run as ONE job, and if so escalates it to the proven sharded full selection.
#
# WHY (2026-11-27, sandbox run 45942780971): detect-tests.sh picked 16 specs
# (~450 tests, tag edits only, no core file changed). Only the literal
# "--grep @regression" target is bin-packed into shards (scripts/plan-shards.ts);
# every path target runs as `--shard=1/1`, so the run hit the 3h job limit and
# the rerun, formFields and merge jobs were lost. detect-tests.sh cannot know
# the size (it never lists tests); the plan job does, so the rule lives here.
#
# Usage: bash .github/scripts/escalate-selective-target.sh "<TARGET>" <TEST_COUNT>
# Prints key=value lines on stdout (reason goes to stderr):
#   escalated=true|false
#   target=<TARGET, or "--grep @regression" when escalated>
#   formfields_entities_json=<every entity from config/sharedConfigSuites.json>
#                            (only when escalated; the same list detect-tests.sh
#                            writes for its own "--grep @regression" Rule 1)
# "--grep @smoke" and "--grep @regression" are never escalated (smoke is small
# by design; regression is already the sharded path).
# ============================================================================

set -e

# Selective targets above this many tests escalate to "--grep @regression".
SELECTIVE_ESCALATION_THRESHOLD=150

TARGET="$1"
TEST_COUNT="$2"

if [ -z "$TARGET" ] || ! [[ "$TEST_COUNT" =~ ^[0-9]+$ ]]; then
  echo "usage: escalate-selective-target.sh \"<TARGET>\" <TEST_COUNT>" >&2
  exit 2
fi

if [ "$TARGET" = "--grep @regression" ] || [ "$TARGET" = "--grep @smoke" ] \
   || [ "$TEST_COUNT" -le "$SELECTIVE_ESCALATION_THRESHOLD" ]; then
  echo "escalated=false"
  echo "target=$TARGET"
  exit 0
fi

# Same entity list detect-tests.sh writes for the full selection.
FF_ALL_JSON=$(node -p "JSON.stringify(require('./config/sharedConfigSuites.json').formFields.entities)")

echo "selective target of $TEST_COUNT tests exceeds $SELECTIVE_ESCALATION_THRESHOLD: escalated to the full sharded selection" >&2
echo "escalated=true"
echo "target=--grep @regression"
echo "formfields_entities_json=$FF_ALL_JSON"
