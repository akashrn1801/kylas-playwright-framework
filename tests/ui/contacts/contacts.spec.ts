import { test } from '../../../src/fixtures/index';
import { ContactsPage } from '../../../src/modules/contacts/ContactsPage';
import { generateContactData } from '../../../src/data/factories/contactFactory';

test.describe('Contacts', () => {
  test(
    '@smoke @regression admin should navigate to contacts list page',
    async ({ adminPage }) => {
      const contactsPage = new ContactsPage(adminPage);

      await contactsPage.goToContactsList();
      await contactsPage.assertOnContactsListPage();
    }
  );

  test(
    '@regression admin should create a new contact with all fields',
    async ({ adminPage }) => {
      test.setTimeout(480000);

      const contactsPage = new ContactsPage(adminPage);
      const contactData = generateContactData();

      await contactsPage.goToContactsList();

      const contactId = await contactsPage.createContact(contactData);

      await contactsPage.assertContactCreated(contactData, contactId ?? undefined);
    }
  );

  test(
    '@regression admin should update a created contact',
    async ({ adminPage }) => {
      test.setTimeout(480000);

      const contactsPage = new ContactsPage(adminPage);
      const contactData = generateContactData();

      await contactsPage.goToContactsList();
      await contactsPage.createContact(contactData);

      const updatedData = generateContactData();

      await contactsPage.updateContact(updatedData, contactData.firstName);
      await contactsPage.assertContactUpdated(updatedData);
    }
  );
});