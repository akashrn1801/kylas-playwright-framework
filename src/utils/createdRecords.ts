import { test } from '@playwright/test';
import { config } from '../../config/config';
import { logger } from './logger';

// WHY (2026-10-30 decision): tests keep everything they create — nothing is deleted after a test, so
// QA is cleaned in one go later. Every record a Leads test creates is therefore logged with its type,
// ID and URL and added to the test's annotations (visible in the Playwright/Allure report), so it can
// be opened in Kylas afterwards. Deleting is opt-in: CLEANUP_TEST_DATA=1 (see config.cleanupTestData).

export type CreatedRecordType =
  | 'lead'
  | 'contact'
  | 'company'
  | 'deal'
  | 'task'
  | 'meeting'
  | 'call log'
  | 'note'
  | 'share rule';

// Where a person can open the record. Tasks, meetings, call logs and notes have no detail page that
// has been verified, so their URL is the API address of the record (needs a signed-in token).
export function createdRecordUrl(type: CreatedRecordType, id: number | string): string {
  const app = config.appUrl;
  switch (type) {
    case 'lead':
      return `${app}/sales/leads/details/${id}`;
    case 'contact':
      return `${app}/sales/contacts/details/${id}`;
    case 'company':
      return `${app}/sales/companies/details/${id}`;
    case 'deal':
      return `${app}/sales/deals/details/${id}`;
    case 'share rule':
      return `${app}/setup/data-management/sharing/entities/edit/${id}`;
    case 'task':
      return `${config.apiBaseUrl}/v1/tasks/${id}`;
    case 'meeting':
      return `${config.apiBaseUrl}/v1/meetings/${id}`;
    case 'call log':
      return `${config.apiBaseUrl}/v1/call-logs/${id}`;
    case 'note':
      return `${config.apiBaseUrl}/v1/notes/${id}`;
  }
}

// `url` overrides the address for records that have none of their own (a note: the lead it sits on)
export function reportCreatedRecord(
  type: CreatedRecordType,
  id: number | string | null | undefined,
  url?: string
): void {
  if (id === null || id === undefined || id === '') return;
  url = url ?? createdRecordUrl(type, id);
  logger.info(`CREATED ${type} ${id} — ${url}`);
  try {
    test.info().annotations.push({ type: `created ${type}`, description: `${id} — ${url}` });
  } catch (error) {
    // test.info() throws outside a running test (setup scripts): the log line above is the record
    logger.debug(`createdRecords: no running test to annotate (${String(error).split('\n')[0]})`);
  }
}
