pipeline {
  agent any
  tools { nodejs 'Node22' }

  options {
    ansiColor('xterm')
    timestamps()
    timeout(time: 60, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    CI                       = 'true'
    PROD_APP_URL             = credentials('PROD_APP_URL')
    PROD_API_BASE_URL        = credentials('PROD_API_BASE_URL')
    PROD_ADMIN_EMAIL         = credentials('PROD_ADMIN_EMAIL')
    PROD_ADMIN_PASSWORD      = credentials('PROD_ADMIN_PASSWORD')
    PROD_RESTRICTED_EMAIL    = credentials('PROD_RESTRICTED_EMAIL')
    PROD_RESTRICTED_PASSWORD = credentials('PROD_RESTRICTED_PASSWORD')
    DEFAULT_TIMEOUT          = '30000'
    NAVIGATION_TIMEOUT       = '90000'
    EXPECT_TIMEOUT           = '20000'
    HEADLESS                 = 'true'
    WORKERS                  = '1'
    RETRY_COUNT              = '1'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        echo "Branch: ${env.GIT_BRANCH} | Commit: ${env.GIT_COMMIT}"
      }
    }

    stage('Install') {
      steps {
        sh 'node --version'
        sh 'npm ci'
        sh 'npx playwright install chromium'
      }
    }

    stage('⚠️ Approval — Run PROD?') {
      steps {
        timeout(time: 24, unit: 'HOURS') {
          input message: '🚨 You are about to run tests against PRODUCTION. Are you sure?',
                ok: 'Yes, I approve — run Prod tests',
                submitter: 'akashrn1801',
                parameters: [
                  string(
                    name: 'REASON',
                    defaultValue: '',
                    description: 'Reason for running against Prod (required)'
                  )
                ]
        }
      }
    }

    stage('Test — Prod') {
      steps {
        sh '''
          ENV=prod npx playwright test \
            --project=chromium \
            --workers=1 \
            --reporter=line,allure-playwright
        '''
      }
      post {
        always {
          sh 'mv allure-results allure-results-prod || true'
          allure([
            includeProperties: false,
            jdk: '',
            results: [[path: 'allure-results-prod']]
          ])
        }
      }
    }
  }

  post {
    success  { echo '✅ Prod tests passed' }
    failure  { echo '❌ Prod tests FAILED — investigate immediately' }
    always   { cleanWs() }
  }
}