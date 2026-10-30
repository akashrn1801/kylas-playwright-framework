#!/bin/bash
# ============================================================================
# jenkins-collect-shard.sh
# Gathers one Jenkins shard's outputs under ./out/ in the layout the sharded
# Jenkinsfile stashes and the merge step expects (mirrors the artifact names the
# GitHub workflows upload):
#   out/blob/shard-<prefix>-<suffix>.zip                          (renamed blob report)
#   out/misc/misc-errors-<prefix>-<suffix>/misc-errors.json       (GitHub's directory naming)
#   out/results/<suffix>/                                         (test-results/ copy)
#
# Usage: bash scripts/jenkins-collect-shard.sh <env> <prefix> <suffix>
#   e.g. prod main 1    |    prod main formfields-lead
#
# Always exits 0 and always creates out/blob and out/misc, so the caller's
# `dir('out/blob')` and stash steps cannot fail on a shard that produced nothing
# (a missing report then shows up in the completeness check, not as a crash).
# ============================================================================
set -u

ENV_NAME="${1:?env required}"
PREFIX="${2:?prefix required}"
SUFFIX="${3:?suffix required}"

BASE="shard-${PREFIX}-${SUFFIX}"
MISC_DIR="out/misc/misc-errors-${PREFIX}-${SUFFIX}"

mkdir -p out/blob out/misc "$MISC_DIR" "out/results/${SUFFIX}"

# Blob zips are renamed because Playwright's default filename is the same in every
# shard's own workspace and the merge folder is flat. One zip is expected; a second
# gets a numeric suffix rather than overwriting the first.
i=0
for f in blob-report/*.zip; do
  [ -e "$f" ] || continue
  if [ "$i" -eq 0 ]; then
    cp "$f" "out/blob/${BASE}.zip"
  else
    cp "$f" "out/blob/${BASE}-${i}.zip"
  fi
  i=$((i + 1))
done
echo "[collect-shard] ${BASE}: $i blob zip(s)"

if [ -f "reports/${ENV_NAME}/misc-errors.json" ]; then
  cp "reports/${ENV_NAME}/misc-errors.json" "${MISC_DIR}/misc-errors.json"
  echo "[collect-shard] ${BASE}: misc-errors.json collected"
else
  echo "[collect-shard] ${BASE}: no reports/${ENV_NAME}/misc-errors.json"
fi

if [ -d test-results ]; then
  cp -r test-results/. "out/results/${SUFFIX}/"
fi

exit 0
