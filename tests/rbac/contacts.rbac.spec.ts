import { test } from '../../src/fixtures/index';
import { ContactsPage } from '../../src/modules/contacts/ContactsPage';
import {
  generateContactData,
  generateAdminContactData,
} from '../../src/data/factories/contactFactory';
import { logger } from '../../src/utils/logger';

test.describe('Contacts RBAC', () => {
  test('@smoke @regression restricted user can navigate to contacts list', async ({
    restrictedPage,
  }) => {
    const contactsPage = new ContactsPage(restrictedPage);

    await contactsPage.goToContactsList();
    await contactsPage.assertOnContactsListPage();
    logger.success('CR1 passed');
  });

  test('@regression restricted user can create a contact', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateContactData();

    await contactsPage.goToContactsList();

    const contactId = await contactsPage.createContact(contactData);

    await contactsPage.assertContactCreated(contactData, contactId ?? undefined);
    logger.success('CR2 passed');
  });

  test('@regression restricted user can edit own contact', async ({ restrictedPage }) => {
    test.setTimeout(480000);

    const contactsPage = new ContactsPage(restrictedPage);
    const contactData = generateContactData();

    await contactsPage.goToContactsList();
    await contactsPage.createContact(contactData);

    const updatedData = generateContactData();

    await contactsPage.updateContact(updatedData, contactData.firstName);
    await contactsPage.assertContactUpdated(updatedData);
    logger.success('CR3 passed');
  });

  test('@regression restricted user cannot see an admin-owned contact', async ({
    adminPage,
    restrictedPage,
  }) => {
    test.setTimeout(480000);

    // WHY: generateAdminContactData uses timestamp prefix (ADM12345678)
    // guarantees this contact name has never existed before — no collision with old test data
    const adminContactsPage = new ContactsPage(adminPage);
    const contactData = generateAdminContactData();

    await adminContactsPage.goToContactsList();
    await adminContactsPage.createContact(contactData);

    const restrictedContactsPage = new ContactsPage(restrictedPage);

    await restrictedContactsPage.goToContactsList();
    await restrictedContactsPage.assertContactNotInList(contactData.firstName);
    logger.success('CR4 passed');
  });
});
