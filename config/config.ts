import * as dotenv from 'dotenv';
dotenv.config();

type Environment = 'qa' | 'staging' | 'prod';

const ENV = (process.env.ENV || 'qa') as Environment;

const urls: Record<Environment, { appUrl: string; apiBaseUrl: string }> = {
  qa: {
    appUrl: process.env.QA_APP_URL || '',
    apiBaseUrl: process.env.QA_API_BASE_URL || '',
  },
  staging: {
    appUrl: process.env.STAGING_APP_URL || '',
    apiBaseUrl: process.env.STAGING_API_BASE_URL || '',
  },
  prod: {
    appUrl: process.env.PROD_APP_URL || '',
    apiBaseUrl: process.env.PROD_API_BASE_URL || '',
  },
};

export const config = {
  env: ENV,
  appUrl: urls[ENV].appUrl,
  apiBaseUrl: urls[ENV].apiBaseUrl,

  users: {
    admin: {
      email: process.env.ADMIN_EMAIL || '',
      password: process.env.ADMIN_PASSWORD || '',
      role: 'admin',
    },
    restricted: {
      email: process.env.RESTRICTED_EMAIL || '',
      password: process.env.RESTRICTED_PASSWORD || '',
      role: 'restricted',
    },
  },

  timeouts: {
    default: Number(process.env.DEFAULT_TIMEOUT) || 30000,
    navigation: Number(process.env.NAVIGATION_TIMEOUT) || 60000,
    expect: Number(process.env.EXPECT_TIMEOUT) || 10000,
  },

  browser: {
    name: process.env.BROWSER || 'chromium',
    headless: process.env.HEADLESS === 'true' || false,
  },

  execution: {
    workers: Number(process.env.WORKERS) || 1,
    retryCount: Number(process.env.RETRY_COUNT) || 1,
  },
};

export type UserRole = keyof typeof config.users;
export type Config = typeof config;