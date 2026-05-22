pipeline {
  agent any

  tools {
    nodejs 'Node22'
  }

  options {
    ansiColor('xterm')
    timestamps()
    timeout(time: 60, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  environment {
    CI = 'true'

    QA_APP_URL             = credentials('QA_APP_URL')
    QA_API_BASE_URL        = credentials('QA_API_BASE_URL')
    QA_ADMIN_EMAIL         = credentials('QA_ADMIN_EMAIL')
    QA_ADMIN_PASSWORD      = credentials('QA_ADMIN_PASSWORD')
    QA_RESTRICTED_EMAIL    = credentials('QA_RESTRICTED_EMAIL')
    QA_RESTRICTED_PASSWORD = credentials('QA_RESTRICTED_PASSWORD')

    STAGING_APP_URL             = credentials('STAGING_APP_URL')
    STAGING_API_BASE_URL        = credentials('STAGING_API_BASE_URL')
    STAGING_ADMIN_EMAIL         = credentials('STAGING_ADMIN_EMAIL')
    STAGING_ADMIN_PASSWORD      = credentials('STAGING_ADMIN_PASSWORD')
    STAGING_RESTRICTED_EMAIL    = credentials('STAGING_RESTRICTED_EMAIL')
    STAGING_RESTRICTED_PASSWORD = credentials('STAGING_RESTRICTED_PASSWORD')

    PROD_APP_URL             = credentials('PROD_APP_URL')
    PROD_API_BASE_URL        = credentials('PROD_API_BASE_URL')
    PROD_ADMIN_EMAIL         = credentials('PROD_ADMIN_EMAIL')
    PROD_ADMIN_PASSWORD      = credentials('PROD_ADMIN_PASSWORD')
    PROD_RESTRICTED_EMAIL    = credentials('PROD_RESTRICTED_EMAIL')
    PROD_RESTRICTED_PASSWORD = credentials('PROD_RESTRICTED_PASSWORD')

    DEFAULT_TIMEOUT    = '30000'
    NAVIGATION_TIMEOUT = '90000'
    EXPECT_TIMEOUT     = '20000'
    HEADLESS           = 'true'
    WORKERS            = '2'
    RETRY_COUNT        = '1'
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
        echo "Branch: ${env.GIT_BRANCH}"
        echo "Commit: ${env.GIT_COMMIT}"
      }
    }

    stage('Install') {
      steps {
        sh 'node --version'
        sh 'npm ci'
        sh 'npx playwright install chromium'
      }
    }

    stage('Test — QA') {
      steps {
        sh '''
          ENV=qa npx playwright test \
            --project=chromium \
            --workers=2 \
            --reporter=line,allure-playwright
        '''
      }
      post {
        always {
          sh 'mv allure-results allure-results-qa || true'
        }
      }
    }

    stage('Test — Staging') {
      steps {
        catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
          sh '''
            ENV=staging npx playwright test \
              --project=chromium \
              --workers=2 \
              --reporter=line,allure-playwright
          '''
        }
      }
      post {
        always {
          sh 'mv allure-results allure-results-staging || true'
        }
      }
    }

    stage('Allure Report') {
      steps {
        allure([
          includeProperties: false,
          jdk: '',
          results: [
            [path: 'allure-results-qa'],
            [path: 'allure-results-staging']
          ]
        ])
      }
    }

    stage('Approval — Prod') {
      when {
        anyOf {
          branch 'main'
          branch 'develop'
        }
      }
      steps {
        timeout(time: 24, unit: 'HOURS') {
          input message: '🚀 Proceed to PROD?',
                ok: 'Yes, run Prod tests',
                submitter: 'akashrn1801'
        }
      }
    }

    stage('Test — Prod') {
      when {
        anyOf {
          branch 'main'
          branch 'develop'
        }
      }
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
    success {
      echo '✅ All stages passed'
    }
    unstable {
      echo '⚠️ Staging tests failed but pipeline continued'
    }
    failure {
      echo '❌ Pipeline failed'
    }
    always {
      cleanWs()
    }
  }
}
