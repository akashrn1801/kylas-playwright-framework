## CI/CD
- GitHub Actions: `dev.yml`, `qa.yml`, `stage.yml`, `prod.yml`, `main.yml`
- Jenkins: `Jenkinsfile` (multi-branch), `Jenkinsfile.qa`, `Jenkinsfile.staging`, `Jenkinsfile.prod`
- `sandbox.yml`: selective test detection based on changed files (uses `scripts/reset-sandbox.sh`)
- Worker count in CI is controlled by the `WORKERS` env var (set per-Jenkinsfile), defaulting to 2 if unset (`playwright.config.ts`); retries default to 1

