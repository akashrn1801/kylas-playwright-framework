/**
 * Email-safety lint (piece C of the email polish, 2026-11-25): fails when the email uses HTML or CSS that Gmail or Outlook drop or mangle, so a visual
 * change cannot quietly break the message in a real inbox. It lints the RENDERED email (every scenario of check:scenarios, builds #239 and #235, the
 * blocked run, the worst case, the "report not available" alert) and the template SOURCE (branches no scenario renders).
 *
 * Rules (each is a rule id in the failure message):
 *  - tags: only the table-and-text vocabulary; no script, svg, canvas, video, audio, iframe, object, embed, form controls, link, base, picture, details
 *  - no inline event handlers, no javascript: links
 *  - images: only `cid:` (an inline attachment; Gmail blocks remote images and strips data: URIs), each with alt, width and height
 *  - inline CSS (the layout): no flex, grid, gap, position, float, display other than block / inline / inline-block / none, no calc(), var(), vw/vh,
 *    clamp/min/max(), transform, animation, transition, filter, object-fit, gradients, url(), @import, @font-face; font families only from the system stack
 *  - the <style> block is progressive enhancement only: outside @media only cosmetic properties; inside a max-width @media only the phone adjustments
 *    (display none/block/inline-block, widths, padding, wrapping); no other at-rules; and the layout must stand without it (every tile cell keeps its
 *    colour inline, the image its size inline)
 *  - the head declares charset, viewport and a light colour scheme
 *
 * Run: npm run check:email-safety
 */
import * as fs from 'fs';
import * as path from 'path';
import { EmailTemplate } from '../src/notifications/EmailTemplate';
import { SCENARIOS } from './check-scenarios';
import { runScenario } from './lib/scenarioKit';
import { buildWorstCaseFixture, replayBuild235 } from './lib/build235Fixture';
import { replayBuild239 } from './lib/build239Fixture';
import { replayBuild240 } from './lib/build240Fixture';

const ALLOWED_TAGS = new Set(['html', 'head', 'meta', 'style', 'title', 'body', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'div', 'span', 'a', 'b', 'strong', 'em', 'i', 'code', 'pre', 'br', 'img', 'ol', 'ul', 'li', 'p', 'h1', 'h2', 'h3', 'h4', 'hr', 'small', 'sup', 'sub']);
const SYSTEM_FONTS = new Set(['-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica', 'arial', 'sans-serif', 'ui-monospace', 'consolas', 'monospace', 'sf mono', 'cascadia code', 'courier new', 'courier', 'inherit']);
const INLINE_BANNED: Array<[string, RegExp]> = [
  ['css-flex', /(^|;)\s*(display\s*:\s*(inline-)?flex|flex[\w-]*\s*:|align-items\s*:|justify-content\s*:|align-self\s*:|order\s*:)/i],
  ['css-grid', /(^|;)\s*(display\s*:\s*(inline-)?grid|grid[\w-]*\s*:|gap\s*:|row-gap\s*:|column-gap\s*:)/i],
  ['css-position', /(^|;)\s*(position\s*:|top\s*:|left\s*:|right\s*:|bottom\s*:|z-index\s*:)/i],
  ['css-float', /(^|;)\s*float\s*:/i],
  ['css-display', /(^|;)\s*display\s*:\s*(?!block\b|inline\b|inline-block\b|none\b)/i],
  ['css-functions', /(calc|var|clamp|min|max)\s*\(/i],
  ['css-viewport-units', /\d\s*(vw|vh|vmin|vmax)\b/i],
  ['css-effects', /(^|;)\s*(transform|animation|transition|filter|backdrop-filter|object-fit|clip-path|mask)[\w-]*\s*:/i],
  ['css-background-image', /gradient\s*\(|url\s*\(/i],
];
// properties the <style> block may set outside @media (cosmetic only), and inside the phone @media
const STYLE_COSMETIC = new Set(['font-size', 'font-weight', 'letter-spacing', 'text-transform', 'line-height', 'margin-top', 'padding', 'padding-bottom', 'border-bottom', 'border', 'border-radius', 'background', 'color', 'width', 'min-width', 'box-sizing', 'overflow-x']);
const STYLE_PHONE = new Set([...STYLE_COSMETIC, 'display', 'max-width', 'padding-left', 'padding-right', 'white-space', 'overflow-wrap', 'vertical-align', 'height']);

/** Returns "rule: detail" for every problem in one rendered email; empty when it is safe. */
export function lintEmailHtml(html: string): string[] {
  const out: string[] = [];
  const bad = (rule: string, detail: string): void => void out.push(`${rule}: ${detail}`);
  const noStyle = html.replace(/<style[\s\S]*?<\/style>/gi, '');

  // tags and handlers
  const tags = new Set([...noStyle.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)[\s>/]/g)].map((m) => m[1].toLowerCase()));
  for (const t of tags) if (!ALLOWED_TAGS.has(t)) bad('tag', `<${t}> is not in the email vocabulary (Gmail or Outlook drops it)`);
  if (/\son[a-z]+\s*=\s*["']/i.test(noStyle)) bad('event-handler', 'an inline on…= handler');
  if (/href\s*=\s*["']\s*javascript:/i.test(noStyle)) bad('javascript-link', 'a javascript: link');
  if (/@import|@font-face|fonts\.googleapis|fonts\.gstatic/i.test(html)) bad('external-font', 'a web font or @import');

  // images
  for (const m of noStyle.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = /\ssrc\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (!src.startsWith('cid:')) bad('image-source', `an image that is not an inline cid: attachment (${src.slice(0, 40)})`);
    if (!/\salt\s*=\s*"[^"]+"/i.test(tag)) bad('image-alt', 'an image without alt text');
    if (!/\swidth\s*=\s*"\d+"/i.test(tag) || !/\sheight\s*=\s*"\d+"/i.test(tag)) bad('image-size', 'an image without width and height attributes');
  }

  // inline CSS
  for (const m of noStyle.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)) {
    const css = m[1];
    for (const [rule, re] of INLINE_BANNED) if (re.test(css)) bad(rule, css.slice(0, 90));
    for (const f of css.matchAll(/font-family\s*:\s*([^;]+)/gi)) {
      for (const fam of f[1].split(',').map((x) => x.trim().replace(/^['"]|['"]$/g, '').toLowerCase())) if (fam && !SYSTEM_FONTS.has(fam)) bad('font-family', `"${fam}" is not a system font`);
    }
  }

  // the <style> block
  for (const block of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = block[1].replace(/\/\*[\s\S]*?\*\//g, '');
    const atRules = [...css.matchAll(/@([a-z-]+)\s*([^{]*)\{/gi)];
    for (const [, name, cond] of atRules) {
      if (name.toLowerCase() !== 'media') bad('style-at-rule', `@${name} in the <style> block`);
      else if (!/^only screen and \(max-width:\s*\d+px\)\s*$/i.test(cond.trim())) bad('style-media', `@media ${cond.trim()} (only the phone query is allowed)`);
    }
    // split into top-level rules and the contents of @media blocks
    const phone = [...css.matchAll(/@media[^{]*\{([\s\S]*?\})\s*\}/gi)].map((m) => m[1]).join('\n');
    const top = css.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, '');
    const props = (body: string): string[] => [...body.matchAll(/([a-z-]+)\s*:\s*([^;}]+)[;}]/gi)].map((m) => `${m[1].toLowerCase()}=${m[2].trim()}`);
    for (const p of props(top)) {
      const [k] = p.split('=');
      if (!STYLE_COSMETIC.has(k)) bad('style-block-layout', `"${k}" outside @media: the <style> block may only be cosmetic (${p.slice(0, 60)})`);
    }
    for (const p of props(phone)) {
      const [k, v] = p.split('=');
      if (!STYLE_PHONE.has(k)) bad('style-block-phone', `"${k}" in the phone @media is not an allowed adjustment`);
      if (k === 'display' && !/^(none|block|inline-block)\b/.test(v)) bad('style-block-phone', `display:${v} in the phone @media`);
    }
  }

  // the layout stands without the <style> block
  for (const m of noStyle.matchAll(/<td\b[^>]*class="kpi"[^>]*>/g)) if (!/style="[^"]*background:#[0-9A-Fa-f]{6}/.test(m[0])) bad('layout-needs-style', 'a tile cell without its colour inline');
  if (/class="donut"/.test(noStyle) && !/<img\b[^>]*style="[^"]*width:\d+px;height:\d+px/.test(noStyle)) bad('layout-needs-style', 'the donut image without its size inline');

  // head
  if (!/<meta charset="UTF-8">/i.test(html)) bad('head', 'no charset meta');
  if (!/<meta name="viewport"/i.test(html)) bad('head', 'no viewport meta');
  if (!/<meta name="color-scheme" content="light">/i.test(html) && /<html/i.test(html) && /section-/.test(html)) bad('head', 'no light colour-scheme meta (dark-mode clients would repaint a light design)');
  return out;
}

/** Template-source scan for branches no scenario renders (comments removed). */
export function lintTemplateSource(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ['source-flex-grid', /display\s*:\s*(inline-)?(flex|grid)/i],
    ['source-position', /position\s*:\s*(absolute|fixed|sticky)/i],
    ['source-markup', /<(svg|script|canvas|video|iframe|object|embed|form|input|button|link)\b/i],
    ['source-font', /@font-face|@import|fonts\.googleapis|fonts\.gstatic/i],
    ['source-remote-image', /<img[^>]*src\s*=\s*["']https?:/i],
  ];
  for (const [rule, re] of rules) if (re.test(code)) out.push(`${rule}: ${(re.exec(code) ?? [''])[0]}`);
  return out;
}

let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}\n`);
};

function main(): void {
  // ── the lint itself: each rule fires on a sample that breaks it, and a clean sample passes ──
  const wrap = (body: string, head = ''): string => `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light">${head}</head><body><table role="presentation"><tr><td id="section-x" style="padding:8px;">${body}</td></tr></table></body></html>`;
  const fires = (html: string, rule: string): boolean => lintEmailHtml(html).some((x) => x.startsWith(`${rule}:`));
  check(lintEmailHtml(wrap('<div style="font-size:12px;color:#000;font-family:-apple-system,Arial,sans-serif;">ok</div><img src="cid:a@b" alt="a" width="10" height="10" style="width:10px;height:10px;">')).length === 0, 'lint: a clean sample (tables, inline colours, a cid image) passes');
  check(fires(wrap('<div style="display:flex;">x</div>'), 'css-flex') && fires(wrap('<div style="display:grid;gap:4px">x</div>'), 'css-grid') && fires(wrap('<div style="position:absolute;top:0">x</div>'), 'css-position'), 'lint: flex, grid and position in an inline style are flagged');
  check(fires(wrap('<div style="float:left">x</div>'), 'css-float') && fires(wrap('<div style="display:table-cell">x</div>'), 'css-display') && fires(wrap('<div style="width:calc(100% - 4px)">x</div>'), 'css-functions') && fires(wrap('<div style="height:50vh">x</div>'), 'css-viewport-units'), 'lint: float, display:table-cell, calc() and viewport units are flagged');
  check(fires(wrap('<div style="background:linear-gradient(#fff,#000)">x</div>'), 'css-background-image') && fires(wrap('<div style="transform:rotate(1deg)">x</div>'), 'css-effects'), 'lint: gradients and transforms are flagged');
  check(fires(wrap('<svg width="10"></svg>'), 'tag') && fires(wrap('<script>1</script>'), 'tag') && fires(wrap('<button>x</button>'), 'tag') && fires(wrap('<iframe src="x"></iframe>'), 'tag'), 'lint: svg, script, button and iframe are flagged');
  check(fires(wrap('<img src="https://x.test/a.png" alt="a" width="1" height="1">'), 'image-source') && fires(wrap('<img src="data:image/png;base64,AAAA" alt="a" width="1" height="1">'), 'image-source') && fires(wrap('<img src="cid:a" width="1" height="1">'), 'image-alt') && fires(wrap('<img src="cid:a" alt="a">'), 'image-size'), 'lint: a remote or data: image, a missing alt and a missing size are flagged');
  check(fires(wrap('<p style="font-family:Inter,sans-serif">x</p>'), 'font-family') && fires(wrap('', '<style>@import url(x.css);</style>'), 'external-font') && fires(wrap('<a onclick="x()">y</a>'), 'event-handler'), 'lint: a web font, @import and an inline handler are flagged');
  check(fires(wrap('', '<style>.a{display:flex}</style>'), 'style-block-layout') && fires(wrap('', '<style>@keyframes k{}</style>'), 'style-at-rule') && fires(wrap('', '<style>@media (min-width:600px){.a{width:1px}}</style>'), 'style-media') && fires(wrap('', '<style>@media only screen and (max-width: 480px){.a{position:absolute}}</style>'), 'style-block-phone'), 'lint: layout in the <style> block, other at-rules, other media queries and position in the phone query are flagged');
  check(fires(wrap('<table><tr><td class="kpi" style="width:10%;">x</td></tr></table>'), 'layout-needs-style'), 'lint: a tile cell whose colour lives only in the <style> block is flagged (the layout must stand without it)');
  check(!fires(wrap('', '<style>.sw{border-radius:2px}@media only screen and (max-width: 480px){.mh{display:none !important}}</style>'), 'style-block-layout') && lintEmailHtml(wrap('', '<style>.sw{border-radius:2px}@media only screen and (max-width: 480px){.mh{display:none !important}}</style>')).length === 0, 'lint: cosmetic rules and the phone query are accepted');

  // ── the real emails ──
  const corpus: Array<[string, string]> = [];
  for (const spec of SCENARIOS) corpus.push([`scenario ${spec.name}`, runScenario(spec).html]);
  corpus.push(['build #239', replayBuild239().html], ['build #240', replayBuild240().html], ['build #235', replayBuild235().html], ['worst case', replayBuild235({ fixture: buildWorstCaseFixture() }).html]);
  corpus.push(['build #235 blocked', replayBuild235({ blockedBySession: { cause: 'renew-session:failure' } }).html]);
  let bytesLinted = 0;
  const problems: string[] = [];
  for (const [name, html] of corpus) {
    bytesLinted += Buffer.byteLength(html);
    for (const p of lintEmailHtml(html)) problems.push(`${name} -> ${p}`);
  }
  const unique = [...new Set(problems.map((p) => p.replace(/^.*? -> /, '')))];
  check(problems.length === 0, `emails: ${corpus.length} rendered emails (${SCENARIOS.length} scenarios, #239, #235, blocked, worst case; ${(bytesLinted / 1024 / 1024).toFixed(1)} MB) use nothing Gmail or Outlook drop`, unique.slice(0, 6).join(' | '));

  // ── the template source ──
  const srcProblems = lintTemplateSource(fs.readFileSync(path.join(__dirname, '../src/notifications/EmailTemplate.ts'), 'utf8'));
  check(srcProblems.length === 0, 'source: EmailTemplate.ts has no flex, grid, absolute position, svg, script, web font or remote image', srcProblems.join(' | '));
  const samples = new EmailTemplate().html(replayBuild239().ctx);
  check(/<style>/.test(samples) && /@media only screen and \(max-width: 480px\)/.test(samples), 'source: the phone rules are in the <style> block (the one allowed use of it)');

  process.stdout.write(`\ncheck:email-safety — ${total - failed}/${total} checks pass\n`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) main();
