/**
 * Background errors, grouped (commit 2 of the email review, 2026-11-25). The email used to print every captured error (build #235: 158 of
 * them, 183 KB, which pushed the email to 424 KB; Gmail clips a message at about 100 KB). It now shows the top groups, one line each:
 * method + endpoint (ids replaced by {id}) + status, with how many times it happened and which tests hit it. The full list goes into a
 * small page next to the HTML report (`background-errors.html`, written by NotificationService into the report directory, which CI
 * uploads as the report artifact).
 */
import * as fs from 'fs';
import * as path from 'path';
import { MiscError, MiscErrorReport } from '../error-collector/ErrorCollector';
import { redactSensitiveText } from './redact';

export type ErrorClass = 'unexpected' | 'rbac' | 'noise';

export interface ErrorGroup {
  klass: ErrorClass;
  type: string;
  method: string;
  endpoint: string;
  status: number | null;
  count: number;
  tests: string[];
  serverMessage: string;
  sample: string;
}

const classOf = (e: MiscError): ErrorClass => (e.expectedReason === 'rbac' ? 'rbac' : e.expectedReason === 'background-noise' ? 'noise' : 'unexpected');

/** /v1/leads/123/has-duplicates -> /v1/leads/{id}/has-duplicates; query string dropped. */
export function normalizeEndpoint(url: string | undefined): string {
  if (!url) return '';
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split('?')[0];
  }
  return pathname
    .split('/')
    .map((seg) => (/^\d{2,}$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) || /^[0-9a-f]{24,}$/i.test(seg) ? '{id}' : seg))
    .join('/');
}

export function groupBackgroundErrors(errors: MiscError[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup & { testSet: Set<string> }>();
  for (const e of errors) {
    const klass = classOf(e);
    const endpoint = normalizeEndpoint(e.url);
    const message = redactSensitiveText(e.message || '').replace(/\s+/g, ' ').trim();
    const key = [klass, e.type, e.method ?? '', endpoint || message.slice(0, 80), e.statusCode ?? ''].join('|');
    let g = groups.get(key);
    if (!g) {
      g = { klass, type: e.type, method: e.method ?? '', endpoint, status: e.statusCode ?? null, count: 0, tests: [], testSet: new Set(), serverMessage: '', sample: message.slice(0, 160) };
      groups.set(key, g);
    }
    g.count++;
    g.testSet.add(e.testTitle || 'unknown');
    if (!g.serverMessage && e.apiErrorMessage) g.serverMessage = redactSensitiveText(e.apiErrorMessage).slice(0, 140);
  }
  const rank: Record<ErrorClass, number> = { unexpected: 0, rbac: 1, noise: 2 };
  return [...groups.values()]
    .map(({ testSet, ...g }) => ({ ...g, tests: [...testSet] }))
    .sort((a, b) => rank[a.klass] - rank[b.klass] || b.count - a.count);
}

export const BACKGROUND_ERRORS_FILE = 'background-errors.html';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The full list, every error once, grouped by test; a plain small page, no email constraints. */
export function renderBackgroundErrorsPage(report: MiscErrorReport, meta: { env: string; branch: string; buildNumber: string }): string {
  const byTest = new Map<string, MiscError[]>();
  for (const e of report.errors) byTest.set(e.testTitle || 'unknown', [...(byTest.get(e.testTitle || 'unknown') ?? []), e]);
  const groups = groupBackgroundErrors(report.errors);
  const groupRows = groups
    .map((g) => `<tr><td>${g.count}</td><td>${g.klass}</td><td>${esc(`${g.method} ${g.endpoint || g.sample}`.trim())}${g.status ? ` → ${g.status}` : ''}</td><td>${g.tests.length}</td><td>${esc(g.serverMessage)}</td></tr>`)
    .join('\n');
  const blocks = [...byTest.entries()]
    .map(([title, errs]) => `<h4>${esc(title)}</h4><ul>${errs.map((e) => `<li><code>[${esc(e.type)}]</code> ${esc(`${e.method ?? ''} ${e.url ?? ''}`.trim())}${e.statusCode ? ` → <b>${e.statusCode}</b>` : ''} ${e.expectedReason ? `<i>(${e.expectedReason === 'rbac' ? 'expected RBAC' : 'known background noise'})</i>` : ''}<br>${esc(redactSensitiveText(e.message || '').slice(0, 300))}${e.apiErrorMessage ? `<br><b>Server:</b> ${esc(redactSensitiveText(e.apiErrorMessage))}` : ''} <small>${esc(e.timestamp)}</small></li>`).join('')}</ul>`)
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Background errors — ${esc(meta.env)} ${esc(meta.branch)} #${esc(meta.buildNumber)}</title><style>body{font:13px system-ui;margin:20px;color:#1b1f24}table{border-collapse:collapse}td,th{border:1px solid #d0d7de;padding:4px 8px;text-align:left}code{background:#f6f8fa}small{color:#8c959f}</style></head><body>
<h2>Background errors — ${esc(meta.env.toUpperCase())} ${esc(meta.branch)} #${esc(meta.buildNumber)}</h2>
<p>${report.totalErrors} captured: ${report.unexpectedErrors} unexpected + ${report.expectedRbacErrors} expected RBAC + ${report.totalErrors - report.unexpectedErrors - report.expectedRbacErrors} known background noise.</p>
<h3>Grouped by request</h3><table><tr><th>Count</th><th>Class</th><th>Request</th><th>Tests</th><th>Server message</th></tr>
${groupRows}</table>
<h3>Every error, by test</h3>
${blocks}
</body></html>`;
}

/** Best effort: a failure to write this page never affects the email. Returns the written path or null. */
export function writeBackgroundErrorsPage(dir: string, report: MiscErrorReport | null | undefined, meta: { env: string; branch: string; buildNumber: string }): string | null {
  if (!report || report.totalErrors === 0) return null;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, BACKGROUND_ERRORS_FILE);
    fs.writeFileSync(file, renderBackgroundErrorsPage(report, meta));
    return file;
  } catch {
    return null;
  }
}
