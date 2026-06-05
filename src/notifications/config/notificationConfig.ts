export interface RecipientConfig {
  to: string[];
  cc?: string[];
}

export interface NotificationConfig {
  enabled: boolean;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    from: string;
  };
  recipients: {
    byEnv: Record<string, RecipientConfig>;
    byBranch: Record<string, RecipientConfig>;
  };
}

const QA_TEAM = ['akash.nakhate@kylas.io', 'akshay.gunshetti@kylas.io'];

export const notificationConfig: NotificationConfig = {
  enabled: process.env.NOTIFY_ENABLED !== 'false',
  smtp: {
    host:     process.env.ZOHO_SMTP_HOST || 'smtp.zoho.in',
    port:     parseInt(process.env.ZOHO_SMTP_PORT || '465'),
    secure:   true,
    user:     process.env.ZOHO_SMTP_USER || 'qa.kylas@zohomail.in',
    password: process.env.ZOHO_APP_PASSWORD || '',
    from:     '"Kylas QA Automation" <qa.kylas@zohomail.in>',
  },
  recipients: {
    byEnv:    { qa: { to: QA_TEAM }, staging: { to: QA_TEAM }, prod: { to: QA_TEAM } },
    byBranch: { dev: { to: QA_TEAM }, qa: { to: QA_TEAM }, stage: { to: QA_TEAM }, prod: { to: QA_TEAM }, main: { to: QA_TEAM } },
  },
};

export function getRecipients(env: string, branch: string): RecipientConfig {
  return notificationConfig.recipients.byBranch[branch]
    || notificationConfig.recipients.byEnv[env]
    || { to: QA_TEAM };
}
