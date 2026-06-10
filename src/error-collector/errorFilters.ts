export const NOISE_PATTERNS: RegExp[] = [
  /Grammarly/i,
  /grammarly/i,
  /HW_frame/i,
  /headway-widget/i,
  /headway\.io/i,
  /content-script/i,
  /record-api/i,
  /chrome-extension:\/\//i,
  /moz-extension:\/\//i,
  /CKEditor/i,
  /widget-toolbar-no-items/i,
  /Warning: Each child in a list/i,
  /Warning: React does not recognize/i,
  /notifications\/unread/i,
  /favicon\.ico/i,
  /WebSocket connection to/i,
  /disconnected port/i,
  /Attempting to use a disconnected/i,
  // Firebase push notification (expected — test browser has no notification permission)
  /permission-blocked/i,
  /messaging\/permission-blocked/i,
  /registration token/i,
  // Sentry rate limiting (non-actionable in test env)
  /sentry\.io/i,
  // Third-party embeds timing out
  /viasocket\.com/i,
  /embedfrontend/i,
];

export const NOISE_URL_PATTERNS: RegExp[] = [
  /headway-widget\.net/i,
  /grammarly\.com/i,
  /chrome-extension/i,
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /sentry\.io/i,
  /viasocket\.com/i,
  /headwayapp\.co/i,
  /zohocdn\.com/i,
  /zoho\.com/i,
];

export function isNoise(message: string, url?: string): boolean {
  const fullText = `${message} ${url || ''}`;
  if (NOISE_PATTERNS.some(p => p.test(fullText))) return true;
  if (url && NOISE_URL_PATTERNS.some(p => p.test(url))) return true;
  return false;
}
