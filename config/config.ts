import * as dotenv from 'dotenv';
dotenv.config();

type Environment = 'qa' | 'staging' | 'prod';
const ENV = (process.env.ENV || 'qa') as Environment;

// WHY: silent empty string → hard to debug failures 30 steps into a test
function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

// WHY: prefix resolves to 'QA' | 'STAGING' | 'PROD' — drives both URL
// and credential lookups so switching ENV= is the only change needed
const ENV_PREFIX = ENV.toUpperCase();

const urls: Record<Environment, { appUrl: string; apiBaseUrl: string }> = {
  qa:      { appUrl: requireEnv('QA_APP_URL'),      apiBaseUrl: process.env.QA_API_BASE_URL || '' },
  staging: { appUrl: requireEnv('STAGING_APP_URL'), apiBaseUrl: process.env.STAGING_API_BASE_URL || '' },
  prod:    { appUrl: requireEnv('PROD_APP_URL'),     apiBaseUrl: process.env.PROD_API_BASE_URL || '' },
};

export const config = {
  env: ENV,
  appUrl: urls[ENV].appUrl,
  apiBaseUrl: urls[ENV].apiBaseUrl,
  users: {
    admin: {
      email:    requireEnv(`${ENV_PREFIX}_ADMIN_EMAIL`),
      password: requireEnv(`${ENV_PREFIX}_ADMIN_PASSWORD`),
      role:     'admin',
    },
    restricted: {
      email:    requireEnv(`${ENV_PREFIX}_RESTRICTED_EMAIL`),
      password: requireEnv(`${ENV_PREFIX}_RESTRICTED_PASSWORD`),
      role:     'restricted',
    },
  },
  timeouts: {
    default:    Number(process.env.DEFAULT_TIMEOUT)    || 30000,
    navigation: Number(process.env.NAVIGATION_TIMEOUT) || 60000,
    expect:     Number(process.env.EXPECT_TIMEOUT)     || 10000,
  },
  browser: {
    name:     process.env.BROWSER || 'chromium',
    headless: process.env.HEADLESS === 'true',
  },
  execution: {
    workers:    Number(process.env.WORKERS)     || 2,
    retryCount: Number(process.env.RETRY_COUNT) || 1,
  },
};

export type UserRole = keyof typeof config.users;
export type Config = typeof config;
