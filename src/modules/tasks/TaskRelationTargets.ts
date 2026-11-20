import { Page } from '@playwright/test';
import { LeadApi } from '../../utils/leadApi';
import { logger } from '../../utils/logger';
import { ContactsPage } from '../contacts/ContactsPage';
import { CompaniesPage } from '../companies/CompaniesPage';
import { DealsPage } from '../deals/DealsPage';
import { generateMinimalContactData } from '../../data/factories/contactFactory';
import { generateMinimalCompanyData } from '../../data/factories/companyFactory';
import { generateMinimalDealData } from '../../data/factories/dealFactory';

// Records a task's Relation field points at, owned by THIS run (sandbox 44533064234: tasks.rbac:74 picked a contact
// that contacts.rbac:572 on another shard deleted 4 s later -> POST /v1/tasks/ 400 007005 "Contact not found";
// tasks.spec:153 the same with a lead, 400 007003). Standing rule 5: never a random pre-existing record.
//
// WHY one set per account and worker, created on first use: a test that picks from the lookup can only be safe from
// another test's delete if the record was created for the relation and nothing deletes it. Nothing in the suite
// knows these records, so nothing deletes them. They are created by (and so visible to) the account that creates the
// task, which keeps the restricted user's lookup scope right. A worker is a process, so the module-level cache is
// per worker; a failed creation is not cached.
export interface TaskRelationTargets {
  lead: string;
  deal: string;
  contact: string;
  company: string;
}

const targetsByUser = new Map<number, Promise<TaskRelationTargets>>();

export async function getTaskRelationTargets(page: Page): Promise<TaskRelationTargets> {
  const api = await LeadApi.forPage(page);
  try {
    const userId = await api.getMyUserId();
    let pending = targetsByUser.get(userId);
    if (!pending) {
      pending = createTargets(page, api, userId);
      targetsByUser.set(userId, pending);
      pending.catch(() => targetsByUser.delete(userId));
    }
    return await pending;
  } finally {
    await api.dispose();
  }
}

async function createTargets(page: Page, api: LeadApi, userId: number): Promise<TaskRelationTargets> {
  const stamp = `REL${Date.now()}`;
  logger.info(`Creating the task relation targets for user ${userId} (${stamp}) — created once, kept, never deleted`);
  await api.createLead({ firstName: stamp, lastName: 'Lead' });
  // the UI create flows already know every environment-specific value (pipeline, currency, picklists), on their own
  // page so the test's page is never touched
  const helper = await page.context().newPage();
  try {
    const contactData = generateMinimalContactData({ firstName: stamp, lastName: 'Contact' });
    const contacts = new ContactsPage(helper);
    await contacts.goToContactsList();
    await contacts.createContact(contactData);

    const companyData = generateMinimalCompanyData({ name: `${stamp} Company` });
    const companies = new CompaniesPage(helper);
    await companies.goToCompaniesList();
    await companies.createCompany(companyData);

    const dealData = generateMinimalDealData({ name: `${stamp} Deal` });
    const deals = new DealsPage(helper);
    await deals.goToDealsList();
    await deals.createDeal(dealData);

    return {
      lead: `${stamp} Lead`,
      contact: `${contactData.firstName} ${contactData.lastName}`,
      company: companyData.name,
      deal: dealData.name,
    };
  } finally {
    await helper.close();
  }
}
