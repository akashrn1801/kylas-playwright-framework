import { createFormFieldLock } from './formFieldLockFactory';

// WHY this thin, entity-specific file exists: mirrors contactFormFieldLock.ts's
// own identical shape and reasoning — a fixed `test`/`withLock` export pair
// a spec file imports once, keyed to its own independent lock scope
// ("companies"), never sharing Lead's or Contact's own lock directories.
const { test, withLock } = createFormFieldLock('companies');

export { test };
export const withCompanyFormFieldLock = withLock;
export { expect } from '../../../src/fixtures/index';
