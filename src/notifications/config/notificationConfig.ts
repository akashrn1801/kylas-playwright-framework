import { logger } from '../../utils/logger';

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
}

// WHY env-driven: no real address lives in source (public repo). NOTIFY_TO / NOTIFY_CC are
// comma- or semicolon-separated lists, NOTIFY_FROM_NAME is the sender display name. A blank
// value (an unset CI secret expands to '') counts as unset.
export const DEFAULT_FROM_NAME = 'Kylas QA Automation';

export const notificationConfig: NotificationConfig = {
  enabled: process.env.NOTIFY_ENABLED !== 'false',
  smtp: {
    host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.ZOHO_SMTP_PORT || '465'),
    secure: true,
    user: process.env.ZOHO_SMTP_USER || '',
    password: process.env.ZOHO_APP_PASSWORD || '',
    from: `"${process.env.NOTIFY_FROM_NAME?.trim() || DEFAULT_FROM_NAME}" <${process.env.ZOHO_SMTP_USER || ''}>`,
  },
};

export function parseAddressList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export function getSenderDisplayName(fallback = DEFAULT_FROM_NAME): string {
  return process.env.NOTIFY_FROM_NAME?.trim() || fallback;
}

let warnedMissingRecipients = false;

// WHY the fallback: an unset NOTIFY_TO must never mean "send to nobody" silently. It warns
// loudly (once per process) and sends only to the sending account (GMAIL_USER), so the run
// result still reaches someone who owns the pipeline. If even the sender is unknown the list is
// empty and the caller's send fails loudly (already logged as an error), never a silent skip.
export function getRecipients(_env: string, _branch: string): RecipientConfig {
  const to = parseAddressList(process.env.NOTIFY_TO);
  const cc = parseAddressList(process.env.NOTIFY_CC);
  if (to.length > 0) return { to, cc: cc.length > 0 ? cc : undefined };

  const sender = process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER || notificationConfig.smtp.user;
  if (!warnedMissingRecipients) {
    warnedMissingRecipients = true;
    logger.warn(
      '[Notification] NOTIFY_TO is not set — falling back to the sender account (GMAIL_USER) only. ' +
        'Set the NOTIFY_TO secret (comma-separated) to reach the team.'
    );
  }
  return { to: sender ? [sender] : [], cc: cc.length > 0 ? cc : undefined };
}
