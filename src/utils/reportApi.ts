/**
 * Read-only report lookups over the API (ADR 0017). Used to CHECK whether a Save As that answered HTTP 500 /
 * 01403004 was written anyway, before the UI repeats it (a blind repeat could create two reports). Reports are
 * served under `/v3/`, not `/v1/` (the UI's own list search is `POST /v3/reports/search`). Search results come
 * from the search index, which trails the write: callers poll, and a miss is "not found yet".
 */
import { Page } from '@playwright/test';
import { buildApiUrl } from '../../config/config';
import { ApiClient, readAccessToken } from './apiClient';

export class ReportApi extends ApiClient {
  static async forPage(page: Page): Promise<ReportApi> {
    return new ReportApi(await ApiClient.createContext(await readAccessToken(page)));
  }

  protected override resolveUrl(path: string): string {
    return buildApiUrl('/').replace(/\/v1\/$/, '') + path;
  }

  /**
   * Raw JSON text of `POST /v3/reports/search` for a text term (the UI's own request shape: a `multi_field`
   * rule). The backend matches per word (OR), so a caller must look for its exact name in the text, never
   * trust "any result".
   */
  async searchText(term: string): Promise<string> {
    const body = await this.sendOrThrow<Record<string, unknown>>(
      'searchReports',
      'POST',
      '/v3/reports/search?page=0&size=50&sort=updatedAt,desc',
      {
        fields: ['id', 'name'],
        jsonRules: [{ id: 'multi_field', field: 'multi_field', type: 'multi_field', operator: 'multi_field', value: term }],
      }
    );
    return JSON.stringify(body);
  }

  /** Name of one report (`GET /v3/reports/{id}`), or null when the body carries no string `name`. */
  async nameOf(reportId: string): Promise<string | null> {
    const body = await this.sendOrThrow<{ name?: unknown }>('getReport', 'GET', `/v3/reports/${reportId}`);
    return typeof body?.name === 'string' ? body.name : null;
  }
}
