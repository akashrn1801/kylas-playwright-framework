/**
 * Offline checks of the outcome donut (piece B of the email polish, 2026-11-25): the PNG renderer (no dependency, text-free, 2x, anti-aliased), the
 * time and size it costs, the fallback when the image cannot be made (the email is still sent, without the image, with the bar and the legend), and the
 * inline attachment reaching the mail library.
 *
 * Run: npm run check:donut
 */
/* eslint-disable no-console -- EmailAdapter reports through console.log; the send check silences it for a moment */
import * as zlib from 'zlib';
import { EmailAdapter } from '../src/notifications/adapters/EmailAdapter';
import { DONUT_CID, EmailTemplate } from '../src/notifications/EmailTemplate';
import { renderDonutPng } from '../src/notifications/DonutChart';
import { logger } from '../src/utils/logger';
import { outcomeChart } from './check-scenarios';
import { replayBuild239 } from './lib/build239Fixture';

let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}\n`);
};

/** Decodes a PNG made by renderDonutPng (8-bit RGBA, filter 0) into raw pixels. */
function decode(png: Buffer): { w: number; h: number; px: Buffer } {
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
  return { w, h, px };
}
const at = (d: { w: number; px: Buffer }, x: number, y: number): [number, number, number, number] => {
  const o = (y * d.w + x) * 4;
  return [d.px[o], d.px[o + 1], d.px[o + 2], d.px[o + 3]];
};

function main(): void {
  const GREEN = '#1A7F37';
  const segs = [{ value: 940, color: GREEN }, { value: 1, color: '#9A6700' }, { value: 1, color: '#57AB5A' }, { value: 0, color: '#CF222E' }, { value: 1, color: '#8C959F' }];
  const t0 = process.hrtime.bigint();
  const png = renderDonutPng(segs);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const d = decode(png);
  check(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && d.w === 340 && d.h === 340, 'png: a valid PNG, 340 x 340 (2x of the 170 px it is shown at)');
  check(png.length < 30 * 1024, `png: under 30 KB (${(png.length / 1024).toFixed(1)} KB for build #239)`);
  const worst = renderDonutPng([{ value: 400, color: '#1A7F37' }, { value: 120, color: '#9A6700' }, { value: 90, color: '#57AB5A' }, { value: 60, color: '#CF222E' }, { value: 30, color: '#8C959F' }]);
  check(worst.length < 30 * 1024, `png: under 30 KB for a busy run too (${(worst.length / 1024).toFixed(1)} KB)`);
  check(ms < 1000, `png: renders in ${ms.toFixed(0)} ms (the dependency is Node's own zlib: 0 bytes to install on a runner or in the Playwright container)`);
  const centre = at(d, 170, 170);
  const midRow = Array.from({ length: 80 }, (_, i) => at(d, 130 + i, 170)[3]);
  check(centre[3] === 0 && midRow.every((a) => a === 0), 'png: no text and a transparent centre (the figure is HTML text next to the image)');
  const bottom = at(d, 170, 170 + 140); // 6 o'clock: inside the large first segment
  check(bottom[3] === 255 && bottom[0] === 0x1a && bottom[1] === 0x7f && bottom[2] === 0x37, 'png: the big segment is the tile green', JSON.stringify(bottom));
  let partial = 0;
  for (let i = 0; i < d.px.length; i += 4) if (d.px[i + 3] > 0 && d.px[i + 3] < 255) partial += 1;
  check(partial > 800, `png: anti-aliased (${partial} edge pixels with partial opacity)`);
  const sliver = Array.from({ length: 340 }, (_, x) => at(d, x, 20)).filter((p) => p[3] === 255 && p[0] === 0x9a && p[1] === 0x67).length;
  check(sliver >= 1, 'png: a 1-in-943 slice stays visible (minimum angle)');
  check(renderDonutPng(segs).equals(png), 'png: deterministic (the same numbers give the same bytes)');
  let threw = false;
  try {
    renderDonutPng([{ value: 0, color: GREEN }]);
  } catch {
    threw = true;
  }
  check(threw, 'png: refuses to draw an empty chart');

  // ── the email: the image, its alt text and the figure ──
  const r = replayBuild239();
  const tpl = new EmailTemplate();
  const html = tpl.html(r.ctx);
  const att = tpl.chartAttachment(r.ctx);
  check(!!att && att.cid === DONUT_CID && att.contentType === 'image/png' && att.content.length < 30 * 1024 && html.includes(`src="cid:${DONUT_CID}"`), 'email: the donut is an inline CID attachment the HTML refers to, under 30 KB');
  const ch = outcomeChart(html);
  check(!!ch && ch.alt?.join() === '943,940,1,1,0,1' && ch.figure === 99.7 && /<img [^>]*width="170" height="170"/.test(html), 'email: alt text states the numbers (943: 940 / 1 / 1 / 0 / 1), the image is shown at 1x (170 px), "99.7% first time" is HTML text', JSON.stringify(ch));
  check(/>99\.7%<\/div><div[^>]*>first time<\/div>/.test(html), 'email: "99.7%" and "first time" are text next to the image');

  // ── the fallback: any failure of the image must not stop the email ──
  const warnings: string[] = [];
  const realWarn = logger.warn.bind(logger);
  logger.warn = (m: string): void => void warnings.push(m);
  const broken = new EmailTemplate(() => {
    throw new Error('simulated: image library missing');
  });
  const fhtml = broken.html(r.ctx);
  const fatt = broken.chartAttachment(r.ctx);
  logger.warn = realWarn;
  const fch = outcomeChart(fhtml);
  check(fatt === null && !fhtml.includes('cid:') && !/<img /.test(fhtml.slice(fhtml.indexOf('section-outcome-chart'), fhtml.indexOf('section-outcome-chart') + 3000)), 'fallback: no attachment and no image tag when the image cannot be made');
  check(!!fch && Object.keys(fch.bar).length === 4 && fch.legend['Passed first time'] === 940 && fch.figure === 99.7, 'fallback: the segmented bar, the legend and the "99.7% first time" text are still there', JSON.stringify(fch));
  check(warnings.length === 1 && /could not be made/.test(warnings[0]) && /simulated: image library missing/.test(warnings[0]) && /without the image/.test(warnings[0]), 'fallback: one warning names the cause and says the email goes out without the image', warnings.join(' | '));
  check(Buffer.byteLength(fhtml) > 1000 && fhtml.includes('<html') && fhtml.includes('Run Summary') && fhtml.includes('id="section-background-errors"'), 'fallback: the rest of the email is complete');
  const odd = new EmailTemplate(() => Buffer.from('not a png'));
  check(odd.chartAttachment(r.ctx) !== null, 'fallback: a generator that returns something is trusted (only a throw drops the image)');

  // ── the mail library gets the inline attachment ──
  const sent: Array<Record<string, unknown>> = [];
  const adapter = new EmailAdapter() as unknown as { transporter: { sendMail: (m: Record<string, unknown>) => Promise<{ messageId: string }> }; send: (p: Record<string, unknown>) => Promise<void> };
  adapter.transporter = { sendMail: async (m) => { sent.push(m); return { messageId: 'stub' }; } };
  const quiet = console.log;
  console.log = (): void => undefined;
  Promise.resolve()
    .then(() => adapter.send({ to: ['a@example.test'], subject: 's', html: '<p>x</p>', env: 'staging', attachments: att ? [att] : [] }))
    .then(() => adapter.send({ to: ['a@example.test'], subject: 's', html: '<p>x</p>', env: 'staging' }))
    .then(() => {
      console.log = quiet;
      const a = sent[0]?.attachments as Array<{ cid: string; filename: string }> | undefined;
      check(!!a && a.length === 1 && a[0].cid === DONUT_CID && a[0].filename === 'run-outcome.png', 'send: the PNG goes to the mail library as an inline attachment with its cid');
      check(sent[1] !== undefined && !('attachments' in sent[1]), 'send: no attachment key when there is no image (the fallback path)');
      process.stdout.write(`\ncheck:donut — ${total - failed}/${total} checks pass (render ${ms.toFixed(0)} ms, ${(png.length / 1024).toFixed(1)} KB)\n`);
      if (failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.log = quiet;
      process.stdout.write(`FAIL  send: ${String(err)}\n`);
      process.exit(1);
    });
}

main();
