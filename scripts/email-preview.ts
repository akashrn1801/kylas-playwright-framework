/**
 * Preview sender (piece C of the email polish, 2026-11-25): builds the run email from a committed fixture, with the donut as a real inline (CID)
 * attachment, and sends it with the existing mail settings so it can be checked in real Gmail, on desktop and phone, before any CI run.
 *
 *   npm run email:preview -- --to <address> --fixture build-239          send it
 *   npm run email:preview -- --to <address> --fixture build-239 --dry-run   build it, write the raw message to a file, send nothing
 *
 * Fixtures: build-239 (the real run of 2026-11-25), build-235 (4 failures, 6 flaky), build-235-blocked (the renew-session failure), worst-case.
 *
 * Safety: the message goes to the ONE address given with --to, and nowhere else: no cc, no bcc, and the normal recipients (NOTIFY_TO / NOTIFY_CC,
 * getRecipients()) are never read. The subject starts with "[PREVIEW]". It is not a run: no history is written and no "already notified" marker is
 * set. The mail settings are the notify step's own (GMAIL_USER / GMAIL_APP_PASSWORD or the ZOHO_ ones, from the environment or .env); no secret is printed.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotEnv } from '../src/notifications/scripts/loadDotEnv';
import { replayBuild235, buildWorstCaseFixture, Replay } from './lib/build235Fixture';
import { replayBuild239 } from './lib/build239Fixture';
import { EmailTemplate } from '../src/notifications/EmailTemplate';
import { EmailPayload } from '../src/notifications/adapters/EmailAdapter';

export const FIXTURES = ['build-239', 'build-235', 'build-235-blocked', 'worst-case'] as const;
export type FixtureName = (typeof FIXTURES)[number];

export interface PreviewArgs {
  to: string;
  fixture: FixtureName;
  dryRun: boolean;
}

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** Parses and validates the command line; throws a plain message for anything that could send to the wrong place. */
export function parseArgs(argv: string[]): PreviewArgs {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const to = get('--to');
  if (!to || to.startsWith('--')) throw new Error('--to <address> is required: the preview goes to that one address only');
  if (!ADDRESS.test(to)) throw new Error(`--to must be exactly one e-mail address (got something else): lists, names and separators are refused`);
  const fixture = (get('--fixture') ?? 'build-239') as FixtureName;
  if (!FIXTURES.includes(fixture)) throw new Error(`--fixture must be one of ${FIXTURES.join(', ')}`);
  return { to, fixture, dryRun: argv.includes('--dry-run') };
}

function replay(fixture: FixtureName): Replay {
  switch (fixture) {
    case 'build-239':
      return replayBuild239();
    case 'build-235':
      return replayBuild235();
    case 'worst-case':
      return replayBuild235({ fixture: buildWorstCaseFixture() });
    case 'build-235-blocked':
      return replayBuild235({
        blockedBySession: {
          cause: 'renew-session:failure',
          renewalFailure: { version: 1 as const, role: 'admin', kind: 'not-renewed-after-logout' as const, minutesLeft: 37, endIso: '2026-11-24T15:42:07.402Z', windowMin: 240, sameSession: true, oldTokenStatusAfterLogout: 200, message: 'The admin session has only 37 min left after logout and a fresh login', at: '2026-11-24T15:05:00.000Z' },
        },
      });
  }
}

/** The message as the notify step would send it, marked [PREVIEW], addressed to the one address. */
export function buildPreview(args: PreviewArgs): { payload: EmailPayload; fixtureSubject: string } {
  const r = replay(args.fixture);
  const tpl = new EmailTemplate();
  const attachment = tpl.chartAttachment(r.ctx);
  const payload: EmailPayload = {
    to: [args.to],
    subject: `[PREVIEW] ${tpl.subject(r.ctx)}`,
    html: tpl.html(r.ctx),
    text: tpl.text(r.ctx),
    ...(attachment ? { attachments: [attachment] } : {}),
    env: r.ctx.env,
  };
  return { payload, fixtureSubject: tpl.subject(r.ctx) };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadDotEnv();
  const { payload } = buildPreview(args);
  const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;
  process.stdout.write(`Preview of fixture ${args.fixture}: "${payload.subject}"\n  html ${kib(Buffer.byteLength(payload.html))}, text ${kib(Buffer.byteLength(payload.text ?? ''))}, ${payload.attachments?.length ?? 0} inline image(s)${payload.attachments?.[0] ? ` (${kib(payload.attachments[0].content.length)})` : ''}\n`);
  if (args.dryRun) {
    // build the raw message with nodemailer's stream transport (nothing is sent), so the MIME structure can be inspected
    const nodemailer = await import('nodemailer');
    const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const info = await t.sendMail({ from: '"Kylas preview" <preview@example.test>', to: args.to, subject: payload.subject, html: payload.html, text: payload.text, attachments: payload.attachments });
    const file = path.join(os.tmpdir(), `email-preview-${args.fixture}.eml`);
    fs.writeFileSync(file, info.message as Buffer);
    process.stdout.write(`  dry run: nothing sent; the raw message is in ${file}\n`);
    return;
  }
  const user = process.env.GMAIL_USER || process.env.ZOHO_SMTP_USER;
  const pass = process.env.GMAIL_APP_PASSWORD || process.env.ZOHO_APP_PASSWORD;
  if (!user || !pass) throw new Error('mail settings are missing: set GMAIL_USER and GMAIL_APP_PASSWORD (or the ZOHO_ ones) in the environment or .env, as for the notify step');
  const { EmailAdapter } = await import('../src/notifications/adapters/EmailAdapter');
  await new EmailAdapter().send(payload);
  process.stdout.write(`  sent to the one address given (no cc, no normal recipients)\n`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(`email:preview: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
