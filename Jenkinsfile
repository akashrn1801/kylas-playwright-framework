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
        CI       = 'true'
        HEADLESS = 'true'
        // Do NOT set ENV here — let params.ENV flow through cleanly
    }

    stages {

        stage('Checkout') {
            steps {
                echo "Checking out code..."
                checkout scm
            }
        }
        // Add this temporary stage after Checkout to verify:
stage('Verify Tools') {
    steps {
        sh 'node -v'
        sh 'npm -v'
        sh 'npx playwright --version'
        sh 'echo "ENV param = ${params.ENV}"'
        sh 'whoami'
        sh 'cat .env | grep -o "^[^=]*"'  // prints key names only, not values
    }
}

        stage('Install Dependencies') {
            steps {
                echo 'Installing Node dependencies...'
                sh 'npm ci'

                echo 'Installing Playwright browsers + system dependencies...'
                // --with-deps installs ALL Linux system libs Chromium needs
                sh 'npx playwright install chromium --with-deps'
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
                        # Confirm critical keys exist — never print values
                        echo "Keys present in .env:"
                        grep -o '^[^=]*' .env
                    '''
                }
            }
        }

        stage('Clear Auth State') {
            steps {
                echo 'Clearing stale browser auth state...'
                sh 'rm -rf src/auth/storageStates/'
                sh 'mkdir -p src/auth/storageStates/'
            }
        }

        stage('Run Playwright Tests') {
            steps {
                echo "Running Playwright tests — ENV=${params.ENV}, WORKERS=${params.WORKERS}"
                sh """
                    export ENV=${params.ENV}
                    export WORKERS=${params.WORKERS}
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
                jdk              : '',
                results          : [[path: 'allure-results']]
            ])

            echo 'Publishing Playwright HTML report...'
            publishHTML(target: [
                allowMissing         : true,
                alwaysLinkToLastBuild: true,
                keepAll              : true,
                reportDir            : 'reports/playwright-report',
                reportFiles          : 'index.html',
                reportName           : 'Playwright HTML Report'
            ])

            echo 'Archiving test artifacts...'
            archiveArtifacts(
                artifacts: 'test-results/**,allure-results/**,reports/**',
                allowEmptyArchive: true
            )
        }

        success {
            echo '✅ All tests passed!'
        }

        failure {
            echo '❌ Tests failed — check Allure + Playwright reports'
        }
    }
}