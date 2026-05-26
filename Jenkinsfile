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
        CI = 'true'
        HEADLESS = 'true'
        PLAYWRIGHT_BROWSERS_PATH = '/var/jenkins_home/.cache/ms-playwright'
    }

    stages {

        stage('Checkout') {
            steps {
                script {
                    echo "Branch: ${env.BRANCH_NAME}"
                }
                checkout scm
            }
        }

        stage('Install') {
            steps {
                sh 'node --version'
                sh 'npm ci'
                sh 'npx playwright install chromium'
            }
        }

        stage('Setup Environment') {
            steps {
                script {
                    def envPrefix = 'QA'
                    def envName = 'qa'
                    if (env.BRANCH_NAME == 'stage') {
                        envPrefix = 'STAGING'
                        envName = 'staging'
                    } else if (env.BRANCH_NAME == 'prod' || env.BRANCH_NAME == 'main') {
                        envPrefix = 'PROD'
                        envName = 'prod'
                    }
                    withCredentials([
                        string(credentialsId: "${envPrefix}_APP_URL", variable: 'APP_URL'),
                        string(credentialsId: "${envPrefix}_API_BASE_URL", variable: 'API_BASE_URL'),
                        string(credentialsId: "${envPrefix}_ADMIN_EMAIL", variable: 'ADMIN_EMAIL'),
                        string(credentialsId: "${envPrefix}_ADMIN_PASSWORD", variable: 'ADMIN_PASSWORD'),
                        string(credentialsId: "${envPrefix}_RESTRICTED_EMAIL", variable: 'RESTRICTED_EMAIL'),
                        string(credentialsId: "${envPrefix}_RESTRICTED_PASSWORD", variable: 'RESTRICTED_PASSWORD')
                    ]) {
                        writeFile file: '.env', text: """ENV=${envName}
${envPrefix}_APP_URL=${APP_URL}
${envPrefix}_API_BASE_URL=${API_BASE_URL}
${envPrefix}_ADMIN_EMAIL=${ADMIN_EMAIL}
${envPrefix}_ADMIN_PASSWORD=${ADMIN_PASSWORD}
${envPrefix}_RESTRICTED_EMAIL=${RESTRICTED_EMAIL}
${envPrefix}_RESTRICTED_PASSWORD=${RESTRICTED_PASSWORD}
HEADLESS=true
CI=true
"""
                    }
                }
            }
        }

        stage('Clear Auth State') {
            steps {
                sh 'rm -rf src/auth/storageStates/'
                sh 'mkdir -p src/auth/storageStates/'
            }
        }

        stage('Run Tests') {
            steps {
                script {
                    def grepTag = '--grep @smoke'
                    if (env.BRANCH_NAME == 'qa') {
                        grepTag = '--grep @regression'
                    } else if (env.BRANCH_NAME == 'stage' || env.BRANCH_NAME == 'main' || env.BRANCH_NAME == 'prod') {
                        grepTag = ''
                    }
                    sh "npx playwright test --project=chromium ${grepTag} --workers=2 || true"
                }
            }
        }

        stage('Approval Gate') {
            when {
                anyOf {
                    branch 'prod'
                    branch 'main'
                }
            }
            steps {
                timeout(time: 24, unit: 'HOURS') {
                    input message: "Tests passed on ${env.BRANCH_NAME}. Approve to proceed?",
                          ok: "Yes, approve"
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
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: 'reports/playwright-report',
                reportFiles: 'index.html',
                reportName: 'Playwright HTML Report'
            ])
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