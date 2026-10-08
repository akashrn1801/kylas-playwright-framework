#!/bin/bash
# ============================================================================
# split-formfields-target.sh
# Splits a detect-tests.sh path target into "formFields paths" (run by the
# fixed per-entity matrix, run-formfields-tests) and "everything else" (run by
# the scoped run-tests job), so a formFields test is never run twice and never
# dropped.
#
# Usage: bash .github/scripts/split-formfields-target.sh "<TARGET>"
# Prints three key=value lines on stdout:
#   formfields_selected=true|false
#   formfields_target=<formFields paths, space separated>
#   rest_target=<all other paths, space separated>
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
if (tokens.some((t) => t.startsWith("-"))) {
  rest.push(...tokens);
} else {
  for (const raw of tokens) {
    const t = raw.replace(/^\.\//, "");
    (prefixes.some((p) => t.startsWith(p) || t + "/" === p) ? ff : rest).push(raw);
  }
}
console.log("formfields_selected=" + (ff.length > 0));
console.log("formfields_target=" + ff.join(" "));
console.log("rest_target=" + rest.join(" "));
'
