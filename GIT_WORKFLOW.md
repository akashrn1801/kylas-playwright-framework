# Kylas Playwright Framework — Git Workflow Guide

> Complete guide for writing new tests, pushing code, and promoting through all environments without conflicts.

---

## Branch Strategy

\`\`\`
feature/\* → dev → qa → stage → prod → main
\`\`\`

| Branch    | Purpose             | Tests Run       |
| --------- | ------------------- | --------------- |
| \`dev\`   | Feature development | \`@smoke\`      |
| \`qa\`    | QA regression       | \`@regression\` |
| \`stage\` | Full suite          | all tests       |
| \`prod\`  | Production safe     | \`@prodSafe\`   |
| \`main\`  | Final validation    | \`@regression\` |

---

## Step 1 — Reset Sandbox Environment

Before starting new work, reset the sandbox environment to a clean state:

\`\`\`bash
npm run sandbox:reset
\`\`\`

This ensures no stale test data or configuration from previous runs interferes with CI.

---

## Step 2 — Start New Work (Always from dev)

\`\`\`bash
git checkout dev && git pull origin dev
git checkout -b feature/your-feature-name
\`\`\`

---

## Step 3 — Write Code and Test Locally

\`\`\`bash
npx tsc --noEmit
npx playwright test tests/ui/your-module/ --project=chromium --headed --workers=1
\`\`\`

---

## Step 4 — Commit and Push

\`\`\`bash
git add .
git commit -m "feat: description"
git push origin feature/your-feature-name
\`\`\`

---

## Step 5 — Merge to Sandbox for CI Verification

Merge your feature branch to sandbox to verify CI passes before opening a PR to dev:

\`\`\`bash
git checkout sandbox && git pull origin sandbox
git merge feature/your-feature-name
git push origin sandbox
\`\`\`

Wait for the sandbox CI pipeline (\`.github/workflows/sandbox.yml\`) to complete. Check the GitHub Actions results:
- If CI passes: proceed to Step 6
- If CI fails: fix the issues locally, commit, push to feature branch, and re-merge to sandbox

---

## Step 6 — Open PR to dev

Once sandbox CI passes, open a pull request to merge your feature branch into dev:

\`\`\`bash
git checkout feature/your-feature-name && git pull origin feature/your-feature-name
\`\`\`

Open PR: https://github.com/akashrn1801/kylas-playwright-framework/compare/dev...feature/your-feature-name

Wait for dev CI to pass before merging.

---

## Step 7 — Promote Through All Environments

### dev → qa (first promotion after sandbox CI passes)

\`\`\`bash
git checkout dev && git pull origin dev
git checkout -b feature/promote-FEATURE-to-qa-YYYYMMDD
git push origin feature/promote-FEATURE-to-qa-YYYYMMDD
\`\`\`
Open PR: https://github.com/akashrn1801/kylas-playwright-framework/compare/qa...feature/promote-FEATURE-to-qa-YYYYMMDD

### qa → stage

\`\`\`bash
git checkout feature/promote-FEATURE-to-qa-YYYYMMDD && git pull origin feature/promote-FEATURE-to-qa-YYYYMMDD
git checkout -b feature/promote-FEATURE-to-stage-YYYYMMDD
git push origin feature/promote-FEATURE-to-stage-YYYYMMDD
\`\`\`
Open PR: https://github.com/akashrn1801/kylas-playwright-framework/compare/stage...feature/promote-FEATURE-to-stage-YYYYMMDD

### stage → prod

\`\`\`bash
git checkout feature/promote-FEATURE-to-stage-YYYYMMDD && git pull origin feature/promote-FEATURE-to-stage-YYYYMMDD
git checkout -b feature/promote-FEATURE-to-prod-YYYYMMDD
git push origin feature/promote-FEATURE-to-prod-YYYYMMDD
\`\`\`
Open PR: https://github.com/akashrn1801/kylas-playwright-framework/compare/prod...feature/promote-FEATURE-to-prod-YYYYMMDD

### prod → main

\`\`\`bash
git checkout feature/promote-FEATURE-to-prod-YYYYMMDD && git pull origin feature/promote-FEATURE-to-prod-YYYYMMDD
git checkout -b feature/promote-FEATURE-to-main-YYYYMMDD
git push origin feature/promote-FEATURE-to-main-YYYYMMDD
\`\`\`
Open PR: https://github.com/akashrn1801/kylas-playwright-framework/compare/main...feature/promote-FEATURE-to-main-YYYYMMDD

---

## Golden Rules

1. Always cut feature branches from dev
2. Each promote branch cuts from the previous promote branch
3. Never push directly to dev/qa/stage/prod/main
4. Never skip environments
5. Wait for CI to pass before merging each PR

---

## Clean Up Merged Branches

\`\`\`bash
git branch -r --merged origin/main | grep "feature/" | sed 's/origin\///' | while read b; do
git push origin --delete "\$b"
done
\`\`\`

---

## Send Notification After Tests

\`\`\`bash
npm run notify
\`\`\`
