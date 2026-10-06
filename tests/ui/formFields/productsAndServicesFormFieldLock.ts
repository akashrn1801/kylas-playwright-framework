import { createFormFieldLock } from './formFieldLockFactory';

// WHY this thin, entity-specific file exists: mirrors taskFormFieldLock.ts's/
// companyFormFieldLock.ts's/contactFormFieldLock.ts's own identical shape
// and reasoning — a fixed `test`/`withLock` export pair a spec file imports
// once, keyed to its own independent lock scope ("products-services"),
// never sharing another entity's own lock directory.
const { test, withLock } = createFormFieldLock('products-services');

export { test };
export const withProductsAndServicesFormFieldLock = withLock;
export { expect } from '../../../src/fixtures/index';
