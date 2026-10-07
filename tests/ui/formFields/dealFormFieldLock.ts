import { createFormFieldLock } from './formFieldLockFactory';

// WHY this thin, entity-specific file exists: mirrors taskFormFieldLock.ts's/
// companyFormFieldLock.ts's/productsAndServicesFormFieldLock.ts's own
// identical shape and reasoning — a fixed `test`/`withLock` export pair a
// spec file imports once, keyed to its own independent lock scope
// ("deals"), never sharing another entity's own lock directory.
const { test, withLock } = createFormFieldLock('deals');

export { test };
export const withDealFormFieldLock = withLock;
export { expect } from '../../../src/fixtures/index';
