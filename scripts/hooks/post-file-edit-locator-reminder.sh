#!/usr/bin/env bash
# Claude Code PostToolUse hook (Write|Edit matcher).
# Substitute for the "post-file-edit" auto-trigger CLAUDE.md documents as not
# being a native Claude Code feature: injects a reminder to run
# locator-reviewer instead of relying on manual invocation.
input=$(cat)
f=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.path // empty')
[ -z "$f" ] && exit 0

case "$f" in
  */src/modules/*.ts|*/tests/*.spec.ts)
    reason="Reminder: $f is a Page Object/spec file — invoke the locator-reviewer agent to scan it for locator stability before moving on."
    jq -n --arg reason "$reason" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $reason}}'
    ;;
  *)
    exit 0
    ;;
esac
