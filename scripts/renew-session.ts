/**
 * CI `renew-session` job (ADR 0017, amended 2026-11-20): reads each role's session end and, when less than the full
 * run window is left, logs out once and logs in fresh (API only, no browser); otherwise leaves it. Logs "session renewed at <time>, ends
 * <time>" or "session OK, ends <time>" and writes reports/<env>/session-info.json for the run email.
 * Run: ENV=staging CI=true npx ts-node scripts/renew-session.ts
 */
import { logger } from '../src/utils/logger';
import { renewSessionsForRun } from '../src/auth/sessionRenewal';

renewSessionsForRun().then(
  () => process.exit(0),
  (error) => {
    logger.error(String(error));
    process.exit(1);
  }
);
