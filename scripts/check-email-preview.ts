/* eslint-disable no-console -- EmailAdapter reports through console.log; the send check silences it for a moment */
/**
 * Offline checks of the preview sender (scripts/email-preview.ts): what it refuses, what it builds, who it can send to. Nothing is sent.
 *
 * Run: npm run check:email-preview
 */
import * as fs from 'fs';
import * as path from 'path';
import { EmailAdapter } from '../src/notifications/adapters/EmailAdapter';
import { DONUT_CID } from '../src/notifications/EmailTemplate';
import { FIXTURES, buildPreview, parseArgs } from './email-preview';

let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}\n`);
};
const throws = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

async function main(): Promise<void> {
  // ── arguments: anything that could send to the wrong place is refused ──
  check(!!throws(() => parseArgs([])) && /--to/.test(throws(() => parseArgs([])) ?? ''), 'args: --to is required');
  check(!!throws(() => parseArgs(['--to', '--fixture', 'build-239'])), 'args: --to without a value is refused');
  check(!!throws(() => parseArgs(['--to', 'a@example.test,b@example.test'])) && !!throws(() => parseArgs(['--to', 'a@example.test;b@example.test'])), 'args: a list of addresses is refused (one address only)');
  check(!!throws(() => parseArgs(['--to', 'Name <a@example.test>'])) && !!throws(() => parseArgs(['--to', 'not-an-address'])), 'args: a display name or a non-address is refused');
  check(/--fixture must be one of/.test(throws(() => parseArgs(['--to', 'a@example.test', '--fixture', 'nope'])) ?? ''), 'args: an unknown fixture is refused and the valid ones are listed');
  const ok = parseArgs(['--to', 'me@example.test', '--fixture', 'build-235', '--dry-run']);
  check(ok.to === 'me@example.test' && ok.fixture === 'build-235' && ok.dryRun === true && parseArgs(['--to', 'me@example.test']).fixture === 'build-239' && parseArgs(['--to', 'me@example.test']).dryRun === false, 'args: a valid command line parses (default fixture build-239, --dry-run is opt-in)');

  // ── the message: marked, addressed to one address, with a real inline image ──
  for (const fixture of FIXTURES) {
    const { payload, fixtureSubject } = buildPreview({ to: 'me@example.test', fixture, dryRun: true });
    const att = payload.attachments?.[0];
    const hasChart = payload.html.includes(`cid:${DONUT_CID}`);
    check(payload.subject === `[PREVIEW] ${fixtureSubject}` && payload.subject.startsWith('[PREVIEW] '), `message (${fixture}): the subject starts with "[PREVIEW] " and keeps the real subject`, payload.subject);
    check(payload.to.length === 1 && payload.to[0] === 'me@example.test' && payload.cc === undefined && !('bcc' in payload), `message (${fixture}): one recipient, no cc, no bcc`);
    check(hasChart === !!att && (!att || (att.cid === DONUT_CID && att.contentType === 'image/png' && att.content.length > 1000 && att.content.length < 30 * 1024)), `message (${fixture}): the donut is a real inline attachment (cid, image/png, under 30 KB) exactly when the HTML refers to it`);
    check(!!payload.text && payload.text.startsWith(fixtureSubject), `message (${fixture}): the plain-text part is there and matches the email's subject`);
  }

  // ── the raw MIME the mail library makes from it ──
  const nodemailer = await import('nodemailer');
  const { payload } = buildPreview({ to: 'me@example.test', fixture: 'build-239', dryRun: true });
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const raw = ((await t.sendMail({ from: '"x" <x@example.test>', to: payload.to, subject: payload.subject, html: payload.html, text: payload.text, attachments: payload.attachments })).message as Buffer).toString('latin1');
  const head = raw.slice(0, raw.indexOf('\n\n'));
  check(/^To: me@example\.test$/m.test(head) && !/^(Cc|Bcc):/im.test(head), 'mime: To is the one address; there is no Cc or Bcc header');
  check(/Content-Type: multipart\/related/i.test(raw) && /Content-Type: image\/png/i.test(raw) && raw.includes(`Content-ID: <${DONUT_CID}>`) && /Content-Type: text\/plain/i.test(raw) && /Content-Type: text\/html/i.test(raw), 'mime: multipart/related with the text part, the HTML part and the PNG carrying the Content-ID the HTML refers to');
  check(/^Subject: .*PREVIEW/m.test(head.replace(/\n\s+/g, ' ')) || /=\?UTF-8\?/.test(head), 'mime: the subject header carries the preview marker');

  // ── who it can send to: only what it is given ──
  const sent: Array<Record<string, unknown>> = [];
  const adapter = new EmailAdapter() as unknown as { transporter: { sendMail: (m: Record<string, unknown>) => Promise<{ messageId: string }> }; send: (p: Record<string, unknown>) => Promise<void> };
  adapter.transporter = { sendMail: async (m) => { sent.push(m); return { messageId: 'stub' }; } };
  const prevTo = process.env.NOTIFY_TO;
  const prevCc = process.env.NOTIFY_CC;
  process.env.NOTIFY_TO = 'team@example.test';
  process.env.NOTIFY_CC = 'lead@example.test';
  const quiet = console.log;
  console.log = (): void => undefined;
  await adapter.send({ ...payload });
  console.log = quiet;
  process.env.NOTIFY_TO = prevTo;
  process.env.NOTIFY_CC = prevCc;
  if (prevTo === undefined) delete process.env.NOTIFY_TO;
  if (prevCc === undefined) delete process.env.NOTIFY_CC;
  const s0 = sent[0] ?? {};
  check(s0.to === 'me@example.test' && s0.cc === undefined && !String(s0.to).includes('team@') && JSON.stringify(s0).indexOf('lead@example.test') < 0 && Array.isArray(s0.attachments), 'send: with NOTIFY_TO and NOTIFY_CC set to a team list, the mail library still gets only the one address, no cc, and the inline image');

  // ── the script never reads the normal recipients ──
  const src = fs.readFileSync(path.join(__dirname, 'email-preview.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check(!/getRecipients|NOTIFY_TO|NOTIFY_CC|resolveRecipients|notificationConfig\.recipients|markNotified|NotificationService/.test(src), 'static: the preview script never reads the normal recipients, never marks a run as notified and does not use the notify service');

  process.stdout.write(`\ncheck:email-preview — ${total - failed}/${total} checks pass\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  process.stdout.write(`FAIL  ${String(err)}\n`);
  process.exit(1);
});
