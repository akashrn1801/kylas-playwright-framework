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
  // a second contact no deal links by default, for DealsPage.addContactToDeal (never the one a default deal already holds)
  secondContact: string;
  company: string;
}

const targetsByUser = new Map<number, Promise<TaskRelationTargets>>();
// users whose set this process is building right now: a call for one of them is a call from inside the creation
// (the creation's own pages use DealsPage/MeetingsPage), which would wait on itself forever
const building = new Set<number>();

export async function getTaskRelationTargets(page: Page): Promise<TaskRelationTargets> {
  const api = await LeadApi.forPage(page);
  try {
    const userId = await api.getMyUserId();
    if (building.has(userId)) {
      throw new Error(
        `getTaskRelationTargets(${userId}) was called while that user's relation targets are being created: the creation must not use a flow that needs them (it would wait on itself)`
      );
    }
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
  building.add(userId);
  try {
    return await buildTargets(page, api, userId);
  } finally {
    building.delete(userId);
  }
}

async function buildTargets(page: Page, api: LeadApi, userId: number): Promise<TaskRelationTargets> {
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
    const secondData = generateMinimalContactData({ firstName: `${stamp}B`, lastName: 'Contact' });
    await contacts.goToContactsList();
    await contacts.createContact(secondData);

    const companyData = generateMinimalCompanyData({ name: `${stamp} Company` });
    const companies = new CompaniesPage(helper);
    await companies.goToCompaniesList();
    await companies.createCompany(companyData);

    const dealData = generateMinimalDealData({ name: `${stamp} Deal`, skipAssociatedEntities: true });
    const deals = new DealsPage(helper);
    await deals.goToDealsList();
    await deals.createDeal(dealData);

    return {
      lead: `${stamp} Lead`,
      contact: `${contactData.firstName} ${contactData.lastName}`,
      secondContact: `${secondData.firstName} ${secondData.lastName}`,
      company: companyData.name,
      deal: dealData.name,
    };
  } finally {
    await helper.close();
  }
}
