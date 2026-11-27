import * as path from 'path';
import { config } from '../../config/config';
import { BillingApi } from '../modules/billing/BillingApi';
import { POST_RUN_SNAPSHOT_FILE, capacityDir, evaluateCapacity, selectionIsReadOnly, writeSnapshot } from '../modules/billing/capacity';
import { readLiveCounts } from '../modules/billing/liveCounts';
import { redactTokens } from '../utils/apiClient';
import { readAccessTokenFromStateFile } from './sessionCheck';

// The account's capacity after this shard's last test (2026-11-26, ADR 0019): ONE read-only GET /v1/tenants/usage with the admin
// session globalSetup saved, written next to the pre-run snapshot. The email takes the latest reading of all shards as "after this
// run" and subtracts the earliest pre-run snapshot, so no job that builds the email needs admin credentials.
// WHY it never throws and never retries: a teardown failure must not change a run's result, and a missing reading is shown by the
// email as "unavailable", never guessed. The token is read from the state file and never logged (rule 22).
export default async function globalTeardown(): Promise<void> {
  try {
    const token = readAccessTokenFromStateFile(path.join(__dirname, 'storageStates', config.env, 'admin.json'));
    if (!token) {
      console.warn('[globalTeardown] Capacity: no admin session in the saved state, post-run reading skipped');
      return;
    }
    const api = await BillingApi.forToken(token);
    try {
      const usage = await api.getUsage();
      const verdict = evaluateCapacity(
        usage,
        config.env,
        {
          recordsWarnBelow: config.billing.recordsWarnBelow[config.env],
          customFieldsWarnBelow: config.billing.customFieldsWarnBelow,
          expectedPlan: config.billing.expectedPlan[config.env],
        },
        new Date()
      );
      // the live totals after the run (skipped on a read-only run, like the gate's)
      if (!selectionIsReadOnly(process.argv.slice(2)).readOnly) verdict.snapshot.live = await readLiveCounts(api, new Date());
      const file = writeSnapshot(capacityDir(config.env), verdict.snapshot, POST_RUN_SNAPSHOT_FILE);
      console.log(`[globalTeardown] Capacity after the run: records ${usage.records.used} used (${verdict.snapshot.records.remaining ?? 'unlimited'} left), saved ${file}`);
    } finally {
      await api.dispose();
    }
  } catch (error) {
    console.warn(`[globalTeardown] Capacity: post-run reading skipped. ${redactTokens(String(error))}`);
  }
}
