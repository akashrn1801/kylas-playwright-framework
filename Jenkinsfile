pipeline {
    agent any

    tools {
        nodejs 'Node22'
    }

    options {
        timestamps()
        // WHY (2026-09-10): this is a multibranch job — disableConcurrentBuilds()
        // scopes per-branch, so it prevents two overlapping builds of the SAME
        // branch (e.g. two rapid pushes to 'main', or a manual re-trigger while
        // an automatic one is still waiting at the Approval Gate) without
        // blocking different branches from building at the same time. That
        // per-branch overlap was never intentional here — the Approval Gate
        // below already assumes a single human-gated run at a time, and an
        // unguarded second build is exactly what produces the extra "@2"-style
        // workspace and the false "NO TEST REPORT AVAILABLE" alert investigated
        // in docs/known-issues/session-expiry-and-auth.md (2026-09-10 entry). NOTE: this does NOT
        // fully close the credential-race risk documented in
        // docs/known-issues/session-expiry-and-auth.md's "Concurrent-Worker Credential File Race" entry for 'main' and
        // 'prod' specifically — both branches resolve to the SAME PROD
        // credentials in the Setup Environment stage below, and
        // disableConcurrentBuilds() cannot prevent a 'main' build and a 'prod'
        // build from running concurrently against each other (different
        // branches, different per-branch job). Closing that cross-branch gap
        // would need a cross-job lock (e.g. the Lockable Resources plugin) —
        // out of scope for this fix, flagged here so it isn't silently assumed
        // solved.
        disableConcurrentBuilds()
        // WHY 48 HOURS, and why this is now a last-resort backstop, not the
        // real enforcement mechanism (redesigned 2026-09-09 — see
        // docs/known-issues/ci-pipelines.md's dated entry for the full investigation):
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

    // WHY (sharded Jenkins): lane counts are settings, not constants. Only a sharded
    // build reads them (see resolveRunMode() / validateLaneCount() below); for every
    // other build they are ignored. Strings, not choices, so a value sent through the
    // API is validated and refused the same way. SHARDED_TEST, TEST_GREP and
    // FF_ENTITIES exist to try the sharded path from a feature branch against QA; they
    // have no effect on a branch listed in KYLAS_SHARDED_BRANCHES (main included).
    parameters {
        string(name: 'CORE_LANES', defaultValue: '2', description: 'Sharded builds: how many core shards run at once (integer 1-4).')
        string(name: 'FF_LANES', defaultValue: '2', description: 'Sharded builds: how many formFields entities run at once, after the core track (integer 1-4).')
        booleanParam(name: 'SHARDED_TEST', defaultValue: false, description: 'Manual build of a branch NOT in KYLAS_SHARDED_BRANCHES: use the sharded engine. Only against QA; refused for any other environment.')
        string(name: 'TEST_GREP', defaultValue: '', description: 'SHARDED_TEST only: run only core tests matching this tag/word (letters, digits, _ @ . -). The build is marked partial.')
        string(name: 'FF_ENTITIES', defaultValue: '', description: 'SHARDED_TEST only: comma separated formFields entities from config/sharedConfigSuites.json, or "none". Empty = all. A subset is marked partial.')
    }

    environment {
        CI                       = 'true'
        HEADLESS                 = 'true'
        PLAYWRIGHT_BROWSERS_PATH = '/var/jenkins_home/.cache/ms-playwright'
    }

    stages {

        stage('Checkout') {
            // WHY a per-stage timeout (2026-09-09, Option C — see
            // docs/known-issues/ci-pipelines.md's dated entry): this stage's own risk
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

        stage('Resolve Mode') {
            // WHY a stage of its own, right after Checkout: decides once whether this build
            // takes the sharded path, so every later `when` reads one env var instead of
            // repeating the branch/trigger rules. Needs the checkout (FF_ENTITIES is
            // validated against config/sharedConfigSuites.json) and still runs before the
            // Approval Gate, so a bad setting is refused before anyone is asked to approve.
            steps {
                script {
                    resolveRunMode()
                }
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
                    // WHY one function, kylasEnvFor() (below): this used to be an if/else here that
                    // only knew stage and prod/main, so every other branch silently fell through to
                    // QA, including sandbox, whose GitHub twin (sandbox.yml) and fallback
                    // Jenkinsfile.sandbox both use STAGING. The test selection per branch was aligned
                    // with the GitHub twins earlier (see Run Tests); the environment never was. A second
                    // copy of the rule (the SHARDED_TEST check in resolveRunMode()) had the same gap,
                    // so both now read this one function.
                    def kylasEnv  = kylasEnvFor(env.BRANCH_NAME ?: '')
                    def envPrefix = kylasEnv.prefix
                    def envName   = kylasEnv.name
                    // WHY exported (sharded Jenkins main): the lock name, the collision
                    // guard and the shard workspaces need the resolved environment,
                    // and this is the one place it is decided.
                    env.KYLAS_ENV_NAME   = envName
                    env.KYLAS_ENV_PREFIX = envPrefix

                    withCredentials([
                        string(credentialsId: "${envPrefix}_APP_URL",             variable: 'APP_URL'),
                        string(credentialsId: "${envPrefix}_API_BASE_URL",        variable: 'API_BASE_URL'),
                        string(credentialsId: "${envPrefix}_ADMIN_EMAIL",         variable: 'ADMIN_EMAIL'),
                        string(credentialsId: "${envPrefix}_ADMIN_PASSWORD",      variable: 'ADMIN_PASSWORD'),
                        string(credentialsId: "${envPrefix}_RESTRICTED_EMAIL",    variable: 'RESTRICTED_EMAIL'),
                        string(credentialsId: "${envPrefix}_RESTRICTED_PASSWORD", variable: 'RESTRICTED_PASSWORD'),
                        string(credentialsId: 'GMAIL_APP_PASSWORD', variable: 'GMAIL_APP_PASSWORD'),
                        string(credentialsId: 'GMAIL_USER',    variable: 'GMAIL_USER'),
                        string(credentialsId: 'NOTIFY_TO', variable: 'NOTIFY_TO'),
                        string(credentialsId: 'NOTIFY_CC', variable: 'NOTIFY_CC'),
                        string(credentialsId: 'NOTIFY_FROM_NAME', variable: 'NOTIFY_FROM_NAME')
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
NOTIFY_TO=${NOTIFY_TO}
NOTIFY_CC=${NOTIFY_CC}
NOTIFY_FROM_NAME=${NOTIFY_FROM_NAME}
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
                // WHY the wall-clock stamps (root cause of build #13, which sat ~3,773 min
                // on this 24h timeout): this host is a laptop that suspends, and Jenkins'
                // timeout does not count suspended time, so the wait and its limit both
                // stretch. The stamps use the real clock (`date`), so the log shows how long
                // the approval really took, also when the timeout fires (finally).
                script {
                    def requestedEpoch = wallClockEpoch()
                    echo "Approval requested at ${wallClockStamp()} (wall clock). The 24h limit does not count time the host is suspended."
                    try {
                        timeout(time: 24, unit: 'HOURS') {
                            input message: "🚨 You are about to run tests against ${env.BRANCH_NAME}. Approve to proceed?",
                                  ok: 'Yes, approve'
                        }
                    } finally {
                        sh "echo \"Approval wait ended at \$(date -u +%Y-%m-%dT%H:%M:%SZ): real wall-clock age \$(( (\$(date +%s) - ${requestedEpoch}) / 60 )) min\""
                    }
                }
            }
        }

        stage('Detect Tests (sandbox only)') {
            when {
                allOf {
                    branch 'sandbox'
                    // WHY: a sharded sandbox build selects its tests in runSharded() instead.
                    not { environment name: 'SHARDED_RUN', value: 'true' }
                }
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

        stage('Sharded Run') {
            // WHY: the one shared sharded engine (see runSharded() below). Which branches use
            // it is decided once in "Resolve Mode"; every other build keeps the unsharded
            // "Run Tests" stage below exactly as before.
            // WHY the trigger rule repeated here: this is the same admission rule as Install, Setup
            // Environment, Clear Auth State, Approval Gate and Run Tests, so the stage can never run
            // for a build those stages skipped, whatever resolveRunMode() decided.
            when {
                allOf {
                    anyOf {
                        branch 'prod'
                        branch 'main'
                        triggeredBy 'UserIdCause'
                    }
                    environment name: 'SHARDED_RUN', value: 'true'
                }
            }
            steps {
                script {
                    runSharded()
                }
            }
        }

        stage('Run Tests') {
            // WHY: Jenkins is primary CI for prod and main only.
            // sandbox/dev/qa/stage are handled exclusively by GitHub Actions.
            // This prevents double execution and environment load conflicts.
            when {
                allOf {
                    anyOf {
                        branch 'prod'
                        branch 'main'
                        triggeredBy 'UserIdCause'
                    }
                    // WHY: a sharded build runs the "Sharded Run" stage above instead.
                    not { environment name: 'SHARDED_RUN', value: 'true' }
                }
            }
            steps {
                script {
                    // WHY (sharded Jenkins): every test run takes the account lock, then the collision
                    // guard, so no Jenkins run overlaps another Jenkins run or a GitHub run on the same
                    // account. TESTS_ATTEMPTED is set inside, after the guard, so a refusal is not
                    // reported as a missing-report failure.
                    withAccountLock(env.KYLAS_ENV_NAME) {
                        // WHY set as the very first statement of this stage (2026-09-10):
                        // marks that this specific build's branch/trigger combination
                        // WAS eligible to run tests (this stage's own `when` above
                        // passed) and this stage was genuinely entered — as opposed to
                        // a build that never got here at all (when-gated out, or
                        // stopped earlier at the Approval Gate/an upstream stage
                        // failure). post{always{}} below reads this flag to decide
                        // whether a missing results.json means "tests were never
                        // supposed to run for this build" (skip notification, no
                        // alert) vs. "tests were attempted but something genuinely
                        // prevented a report" (a real infra failure — still alert,
                        // preserving the original 2026-09-09 intent of
                        // sendReportUnavailableAlert()). See docs/known-issues/ci-pipelines.md's
                        // 2026-09-10 entry for the full investigation this fixes.
                        env.TESTS_ATTEMPTED = 'true'
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
                        // BASE_BRANCH=dev) — see docs/known-issues/ci-pipelines.md's dated
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
                        // (2026-09-09, Option C — see docs/known-issues/ci-pipelines.md's
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
                        // docs/known-issues/ci-pipelines.md's dated entry), IS still a
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
                                "twice already. See docs/known-issues/ci-pipelines.md's dated 2026-09-09 entry for the full history."
                            )
                        }
                        // WHY additive only, not replacing computedTimeoutMinutes above
                        // (2026-09-04) — this printed estimate is informational; the
                        // existing per-test-count timeout stays the sole safety ceiling
                        // enforced below. Replacing it with a real historical average
                        // was explicitly considered and rejected for prod/main
                        // specifically — a wrong/thin-sample computed value could kill
                        // a legitimate build, where a wrong printed line cannot. See
                        // docs/known-issues/ci-pipelines.md's dynamic-duration-estimate entry.
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

    }

    post {
        always {
            script {
                // WHY first (sharded Jenkins): the merged report must exist before the
                // archive/publish steps below and before history:sync and notify, which
                // read reports/playwright-report/results.json. Outside both locks.
                if (env.SHARDED_RUN == 'true') {
                    shardedMergeAndReport()
                }
            }
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
                    // (docs/known-issues/reporting-and-notifications.md's "CI reporting-history ledger"
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
                // WHY gated on TESTS_ATTEMPTED, not unconditional (2026-09-10):
                // this used to run on EVERY build regardless of whether 'Run
                // Tests' above ever executed — an automatic dev/qa/stage/sandbox
                // build (Jenkins isn't the primary CI for those; see 'Run Tests'
                // when{}'s own WHY comment), or any build that stopped at/before
                // the Approval Gate (declined, timed out, or aborted), reached
                // this point with no results.json ever created, and
                // NotificationService correctly threw "Report not found" —
                // which by design (2026-09-09 sandbox Build #167 fix) sends a
                // loud "NO TEST REPORT AVAILABLE" alert. That alert is the
                // right behavior for a genuine crashed/killed test run, but a
                // false alarm for a build that was never supposed to produce a
                // report in the first place. Gating on the flag set at the top
                // of 'Run Tests' preserves the real-crash alert (TESTS_ATTEMPTED
                // is set the moment that stage is entered, before anything can
                // fail) while skipping the false one. Full investigation:
                // docs/known-issues/ci-pipelines.md's 2026-09-10 entry.
                if (env.TESTS_ATTEMPTED == 'true') {
                    try {
                        sh 'npm run notify || true'
                    } catch (e) {
                        echo 'Notification failed — continuing'
                    }
                } else {
                    echo 'Run Tests never started for this build (branch/trigger not eligible, or the pipeline stopped before reaching it — e.g. Approval Gate declined/timed out, or an earlier stage failed) — skipping notification to avoid a false "no report" alert for a build that was never supposed to produce one.'
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

// ============================================================================
// Sharded Jenkins engine and shared helpers. Everything below runs in the
// pipeline's own CPS context (steps allowed) unless marked @NonCPS.
// ============================================================================

// ---- Run mode ---------------------------------------------------------------

// The one branch -> environment rule (matches each branch's GitHub twin): stage and sandbox use
// STAGING (stage.yml, sandbox.yml), prod and main use PROD (prod.yml, main.yml), everything else
// (dev, qa, feature branches) uses QA (dev.yml, qa.yml). Used by Setup Environment, which exports
// the result as KYLAS_ENV_NAME/KYLAS_ENV_PREFIX, and by the SHARDED_TEST check below.
@NonCPS
def kylasEnvFor(String branch) {
    if (branch == 'stage' || branch == 'sandbox') { return [prefix: 'STAGING', name: 'staging'] }
    if (branch == 'prod' || branch == 'main') { return [prefix: 'PROD', name: 'prod'] }
    return [prefix: 'QA', name: 'qa']
}

@NonCPS
def csvList(String raw) {
    def out = []
    for (String part : (raw ?: '').split(',')) {
        def t = part.trim()
        if (t) { out << t }
    }
    return out
}

def validateLaneCount(String name, def raw) {
    // null: the parameter does not exist yet (first build after it was added). Default 2.
    def value = (raw == null) ? '2' : raw.toString()
    if (!(value ==~ /^[1-4]$/)) {
        error("${name} must be an integer from 1 to 4, got '${value}'")
    }
    return value.toInteger()
}

def resolveRunMode() {
    def branch = env.BRANCH_NAME ?: ''
    def manual = currentBuild.getBuildCauses('hudson.model.Cause$UserIdCause').size() > 0
    def sharding = (env.KYLAS_SHARDING ?: '').trim()
    def listed = csvList(env.KYLAS_SHARDED_BRANCHES).contains(branch)
    def wantsTest = params.SHARDED_TEST == true
    def sharded = false
    def testRun = false
    def reason = ''

    if (sharding.equalsIgnoreCase('off')) {
        reason = 'KYLAS_SHARDING=off: sharding is off everywhere'
    } else if (listed) {
        // WHY the trigger rule (root cause: this branch used to become sharded for ANY trigger): the
        // stages that make a run possible (Install, Setup Environment, Clear Auth State, the Approval
        // Gate, Run Tests) only admit prod, main or a manual build, because Jenkins is not the
        // automatic CI for the other branches (GitHub Actions is). "Listed" only chooses HOW a build
        // that is allowed to run tests runs them (sharded); it must never decide WHETHER one runs.
        // Otherwise an automatic push to a listed sandbox would start a sharded run with no Install,
        // no Setup Environment and no approval, next to GitHub's own sandbox run.
        if (branch == 'prod' || branch == 'main' || manual) {
            sharded = true
            reason = "branch '${branch}' is listed in KYLAS_SHARDED_BRANCHES"
        } else {
            reason = "branch '${branch}' is listed in KYLAS_SHARDED_BRANCHES, but this is an automatic build and only prod, main or a manual build runs tests on Jenkins: unsharded, tests skipped as today"
        }
        if (wantsTest || params.TEST_GREP || params.FF_ENTITIES) {
            echo "SHARDED_TEST / TEST_GREP / FF_ENTITIES have no effect on '${branch}' (it is a KYLAS_SHARDED_BRANCHES branch): ignored"
        }
    } else if (wantsTest) {
        if (!manual) {
            reason = 'SHARDED_TEST is only honoured on a manual build: ignored'
        } else {
            def envName = kylasEnvFor(branch).name
            if (envName != 'qa') {
                error("SHARDED_TEST refused: branch '${branch}' resolves to '${envName}', and the sharded test path runs against QA only")
            }
            sharded = true
            testRun = true
            reason = "SHARDED_TEST on a manual build of '${branch}' (QA)"
        }
    } else {
        reason = "branch '${branch}' is not in KYLAS_SHARDED_BRANCHES: unsharded"
    }

    env.SHARDED_RUN = sharded ? 'true' : 'false'
    env.SHARDED_TEST_RUN = testRun ? 'true' : 'false'
    echo "Run mode: ${sharded ? 'SHARDED' : 'unsharded'} (${reason})"

    if (sharded) {
        def coreLanes = validateLaneCount('CORE_LANES', params.CORE_LANES)
        def ffLanes = validateLaneCount('FF_LANES', params.FF_LANES)
        def scope = ''
        if (testRun) {
            def grep = (params.TEST_GREP ?: '').trim()
            if (grep && !(grep ==~ /^[A-Za-z0-9_@.\-]+$/)) {
                error("TEST_GREP '${grep}' is not allowed: use letters, digits, _ @ . - only (no spaces)")
            }
            def ff = (params.FF_ENTITIES ?: '').trim()
            if (ff) {
                def valid = sh(script: "node -p \"require('./config/sharedConfigSuites.json').formFields.entities.join(' ')\"", returnStdout: true).trim().split(' ') as List
                for (String e : csvList(ff)) {
                    if (e != 'none' && !valid.contains(e)) {
                        error("FF_ENTITIES: unknown entity '${e}' (valid: ${valid.join(', ')}, or 'none')")
                    }
                }
            }
            def parts = []
            if (grep) { parts << "TEST_GREP=${grep}" }
            if (ff) { parts << "FF_ENTITIES=${ff}" }
            scope = parts.join(' ')
        }
        env.SHARD_CORE_LANES = coreLanes.toString()
        env.SHARD_FF_LANES = ffLanes.toString()
        env.SHARD_SCOPE = scope
        // Read by history:sync (src/notifications/scripts/syncHistory.ts): marks the ledger record.
        env.CI_LANES = "core=${coreLanes},ff=${ffLanes}" + (scope ? ',scoped' : '')
        echo "Lanes: core=${coreLanes}, formFields=${ffLanes}${scope ? ' | scoped: ' + scope : ''}"
    }
}

// ---- Wall clock (approval age) ---------------------------------------------

def wallClockEpoch() {
    return sh(script: 'date +%s', returnStdout: true).trim()
}

def wallClockStamp() {
    return sh(script: 'date -u +%Y-%m-%dT%H:%M:%SZ', returnStdout: true).trim()
}

// ---- Account lock and collision guard --------------------------------------

// Takes the per-account lock (Lockable Resources), then runs the collision guard inside it.
// Used by every Jenkins test run, sharded or not, so no Jenkins run overlaps another Jenkins
// run or a GitHub run on the same account. The lock is released when the block ends or the
// build is aborted.
def withAccountLock(String envName, Closure body) {
    def resource = "kylas-${envName}-account"
    echo "Taking lock '${resource}' (waits while another Jenkins run holds it)"
    lock(resource: resource) {
        echo "Lock '${resource}' held"
        runCollisionGuard(envName)
        body()
    }
}

def runCollisionGuard(String envName) {
    withCredentials([usernamePassword(credentialsId: 'github-credentials', usernameVariable: 'GIT_USERNAME', passwordVariable: 'GIT_TOKEN')]) {
        sh "bash scripts/jenkins-collision-guard.sh ${envName}"
    }
}

// Same check, but returns the exit status instead of failing the build, for the mid-run
// re-checks: a hit there must skip the remaining phases yet still let merge and notify run.
def collisionGuardStatus(String envName) {
    def rc = 0
    withCredentials([usernamePassword(credentialsId: 'github-credentials', usernameVariable: 'GIT_USERNAME', passwordVariable: 'GIT_TOKEN')]) {
        rc = sh(script: "bash scripts/jenkins-collision-guard.sh ${envName}", returnStatus: true)
    }
    return rc
}

// ---- Plan parsing (pure string work: no steps, so @NonCPS) ------------------

@NonCPS
def parsePlan(String text) {
    def plan = [coreTotal: 0, ffTotal: 0, testCount: 0, ffGrep: '', core: [], ff: []]
    for (String line : text.split('\n')) {
        if (!line.trim()) { continue }
        def p = line.split('\\|', -1)
        if (p[0] == 'meta') {
            for (int i = 1; i < p.length; i++) {
                def kv = p[i].split('=', 2)
                def v = kv.length > 1 ? kv[1] : ''
                if (kv[0] == 'core_total') { plan.coreTotal = Integer.parseInt(v) }
                if (kv[0] == 'ff_total') { plan.ffTotal = Integer.parseInt(v) }
                if (kv[0] == 'test_count') { plan.testCount = Integer.parseInt(v) }
                if (kv[0] == 'ff_grep') { plan.ffGrep = v }
            }
        } else if (p[0] == 'core') {
            plan.core << [id: p[1], weight: Integer.parseInt(p[2]), files: p[3]]
        } else if (p[0] == 'ff') {
            plan.ff << [entity: p[1], files: p[2]]
        }
    }
    return plan
}

@NonCPS
def parseKeyValues(String text) {
    def m = [:]
    for (String line : text.split('\n')) {
        def i = line.indexOf('=')
        if (i > 0) { m[line.substring(0, i)] = line.substring(i + 1) }
    }
    return m
}

// Deals units across laneCount lanes: heaviest first, each onto the currently lightest lane
// (ties go to the lowest lane), so equal-weight units simply alternate. No sort() with a
// closure: it is not safe in the pipeline's CPS context.
@NonCPS
def dealLanes(List units, int laneCount) {
    def lanes = []
    def loads = []
    for (int i = 0; i < laneCount; i++) {
        lanes << []
        loads << 0
    }
    def remaining = new ArrayList(units)
    while (!remaining.isEmpty()) {
        int heaviest = 0
        for (int i = 1; i < remaining.size(); i++) {
            if (remaining[i].weight > remaining[heaviest].weight) { heaviest = i }
        }
        def unit = remaining.remove(heaviest)
        int lightest = 0
        for (int i = 1; i < laneCount; i++) {
            if (loads[i] < loads[lightest]) { lightest = i }
        }
        lanes[lightest] << unit
        loads[lightest] = loads[lightest] + unit.weight
    }
    return lanes
}

// ---- Selection, plan and the sharded run ------------------------------------

def softSh(String label, String cmd) {
    def rc = sh(script: cmd, returnStatus: true)
    if (rc != 0) {
        echo "${label} failed (exit ${rc})"
        currentBuild.result = 'FAILURE'
    }
    return rc
}

def resolveSelection() {
    if (env.BRANCH_NAME == 'sandbox') {
        // WHY an explicit refspec and the PAT (askpass, never argv): the multibranch checkout only
        // fetches the branch itself, so `git fetch origin dev` does not update origin/dev, and
        // detect-tests.sh needs origin/dev. A failed fetch FAILS the build: without origin/dev the
        // changes cannot be compared, which is not the same as "nothing changed", and answering
        // --grep @smoke would let a change that needs the full regression pass on smoke only.
        withCredentials([usernamePassword(credentialsId: 'github-credentials', usernameVariable: 'GIT_USERNAME', passwordVariable: 'GIT_TOKEN')]) {
            sh '''
                ASKPASS="$(mktemp)"
                printf '#!/bin/sh\ncase "$1" in Username*) echo "$GIT_USERNAME";; *) echo "$GIT_TOKEN";; esac\n' > "$ASKPASS"
                chmod 700 "$ASKPASS"
                GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 git fetch --no-tags origin +refs/heads/dev:refs/remotes/origin/dev
                rc=$?
                rm -f "$ASKPASS"
                if [ "$rc" -ne 0 ]; then
                    echo "ERROR: git fetch of origin/dev failed (exit $rc). The sandbox selection compares this branch with dev, so it cannot choose tests without it. Not falling back to --grep @smoke: fix the fetch (credentials, network) and re-run." >&2
                    exit 1
                fi
            '''
        }
    }
    def raw = sh(script: 'bash scripts/jenkins-resolve-selection.sh "$BRANCH_NAME"', returnStdout: true)
    return parseKeyValues(raw)
}

def runSharded() {
    def envName = env.KYLAS_ENV_NAME
    def branch = env.BRANCH_NAME
    if (env.SHARDED_TEST_RUN == 'true' && envName != 'qa') {
        error("Sharded test path refused: branch '${branch}' resolved to '${envName}', it runs against QA only")
    }
    if (envName == 'prod' && branch != 'main' && branch != 'prod') {
        error("Sharded run refused: branch '${branch}' must not run against PROD")
    }
    def coreLanes = env.SHARD_CORE_LANES.toInteger()
    def ffLanes = env.SHARD_FF_LANES.toInteger()
    def scope = env.SHARD_SCOPE ?: ''
    def mainWs = env.WORKSPACE
    def nodeName = env.NODE_NAME
    def nodeBin = sh(script: 'dirname "$(command -v node)"', returnStdout: true).trim()
    // GitHub names its artifacts after the workflow (main/qa/stage); this keeps the same labels.
    def prefix = (envName == 'prod') ? 'main' : envName
    def safeBranch = branch.replaceAll('[^A-Za-z0-9_.-]', '_')

    withAccountLock(envName) {
        // Set after the guard, so a refused run is not reported as a missing-report failure.
        env.TESTS_ATTEMPTED = 'true'

        def sel = resolveSelection()
        def selGrep = sel.sel_grep ?: ''
        def selPaths = sel.sel_paths ?: ''
        def coreMode = sel.core_mode ?: 'run'
        def ffMode = sel.ff_mode ?: 'all'
        def ffList = sel.ff_list ?: ''
        def ffGrep = sel.ff_grep ?: ''
        if (env.SHARDED_TEST_RUN == 'true') {
            def grep = (params.TEST_GREP ?: '').trim()
            if (grep) {
                selGrep = grep
                selPaths = ''
                coreMode = 'run'
            }
            def ffParam = (params.FF_ENTITIES ?: '').replace(' ', '')
            if (ffParam == 'none') {
                ffMode = 'none'
            } else if (ffParam) {
                ffMode = 'list'
                ffList = ffParam
                ffGrep = ''
            }
            if (grep && ffMode == 'matching') {
                ffGrep = grep
            }
            if (grep && !ffParam) {
                echo 'WARNING: TEST_GREP is set but FF_ENTITIES is empty, so ALL formFields entities will run in full. Use FF_ENTITIES=none for a core-only trial.'
            }
        }
        echo "Selection for '${branch}' on ${envName}: ${sel.label}${scope ? ' | scoped: ' + scope : ''}"
        echo "  core: grep='${selGrep}' paths='${selPaths}' | formFields: mode=${ffMode} list='${ffList}' grep='${ffGrep}'"

        stage('Plan Shards') {
            def ffArg = (ffMode == 'list') ? ffList : ffMode
            def planArgs = []
            if (selGrep) { planArgs << "--grep ${selGrep}" }
            if (selPaths) { planArgs << selPaths }
            def helperArgs = "--ff '${ffArg}'"
            if (ffGrep) { helperArgs += " --ff-grep '${ffGrep}'" }
            if (selGrep) { helperArgs += " --sel-grep '${selGrep}'" }
            if (selPaths) { helperArgs += " --sel-paths '${selPaths}'" }
            // GITHUB_OUTPUT points at a file, so plan-shards.ts writes shard_total/shards_json/test_count
            // there instead of printing JSON between log lines. The one failure that is not an error here
            // is "no core files left after excluding formFields" (a selection of only formFields paths).
            // coreMode 'none' (a sandbox selection of only formFields paths): no planner run, because no
            // arguments would plan the WHOLE suite.
            def runPlanner = (coreMode == 'none') ? 'false' : 'true'
            sh """
                rm -f shard-plan.out shard-plan.txt shard-plan.log
                rc=0
                if [ ${runPlanner} = true ]; then
                set +e
                GITHUB_OUTPUT="\$PWD/shard-plan.out" npx ts-node scripts/plan-shards.ts ${planArgs.join(' ')} > shard-plan.log 2>&1
                rc=\$?
                set -e
                fi
                [ -f shard-plan.log ] && cat shard-plan.log
                if [ \$rc -ne 0 ]; then
                    if grep -q 'zero test files remain' shard-plan.log; then
                        echo "[plan] no core test files in this selection: the core track is empty"
                        rm -f shard-plan.out
                    else
                        exit \$rc
                    fi
                fi
                npx ts-node scripts/jenkins-shard-plan.ts shard-plan.out shard-plan.txt ${helperArgs}
            """
        }
        def plan = parsePlan(readFile('shard-plan.txt'))

        def workers = (sel.workers == 'dynamic') ? (plan.testCount > 50 ? 2 : 1) : sel.workers.toInteger()
        def testTimeout = sel.test_timeout.toInteger()
        def grepFlag = selGrep ? " --grep ${selGrep}" : ''
        def timeoutFlag = (testTimeout > 0) ? " --timeout=${testTimeout}" : ''
        def reporters = '--reporter=blob,list,./src/reporters/MiscErrorReporter.ts'

        def common = [nodeName: nodeName, nodeBin: nodeBin, mainWs: mainWs, envName: envName, prefix: prefix]
        def coreUnits = []
        def ffUnits = []
        def unitLines = []
        for (def c : plan.core) {
            def suffix = c.id
            coreUnits << common + [
                title: "core shard ${c.id}", suffix: suffix, weight: c.weight,
                wsName: "kylas-${safeBranch}-core-${c.id}",
                blobStash: "blob-${prefix}-${suffix}", miscStash: "misc-${prefix}-${suffix}",
                command: "ENV=${envName} npx playwright test --project=chromium${grepFlag} --workers=${workers}${timeoutFlag} ${c.files} ${reporters}"
            ]
            unitLines << "blob-${prefix}-${suffix}|misc-${prefix}-${suffix}"
        }
        def ffGrepFlag = plan.ffGrep ? " --grep ${plan.ffGrep}" : ''
        for (def f : plan.ff) {
            def suffix = "formfields-${f.entity}"
            ffUnits << common + [
                title: "formFields ${f.entity}", suffix: suffix, weight: 1,
                wsName: "kylas-${safeBranch}-ff-${f.entity}",
                blobStash: "blob-${prefix}-${suffix}", miscStash: "misc-${prefix}-${suffix}",
                command: "ENV=${envName} npx playwright test --project=chromium --workers=2 ${f.files}${ffGrepFlag} ${reporters}"
            ]
            unitLines << "blob-${prefix}-${suffix}|misc-${prefix}-${suffix}"
        }
        writeFile file: 'shard-units.txt', text: unitLines.join('\n') + '\n'
        writeFile file: 'shard-meta.txt', text: "env=${envName}\nprefix=${prefix}\ncore_total=${plan.coreTotal}\nff_total=${plan.ffTotal}\nscope=${scope}\n"
        echo "Plan: ${plan.coreTotal} core shard(s) / ${plan.testCount} test(s), ${plan.ffTotal} formFields entit${plan.ffTotal == 1 ? 'y' : 'ies'}; core workers=${workers}, lanes core=${coreLanes} ff=${ffLanes}"

        // One source tree for every shard: the exact commit this build checked out, with no
        // second fetch (main could move during a multi-hour run), and no secrets in the stash.
        stash name: 'kylas-src', includes: '**',
              excludes: 'node_modules/**,.env,.git/**,reports/**,test-results/**,blob-report/**,out/**,all-blob-reports/**,all-misc-errors/**,src/auth/storageStates/**,.locks/**'

        // WHY try/finally (the reset must not depend on the formFields phase finishing): the tests can
        // leave Min/Max/Regex limits on the dedicated fields, and an abort or a failure in the middle of
        // the phase is exactly when they are left behind. GitHub's reset job is `if: always()`; this is
        // the same rule: the reset runs whenever the formFields phase STARTED, in any result, still
        // inside the account lock and still behind a fresh collision-guard check.
        def ffStarted = false
        try {
            // Only one sharded run at a time uses this laptop. Always taken inside the account lock
            // (never the other way round), so two runs cannot wait on each other.
            lock(resource: 'jenkins-heavy-run') {
                echo "Lock 'jenkins-heavy-run' held"
                if (coreUnits) {
                    stage('Core track') {
                        runLanes('core', coreLanes, coreUnits)
                    }
                }
                // After the core track in ANY result (ADR 0007): a failed core shard never suppresses formFields.
                if (ffUnits) {
                    stage('formFields track') {
                        def rc = collisionGuardStatus(envName)
                        if (rc != 0) {
                            echo 'Collision guard refused the formFields phase: skipping it (and the reset). The merge reports the run as incomplete.'
                            currentBuild.result = 'FAILURE'
                        } else {
                            // Set BEFORE the lanes start: from here on an entity may have changed the limits.
                            ffStarted = true
                            runLanes('ff', ffLanes, ffUnits)
                        }
                    }
                }
            }
        } finally {
            // The dedicated form-field limits are reset once, inside the account lock, after the
            // laptop lock is released (the reset is light).
            if (ffStarted) {
                stage('Reset field config') {
                    def rc = collisionGuardStatus(envName)
                    if (rc != 0) {
                        echo 'Collision guard refused the field-config reset: skipping it. Stale form-field limits may remain.'
                        currentBuild.result = 'FAILURE'
                    } else {
                        def confirm = (envName == 'prod') ? ' --confirm-prod' : ''
                        timeout(time: 25, unit: 'MINUTES') {
                            def resetRc = sh(script: "npm run reset:field-config -- --env ${envName}${confirm}", returnStatus: true)
                            if (resetRc != 0) {
                                echo "WARNING: Dedicated field reset incomplete (${envName}): reset:field-config exited ${resetRc}. Stale form-field limits may remain. Run: npm run reset:field-config -- --env ${envName} --dry-run (docs/RUNBOOK.md)"
                            }
                        }
                    }
                }
            }
        }
    }
}

def runLanes(String kind, int laneCount, List units) {
    def lanes = dealLanes(units, laneCount)
    def branches = [:]
    for (int i = 0; i < lanes.size(); i++) {
        def laneUnits = lanes[i]
        if (laneUnits.isEmpty()) { continue }
        def laneNo = i + 1
        branches["${kind} lane ${laneNo}"] = {
            for (def u : laneUnits) {
                stage(u.title) {
                    runShardUnit(u)
                }
            }
        }
    }
    branches.failFast = false
    parallel branches
}

// One shard or entity: its own workspace (hence its own .env, storageStates and .locks), the
// same source tree, and the stashes the merge step reads. A failure marks the build FAILURE
// but never stops the other shards.
def runShardUnit(Map u) {
    node(u.nodeName) {
        ws(u.wsName) {
            withEnv(["PATH+NODE=${u.nodeBin}"]) {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE', message: "${u.title} failed") {
                    try {
                        deleteDir()
                        unstash 'kylas-src'
                        // The email/notify secrets are not needed by a shard.
                        sh "grep -Ev '^(GMAIL_|NOTIFY_)' '${u.mainWs}/.env' > .env"
                        sh 'npm ci'
                        sh 'rm -rf src/auth/storageStates .locks blob-report reports test-results out; mkdir -p src/auth/storageStates'
                        // Same ceiling as the GitHub shard jobs.
                        timeout(time: 180, unit: 'MINUTES') {
                            sh u.command
                        }
                    } finally {
                        sh "bash scripts/jenkins-collect-shard.sh ${u.envName} ${u.prefix} ${u.suffix}"
                        dir('out/blob') {
                            stash name: u.blobStash, includes: '*.zip', allowEmpty: true
                        }
                        dir('out/misc') {
                            stash name: u.miscStash, includes: '**', allowEmpty: true
                        }
                        archiveArtifacts artifacts: "out/results/${u.suffix}/**", allowEmptyArchive: true
                        deleteDir()
                    }
                }
            }
        }
    }
}

// Runs in post{always{}} for a sharded build, outside both locks: collects the stashes, checks
// completeness, merges the blob reports and the misc-errors. history:sync and notify then run
// once, from the existing post steps, against the merged report.
def shardedMergeAndReport() {
    if (!fileExists('shard-meta.txt')) {
        echo 'Sharded build produced no shard plan: nothing to merge.'
        return
    }
    def meta = parseKeyValues(readFile('shard-meta.txt'))
    sh 'rm -rf all-blob-reports all-misc-errors; mkdir -p all-blob-reports all-misc-errors'
    for (String line : readFile('shard-units.txt').readLines()) {
        if (!line.trim()) { continue }
        def names = line.split('\\|')
        try {
            dir('all-blob-reports') {
                unstash names[0]
            }
        } catch (err) {
            echo "No blob report from ${names[0]} (the shard never produced one)"
        }
        try {
            dir('all-misc-errors') {
                unstash names[1]
            }
        } catch (err) {
            echo "No misc-errors from ${names[1]}"
        }
    }
    // Always exits 0 by design: it writes reports/<env>/shard-completeness.json for history:sync and notify.
    sh "bash .github/scripts/verify-shard-completeness.sh ${meta.env} ${meta.core_total} ${meta.ff_total}"
    if (meta.scope) {
        // A deliberately scoped run is complete by count but is not a full-suite result: mark it for the email.
        writeFile file: 'shard-scope.txt', text: meta.scope
        sh "node -e \"const fs=require('fs');const f='reports/${meta.env}/shard-completeness.json';const j=JSON.parse(fs.readFileSync(f,'utf8'));j.scoped=fs.readFileSync('shard-scope.txt','utf8').trim();fs.writeFileSync(f,JSON.stringify(j)+'\\\\n')\""
    }
    softSh('Merging shard reports', 'npx playwright merge-reports --config=merge.config.ts ./all-blob-reports')
    softSh('Aggregating misc-errors', "npx ts-node scripts/merge-misc-errors.ts ${meta.env} all-misc-errors")
}
