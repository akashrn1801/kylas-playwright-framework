import { test as base } from '../../../src/fixtures/index';
import { createListPreferenceLock } from '../../../src/utils/listPreferenceLock';
import { LOCK_WAIT_FIXTURE_TIMEOUT_MS } from '../formFields/formFieldLockFactory';

// WHY (DB14, sandbox run 45553181980): the admin's Primary dashboard is ONE setting per user, stored on the server, and every
// worker logs in as the same admin. DB14 marks its own dashboard Primary and then reloads, expecting to land on it; the reload
// landed on "Default Dashboard" instead (passed on the rerun). Only DB14 marks the admin's Primary (DB26 does the same for the
// restricted user, a different account), and `mark_as_preferred` is already awaited (2xx) before the reload, so the remaining
// candidates are another admin dashboard test changing or resetting the setting meanwhile, or the server reading it back late.
// ROOT CAUSE NOT CONFIRMED: this lock removes the first candidate (hardening); DB14's failure message now carries the
// evidence that separates the two. Same shared/exclusive primitive as the lead list lock (src/utils/listPreferenceLock.ts):
// every test of this file holds it SHARED (`auto: true`); a test tagged PRIMARY_WRITER_TAG holds it EXCLUSIVELY, so nothing
// else of the admin runs while the Primary setting is changed. SCOPE: a file lock coordinates workers on ONE machine; the shard
// planner never splits a spec file, so dashboard.spec.ts is covered. dashboard.rbac.spec.ts (restricted user, other shard) is not.
export const PRIMARY_WRITER_TAG = '@primary-writer';

const primaryDashboardLock = createListPreferenceLock('dashboard-primary', { waitBudgetMs: LOCK_WAIT_FIXTURE_TIMEOUT_MS });

export const test = base.extend<{ primaryDashboardLock: void }>({
  primaryDashboardLock: [
    async ({}, use, testInfo) => {
      const mode = testInfo.tags.includes(PRIMARY_WRITER_TAG) ? 'exclusive' : 'shared';
      const release = await primaryDashboardLock.acquire(mode, testInfo.title);
      try {
        await use();
      } finally {
        release();
      }
    },
    { auto: true, scope: 'test', timeout: LOCK_WAIT_FIXTURE_TIMEOUT_MS },
  ],
});

export { expect } from '../../../src/fixtures/index';
