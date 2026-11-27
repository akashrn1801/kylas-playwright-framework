/**
 * Read-only quotation lookups over the API (ADR 0017, B4). Used to CHECK whether a quotation create that
 * answered HTTP 500 was written anyway, before the UI retries it (a blind retry could double-create).
 * Same token and context handling as the other API helpers (see apiClient.ts). Search results come from
 * the search index, which trails the write by a short while: callers poll, and a miss is "not found yet".
 */
import { Page } from '@playwright/test';
import { ApiClient, readAccessToken } from './apiClient';

export class QuotationApi extends ApiClient {
  static async forPage(page: Page): Promise<QuotationApi> {
    return new QuotationApi(await ApiClient.createContext(await readAccessToken(page)));
  }

  /** Ids of the quotations that carry exactly this quotation number. */
  async findIdsByNumber(quotationNumber: string): Promise<number[]> {
    const result = await this.sendOrThrow<{ content: Array<{ id: number }> }>(
      'searchQuotations',
      'POST',
      '/quotations/search?page=0&size=5&sort=createdAt,desc',
      {
        fields: ['id', 'quotationNumber'],
        jsonRule: ApiClient.rule('quotationNumber', 'equal', quotationNumber),
      }
    );
    return (result.content ?? []).map((q) => q.id);
  }
}
