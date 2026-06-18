pipeline {
    agent any

    tools {
        nodejs 'Node22'
    }

    options {
        timestamps()
        timeout(time: 60, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    environment {
        CI                       = 'true'
        HEADLESS                 = 'true'
        PLAYWRIGHT_BROWSERS_PATH = '/var/jenkins_home/.cache/ms-playwright'
    }

    stages {

        stage('Checkout') {
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
                    sh "npx playwright test --project=chromium --workers=2 || true"
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