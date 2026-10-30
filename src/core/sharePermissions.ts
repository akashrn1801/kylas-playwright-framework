/**
 * Share-rule vocabulary shared by every entity (2026-10-30, Leads coverage work).
 *
 * WHY here: a record share is the same feature for every entity — the same permission switches on
 * the same Setup → Data Management → Share Data page, the same share-rule API — so the permission
 * list and the per-entity facts live once, in the shared core, not inside any entity's page object.
 *
 * HOW another entity plugs in: add ONE entry to SHARE_ENTITIES (its label on the Share Data page and
 * the API path segment of its records) — and have its page object expose "is this right-rail icon /
 * button / menu item shown" so the per-permission access checks can be written for it. Only LEAD has
 * been verified live; do not add an entry before checking both values on the real page.
 */

/** Permissions a share can grant. `delete` exists in the share payload but has no switch on the rule page. */
export const SHARE_PERMISSIONS = [
  'read',
  'update',
  'delete',
  'note',
  'task',
  'meeting',
  'call',
  'email',
  'sms', // labelled "Conversation" on the rule page
  'document',
] as const;

export type SharePermission = (typeof SHARE_PERMISSIONS)[number];

/** Every permission, granted or not — a full picture of what a share allows. */
export type SharePermissionSet = Record<SharePermission, boolean>;

/** Build a full permission set from the list of granted permissions (read is always granted by a share). */
export function permissionSet(granted: SharePermission[]): SharePermissionSet {
  const set = Object.fromEntries(SHARE_PERMISSIONS.map((p) => [p, false])) as SharePermissionSet;
  set.read = true;
  for (const permission of granted) set[permission] = true;
  return set;
}

export interface ShareEntityConfig {
  /** How the entity is named on the Share Data page ("Entity Type" filter, "Lead (record name)" column). */
  label: string;
  /** API path segment of the entity's records: `PUT /v1/<apiPath>/{recordId}/share/{ruleId}`. */
  apiPath: string;
}

export const SHARE_ENTITIES = {
  LEAD: { label: 'Lead', apiPath: 'leads' },
} as const satisfies Record<string, ShareEntityConfig>;

export type ShareEntityType = keyof typeof SHARE_ENTITIES;
