import { createFormFieldLock } from './formFieldLockFactory';

// WHY this thin, entity-specific file exists: mirrors companyFormFieldLock.ts's/
// contactFormFieldLock.ts's own identical shape and reasoning — a fixed
// `test`/`withLock` export pair a spec file imports once, keyed to its own
// independent lock scope ("tasks"), never sharing Lead's/Contact's/Company's
// own lock directories.
const { test, withLock } = createFormFieldLock('tasks');

export { test };
export const withTaskFormFieldLock = withLock;
export { expect } from '../../../src/fixtures/index';
