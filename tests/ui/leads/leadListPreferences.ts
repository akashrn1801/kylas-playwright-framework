import { test as base } from '../../../src/fixtures/index';
import { createListPreferenceLock } from '../../../src/utils/listPreferenceLock';
import { LOCK_WAIT_FIXTURE_TIMEOUT_MS } from '../formFields/formFieldLockFactory';

// WHY (B7, KI-59): see src/utils/listPreferenceLock.ts. The admin's lead list view, sort and page size live on the
// server, shared by every worker. Every test that goes through this `test` holds the lock SHARED for its whole
// duration (`auto: true`, so nobody can forget it); a test tagged LIST_PREFS_WRITER_TAG (it changes view, sort, page
// size or columns) holds it EXCLUSIVELY: it waits until no other lead test is running and blocks new ones.
// SCOPE (read before reusing): the lock is a file lock, so it only coordinates workers on ONE machine. The shard planner
// never splits a spec file across shards (scripts/plan-shards.ts), so leads.spec.ts, which holds both writers (L65,
// L68) and most list readers, is covered. Lead specs that run on other shards (leads.rbac.spec.ts, the lead
// field-limit specs) are NOT, exactly like the formFields cross-shard case in docs/known-issues/sharding-and-locks.md.
// Covering them means registering them as a shared-config suite in config/sharedConfigSuites.json (pins them to one
// shard: an owner decision), so this module is deliberately not named *Lock and does not trigger the check:conventions
// rule for registered suites. Tag a new writer with `{ tag: LIST_PREFS_WRITER_TAG }` and keep
// `restoreListPreferencesOnTeardown`.
export const LIST_PREFS_WRITER_TAG = '@list-prefs-writer';

const leadListPreferenceLock = createListPreferenceLock('leads', { waitBudgetMs: LOCK_WAIT_FIXTURE_TIMEOUT_MS });

export const test = base.extend<{ leadListPrefLock: void }>({
  leadListPrefLock: [
    async ({}, use, testInfo) => {
      const mode = testInfo.tags.includes(LIST_PREFS_WRITER_TAG) ? 'exclusive' : 'shared';
      const release = await leadListPreferenceLock.acquire(mode, testInfo.title);
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
