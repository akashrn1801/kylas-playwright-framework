/**
 * Visual regression screenshots of the run email (piece C of the email polish, 2026-11-25): renders the key scenarios and the two real builds through the
 * real pipeline and takes Playwright screenshots at 1200 px and 375 px wide, in the light and the dark colour scheme, so a change can be reviewed by eye.
 *
 *   npm run email:screens [-- --out <dir>] [-- --only <name,name>]       default dir: ~/build239-render/screens
 *
 * Writes <name>-<width>-<scheme>.png and index.html (a gallery). Exit 1 when any 375 px render scrolls sideways (the phone layout is broken), so it can
 * also gate a change. The email is designed light and declares `color-scheme: light`; the dark shots show what a client that honours the declaration
 * (or does not repaint) displays, which must stay readable. Nothing is sent and nothing touches the network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chromium } from '@playwright/test';
import { DONUT_CID, EmailContext, EmailTemplate } from '../src/notifications/EmailTemplate';
import { SCENARIOS } from './check-scenarios';
import { runScenario } from './lib/scenarioKit';
import { buildWorstCaseFixture, replayBuild235 } from './lib/build235Fixture';
import { replayBuild239 } from './lib/build239Fixture';
import { replayBuild240 } from './lib/build240Fixture';

const WIDTHS = [1200, 375] as const;
const SCHEMES = ['light', 'dark'] as const;
const KEY_SCENARIOS = ['01-all-pass-first-time', '04-flaky-only-no-rerun', '06-failures-fail-again', '20-zero-tests-selected', '21-very-bad-run', '30-dev-clean', '32-qa-needs-a-look', '33-env-qa', '34-env-staging', '35-env-prod', '36-env-unknown'];

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** The real message refers to the donut as cid:<id>; a browser cannot, so the screenshot HTML carries the same PNG as a data URI. */
function inline(html: string, ctx: EmailContext | null): string {
  const png = ctx ? new EmailTemplate().chartAttachment(ctx) : null;
  return png ? html.split(`cid:${DONUT_CID}`).join(`data:image/png;base64,${png.content.toString('base64')}`) : html;
}

async function main(): Promise<void> {
  const out = (arg('--out') ?? path.join(os.homedir(), 'build239-render', 'screens')).replace(/^~(?=$|\/)/, os.homedir());
  const only = arg('--only')?.split(',');
  fs.mkdirSync(out, { recursive: true });

  const emails: Array<{ name: string; title: string; html: string }> = [];
  const r239 = replayBuild239();
  emails.push({ name: 'build-239', title: 'Build #239 (real run: 1 flaky, 1 passed on the rerun)', html: inline(r239.html, r239.ctx) });
  const r240 = replayBuild240();
  emails.push({ name: 'build-240', title: 'Build #240 (real run: 8 flaky, none failed, nothing rerun)', html: inline(r240.html, r240.ctx) });
  const r235 = replayBuild235();
  emails.push({ name: 'build-235', title: 'Build #235 (2 failed, 6 flaky, rerun)', html: inline(r235.html, r235.ctx) });
  const blocked = replayBuild235({ blockedBySession: { cause: 'renew-session:failure' } });
  emails.push({ name: 'build-235-blocked', title: 'Blocked run (renew-session failed)', html: inline(blocked.html, blocked.ctx) });
  const worst = replayBuild235({ fixture: buildWorstCaseFixture() });
  emails.push({ name: 'worst-case', title: 'Worst case (60 failed, 80 flaky, 790 background errors)', html: inline(worst.html, worst.ctx) });
  for (const spec of SCENARIOS.filter((s) => KEY_SCENARIOS.includes(s.name))) {
    const r = runScenario(spec);
    emails.push({ name: spec.name, title: spec.title, html: inline(r.html, r.ctx) });
  }
  const chosen = emails.filter((e) => !only || only.includes(e.name));

  const browser = await chromium.launch();
  const rows: string[] = [];
  const overflow: string[] = [];
  let shots = 0;
  try {
    for (const e of chosen) {
      const cells: string[] = [];
      for (const width of WIDTHS) {
        for (const scheme of SCHEMES) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
          const page = await context.newPage();
          await page.setContent(e.html, { waitUntil: 'load' });
          const file = `${e.name}-${width}-${scheme}.png`;
          await page.screenshot({ path: path.join(out, file), fullPage: true });
          const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
          if (width === 375 && scrollWidth > 375) overflow.push(`${e.name} (${scheme}): ${scrollWidth}px wide`);
          await context.close();
          shots += 1;
          cells.push(`<td style="vertical-align:top;padding:6px;"><div style="font:11px system-ui;margin-bottom:4px;">${width}px · ${scheme}</div><a href="${file}"><img src="${file}" style="width:${width === 1200 ? 360 : 140}px;border:1px solid #ccc;"></a></td>`);
        }
      }
      rows.push(`<h3 style="font:600 14px system-ui;margin:18px 0 4px;">${e.title} <span style="color:#888;font-weight:400;">(${e.name})</span></h3><table><tr>${cells.join('')}</tr></table>`);
      process.stdout.write(`  ${e.name}: ${WIDTHS.length * SCHEMES.length} screenshots\n`);
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Email screenshots</title><body style="margin:20px;background:#f6f8fa;font-family:system-ui;"><h2>Run email screenshots</h2><p style="font-size:12px;color:#555;">1200 px and 375 px, light and dark colour scheme. Click an image for the full size. The email is designed light (color-scheme: light), so the dark shots must look the same as the light ones.</p>${rows.join('')}</body>`);
  process.stdout.write(`email:screens — ${shots} screenshots of ${chosen.length} emails in ${out}\n`);
  if (overflow.length > 0) {
    process.stdout.write(`FAIL: the phone layout scrolls sideways in ${overflow.length} render(s):\n${overflow.map((o) => `  ${o}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('PASS: no 375 px render scrolls sideways\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`email:screens: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
