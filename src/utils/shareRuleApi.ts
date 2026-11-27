/**
 * Share-rule API helper — generic over the entity (2026-10-30, Leads coverage work).
 *
 * Every share creates a rule that is managed on Setup → Data Management → Share Data. Endpoints, all
 * proven live on QA: create `POST /v1/<entity>/{recordId}/share`, list/filter
 * `POST /v1/share-rules/search`, read `GET /v1/share-rules/{id}`, change permissions
 * `PUT /v1/<entity>/{recordId}/share/{ruleId}`, delete `DELETE /v1/share-rules/{id}/delete`.
 * Nothing in here knows about leads: the entity comes from SHARE_ENTITIES (src/core/sharePermissions.ts).
 */
import { Page } from '@playwright/test';
import { ApiClient, ApiResult, readAccessToken } from './apiClient';
import {
  SHARE_ENTITIES,
  SHARE_PERMISSIONS,
  ShareEntityType,
  SharePermission,
  SharePermissionSet,
  permissionSet,
} from '../core/sharePermissions';

export interface ShareRule {
  id: number;
  entityType: string;
  entityId: number;
  fromId: number;
  toId: number;
  actions: Record<string, boolean>;
  [key: string]: unknown;
}

export class ShareRuleApi extends ApiClient {
  static async forToken(token: string): Promise<ShareRuleApi> {
    return new ShareRuleApi(await ApiClient.createContext(token));
  }

  static async forPage(page: Page): Promise<ShareRuleApi> {
    return ShareRuleApi.forToken(await readAccessToken(page));
  }

  /** The permissions a rule grants, as a full set. */
  static permissionsOf(rule: Pick<ShareRule, 'actions'>): SharePermissionSet {
    return Object.fromEntries(
      SHARE_PERMISSIONS.map((permission) => [permission, rule.actions[permission] === true])
    ) as SharePermissionSet;
  }

  /** Share one record with one user. `read` is always granted by a share. */
  createShare(args: {
    entityType: ShareEntityType;
    recordId: number;
    recordName: string;
    fromUserId: number;
    toUserId: number;
    permissions: SharePermission[];
  }): Promise<ApiResult> {
    const granted = permissionSet(args.permissions);
    return this.send('POST', `/${SHARE_ENTITIES[args.entityType].apiPath}/${args.recordId}/share`, {
      // WHY these keys only: the share payload carries exactly these actions (proven live)
      actions: {
        read: true,
        update: granted.update,
        delete: false,
        email: granted.email,
        call: granted.call,
        note: granted.note,
        sms: granted.sms,
        task: granted.task,
        // meeting / document are in the rule's own action set; sent too so they are granted when asked for
        meeting: granted.meeting,
        document: granted.document,
      },
      toType: 'USER',
      toId: args.toUserId,
      fromType: 'USER',
      fromId: args.fromUserId,
      entityName: args.recordName,
    });
  }

  /** The rules that share one record (usually one per user it is shared with). */
  async findRules(entityType: ShareEntityType, recordId: number): Promise<ShareRule[]> {
    const result = await this.sendOrThrow<{ content: ShareRule[] }>(
      'findRules',
      'POST',
      '/share-rules/search?page=0&size=20',
      {
        fields: ['id', 'entityType', 'entityId', 'fromId', 'toId', 'actions'],
        jsonRule: {
          rules: [
            { operator: 'equal', id: 'entityType', field: 'entityType', type: 'string', value: entityType },
            { operator: 'equal', id: 'entityId', field: 'entityId', type: 'long', value: String(recordId) },
          ],
          condition: 'AND',
          valid: true,
        },
      }
    );
    return result.content;
  }

  async countRules(entityType: ShareEntityType, recordId: number): Promise<number> {
    return (await this.findRules(entityType, recordId)).length;
  }

  getRule(ruleId: number): Promise<ApiResult<ShareRule>> {
    return this.send<ShareRule>('GET', `/share-rules/${ruleId}`);
  }

  /** Change what a rule grants (everything not listed is switched off; read stays on). */
  async updateRulePermissions(
    entityType: ShareEntityType,
    recordId: number,
    ruleId: number,
    permissions: SharePermission[]
  ): Promise<ApiResult> {
    const current = await this.getRule(ruleId);
    if (!current.ok) throw new Error(`updateRulePermissions: rule ${ruleId} not readable (HTTP ${current.status})`);
    const granted = permissionSet(permissions);
    const actions = { ...current.body.actions };
    for (const permission of SHARE_PERMISSIONS) {
      if (permission in actions) actions[permission] = granted[permission];
    }
    return this.send('PUT', `/${SHARE_ENTITIES[entityType].apiPath}/${recordId}/share/${ruleId}`, {
      ...current.body,
      actions,
    });
  }

  deleteRule(ruleId: number): Promise<ApiResult> {
    return this.send('DELETE', `/share-rules/${ruleId}/delete`);
  }
}
