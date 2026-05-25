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
    CI                          = 'true'
    HEADLESS                    = 'true'
    DEFAULT_TIMEOUT             = '30000'
    NAVIGATION_TIMEOUT          = '90000'
    EXPECT_TIMEOUT              = '20000'
    RETRY_COUNT                 = '1'
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
        sh 'npx playwright install chromium --with-deps'
      }
    }
    stage('Test — dev (smoke)') {
      when { branch 'dev' }
      environment {
        QA_APP_URL             = credentials('QA_APP_URL')
        QA_API_BASE_URL        = credentials('QA_API_BASE_URL')
        QA_ADMIN_EMAIL         = credentials('QA_ADMIN_EMAIL')
        QA_ADMIN_PASSWORD      = credentials('QA_ADMIN_PASSWORD')
        QA_RESTRICTED_EMAIL    = credentials('QA_RESTRICTED_EMAIL')
        QA_RESTRICTED_PASSWORD = credentials('QA_RESTRICTED_PASSWORD')
      }
      steps {
        sh 'ENV=qa npx playwright test --project=chromium --grep @smoke --workers=2 --timeout=90000 --reporter=line,allure-playwright'
      }
      post {
        always {
          sh 'mv allure-results allure-results-dev || true'
          allure(results: [[path: 'allure-results-dev']])
        }
      }
    }
    stage('Test — qa (regression)') {
      when { branch 'qa' }
      environment {
        QA_APP_URL             = credentials('QA_APP_URL')
        QA_API_BASE_URL        = credentials('QA_API_BASE_URL')
        QA_ADMIN_EMAIL         = credentials('QA_ADMIN_EMAIL')
        QA_ADMIN_PASSWORD      = credentials('QA_ADMIN_PASSWORD')
        QA_RESTRICTED_EMAIL    = credentials('QA_RESTRICTED_EMAIL')
        QA_RESTRICTED_PASSWORD = credentials('QA_RESTRICTED_PASSWORD')
      }
      steps {
        sh 'ENV=qa npx playwright test --project=chromium --grep @regression --workers=2 --timeout=90000 --reporter=line,allure-playwright'
      }
      post {
        always {
          sh 'mv allure-results allure-results-qa || true'
          allure(results: [[path: 'allure-results-qa']])
        }
      }
    }
    stage('Test — stage (full suite)') {
      when { branch 'stage' }
      environment {
        STAGING_APP_URL             = credentials('STAGING_APP_URL')
        STAGING_API_BASE_URL        = credentials('STAGING_API_BASE_URL')
        STAGING_ADMIN_EMAIL         = credentials('STAGING_ADMIN_EMAIL')
        STAGING_ADMIN_PASSWORD      = credentials('STAGING_ADMIN_PASSWORD')
        STAGING_RESTRICTED_EMAIL    = credentials('STAGING_RESTRICTED_EMAIL')
        STAGING_RESTRICTED_PASSWORD = credentials('STAGING_RESTRICTED_PASSWORD')
      }
      steps {
        sh 'ENV=staging npx playwright test --project=chromium --workers=2 --timeout=90000 --reporter=line,allure-playwright'
      }
      post {
        always {
          sh 'mv allure-results allure-results-stage || true'
          allure(results: [[path: 'allure-results-stage']])
        }
      }
    }
    stage('Test — main (regression)') {
      when { branch 'main' }
      environment {
        PROD_APP_URL             = credentials('PROD_APP_URL')
        PROD_API_BASE_URL        = credentials('PROD_API_BASE_URL')
        PROD_ADMIN_EMAIL         = credentials('PROD_ADMIN_EMAIL')
        PROD_ADMIN_PASSWORD      = credentials('PROD_ADMIN_PASSWORD')
        PROD_RESTRICTED_EMAIL    = credentials('PROD_RESTRICTED_EMAIL')
        PROD_RESTRICTED_PASSWORD = credentials('PROD_RESTRICTED_PASSWORD')
      }
      steps {
        sh 'ENV=prod npx playwright test --project=chromium --grep @regression --workers=2 --timeout=90000 --reporter=line,allure-playwright'
      }
      post {
        always {
          sh 'mv allure-results allure-results-main || true'
          allure(results: [[path: 'allure-results-main']])
        }
      }
    }
    stage('Approval — Run PROD?') {
      when { branch 'prod' }
      steps {
        timeout(time: 24, unit: 'HOURS') {
          input message: '🚨 Run tests against PRODUCTION?',
                ok: 'Yes, approve',
                submitter: 'akashrn1801'
        }
      }
    }
    stage('Test — prod (prodSafe)') {
      when { branch 'prod' }
      environment {
        PROD_APP_URL             = credentials('PROD_APP_URL')
        PROD_API_BASE_URL        = credentials('PROD_API_BASE_URL')
        PROD_ADMIN_EMAIL         = credentials('PROD_ADMIN_EMAIL')
        PROD_ADMIN_PASSWORD      = credentials('PROD_ADMIN_PASSWORD')
        PROD_RESTRICTED_EMAIL    = credentials('PROD_RESTRICTED_EMAIL')
        PROD_RESTRICTED_PASSWORD = credentials('PROD_RESTRICTED_PASSWORD')
      }
      steps {
        sh 'ENV=prod npx playwright test --project=chromium --grep @prodSafe --workers=1 --timeout=90000 --reporter=line,allure-playwright'
      }
      post {
        always {
          sh 'mv allure-results allure-results-prod || true'
          allure(results: [[path: 'allure-results-prod']])
        }
      }
    }
  }
  post {
    success  { echo '✅ Pipeline passed' }
    failure  { echo '❌ Pipeline failed' }
    always   { cleanWs() }
  }
}
