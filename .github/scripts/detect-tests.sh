#!/bin/bash
# ============================================================================
# detect-tests.sh
# Auto-detects which Playwright tests to run based on changed files.
# ============================================================================

set -e

BASE_BRANCH="${BASE_BRANCH:-dev}"

# ── Get changed files (allow override via env var for local testing) ──────────
if [ -z "$CHANGED_FILES" ]; then
  CHANGED_FILES=$(git diff --name-only "origin/${BASE_BRANCH}...HEAD" 2>/dev/null || \
                  git diff --name-only HEAD~1 2>/dev/null || \
                  echo "")
fi

echo "=== Changed files ===" >&2
echo "${CHANGED_FILES:-none}" >&2
echo "=====================" >&2

if [ -z "$CHANGED_FILES" ]; then
  echo "No changed files detected — running smoke tests" >&2
  echo "--grep @smoke"
  exit 0
fi

# ── Rule 1: Core framework files → full regression ────────────────────────────
CORE_CHANGED=$(echo "$CHANGED_FILES" | grep -E \
  "^(src/core/|src/fixtures/|src/auth/|playwright\.config\.ts)" \
  || true)

# WHY: config/config.ts only triggers full regression for critical changes
# (appUrl, users, timeouts) not for module-level retry tuning (meetingRetry etc.)
if echo "$CHANGED_FILES" | grep -q "^config/config\.ts$"; then
  CONFIG_CRITICAL=$(git diff "origin/${BASE_BRANCH}" -- config/config.ts 2>/dev/null | \
    grep "^+" | grep -E "(appUrl|apiBaseUrl|ADMIN|RESTRICTED|default:|navigation:|expect:|browser|headless|workers|retryCount)" \
    || true)
  if [ -n "$CONFIG_CRITICAL" ]; then
    CORE_CHANGED="config/config.ts $CORE_CHANGED"
    echo "Critical config change detected — adding to core" >&2
  else
    echo "Non-critical config change (retry tuning etc.) — skipping core trigger" >&2
  fi
fi

if [ -n "$CORE_CHANGED" ]; then
  echo "Core file changed: $CORE_CHANGED" >&2
  echo "→ Running full regression" >&2
  echo "--grep @regression"
  exit 0
fi

# ── Rule 2: Only utility/workflow files → smoke ───────────────────────────────
NON_UTILITY=$(echo "$CHANGED_FILES" | grep -vE \
  "^(src/notifications/|src/reporters/|src/error-collector/|src/utils/|\.github/|package\.json|tsconfig|\.eslint|\.prettier)" \
  || true)

if [ -z "$NON_UTILITY" ]; then
  echo "Only utility/config files changed — running smoke tests" >&2
  echo "--grep @smoke"
  exit 0
fi

# ── Rule 3: Extract module names and map to test paths ────────────────────────
declare -A MODULES_SEEN
TEST_PATHS=""

extract_module() {
  local file="$1"
  local module=""

  if echo "$file" | grep -qE "^src/modules/[^/]+/"; then
    module=$(echo "$file" | sed 's|^src/modules/||' | cut -d'/' -f1)
  elif echo "$file" | grep -qE "^tests/ui/[^/]+/"; then
    module=$(echo "$file" | sed 's|^tests/ui/||' | cut -d'/' -f1)
  elif echo "$file" | grep -qE "^tests/rbac/[^.]+\.rbac\.spec\.ts"; then
    module=$(echo "$file" | sed 's|^tests/rbac/||' | sed 's|\.rbac\.spec\.ts||')
  elif echo "$file" | grep -qE "^src/data/factories/[^/]+Factory\.ts"; then
    raw=$(echo "$file" | sed 's|^src/data/factories/||' | sed 's|Factory\.ts||' | tr '[:upper:]' '[:lower:]')
    case "$raw" in
      company)   module="companies" ;;
      contact)   module="contacts" ;;
      lead)      module="leads" ;;
      deal)      module="deals" ;;
      meeting)   module="meetings" ;;
      task)      module="tasks" ;;
      quotation) module="quotations" ;;
      *)         module="${raw}s" ;;
    esac
  fi

  echo "$module"
}

while IFS= read -r file; do
  [ -z "$file" ] && continue
  echo "$file" | grep -qE "^(src/notifications/|src/reporters/|src/error-collector/|src/utils/|\.github/)" && continue

  module=$(extract_module "$file")
  [ -z "$module" ] && continue
  [ "${MODULES_SEEN[$module]+isset}" ] && continue
  MODULES_SEEN[$module]=1

  echo "Module detected: $module (from: $file)" >&2

  if [ -d "tests/ui/$module" ]; then
    TEST_PATHS="$TEST_PATHS tests/ui/$module/"
    echo "  + tests/ui/$module/" >&2
  fi

  if [ -f "tests/rbac/$module.rbac.spec.ts" ]; then
    TEST_PATHS="$TEST_PATHS tests/rbac/$module.rbac.spec.ts"
    echo "  + tests/rbac/$module.rbac.spec.ts" >&2
  fi

done <<< "$CHANGED_FILES"

TEST_PATHS=$(echo "$TEST_PATHS" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ' | xargs)

if [ -z "$TEST_PATHS" ]; then
  echo "No module mapping found — running smoke tests" >&2
  echo "--grep @smoke"
  exit 0
fi

echo "=== Final test targets ===" >&2
echo "$TEST_PATHS" >&2
echo "==========================" >&2
echo "$TEST_PATHS"
