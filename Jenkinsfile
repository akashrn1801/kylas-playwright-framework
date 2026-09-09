pipeline {
    agent any

    tools {
        nodejs 'Node22'
    }

    options {
        timestamps()
        // WHY 48 HOURS, and why this is now a last-resort backstop, not the
        // real enforcement mechanism (redesigned 2026-09-09 — see
        // .claude/known-issues.md's dated entry for the full investigation):
        // this single global timeout used to be the ONLY bound on the whole
        // pipeline, covering Checkout+Install+Setup+ClearAuth+ApprovalGate+
        // RunTests combined — a single wall-clock budget trying to serve two
        // fundamentally incompatible needs (a human approval wait explicitly
        // allowed up to 24h, and a test run that must scale with suite size).
        // It had already silently drifted stale TWICE before (60->150 min in
        // 2026-06-30, 150->300 min in 2026-07-04, both manually recalibrated
        // alongside the inner per-test-count formula) and was found broken a
        // THIRD time on 2026-09-09 (300 min vs. a real 544-min computed inner
        // timeout at 514 tests) — a repeating pattern, not a one-off. Rather
        // than bump this number a third time (the same class of fix that
        // already failed twice), every stage below now has its OWN
        // appropriately-scoped timeout sized for its actual risk, so nothing
        // stage-specific depends on this value being kept in sync with
        // anything else ever again. This backstop's only remaining job is to
        // catch a genuinely unforeseen hang that somehow evades every
        // per-stage bound below (e.g. between stages) — sized comfortably
        // above the realistic worst case (24h approval + generous margin for
        // every other stage's own bound combined) specifically so it should
        // essentially never fire under normal operation.
        timeout(time: 48, unit: 'HOURS')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    environment {
        CI                       = 'true'
        HEADLESS                 = 'true'
        PLAYWRIGHT_BROWSERS_PATH = '/var/jenkins_home/.cache/ms-playwright'
    }

    stages {

        stage('Checkout') {
            // WHY a per-stage timeout (2026-09-09, Option C — see
            // .claude/known-issues.md's dated entry): this stage's own risk
            // (a slow/hung git checkout) doesn't scale with test count, so a
            // small fixed bound is genuinely correct here, not a guess that
            // will need periodic recalibration the way the old shared global
            // timeout did.
            options {
                timeout(time: 15, unit: 'MINUTES')
            }
            steps {
                echo "Branch: ${env.BRANCH_NAME}"
                checkout scm
            }
        }

        stage('Install') {
            when {
                anyOf {
                    branch 'prod'
                    branch 'main'
                    triggeredBy 'UserIdCause'
                }
            }
            // WHY 30 min (2026-09-09, Option C): npm ci + a browser install
            // — generous for a cold cache/slow network, but this genuinely
            // doesn't grow with test count, unlike Run Tests below.
            options {
                timeout(time: 30, unit: 'MINUTES')
            }
            steps {
                sh 'node --version'
                sh 'npm ci'
                sh 'npx playwright install chromium'
            }
        }

        stage('Setup Environment') {
            when {
                anyOf {
                    branch 'prod'
                    branch 'main'
                    triggeredBy 'UserIdCause'
                }
            }
            // WHY 10 min (2026-09-09, Option C): writes one small .env file
            // via withCredentials — should be near-instant; generous only for
            // a slow credential-store lookup.
            options {
                timeout(time: 10, unit: 'MINUTES')
            }
            steps {
                script {
                    def envPrefix = 'QA'
                    def envName   = 'qa'
                    if (env.BRANCH_NAME == 'stage') {
                        envPrefix = 'STAGING'
                        envName   = 'staging'
                    } else if (env.BRANCH_NAME == 'prod' || env.BRANCH_NAME == 'main') {
                        envPrefix = 'PROD'
                        envName   = 'prod'
                    }

                    withCredentials([
                        string(credentialsId: "${envPrefix}_APP_URL",             variable: 'APP_URL'),
                        string(credentialsId: "${envPrefix}_API_BASE_URL",        variable: 'API_BASE_URL'),
                        string(credentialsId: "${envPrefix}_ADMIN_EMAIL",         variable: 'ADMIN_EMAIL'),
                        string(credentialsId: "${envPrefix}_ADMIN_PASSWORD",      variable: 'ADMIN_PASSWORD'),
                        string(credentialsId: "${envPrefix}_RESTRICTED_EMAIL",    variable: 'RESTRICTED_EMAIL'),
                        string(credentialsId: "${envPrefix}_RESTRICTED_PASSWORD", variable: 'RESTRICTED_PASSWORD'),
                        string(credentialsId: 'GMAIL_APP_PASSWORD', variable: 'GMAIL_APP_PASSWORD'),
                        string(credentialsId: 'GMAIL_USER',    variable: 'GMAIL_USER')
                    ]) {
                        writeFile file: '.env', text: """\
ENV=${envName}
${envPrefix}_APP_URL=${APP_URL}
${envPrefix}_API_BASE_URL=${API_BASE_URL}
${envPrefix}_ADMIN_EMAIL=${ADMIN_EMAIL}
${envPrefix}_ADMIN_PASSWORD=${ADMIN_PASSWORD}
${envPrefix}_RESTRICTED_EMAIL=${RESTRICTED_EMAIL}
${envPrefix}_RESTRICTED_PASSWORD=${RESTRICTED_PASSWORD}
HEADLESS=true
CI=true
NAVIGATION_TIMEOUT=120000
GMAIL_APP_PASSWORD=${GMAIL_APP_PASSWORD}
GMAIL_USER=${GMAIL_USER}
GMAIL_SMTP_HOST=smtp.gmail.com
GMAIL_SMTP_PORT=587
NOTIFY_ENABLED=true
REPORT_PATH=reports/playwright-report/results.json
"""
                    }
                }
            }
        }

        stage('Clear Auth State') {
            when {
                anyOf {
                    branch 'prod'
                    branch 'main'
                    triggeredBy 'UserIdCause'
                }
            }
            // WHY 5 min (2026-09-09, Option C): a local rm -rf/mkdir — trivial,
            // no realistic scenario needs more than a couple of seconds.
            options {
                timeout(time: 5, unit: 'MINUTES')
            }
            steps {
                sh 'rm -rf src/auth/storageStates/'
                sh 'mkdir -p src/auth/storageStates/'
            }
        }

        stage('Approval Gate') {
            when {
                anyOf {
                    branch 'prod'
                    branch 'main'
                    triggeredBy 'UserIdCause'
                }
            }
            steps {
                // WHY unchanged (2026-09-09, Option C — this is the fix, not
                // an oversight): this step-level timeout was ALREADY
                // correctly scoped to just the human-approval wait — the bug
                // was that the pipeline-wide options{} timeout above ALSO
                // covered this same wall-clock window, so a slow approval
                // could silently consume budget the Run Tests stage actually
                // needed. Removing the old shared global timeout (see
                // options{} above) means this 24h allowance is now genuinely
                // independent, exactly as it always should have been.
                timeout(time: 24, unit: 'HOURS') {
                    input message: "🚨 You are about to run tests against ${env.BRANCH_NAME}. Approve to proceed?",
                          ok: 'Yes, approve'
                }
            }
        }

        stage('Detect Tests (sandbox only)') {
            when {
                branch 'sandbox'
            }
            // WHY 10 min (2026-09-09, Option C): a git fetch plus running
            // detect-tests.sh — fast, doesn't scale with suite size.
            options {
                timeout(time: 10, unit: 'MINUTES')
            }
            steps {
                script {
                    sh 'git fetch origin dev'
                    def target = sh(
                        script: 'BASE_BRANCH=dev bash .github/scripts/detect-tests.sh 2>&1 | tail -1',
                        returnStdout: true
                    ).trim()
                    echo "Sandbox detected test target: ${target}"
                    env.SANDBOX_TEST_TARGET = target
                }
            }
        }

        stage('Run Tests') {
            // WHY: Jenkins is primary CI for prod and main only.
            // sandbox/dev/qa/stage are handled exclusively by GitHub Actions.
            // This prevents double execution and environment load conflicts.
            when {
                anyOf {
                    branch 'prod'
                    branch 'main'
                    triggeredBy 'UserIdCause'
                }
            }
            steps {
                script {
                    // WHY: Dynamic timeout — scales automatically as the suite grows.
                    // Previously calibrated at ~20 sec/test, but a real full-suite local
                    // run (235 tests, workers=2, 2.9 hours) measured ~44.4 sec/test —
                    // more than double. 20 sec/test made this timeout the actual cause
                    // of Jenkins killing the run mid-suite, not a symptom of it. Recalibrated
                    // to 60 sec/test (~35% margin over the measured rate, to also absorb
                    // Jenkins hardware being slower than local) plus a larger buffer.
                    // WHY per-branch testFilter/countScript (fixed 2026-09-04) —
                    // confirmed pre-existing bug via `git blame` (introduced
                    // 2026-07-01, two months before this session, NOT caused by
                    // this session's earlier Phase 3 credential/estimate-duration
                    // work): this logic previously only ever special-cased
                    // 'prod', so every other branch — dev, qa, sandbox, stage,
                    // main — fell through to the full, unfiltered suite. stage
                    // and main happened to look "correct" purely because they're
                    // SUPPOSED to run full; dev/qa/sandbox were genuinely wrong,
                    // silently running the full suite instead of their intended
                    // @smoke/@regression/selective subset for ~2 months. Each
                    // branch below is matched to the EXACT mechanism its own
                    // GitHub Actions workflow uses (dev.yml/qa.yml/prod.yml's
                    // own --grep tags; sandbox.yml's own detect-tests.sh via
                    // BASE_BRANCH=dev) — see .claude/known-issues.md's dated
                    // entry for the full root-cause writeup and the GitHub-
                    // Actions-vs-Jenkinsfile comparison table this was built
                    // from. prod's own pre-existing, already-correct @prodSafe
                    // behavior is preserved exactly, not just re-derived.
                    def branchName = env.BRANCH_NAME
                    def testFilter
                    def countScript
                    if (branchName == 'prod') {
                        testFilter = '--grep @prodSafe'
                        countScript = "grep -rh \"@prodSafe\" tests/ | wc -l"
                    } else if (branchName == 'dev') {
                        testFilter = '--grep @smoke'
                        countScript = "grep -rh \"@smoke\" tests/ | wc -l"
                    } else if (branchName == 'qa') {
                        testFilter = '--grep @regression'
                        countScript = "grep -rh \"@regression\" tests/ | wc -l"
                    } else if (branchName == 'sandbox') {
                        // WHY env.SANDBOX_TEST_TARGET, not a fresh detection
                        // call: the "Detect Tests (sandbox only)" stage above
                        // already computed this via the exact same
                        // .github/scripts/detect-tests.sh invocation (same
                        // BASE_BRANCH=dev) GitHub Actions' own sandbox.yml
                        // uses — confirmed byte-for-byte identical to
                        // Jenkinsfile.sandbox's own already-proven "Detect
                        // Changed Tests" stage. Re-running detection here
                        // would duplicate work and risk a different result if
                        // dev moved between stages. Falls back to @smoke (not
                        // an empty/unbounded target, which would silently
                        // mean "run everything" — the exact bug being fixed)
                        // if that stage somehow never populated it.
                        testFilter = env.SANDBOX_TEST_TARGET ?: '--grep @smoke'
                        // WHY --list-based counting, not grep -rh: the real
                        // detect-tests.sh output can be a --grep flag OR a
                        // space-separated list of specific test file/
                        // directory paths (confirmed live from its own
                        // source) — a static file-count grep can't count
                        // either shape correctly. Mirrors sandbox.yml's own
                        // proven counting method exactly.
                        countScript = "npx playwright test --project=chromium --list ${testFilter} 2>/dev/null | grep -c \"chromium\" || echo 0"
                    } else {
                        // stage, main, and any other branch: unchanged, full
                        // suite — matches GitHub Actions' own stage.yml/
                        // main.yml (no grep at all).
                        testFilter = ''
                        countScript = "grep -rh \"^\\s*test(\" tests/ | wc -l"
                    }
                    def testCount = sh(
                        script: countScript,
                        returnStdout: true
                    ).trim().toInteger()
                    def secondsPerTest = 60
                    def bufferMinutes = 30
                    def computedTimeoutMinutes = (testCount * secondsPerTest + 59) / 60 + bufferMinutes
                    echo "Detected ${testCount} tests (branch: ${env.BRANCH_NAME}) — dynamic timeout set to ${computedTimeoutMinutes} minutes"
                    // WHY this is now the ONLY meaningful bound on this stage
                    // (2026-09-09, Option C — see .claude/known-issues.md's
                    // dated entry): the old pipeline-wide options{} timeout
                    // used to ALSO cap this stage from above, and had
                    // silently drifted smaller than this computed value
                    // (300 min vs. a real 544 min at 514 tests) — meaning
                    // this formula's own scaling was being overridden by a
                    // stale, unrelated ceiling nobody was watching. That
                    // outer timeout is now a generous 48h last-resort
                    // backstop only (see options{} above) — this formula is
                    // free to keep scaling correctly forever with nothing
                    // else silently capping it.

                    // WHY this check exists at all (added 2026-09-09): the
                    // 48h backstop above CANNOT be made genuinely dynamic —
                    // Jenkins' declarative options{} block is evaluated once,
                    // at pipeline start, before this script runs, so it
                    // structurally cannot read a value computed here (same
                    // hard platform constraint documented in options{}'s own
                    // WHY comment). That means 48h, while sized with a
                    // multi-year real margin today (see the math in
                    // .claude/known-issues.md's dated entry), IS still a
                    // static number with a real, calculable expiration point
                    // as this formula's own output keeps growing — exactly
                    // the property that made the OLD 300-min outer timeout
                    // fail silently, twice, over the years. Since the number
                    // itself can't be made self-adjusting, this check makes
                    // its eventual drift LOUD instead of silent: it computes
                    // the real worst-case total (24h Approval Gate + every
                    // fixed pre-stage's own bound + this stage's own
                    // computed timeout) and fails the build with a clear,
                    // actionable message the moment that total comes within
                    // 2 hours of the 48h backstop — years before it could
                    // ever actually be hit, giving a human a real chance to
                    // raise both this stage's awareness and the options{}
                    // value, rather than discovering it the way the original
                    // 300-min ceiling was discovered: silently, after it had
                    // already been wrong for weeks.
                    def outerBackstopMinutes = 48 * 60 // must match options{}'s timeout() value above, kept in sync by hand — see that block's own WHY comment
                    def approvalGateMinutes = 24 * 60 // Approval Gate's own full worst-case allowance
                    def fixedStageMinutes = 15 + 30 + 10 + 5 + 10 // Checkout + Install + Setup Environment + Clear Auth State + Detect Tests, worst case if all apply
                    def projectedWorstCaseMinutes = approvalGateMinutes + fixedStageMinutes + computedTimeoutMinutes
                    def backstopMarginMinutes = outerBackstopMinutes - projectedWorstCaseMinutes
                    if (backstopMarginMinutes < 120) {
                        error(
                            "Projected worst-case pipeline duration (${projectedWorstCaseMinutes} min = " +
                            "${approvalGateMinutes} min Approval Gate + ${fixedStageMinutes} min fixed stages + " +
                            "${computedTimeoutMinutes} min Run Tests, for ${testCount} tests) is within 120 min of " +
                            "the outer pipeline timeout (${outerBackstopMinutes} min, set in this Jenkinsfile's " +
                            "options{} block) — margin is only ${backstopMarginMinutes} min. Raise BOTH the " +
                            "options{} timeout() value above AND this stage's outerBackstopMinutes constant now, " +
                            "before this repeats the exact drift that silently broke the old 300-min outer ceiling " +
                            "twice already. See .claude/known-issues.md's dated 2026-09-09 entry for the full history."
                        )
                    }
                    // WHY additive only, not replacing computedTimeoutMinutes above
                    // (2026-09-04) — this printed estimate is informational; the
                    // existing per-test-count timeout stays the sole safety ceiling
                    // enforced below. Replacing it with a real historical average
                    // was explicitly considered and rejected for prod/main
                    // specifically — a wrong/thin-sample computed value could kill
                    // a legitimate build, where a wrong printed line cannot. See
                    // .claude/known-issues.md's dynamic-duration-estimate entry.
                    // WHY no explicit ENV= here (fixed 2026-09-04, caught before
                    // any live run): this stage's own `when` block admits ANY
                    // manually-triggered build via `triggeredBy 'UserIdCause'`,
                    // regardless of branch — a real, deliberately-designed escape
                    // hatch (confirmed live: "Setup Environment" above resolves
                    // ENV dynamically per branch — stage/prod/main/else-QA — and
                    // writes it into a real .env file). An earlier version of
                    // this line hardcoded ENV=prod, which is only correct for
                    // prod/main — wrong for a manual trigger against any other
                    // branch. Fixed to rely on estimate-duration's own
                    // loadDotEnv() picking up the real value, exactly matching
                    // how the actual playwright test command below and the
                    // history:sync call in `post` already do it correctly.
                    withCredentials([usernamePassword(credentialsId: 'github-credentials', usernameVariable: 'GIT_USERNAME', passwordVariable: 'GIT_TOKEN')]) {
                        sh '''
                            WORKERS=2 BRANCH_NAME="$BRANCH_NAME" PIPELINE_TOKEN="$GIT_TOKEN" npm run estimate-duration --silent || true
                        '''
                    }
                    timeout(time: computedTimeoutMinutes, unit: 'MINUTES') {
                        sh "npx playwright test --project=chromium ${testFilter} --workers=2"
                    }
                }
            }
        }

    }

    post {
        always {
            archiveArtifacts(
                artifacts: 'reports/**,test-results/**',
                allowEmptyArchive: true
            )
            publishHTML(target: [
                allowMissing         : true,
                alwaysLinkToLastBuild: true,
                keepAll              : true,
                reportDir            : 'reports/playwright-report',
                reportFiles          : 'index.html',
                reportName           : 'Playwright HTML Report'
            ])
            script {
                try {
                    // WHY: Confirmed live (2026-07-07 reporting overhaul, P2) —
                    // must run before notify so its delta output exists in time
                    // for the email. Reads ENV from the .env file written during
                    // the test stage above (via loadDotEnv.ts), same as notify
                    // already does — this pipeline resolves ENV dynamically per
                    // branch (staging/prod), never a fixed value.
                    // WHY the credential binding, added 2026-09-04 — confirmed
                    // via direct grep that this call had NEVER had any git
                    // credential wired, on this or any other Jenkinsfile: every
                    // real ledger record from this pipeline's history is absent
                    // (history/{qa,staging,prod}.jsonl contain zero
                    // runSource:"jenkins" entries) — this push has always been
                    // fully anonymous and has always failed, the exact same root
                    // cause already found and fixed for GitHub Actions
                    // (.claude/known-issues.md's "CI reporting-history ledger"
                    // section), just never diagnosed for Jenkins. BRANCH_NAME
                    // needs no explicit derivation here — env.BRANCH_NAME is
                    // already Jenkins-native for this multibranch job and is
                    // already auto-exported to this sh step's real environment.
                    withCredentials([usernamePassword(credentialsId: 'github-credentials', usernameVariable: 'GIT_USERNAME', passwordVariable: 'GIT_TOKEN')]) {
                        sh '''
                            WORKERS=2 PIPELINE_TOKEN="$GIT_TOKEN" npm run history:sync || true
                        '''
                    }
                } catch (e) {
                    echo 'History sync failed — continuing'
                }
                try {
                    sh 'npm run notify || true'
                } catch (e) {
                    echo 'Notification failed — continuing'
                }
            }
            cleanWs()
        }
        success {
            echo "✅ Tests passed on ${env.BRANCH_NAME}"
        }
        failure {
            echo "❌ Tests failed on ${env.BRANCH_NAME}"
        }
    }
}