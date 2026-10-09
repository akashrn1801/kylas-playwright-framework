#!/bin/bash
# ============================================================================
# split-formfields-target.sh
# Splits a detect-tests.sh path target into "formFields paths" (run by the
# fixed per-entity matrix, run-formfields-tests) and "everything else" (run by
# the scoped run-tests job), so a formFields test is never run twice and never
# dropped.
#
# Usage: bash .github/scripts/split-formfields-target.sh "<TARGET>"
# Prints four key=value lines on stdout:
#   formfields_selected=true|false
#   formfields_target=<formFields paths, space separated>
#   formfields_entities=<entities those paths cover, comma separated, sorted>
#   rest_target=<all other paths, space separated>
#
# 2026-10-08: sandbox runs only the SELECTED entities. detect-tests.sh emits an
# entity-specific target as explicit spec files (<entity>FieldLimits.spec.ts /
# .rbac.spec.ts) and a whole directory only when a shared file changed. The
# formFields paths are always removed from the scoped target; only the paths
# that remain in formfields_target count as "moved", so the workflow's
# "moved + scoped == original" guard compares the selected entities' tests, not
# all 417. A directory token, or a file in those directories that matches no
# entity, covers EVERY entity (the safe default). The workflow cross-checks
# formfields_entities against detect-tests.sh's own list.
#
# The prefixes come from config/sharedConfigSuites.json (uiDir/rbacDir), the
# same explicit path-prefix rule scripts/plan-shards.ts uses to carve formFields
# out of the escalated run — never a grep substring. (plan-shards strips the
# leading "tests/" because `playwright --list` reports paths relative to the
# tests root; detect-tests.sh emits repo-relative paths, so they stay intact.)
#
# A target that is a flag (e.g. "--grep @smoke") is passed through untouched:
# there are no paths to split.
# ============================================================================
set -e

TARGET="$1"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

TARGET="$TARGET" REPO_ROOT="$REPO_ROOT" node -e '
const fs = require("fs");
const path = require("path");
const cfg = JSON.parse(fs.readFileSync(path.join(process.env.REPO_ROOT, "config/sharedConfigSuites.json"), "utf-8"));
const others = Object.keys(cfg).filter((k) => k !== "formFields");
if (others.length > 0) {
  // WHY fail: only formFields has a dedicated CI track. Another shared-config
  // suite would be dropped from the scoped job here and run nowhere.
  process.stderr.write("::error::config/sharedConfigSuites.json has suite(s) besides formFields (" + others.join(", ") + ") but only formFields has a dedicated CI track — refusing to split, its tests would be dropped.\n");
  process.exit(1);
}
const prefixes = [cfg.formFields.uiDir, cfg.formFields.rbacDir].map((d) => d.replace(/\/+$/, "") + "/");
const tokens = (process.env.TARGET || "").split(/\s+/).filter(Boolean);
const ff = [];
const rest = [];
const entities = new Set();
const entityOf = (t) => {
  const m = t.match(/\/([A-Za-z]+)FieldLimits(?:\.rbac)?\.spec\.ts$/);
  return m && cfg.formFields.entities.includes(m[1]) ? m[1] : null;
};
if (tokens.some((t) => t.startsWith("-"))) {
  rest.push(...tokens);
} else {
  for (const raw of tokens) {
    const t = raw.replace(/^\.\//, "");
    const inFf = prefixes.some((p) => t.startsWith(p) || t + "/" === p);
    (inFf ? ff : rest).push(raw);
    if (inFf) {
      const e = entityOf(t);
      if (e) entities.add(e);
      else cfg.formFields.entities.forEach((x) => entities.add(x));
    }
  }
}
console.log("formfields_selected=" + (ff.length > 0));
console.log("formfields_target=" + ff.join(" "));
console.log("formfields_entities=" + [...entities].sort().join(","));
console.log("rest_target=" + rest.join(" "));
'
