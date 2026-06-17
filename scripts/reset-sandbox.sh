#!/bin/bash
# ============================================================================
# reset-sandbox.sh
# Resets sandbox branch to match dev exactly.
# Run this before starting any new piece of work on sandbox.
#
# Usage: bash scripts/reset-sandbox.sh
# ============================================================================

set -e

echo "Fetching latest dev..."
git fetch origin dev

echo "Switching to sandbox..."
git checkout sandbox

echo "Resetting sandbox to match dev exactly..."
git reset --hard origin/dev

echo "Force pushing sandbox to remote..."
git push --force origin sandbox

echo ""
echo "✅ Sandbox is now clean and in sync with dev."
echo "   You can now make your changes and push."
