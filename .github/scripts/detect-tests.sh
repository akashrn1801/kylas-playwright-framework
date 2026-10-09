#!/bin/bash
# ============================================================================
# detect-tests.sh
# Auto-detects which Playwright tests to run based on changed files.
# ============================================================================

set -e

BASE_BRANCH="${BASE_BRANCH:-dev}"

# ── formFields entity selection (sandbox.yml's per-entity matrix) ─────────────
# WHY (2026-10-08, run 37753304635: a ProductsAndServicesPage.ts-only change
# moved all 417 formFields tests to the 6-entity matrix): the entity list comes
# from config/sharedConfigSuites.json (never hardcoded here). Set
# FORMFIELDS_ENTITIES_OUT=<file> and this script also writes
#   formfields_entities_json=["lead","deal"]
# to it (stdout stays the test target, unchanged). The list is NEVER empty: when
# no formFields entity is selected it is the placeholder ["none"], and the
# workflow gates the matrix job on run_formfields_track instead.
SHARED_CONFIG="config/sharedConfigSuites.json"
FF_ENTITIES_ALL=$(node -p "require('./${SHARED_CONFIG}').formFields.entities.join(' ')" 2>/dev/null || true)
FF_ENTITIES_SELECTED=""
FF_ALL_SELECTED=0

write_ff_entities() {
  [ -z "${FORMFIELDS_ENTITIES_OUT:-}" ] && return 0
  local list="$1" json="["
  local first=1 e
  for e in $list; do
    [ "$first" -eq 0 ] && json="$json,"
    json="$json\"$e\""
    first=0
  done
  [ "$first" -eq 1 ] && json='["none"]' || json="$json]"
  echo "formfields_entities_json=$json" > "$FORMFIELDS_ENTITIES_OUT"
}

# Prints the entities whose formFields spec files import the given module path
# (e.g. modules/leads/LeadsPage). Derived from the real import text of
# tests/{ui,rbac}/formFields/<entity>FieldLimits(.rbac).spec.ts, so a file
# imported by several entities' specs maps to all of them.
ff_entities_importing() {
  local import_path="$1" e
  for e in $FF_ENTITIES_ALL; do
    if grep -qE "${import_path}['\"]" \
      "tests/ui/formFields/${e}FieldLimits.spec.ts" \
      "tests/rbac/formFields/${e}FieldLimits.rbac.spec.ts" 2>/dev/null; then
      echo "$e"
    fi
  done
}

is_ff_entity() {
  local e
  for e in $FF_ENTITIES_ALL; do [ "$e" = "$1" ] && return 0; done
  return 1
}

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
  write_ff_entities ""
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
  write_ff_entities "$FF_ENTITIES_ALL"
  echo "--grep @regression"
  exit 0
fi

# ── Rule 2: Only utility/workflow files → smoke ───────────────────────────────
NON_UTILITY=$(echo "$CHANGED_FILES" | grep -vE \
  "^(src/notifications/|src/reporters/|src/error-collector/|src/utils/|\.github/|package\.json|tsconfig|\.eslint|\.prettier)" \
  || true)

if [ -z "$NON_UTILITY" ]; then
  echo "Only utility/config files changed — running smoke tests" >&2
  write_ff_entities ""
  echo "--grep @smoke"
  exit 0
fi

# ── Rule 3: Extract module names and map to test paths ────────────────────────
declare -A MODULES_SEEN
TEST_PATHS=""

extract_module() {
  local file="$1"
  local module=""

  if [ "$file" = "$SHARED_CONFIG" ]; then
    # Shared formFields config: every entity.
    module="formFields"
  elif echo "$file" | grep -qE "^tests/(ui|rbac)/formFields/[^/]+$"; then
    # <entity>FieldLimits(.rbac).spec.ts / <entity>FormFieldLock.ts -> that
    # entity only. Anything else in these dirs (formFieldLockFactory.ts,
    # formFieldsTestLock.ts, an unrecognised file) is shared -> all entities.
    base=$(basename "$file")
    ff_entity=$(echo "$base" | sed -nE 's/^([A-Za-z]+)(FieldLimits(\.rbac)?\.spec|FormFieldLock)\.ts$/\1/p')
    if [ -n "$ff_entity" ] && is_ff_entity "$ff_entity"; then
      module="formFields:$ff_entity"
    else
      module="formFields"
    fi
  elif echo "$file" | grep -qE "^src/modules/[^/]+/"; then
    module=$(echo "$file" | sed 's|^src/modules/||' | cut -d'/' -f1)
  elif echo "$file" | grep -qE "^tests/ui/[^/]+/"; then
    module=$(echo "$file" | sed 's|^tests/ui/||' | cut -d'/' -f1)
  elif echo "$file" | grep -qE "^tests/rbac/[^/]+/[^/]+\.rbac\.spec\.ts"; then
    # WHY (2026-09-28, Form Field Limit feature, subfolder move): this
    # feature's 6 RBAC files were moved into their own tests/rbac/formFields/
    # subfolder to mirror tests/ui/formFields/'s own grouping (previously
    # they sat flat in tests/rbac/, needing a separate name-based
    # normalization step below to recognize them — no longer needed now
    # that the DIRECTORY itself is "formFields", symmetric with the UI
    # side). This branch must be checked BEFORE the flat-file branch below,
    # since the flat-file regex's `[^.]+` would otherwise also match a
    # subfolder path (slashes aren't dots) and extract a broken
    # slash-containing "module" name. Extracting the subfolder name
    # directly means any future RBAC file grouped the same way (not just
    # formFields) is handled with zero further code changes.
    module=$(echo "$file" | sed 's|^tests/rbac/||' | cut -d'/' -f1)
  elif echo "$file" | grep -qE "^tests/rbac/[^.]+\.rbac\.spec\.ts"; then
    module=$(echo "$file" | sed 's|^tests/rbac/||' | sed 's|\.rbac\.spec\.ts||')
  elif echo "$file" | grep -qE "^src/data/factories/[^/]+Factory\.ts"; then
    entityRaw=$(echo "$file" | sed 's|^src/data/factories/||' | sed 's|Factory\.ts||')
    raw=$(echo "$entityRaw" | tr '[:upper:]' '[:lower:]')
    case "$raw" in
      company)             module="companies" ;;
      contact)             module="contacts" ;;
      lead)                module="leads" ;;
      deal)                module="deals" ;;
      meeting)             module="meetings" ;;
      task)                module="tasks" ;;
      quotation)           module="quotations" ;;
      # WHY (2026-09-28, bug fix): every other case above is an IRREGULAR
      # plural (company->companies, not companys), so the generic "${raw}s"
      # fallback below only works for regular plurals. productsAndServices
      # is a genuine THIRD shape — no pluralization at all — and the
      # fallback previously lowercased the whole name before applying it,
      # producing "productsandservicess" (wrong case AND a spurious extra
      # "s"), matching neither tests/ui/productsAndServices/ nor
      # tests/rbac/productsAndServices.rbac.spec.ts. Using $entityRaw here
      # (captured BEFORE lowercasing) preserves the real camelCase name.
      productsandservices) module="$entityRaw" ;;
      *)                   module="${raw}s" ;;
    esac
  fi

  # WHY (2026-09-28): a src/modules/**/*.ts page object or a
  # src/data/factories/**/*.ts factory can be a genuine, real import
  # dependency of the Form Field Limit feature's own spec files
  # (tests/ui/formFields/*.spec.ts, tests/rbac/formFields/*.rbac.spec.ts) —
  # confirmed live for every one of today's 6 entities (e.g.
  # leadFieldLimits.rbac.spec.ts imports both LeadsPage.ts AND
  # leadFactory.ts). Neither the src/modules/ branch above (module="leads",
  # the plural directory name) nor the factories branch (also "leads") maps
  # to "formFields" on their own, so a change to either file previously
  # triggered ONLY that entity's own core module tests, silently dropping
  # this feature's coverage. Rather than deriving an entity name and
  # guessing it matches a naming convention (fragile, and would need a
  # plural<->singular table exactly like the case statement above), this
  # checks the REAL, current import dependency directly: does any
  # formFields spec file's source text actually reference this changed
  # file's module path? This is genuinely dynamic — zero entity names or
  # counts enumerated — so it covers any future entity's page
  # object/factory the same way, with zero code change here, as long as
  # that entity's formFields spec files import it the same way every
  # existing one does. Both directories (grep -r recurses) are checked
  # regardless of how many entity files sit inside them.
  #
  # 2026-10-08 (Option B): the match is now PER ENTITY — a page object/factory
  # imported only by leadFieldLimits specs selects the Lead entity only; one
  # imported by several entities' specs selects each of them. The shared
  # FormFieldsConfigPage (src/modules/formFields/) already maps to every
  # entity through the branch above, so it is skipped here.
  if echo "$file" | grep -qE "^src/(modules|data/factories)/" && [ "$module" != "formFields" ]; then
    import_path=$(echo "$file" | sed -E 's|^src/||; s|\.ts$||')
    for ff_entity in $(ff_entities_importing "$import_path"); do
      module="$module formFields:$ff_entity"
    done
  fi

  echo "$module"
}

while IFS= read -r file; do
  [ -z "$file" ] && continue
  echo "$file" | grep -qE "^(src/notifications/|src/reporters/|src/error-collector/|src/utils/|\.github/)" && continue

  # WHY space-separated: extract_module() can now return MORE THAN ONE
  # module for a single file (e.g. "leads formFields") when that file is a
  # real import dependency of the formFields feature in addition to its
  # own core module — see extract_module()'s own WHY comment above.
  modules_for_file=$(extract_module "$file")
  [ -z "$modules_for_file" ] && continue

  for module in $modules_for_file; do
    [ "${MODULES_SEEN[$module]+isset}" ] && continue
    MODULES_SEEN[$module]=1

    echo "Module detected: $module (from: $file)" >&2

    # WHY (2026-09-28, Form Field Limit feature): "formFields" has no single
    # spec file of its own on either side — it was split into 6 per-entity
    # files, one per entity, each grouped in its own shared subfolder
    # (tests/ui/formFields/, tests/rbac/formFields/ — symmetric on both
    # sides as of the 2026-09-28 RBAC-side subfolder move). The generic
    # single-file check below would silently find nothing for either side.
    # Special-case it to pull in the whole feature (both directories, in
    # full) explicitly.
    # 2026-10-08: "formFields:<entity>" (one entity) emits only that entity's
    # UI + RBAC spec files; plain "formFields" (shared file changed) still emits
    # both directories and selects every entity.
    if [[ "$module" == formFields:* ]]; then
      ff_entity="${module#formFields:}"
      FF_ENTITIES_SELECTED="$FF_ENTITIES_SELECTED $ff_entity"
      for ff_spec in "tests/ui/formFields/${ff_entity}FieldLimits.spec.ts" \
                     "tests/rbac/formFields/${ff_entity}FieldLimits.rbac.spec.ts"; do
        if [ -f "$ff_spec" ]; then
          TEST_PATHS="$TEST_PATHS $ff_spec"
          echo "  + $ff_spec" >&2
        fi
      done
      continue
    fi
    if [ "$module" = "formFields" ]; then
      FF_ALL_SELECTED=1
      if [ -d "tests/ui/formFields" ]; then
        TEST_PATHS="$TEST_PATHS tests/ui/formFields/"
        echo "  + tests/ui/formFields/" >&2
      fi
      if [ -d "tests/rbac/formFields" ]; then
        TEST_PATHS="$TEST_PATHS tests/rbac/formFields/"
        echo "  + tests/rbac/formFields/" >&2
      fi
      continue
    fi

    if [ -d "tests/ui/$module" ]; then
      TEST_PATHS="$TEST_PATHS tests/ui/$module/"
      echo "  + tests/ui/$module/" >&2
    fi

    if [ -f "tests/rbac/$module.rbac.spec.ts" ]; then
      TEST_PATHS="$TEST_PATHS tests/rbac/$module.rbac.spec.ts"
      echo "  + tests/rbac/$module.rbac.spec.ts" >&2
    fi
  done

done <<< "$CHANGED_FILES"

if [ "$FF_ALL_SELECTED" -eq 1 ]; then
  # Directories already cover every entity: drop the redundant per-entity files.
  TEST_PATHS=$(echo "$TEST_PATHS" | tr ' ' '\n' | grep -vE '^tests/(ui|rbac)/formFields/[^/]+\.ts$' | tr '\n' ' ')
  FF_ENTITIES_SELECTED="$FF_ENTITIES_ALL"
fi
FF_ENTITIES_SELECTED=$(echo "$FF_ENTITIES_SELECTED" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' | xargs || true)

TEST_PATHS=$(echo "$TEST_PATHS" | tr ' ' '\n' | sort -u | grep -v '^$' | tr '\n' ' ' | xargs)

if [ -z "$TEST_PATHS" ]; then
  echo "No module mapping found — running smoke tests" >&2
  write_ff_entities ""
  echo "--grep @smoke"
  exit 0
fi

write_ff_entities "$FF_ENTITIES_SELECTED"
echo "formFields entities selected: ${FF_ENTITIES_SELECTED:-none}" >&2
echo "=== Final test targets ===" >&2
echo "$TEST_PATHS" >&2
echo "==========================" >&2
echo "$TEST_PATHS"
