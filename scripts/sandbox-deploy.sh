#!/bin/bash
# ============================================================================
# sandbox-deploy.sh
# Resets sandbox to dev, merges feature branch, and pushes ONCE.
# One push = one CI run.
#
# Usage: bash scripts/sandbox-deploy.sh feature/your-branch-name
# ============================================================================
set -e

FEATURE_BRANCH="${1}"
if [ -z "$FEATURE_BRANCH" ]; then
  echo "❌ Usage: bash scripts/sandbox-deploy.sh <feature-branch>"
  exit 1
fi

echo "Fetching latest dev..."
git fetch origin dev

echo "Switching to sandbox..."
git checkout sandbox

echo "Resetting sandbox to match dev exactly..."
git reset --hard origin/dev

echo "Merging $FEATURE_BRANCH into sandbox..."
git merge "$FEATURE_BRANCH" --no-edit

echo "Pushing sandbox (single push = single CI run)..."
git push --force origin sandbox

echo ""
echo "✅ Sandbox deployed from $FEATURE_BRANCH — 1 CI run triggered."
