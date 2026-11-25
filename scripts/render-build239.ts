/**
 * Renders the emails of builds #239 and #235 from their fixtures through the real pipeline, for review in a browser (2026-11-25, email redesign).
 *
 *   npx ts-node scripts/render-build239.ts --out ~/build239-render [--before <real-email.html>]
 *
 * Writes after.html + after.txt (build #239), build235-after.html (build #235), before.html (a copy of the real email, when given), and prints sizes.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmailTemplate } from '../src/notifications/EmailTemplate';
import { replayBuild235 } from './lib/build235Fixture';
import { replayBuild239 } from './lib/build239Fixture';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const out = (arg('--out') ?? path.join(os.homedir(), 'build239-render')).replace(/^~(?=$|\/)/, os.homedir());
fs.mkdirSync(out, { recursive: true });
const kib = (s: string): string => `${(Buffer.byteLength(s, 'utf8') / 1024).toFixed(1)} KiB`;

const r239 = replayBuild239();
fs.writeFileSync(path.join(out, 'after.html'), r239.html);
fs.writeFileSync(path.join(out, 'after.txt'), `Subject: ${r239.subject}\n\n${new EmailTemplate().text(r239.ctx)}`);
const before = arg('--before');
if (before) fs.copyFileSync(before, path.join(out, 'before.html'));
const r235 = replayBuild235();
fs.writeFileSync(path.join(out, 'build235-after.html'), r235.html);
process.stdout.write(`#239 after.html ${kib(r239.html)}  subject: ${r239.subject}\n#235 build235-after.html ${kib(r235.html)}  subject: ${r235.subject}\n-> ${out}\n`);
