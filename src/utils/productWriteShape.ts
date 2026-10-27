import { Page, Response } from '@playwright/test';
import { logger } from './logger';

// WHY this exists (sandbox run 39903711894, P&S formFields FFPS29/FFPS23/FFRPS9):
// the traces of the failed attempts show every `POST /v1/products` sending the
// custom field FLAT (top-level `cfFormFieldLimitText`, `customFieldValues: {}`),
// and the product read back with `customFieldValues: {}`. The value was never
// sent in the shape the backend stores, so re-reading the edit page cannot
// recover it. This records, per product write, whether each custom field went
// FLAT or NESTED, and whether the layout the form was built from names the
// field with or without the `customFieldValues.` prefix. It only reads
// requests and responses and logs key names (never values).

export type PayloadShape = 'FLAT' | 'NESTED' | 'BOTH';

interface WriteRecord {
  id: string | null;
  method: 'POST' | 'PUT';
  shapes: Map<string, PayloadShape>;
  nestedKeys: string[];
}

interface PageState {
  writes: WriteRecord[];
  // layout view ('create' | 'edit') -> custom field name -> named WITH the `customFieldValues.` prefix?
  layoutPrefixed: Map<string, Map<string, boolean>>;
}

const states = new WeakMap<Page, PageState>();

const CREATE_PATH = /^\/v\d+\/products\/?$/;
const EDIT_PATH = /^\/v\d+\/products\/(\d+)\/?$/;
const LAYOUT_PATH = /^\/v\d+\/products\/layout$/;
const NESTED_PREFIX = 'customFieldValues.';

function collectCustomFieldNames(node: unknown, into: Map<string, boolean>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectCustomFieldNames(item, into);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.standard === false && typeof obj.name === 'string') {
      into.set(obj.name.replace(NESTED_PREFIX, ''), obj.name.startsWith(NESTED_PREFIX));
    }
    for (const value of Object.values(obj)) collectCustomFieldNames(value, into);
  }
}

async function onResponse(page: Page, state: PageState, response: Response): Promise<void> {
  const request = response.request();
  const method = request.method().toUpperCase();
  let url: URL;
  try {
    url = new URL(response.url());
  } catch (error) {
    logger.debug(`productWriteShape: unparsable url (${String(error)})`);
    return;
  }

  if (method === 'GET' && LAYOUT_PATH.test(url.pathname) && response.ok()) {
    const view = url.searchParams.get('view') ?? '';
    try {
      const names = new Map<string, boolean>();
      collectCustomFieldNames(await response.json(), names);
      state.layoutPrefixed.set(view, names);
    } catch (error) {
      logger.debug(`productWriteShape: layout body not readable (${String(error)})`);
    }
    return;
  }

  const isCreate = method === 'POST' && CREATE_PATH.test(url.pathname);
  const editMatch = method === 'PUT' ? EDIT_PATH.exec(url.pathname) : null;
  if ((!isCreate && !editMatch) || !response.ok()) return;

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(request.postData() ?? '') as Record<string, unknown>;
  } catch (error) {
    logger.debug(`productWriteShape: write body is not JSON (${String(error)})`);
    return;
  }

  let id: string | null = editMatch ? editMatch[1] : null;
  if (isCreate) {
    try {
      const created = (await response.json()) as { id?: unknown };
      id = created.id === undefined ? null : String(created.id);
    } catch (error) {
      logger.debug(`productWriteShape: create response body not readable (${String(error)})`);
    }
  }

  const nested =
    body.customFieldValues && typeof body.customFieldValues === 'object'
      ? (body.customFieldValues as Record<string, unknown>)
      : {};
  const nestedKeys = Object.keys(nested);
  const flatKeys = Object.keys(body).filter((key) => key.startsWith('cf'));
  const shapes = new Map<string, PayloadShape>();
  for (const name of new Set([...flatKeys, ...nestedKeys])) {
    const flat = flatKeys.includes(name);
    const inNested = nestedKeys.includes(name);
    shapes.set(name, flat && inNested ? 'BOTH' : flat ? 'FLAT' : 'NESTED');
  }
  state.writes.push({ id, method: isCreate ? 'POST' : 'PUT', shapes, nestedKeys });

  const view = isCreate ? 'create' : 'edit';
  const layout = state.layoutPrefixed.get(view);
  for (const [name, shape] of shapes) {
    const prefixed = layout?.get(name);
    const layoutNote =
      prefixed === undefined
        ? `layout?view=${view} not captured for this field`
        : `layout?view=${view} names it ${prefixed ? 'WITH' : 'WITHOUT'} the "customFieldValues." prefix`;
    logger.info(
      `[P&S write] ${method} product ${id ?? '(id unknown)'}: ${name} sent ${shape}` +
        `${shape === 'FLAT' ? ' (top-level)' : ''}, customFieldValues keys=[${nestedKeys.join(', ')}]; ${layoutNote}`
    );
  }
}

export function trackProductWrites(page: Page): void {
  if (states.has(page)) return;
  const state: PageState = { writes: [], layoutPrefixed: new Map() };
  states.set(page, state);
  page.on('response', (response) => {
    void onResponse(page, state, response).catch((error) =>
      logger.debug(`productWriteShape: ${String(error)}`)
    );
  });
}

// True when the recorded write for this product sent `internalName` FLAT only.
export function wasWrittenFlat(page: Page, id: string, internalName: string): boolean {
  const record = [...(states.get(page)?.writes ?? [])].reverse().find((w) => w.id === id);
  return record?.shapes.get(internalName) === 'FLAT';
}

// The message for "every one of the last `attempts` writes of this field was FLAT", or null.
export function flatOnAllAttemptsMessage(
  page: Page,
  internalName: string,
  attempts: number
): string | null {
  const withField = (states.get(page)?.writes ?? []).filter((w) => w.shapes.has(internalName));
  const last = withField.slice(-attempts);
  if (last.length < attempts || !last.every((w) => w.shapes.get(internalName) === 'FLAT')) {
    return null;
  }
  const empty = last.every((w) => w.nestedKeys.length === 0);
  return (
    `app posted ${internalName} FLAT on all ${attempts} attempts, ` +
    `customFieldValues ${empty ? 'empty' : 'without it'}, value not stored`
  );
}
