/**
 * Read-only meeting lookup over the API. Used to read back what the server saved for a meeting (from, to and the
 * zone they are saved in) after a reschedule: the edit form shows the times in the browser's zone, so it cannot
 * say what was saved. Same token and context handling as the other API helpers (see apiClient.ts).
 */
import { Page } from '@playwright/test';
import { ApiClient, readAccessToken } from './apiClient';

export interface MeetingRecord {
  from?: string;
  to?: string;
  timezone?: { name?: string };
}

export class MeetingApi extends ApiClient {
  static async forPage(page: Page): Promise<MeetingApi> {
    return new MeetingApi(await ApiClient.createContext(await readAccessToken(page)));
  }

  async getMeeting(meetingId: number): Promise<MeetingRecord> {
    return this.sendOrThrow<MeetingRecord>(`getMeeting ${meetingId}`, 'GET', `/meetings/${meetingId}`);
  }
}
