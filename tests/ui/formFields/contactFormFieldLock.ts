import { createFormFieldLock } from './formFieldLockFactory';

// WHY this thin, entity-specific file exists at all rather than every
// Contact test calling createFormFieldLock('contacts') itself: mirrors
// formFieldsTestLock.ts's own shape (a fixed `test`/`withLock` export pair
// a spec file imports once) so contactFieldLimits.spec.ts and this
// feature's Contact RBAC block both import from one obvious, named module
// — exactly like Lead's own `import { test, expect, withLeadFormFieldLock }
// from './formFieldsTestLock'` — rather than each independently
// instantiating the factory with a hand-typed entity-key string that could
// drift between call sites (e.g. one file typing "contact" instead of
// "contacts").
const { test, withLock } = createFormFieldLock('contacts');

export { test };
export const withContactFormFieldLock = withLock;
export { expect } from '../../../src/fixtures/index';
