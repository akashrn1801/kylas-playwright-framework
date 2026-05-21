pipeline {
    agent any

    tools {
        nodejs 'Node20'
        allure 'Allure'
    }

    environment {
        CI       = 'true'
        ENV      = 'prod'
        HEADLESS = 'true'
    }

    stages {

        stage('Checkout') {
            steps {
                echo 'Checking out code...'
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing dependencies...'
                sh 'npm ci'
                sh 'npx playwright install chromium'
            }
        }

        stage('Setup Environment') {
            steps {
                echo 'Setting up environment...'
                withCredentials([file(credentialsId: 'kylas-env-file', variable: 'ENV_FILE')]) {
                    sh '''
                        chmod 777 .
                        cp $ENV_FILE .env
                        chmod 644 .env
                    '''
                }
            }
        }

        stage('Run Playwright Tests') {
            steps {
                echo 'Running Playwright tests...'
                sh 'rm -rf src/auth/storageStates/'
                sh 'npx playwright test --project=chromium --workers=1 tests/ui'
            }
        }

    }

    post {
        always {
            echo 'Publishing reports...'
            allure([
                includeProperties: false,
                jdk              : '',
                results          : [[path: 'allure-results']]
            ])
            publishHTML(target: [
                allowMissing         : true,
                alwaysLinkToLastBuild: true,
                keepAll              : true,
                reportDir            : 'reports/playwright-report',
                reportFiles          : 'index.html',
                reportName           : 'Playwright HTML Report'
            ])
        }
        success {
            echo '✅ All tests passed!'
        }
        failure {
            echo '❌ Tests failed — check Allure report for details'
        }
    }
}