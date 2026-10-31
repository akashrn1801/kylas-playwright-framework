/**
 * Lead API helper — API-level setup and read-back for Lead tests (deleting happens only in tests of
 * a delete feature and, opt-in with CLEANUP_TEST_DATA=1, in the fixtures).
 *
 * WHY this exists (2026-10-30, Leads coverage work): every Lead test used to
 * create its data through the UI (a full form fill) and none deleted it, so
 * QA accumulated ~14.7k leads and the restricted user saw ~2.8k admin-owned
 * leads through shares that no test ever removed. Setup through the API is
 * faster and deterministic, and the same API gives the persisted layer an
 * assertion can read instead of a list search (which lags the write).
 *
 * WHY the token is read from the live page's localStorage and the requests
 * use their own APIRequestContext: the Bearer value is the JWT payload's
 * `data.accessToken` (the same source BasePage.fetchAuthenticatedApiData()
 * reads — a GET-only helper). Reading it from the page means no extra login
 * (KI-51: logins can invalidate the other session of the same account), and
 * a standalone context means a teardown still works after the page crashed.
 * The token is never logged (standing rule 22).
 *
 * Endpoint shapes below were each proven live on QA (2026-10-30).
 */
import { Page } from '@playwright/test';
import { ApiClient, ApiJsonRule, ApiResult, readAccessToken, redactTokens } from './apiClient';
import { logger } from './logger';
import { reportCreatedRecord } from './createdRecords';
import { uniqueEmail } from '../data/factories/uniqueValues';

export type { ApiJsonRule, ApiResult };
export { readAccessToken };

export interface ApiLead {
  id: number;
  ownerId: number;
  city?: string;
  firstName?: string;
  lastName?: string;
  emails?: Array<{ type: string; value: string; primary: boolean }>;
  pipeline?: { id: number; name: string; stage: { id: number; name: string } };
  convertedAt?: string;
  convertedBy?: number;
  conversionDetails?: Array<{ entityType: 'DEAL' | 'CONTACT' | 'COMPANY'; entityId: number }>;
  recordActions?: Record<string, boolean>;
  [key: string]: unknown;
}

export interface ApiPipelineStage {
  id: number;
  name: string;
}

export interface ApiPipeline {
  id: number;
  name: string;
  stages: ApiPipelineStage[];
  lostReasons: string[];
  unqualifiedReasons: string[];
}

export interface ListPreferences {
  id: number;
  sort: string;
  size: number;
  view: string;
  pipelineId: number;
}

export class LeadApi extends ApiClient {
  static async forToken(token: string): Promise<LeadApi> {
    return new LeadApi(await ApiClient.createContext(token));
  }

  static async forPage(page: Page): Promise<LeadApi> {
    return LeadApi.forToken(await readAccessToken(page));
  }

  // ── Lead CRUD ─────────────────────────────────────────────────────────

  /**
   * Create a lead. Defaults: a unique e-mail so uniqueness (EMAIL_PHONE) never
   * rejects it. A lead created this way has NO pipeline (proven live) — use
   * attachPipeline() when a test needs Close/Convert.
   */
  async createLead(overrides: Record<string, unknown> & { firstName: string }): Promise<ApiLead> {
    const body = {
      lastName: 'Api',
      emails: [{ type: 'OFFICE', value: uniqueEmail('lead'), primary: true }],
      ...overrides,
    };
    await this.assertContactValuesUnused(body);
    const lead = await this.sendOrThrow<ApiLead>('createLead', 'POST', '/leads', body);
    reportCreatedRecord('lead', lead.id);
    return lead;
  }

  /**
   * Ask the app (`GET /leads/has-duplicates`, answered from the database at once — checked live: false
   * before the create, true right after) whether an e-mail or a phone number is already used by a lead.
   * Returns null when the endpoint itself does not answer OK (it fails on some environments, e.g. the
   * product one on PROD): the check is a safety net, so "unknown" is reported to the caller, never thrown.
   */
  async hasDuplicate(field: 'emails' | 'phoneNumbers', value: string): Promise<boolean | null> {
    const result = await this.send<{ duplicate?: boolean }>(
      'GET',
      `/leads/has-duplicates?fieldName=${field}&value=${encodeURIComponent(value)}`
    );
    if (!result.ok || typeof result.body?.duplicate !== 'boolean') {
      logger.warn(
        `Lead duplicate pre-check unavailable (${field}): HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 200)} — create goes ahead without it`
      );
      return null;
    }
    return result.body.duplicate;
  }

  /**
   * Fail LOUDLY, before the create, when a test sends an e-mail or phone that the account already has: the
   * duplicate check would otherwise refuse (or, on a misconfigured account, mis-handle) the create and the
   * failure would look like a product defect. Never a retry: callers build their values in uniqueValues.ts.
   * An endpoint that does not answer (hasDuplicate() === null) never blocks the create.
   */
  async assertContactValuesUnused(body: Record<string, unknown>): Promise<void> {
    const emails = (body.emails as Array<{ value: string }> | undefined) ?? [];
    const phones = (body.phoneNumbers as Array<{ value: string }> | undefined) ?? [];
    for (const { value } of emails) {
      if ((await this.hasDuplicate('emails', value)) === true) {
        throw new Error(`Test data collision: a lead with e-mail ${value} already exists (values come from uniqueValues.ts)`);
      }
    }
    for (const { value } of phones) {
      if ((await this.hasDuplicate('phoneNumbers', value)) === true) {
        throw new Error(`Test data collision: a lead with phone ${value} already exists (values come from uniqueValues.ts)`);
      }
    }
  }

  /** POST exactly this body and return the raw result (for tests that expect a rejection). */
  async createLeadRaw(body: Record<string, unknown>): Promise<
    ApiResult<{ id?: number; code?: string; message?: string; errorDetails?: Array<{ field: string | null; message: string }> }>
  > {
    const result = await this.send<{
      id?: number;
      code?: string;
      message?: string;
      errorDetails?: Array<{ field: string | null; message: string }>;
    }>('POST', '/leads', body);
    if (result.ok) reportCreatedRecord('lead', result.body?.id); // only when the server wrongly accepted it
    return result;
  }

  /** A field's configured maximum length, read from the live edit layout (never hardcoded). */
  async getEditLayoutFieldLength(internalName: string): Promise<number> {
    const layout = await this.sendOrThrow<{
      layoutItems: Array<{ layoutItems: Array<{ item?: { internalName: string; length: number | null } }> }>;
    }>('getEditLayout', 'GET', '/layouts/lead/edit');
    for (const section of layout.layoutItems) {
      for (const entry of section.layoutItems) {
        if (entry.item?.internalName === internalName && entry.item.length) return entry.item.length;
      }
    }
    throw new Error(`getEditLayoutFieldLength: no length configured for "${internalName}"`);
  }

  getLead(id: number): Promise<ApiResult<ApiLead>> {
    return this.send<ApiLead>('GET', `/leads/${id}`);
  }

  async getLeadOrThrow(id: number): Promise<ApiLead> {
    return this.sendOrThrow<ApiLead>(`getLead(${id})`, 'GET', `/leads/${id}`);
  }

  /** PUT needs the whole object (proven live): GET, merge the patch, strip read-only keys. */
  async updateLead(id: number, patch: Record<string, unknown>): Promise<ApiResult<ApiLead>> {
    const current = await this.getLeadOrThrow(id);
    const body: Record<string, unknown> = { ...current, ...patch };
    for (const key of ['recordActions', 'metaData', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']) {
      delete body[key];
    }
    return this.send<ApiLead>('PUT', `/leads/${id}`, body);
  }

  /** PUT exactly this body (no GET first) — for tests that expect the write to be denied. */
  putLeadRaw(id: number, body: Record<string, unknown>): Promise<ApiResult<{ code?: string }>> {
    return this.send('PUT', `/leads/${id}`, body);
  }

  deleteLead(id: number): Promise<ApiResult> {
    return this.send('DELETE', `/leads/${id}`);
  }

  // ── Pipeline ──────────────────────────────────────────────────────────

  /** The first active lead pipeline (QA has exactly one: "Default Lead Pipeline"). */
  async getLeadPipeline(): Promise<ApiPipeline> {
    const search = await this.sendOrThrow<{ content: Array<{ id: number; name: string; entityType: string }> }>(
      'getLeadPipeline',
      'POST',
      '/pipelines/search?page=0&size=20',
      { fields: ['id', 'name', 'entityType'], jsonRule: null }
    );
    const leadPipeline = search.content.find((p) => p.entityType === 'LEAD');
    if (!leadPipeline) throw new Error('getLeadPipeline: no LEAD pipeline exists on this environment');
    return this.sendOrThrow<ApiPipeline>('getLeadPipeline detail', 'GET', `/pipelines/${leadPipeline.id}`);
  }

  /** Attach the lead pipeline at a stage (default: first stage). PUT shape proven live. */
  async attachPipeline(leadId: number, stageName?: string): Promise<ApiLead> {
    const pipeline = await this.getLeadPipeline();
    const stage = stageName ? pipeline.stages.find((s) => s.name === stageName) : pipeline.stages[0];
    if (!stage) throw new Error(`attachPipeline: stage "${stageName}" not found in ${pipeline.name}`);
    const result = await this.updateLead(leadId, { pipeline: { id: pipeline.id, stage: { id: stage.id } } });
    if (!result.ok) {
      throw new Error(`attachPipeline failed: HTTP ${result.status} ${JSON.stringify(result.body).slice(0, 400)}`);
    }
    return result.body;
  }

  /**
   * The account's lead duplicate-check setting (`GET /configurations/uniqueness/lead` →
   * `{ field: 'EMAIL_PHONE' }`; the other values seen or expected are NONE, EMAIL and PHONE). Read-only.
   */
  async getUniquenessField(): Promise<string> {
    const result = await this.sendOrThrow<{ field: string }>(
      'getUniquenessField',
      'GET',
      '/configurations/uniqueness/lead'
    );
    return result.field;
  }

  /** `GET /leads/{id}/pipeline` — 400 `002056` while no pipeline is attached. */
  getLeadPipelineOf(leadId: number): Promise<ApiResult> {
    return this.send('GET', `/leads/${leadId}/pipeline`);
  }

  /** Close a lead through the stage-activate endpoint the Close Lead dialog uses. */
  async closeLead(leadId: number, stageName: 'Won' | 'Closed Lost' | 'Closed Unqualified'): Promise<void> {
    const pipeline = await this.getLeadPipeline();
    const stage = pipeline.stages.find((s) => s.name === stageName);
    if (!stage) throw new Error(`closeLead: stage "${stageName}" not found`);
    const reason =
      stageName === 'Closed Lost'
        ? pipeline.lostReasons[0]
        : stageName === 'Closed Unqualified'
          ? pipeline.unqualifiedReasons[0]
          : undefined;
    await this.sendOrThrow('closeLead', 'POST', `/leads/${leadId}/pipeline-stages/${stage.id}/activate`, {
      reasonForClosing: reason ?? null,
      actualValue: null,
      estimatedValue: null,
      actualClosureDate: null,
    });
  }

  // ── Sharing, search, lists, identity ──────────────────────────────────

  async searchLeads(
    jsonRule: ApiJsonRule | null,
    options: { fields?: string[]; page?: number; size?: number; sort?: string } = {}
  ): Promise<{ totalElements: number; content: ApiLead[] }> {
    const { fields = ['id', 'firstName', 'lastName', 'ownerId', 'pipelineStage'], page = 0, size = 100, sort = 'updatedAt,desc' } = options;
    return this.sendOrThrow('searchLeads', 'POST', `/search/lead?sort=${sort}&page=${page}&size=${size}`, {
      fields,
      jsonRule,
    });
  }

  async getSmartLists(): Promise<Array<{ id: number; name: string; searchRequest: { jsonRule: ApiJsonRule } }>> {
    const result = await this.sendOrThrow<{ content?: unknown[] } | unknown[]>(
      'getSmartLists',
      'POST',
      '/search-lists/fetch/lead',
      {}
    );
    const list = (Array.isArray(result) ? result : (result.content ?? [])) as Array<{
      id: number;
      name: string;
      searchRequest: { jsonRule: ApiJsonRule };
    }>;
    return list;
  }

  /**
   * The per-user list preferences of the "All leads" smart list: sort, page size and view mode.
   * They persist on the server (`POST /search-lists/{id}/mark-as-preferred`, one call per setting,
   * the same calls the page makes) — so a test that changes any of them must put it back, or every
   * later list test starts in that state. The server applies a change with a short delay.
   */
  async getListPreferences(): Promise<ListPreferences> {
    const allLeads = (await this.getSmartLists()).find((l) => l.name === 'All leads');
    if (!allLeads) throw new Error('getListPreferences: system smart list "All leads" not found');
    const detail = allLeads as unknown as { id: number; sort: string; size: number; view: string; pipelineId: number };
    return { id: detail.id, sort: detail.sort, size: detail.size, view: detail.view, pipelineId: detail.pipelineId };
  }

  async setListPreferences(prefs: ListPreferences): Promise<void> {
    const path = `/search-lists/${prefs.id}/mark-as-preferred?entityType=LEAD`;
    await this.sendOrThrow('set list sort', 'POST', path, { sort: prefs.sort, freezedColumn: null });
    await this.sendOrThrow('set list size', 'POST', path, { size: prefs.size, freezedColumn: null });
    await this.sendOrThrow('set list view', 'POST', path, {
      view: prefs.view,
      pipelineId: prefs.pipelineId,
      freezedColumn: null,
    });
  }

  async getMyUserId(): Promise<number> {
    const me = await this.sendOrThrow<{ id: number }>('getMyUserId', 'GET', '/users/me');
    return me.id;
  }

  /** Add a note to a lead (`POST /notes/relation`, the call the Notes panel makes). */
  async addNote(leadId: number, text: string): Promise<ApiResult> {
    const result = await this.send<{ id?: number }>('POST', '/notes/relation', {
      sourceEntity: { description: `<div>${text}</div>`, mentions: null },
      targetEntityId: String(leadId),
      targetEntityType: 'LEAD',
    });
    if (result.ok) reportCreatedRecord('note', result.body?.id);
    return result;
  }

  async getLeadOwnerId(leadId: number): Promise<number> {
    return (await this.getLeadOrThrow(leadId)).ownerId;
  }

  /** The tasks listed on a lead (`GET /tasks/relation`, the call the lead's Tasks panel makes). */
  async getTaskNamesOfLead(leadId: number, leadOwnerId: number): Promise<string[]> {
    const result = await this.sendOrThrow<{ content: Array<{ name?: string }> }>(
      'getTaskNamesOfLead',
      'GET',
      `/tasks/relation?targetEntityType=LEAD&targetEntityId=${leadId}&page=0&size=10&sort=createdAt,desc&targetEntityOwnerId=${leadOwnerId}`
    );
    return result.content.map((task) => task.name ?? '');
  }

  // ── Records created on a lead: notes, tasks, meetings, call logs (shapes captured from the UI calls) ──

  /** First option of a picklist on the task create form (read live, not hardcoded). */
  private async firstTaskPicklistId(internalName: 'status' | 'priority'): Promise<number> {
    const layout = await this.sendOrThrow<unknown>('task layout', 'GET', '/layouts/task/create');
    let found: number | undefined;
    const walk = (node: unknown): void => {
      if (found !== undefined) return;
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        const item = node as { internalName?: string; pickLists?: Array<{ id: number }> };
        if (item.internalName === internalName && item.pickLists?.length) found = item.pickLists[0].id;
        else Object.values(node).forEach(walk);
      }
    };
    walk(layout);
    if (found === undefined) throw new Error(`firstTaskPicklistId: no options for task ${internalName}`);
    return found;
  }

  async createTaskOnLead(lead: { id: number; name: string }, assignedToUserId: number): Promise<ApiResult<{ id?: number }>> {
    const result = await this.send<{ id?: number }>('POST', '/tasks', {
      dueDate: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
      assignedTo: assignedToUserId,
      status: await this.firstTaskPicklistId('status'),
      name: `${lead.name} task`,
      priority: await this.firstTaskPicklistId('priority'),
      relation: [{ targetEntityId: lead.id, targetEntityType: 'LEAD', targetEntityName: lead.name }],
    });
    if (result.ok) reportCreatedRecord('task', result.body?.id);
    return result;
  }

  async createMeetingOnLead(
    lead: { id: number; name: string },
    user: { id: number; name: string }
  ): Promise<ApiResult<{ id?: number }>> {
    const from = new Date(Date.now() + 2 * 24 * 3600 * 1000);
    const result = await this.send<{ id?: number }>('POST', '/meetings', {
      owner: user,
      title: `${lead.name} meeting`,
      allDay: false,
      medium: 'OFFLINE',
      // The create form sends the tenant's own time zone (id 372 = Asia/Calcutta on QA)
      timezone: { id: 372, name: 'Asia/Calcutta' },
      customFieldValues: {},
      status: 'scheduled',
      relatedTo: [{ id: String(lead.id), name: lead.name, entity: 'lead' }],
      participants: [
        { id: user.id, entity: 'user', name: user.name },
        { id: String(lead.id), entity: 'lead', name: lead.name },
      ],
      from: from.toISOString(),
      to: new Date(from.getTime() + 15 * 60 * 1000).toISOString(),
    });
    if (result.ok) reportCreatedRecord('meeting', result.body?.id);
    return result;
  }

  async createCallLogOnLead(lead: { id: number; name: string; phoneId: number }): Promise<ApiResult<{ id?: number }>> {
    // multipart, exactly as the Log a call form sends it
    const result = await this.send<{ id?: number }>('POST', '/call-logs/', undefined, {
      isManual: 'true',
      outcome: 'connected',
      startTime: new Date().toISOString(),
      phoneId: String(lead.phoneId),
      callType: 'outgoing',
      duration: '60000',
      durationType: 'seconds',
      callSummary: `${lead.name} call`,
      'relatedTo[id]': String(lead.id),
      'relatedTo[name]': lead.name,
      'relatedTo[entity]': 'lead',
      'relatedTo[phoneId]': String(lead.phoneId),
    });
    if (result.ok) reportCreatedRecord('call log', result.body?.id);
    return result;
  }

  /** The ids of the notes listed on a lead (`GET /notes/relation`, the call the Notes panel makes). */
  async getNoteIdsOfLead(leadId: number, leadOwnerId: number): Promise<number[]> {
    const result = await this.sendOrThrow<{ content: Array<{ id: number }> }>(
      'getNoteIdsOfLead',
      'GET',
      `/notes/relation?targetEntityId=${leadId}&targetEntityType=LEAD&sort=createdAt,desc&page=0&size=10&targetEntityOwnerId=${leadOwnerId}`
    );
    return (result.content ?? []).map((note) => note.id);
  }

  async getLeadPhoneId(leadId: number): Promise<number> {
    const phone = (await this.getLeadOrThrow(leadId)).phoneNumbers as Array<{ id: number }> | undefined;
    if (!phone?.[0]) throw new Error(`getLeadPhoneId: lead ${leadId} has no phone number`);
    return phone[0].id;
  }

  deleteNote(id: number): Promise<ApiResult> {
    return this.send('DELETE', `/notes/${id}`);
  }

  deleteTask(id: number): Promise<ApiResult> {
    return this.send('DELETE', `/tasks/${id}`);
  }

  deleteMeeting(id: number): Promise<ApiResult> {
    return this.send('DELETE', `/meetings/${id}`);
  }

  deleteCallLog(id: number): Promise<ApiResult> {
    return this.send('DELETE', `/call-logs/${id}`);
  }

  // ── Meetings (independent proof that a meeting created from a lead exists) ─

  /** How many meetings carry exactly this title (`POST /meetings/search`, page index starts at 1). */
  async countMeetingsByTitle(title: string): Promise<number> {
    const result = await this.sendOrThrow<{ totalElements: number }>(
      'countMeetingsByTitle',
      'POST',
      '/meetings/search?page=1&size=10&sort=from,desc',
      { fields: ['id', 'title'], jsonRule: LeadApi.rule('title', 'equal', title) }
    );
    return result.totalElements;
  }

  // ── Other entities created by a conversion ────────────────────────────

  deleteRecord(entity: 'deals' | 'contacts' | 'companies', id: number): Promise<ApiResult> {
    return this.send('DELETE', `/${entity}/${id}`);
  }

  getRecord(entity: 'deals' | 'contacts' | 'companies', id: number): Promise<ApiResult> {
    return this.send('GET', `/${entity}/${id}`);
  }
}

const CONVERSION_ENTITIES = { DEAL: 'deals', CONTACT: 'contacts', COMPANY: 'companies' } as const;

/**
 * Log (type, ID, URL) every deal, contact and company a lead's conversion created, read from the
 * lead's own `conversionDetails`. Read-only; never throws. Runs at teardown whether or not cleanup
 * is on, because those records are created by the app, not by a test line.
 */
export async function reportLeadConversion(api: LeadApi, leadId: number): Promise<void> {
  try {
    const lead = await api.getLead(leadId);
    if (!lead.ok) return;
    for (const item of lead.body.conversionDetails ?? []) {
      const type = item.entityType.toLowerCase() as 'deal' | 'contact' | 'company';
      reportCreatedRecord(type, item.entityId);
    }
  } catch (error) {
    logger.warn(`Could not read the records created by converting lead ${leadId} — ${redactTokens(String(error))}`);
  }
}

/**
 * Opt-in cleanup only (CLEANUP_TEST_DATA=1): delete a lead and everything its conversion created.
 * Never throws — a failed teardown must not fail (or mask the failure of) the test body.
 */
export async function deleteLeadAndConversion(api: LeadApi, leadId: number): Promise<void> {
  try {
    const lead = await api.getLead(leadId);
    if (lead.status === 404) return; // already gone (the test deleted it itself)
    const linked = lead.ok ? (lead.body.conversionDetails ?? []) : [];
    // WHY deal → contact → company: the order the live probe deleted them in without error.
    for (const type of ['DEAL', 'CONTACT', 'COMPANY'] as const) {
      for (const item of linked.filter((l) => l.entityType === type)) {
        const result = await api.deleteRecord(CONVERSION_ENTITIES[type], item.entityId);
        if (!result.ok && result.status !== 404) {
          logger.warn(`Lead cleanup: could not delete ${type} ${item.entityId} (HTTP ${result.status})`);
        }
      }
    }
    const deleted = await api.deleteLead(leadId);
    if (!deleted.ok && deleted.status !== 404) {
      logger.warn(`Lead cleanup: could not delete lead ${leadId} (HTTP ${deleted.status})`);
    }
  } catch (error) {
    logger.warn(`Lead cleanup: lead ${leadId} was not cleaned up — ${redactTokens(String(error))}`);
  }
}
