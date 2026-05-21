pipeline {
    agent any

    tools {
        nodejs 'Node20'
        allure 'Allure'
    }

    parameters {
        choice(
            name: 'ENV',
            choices: ['prod', 'qa', 'staging'],
            description: 'Environment to run tests against'
        )

        choice(
            name: 'WORKERS',
            choices: ['1', '2', '3'],
            description: 'Number of parallel workers'
        )
    }

    environment {
        CI = 'true'
        HEADLESS = 'true'
    }

    stages {

        stage('Checkout') {
            steps {
                echo 'Checking out code...'
                checkout scm
            }
        }

        stage('Verify Tools') {
            steps {

                echo 'Verifying Jenkins environment and installed tools...'

                sh 'node -v'
                sh 'npm -v'
                sh 'npx playwright --version'

                echo "ENV param = ${params.ENV}"
                echo "WORKERS param = ${params.WORKERS}"

                sh 'whoami'

                sh '''
                    echo "Current workspace:"
                    pwd

                    echo "Workspace files:"
                    ls -la
                '''

                sh '''
                    if [ -f .env ]; then
                        echo ".env exists"

                        echo "Available ENV keys:"
                        grep -o "^[^=]*" .env || true
                    else
                        echo ".env not found yet (expected before Setup Environment stage)"
                    fi
                '''
            }
        }

        stage('Install Dependencies') {
            steps {

                echo 'Installing Node dependencies...'

                sh '''
                    npm ci
                '''

                echo 'Installing Playwright browsers and Linux dependencies...'

              sh '''
    npx playwright install chromium
'''

                echo 'Installed Playwright browsers successfully'
            }
        }

        stage('Setup Environment') {
            steps {

                echo "Setting up .env for environment: ${params.ENV}"

                withCredentials([
                    file(credentialsId: 'kylas-env-file', variable: 'ENV_FILE')
                ]) {

                    sh '''
                        cp "$ENV_FILE" .env

                        chmod 644 .env

                        echo "✅ .env file copied successfully"

                        echo "Validating .env file..."

                        if [ ! -f .env ]; then
                            echo "❌ .env file missing"
                            exit 1
                        fi

                        echo "Available ENV keys:"
                        grep -o "^[^=]*" .env || true
                    '''
                }
            }
        }

        stage('Clear Auth State') {
            steps {

                echo 'Clearing stale Playwright auth state...'

                sh '''
                    rm -rf src/auth/storageStates/

                    mkdir -p src/auth/storageStates/

                    echo "✅ Auth state cleaned"
                '''
            }
        }

        stage('Run Playwright Tests') {
            steps {

                echo "Running Playwright tests"

                echo "ENV = ${params.ENV}"
                echo "WORKERS = ${params.WORKERS}"

                sh """
                    export ENV=${params.ENV}
                    export WORKERS=${params.WORKERS}

                    echo "Using ENV=\$ENV"
                    echo "Using WORKERS=\$WORKERS"

                    npx playwright test --project=chromium tests/ui
                """
            }
        }
    }

    post {

        always {

            echo 'Publishing Allure report...'

            allure([
                includeProperties: false,
                jdk: '',
                results: [[path: 'allure-results']]
            ])

            echo 'Publishing Playwright HTML report...'

            publishHTML(target: [
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: true,
                reportDir: 'reports/playwright-report',
                reportFiles: 'index.html',
                reportName: 'Playwright HTML Report'
            ])

            echo 'Archiving test artifacts...'

            archiveArtifacts(
                artifacts: 'test-results/**,allure-results/**,reports/**',
                allowEmptyArchive: true
            )
        }

        success {
            echo '✅ All Playwright tests passed successfully!'
        }

        failure {
            echo '❌ Tests failed — check Allure and Playwright reports'
        }
    }
}