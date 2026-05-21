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

const users: Record<Environment, { admin: { email: string; password: string }; restricted: { email: string; password: string } }> = {
  qa: {
    admin: {
      email: process.env.QA_ADMIN_EMAIL || '',
      password: process.env.QA_ADMIN_PASSWORD || '',
    },
    restricted: {
      email: process.env.QA_RESTRICTED_EMAIL || '',
      password: process.env.QA_RESTRICTED_PASSWORD || '',
    },
  },
  staging: {
    admin: {
      email: process.env.STAGING_ADMIN_EMAIL || '',
      password: process.env.STAGING_ADMIN_PASSWORD || '',
    },
    restricted: {
      email: process.env.STAGING_RESTRICTED_EMAIL || '',
      password: process.env.STAGING_RESTRICTED_PASSWORD || '',
    },
  },
  prod: {
    admin: {
      email: process.env.PROD_ADMIN_EMAIL || '',
      password: process.env.PROD_ADMIN_PASSWORD || '',
    },
    restricted: {
      email: process.env.PROD_RESTRICTED_EMAIL || '',
      password: process.env.PROD_RESTRICTED_PASSWORD || '',
    },
  },
};

export const config = {
  env: ENV,
  appUrl: urls[ENV].appUrl,
  apiBaseUrl: urls[ENV].apiBaseUrl,

  users: {
    admin: {
      ...users[ENV].admin,
      role: 'admin',
    },
    restricted: {
      ...users[ENV].restricted,
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
    headless: process.env.HEADLESS !== 'false',
  },

  execution: {
    workers: Number(process.env.WORKERS) || 1,
    retryCount: Number(process.env.RETRY_COUNT) || 1,
  },
};

export type UserRole = keyof typeof config.users;
export type Config = typeof config;