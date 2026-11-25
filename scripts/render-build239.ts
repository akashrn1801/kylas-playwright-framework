/**
 * Renders the emails of builds #239 and #235 from their fixtures through the real pipeline, for review in a browser (2026-11-25, email redesign).
 *
 *   npx ts-node scripts/render-build239.ts --out ~/build239-render [--before <real-email.html>]
 *
 * Writes after.html + after.txt + after-mobile.html (build #239; the mobile file is the same email in a 375 px wide frame, so its media queries
 * apply), build235-after.html (build #235), blocked.html (the run whose renew-session job failed), before.html (a copy of the real email, when
 * given), and prints sizes.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DONUT_CID, EmailContext, EmailTemplate } from '../src/notifications/EmailTemplate';
import { replayBuild235 } from './lib/build235Fixture';
import { replayBuild239 } from './lib/build239Fixture';
import { replayBuild240 } from './lib/build240Fixture';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = (arg('--out') ?? path.join(os.homedir(), 'build239-render')).replace(/^~(?=$|\/)/, os.homedir());
fs.mkdirSync(out, { recursive: true });
const kib = (s: string): string => `${(Buffer.byteLength(s, 'utf8') / 1024).toFixed(1)} KiB`;

// The real message refers to the donut as cid:<id> (an inline attachment). A browser cannot resolve that, so the review files carry the same PNG as a data URI.
const inline = (html: string, ctx: EmailContext): string => {
  const png = new EmailTemplate().chartAttachment(ctx);
  return png ? html.split(`cid:${DONUT_CID}`).join(`data:image/png;base64,${png.content.toString('base64')}`) : html;
};

const r239 = replayBuild239();
fs.writeFileSync(path.join(out, 'after.html'), inline(r239.html, r239.ctx));
fs.writeFileSync(path.join(out, 'after.txt'), `Subject: ${r239.subject}\n\n${new EmailTemplate().text(r239.ctx)}`);
const before = arg('--before');
if (before) fs.copyFileSync(before, path.join(out, 'before.html'));
const phone = (html: string): string =>
  `<!doctype html><meta charset="utf-8"><title>375 px</title><body style="margin:0;background:#E5E9EE"><div style="width:375px;margin:16px auto;box-shadow:0 0 0 1px #B8C0CC"><iframe style="width:375px;height:5200px;border:0;display:block;background:#fff" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></div></body>`;
fs.writeFileSync(path.join(out, 'after-mobile.html'), phone(inline(r239.html, r239.ctx)));
const r240 = replayBuild240();
fs.writeFileSync(path.join(out, 'after-240.html'), inline(r240.html, r240.ctx));
fs.writeFileSync(path.join(out, 'after-240-mobile.html'), phone(inline(r240.html, r240.ctx)));
const r235 = replayBuild235();
const blocked = replayBuild235({
  blockedBySession: {
    cause: 'renew-session:failure',
    renewalFailure: { version: 1 as const, role: 'admin', kind: 'not-renewed-after-logout' as const, minutesLeft: 37, endIso: '2026-11-24T15:42:07.402Z', windowMin: 240, sameSession: true, oldTokenStatusAfterLogout: 200, message: 'The admin session has only 37 min left after logout and a fresh login', at: '2026-11-24T15:05:00.000Z' },
  },
});
fs.writeFileSync(path.join(out, 'blocked.html'), inline(blocked.html, blocked.ctx));
fs.writeFileSync(path.join(out, 'build235-after.html'), inline(r235.html, r235.ctx));
process.stdout.write(`#240 after-240.html ${kib(r240.html)}\nblocked.html ${kib(blocked.html)}\n#239 after.html ${kib(r239.html)}  subject: ${r239.subject}\n#235 build235-after.html ${kib(r235.html)}  subject: ${r235.subject}\n-> ${out}\n`);
