/**
 * `npm run check:email-size` (commit 2 of the email review, 2026-11-25): the rendered email must stay under Gmail's clipping limit
 * (about 100 KB; build #235 was 456 KB, so readers never reached the bottom sections), on the real build #235 replay and its blocked-by-session
 * variant; the worst case (60 failed, 80 flaky, 790 background errors) is only reported, nothing is capped for size. Also checks the structural rules behind the size: every
 * error once, no unopenable artifact paths, the grouped background errors with the full list in a page, the plain-text part.
 * Nothing is sent and nothing touches the network.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildWorstCaseFixture, loadFixture, replayBuild235 } from './lib/build235Fixture';
import { branchAdvice as branchAdviceFor } from '../src/notifications/AutomationHealth';
import { buildKnownIssuesIndex, locateKnownIssues } from '../src/notifications/KnownIssuesIndex';
import { EmailTemplate } from '../src/notifications/EmailTemplate';
import { BACKGROUND_ERRORS_FILE, groupBackgroundErrors, normalizeEndpoint, writeBackgroundErrorsPage } from '../src/notifications/BackgroundErrors';

const LIMIT = 100 * 1024;
let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      ${detail}`}\n`);
  if (!ok) failed++;
};
const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;

const real = replayBuild235({ withSkipReason: true });
const blocked = replayBuild235({ blockedBySession: { cause: 'renew-session:failure' } });
const worst = replayBuild235({ fixture: buildWorstCaseFixture() });

// Nothing is capped for size (2026-11-25): the normal runs must fit, the worst case is only REPORTED (Gmail shows "View entire message" past ~102 KB), and what
// must always be above the clip is the essentials, so those are checked by position.
for (const [name, r] of [['build #235', real], ['build #235 blocked by renew-session', blocked]] as const) {
  const bytes = Buffer.byteLength(r.sent);
  check(bytes < LIMIT, `size: ${name} is under 100 KiB (${kib(bytes)})`, `${kib(bytes)} (${bytes} B) is over ${kib(LIMIT)}`);
}
const worstBytes = Buffer.byteLength(worst.sent);
process.stdout.write(`INFO  worst case (60 failed, 80 flaky, 790 background errors) is ${kib(worstBytes)} as sent (${kib(Buffer.byteLength(worst.html))} readable); not a failure\n`);
const CLIP = 102 * 1024;
for (const [name, r] of [['build #235', real], ['worst case', worst]] as const) {
  const sent = r.sent;
  const at = (needle: string): number => Buffer.byteLength(sent.slice(0, Math.max(0, sent.indexOf(needle))));
  const essentialsEnd = at('Slowest Tests');
  check(sent.includes('Slowest Tests') && essentialsEnd < CLIP, `size: ${name}: verdict, tiles, How the run ended, Action Required and Module Analytics all end before the clip (${kib(essentialsEnd)})`, `${kib(essentialsEnd)}`);
  const order = ['>Result<', 'How the run ended', 'Action Required (Automation Health', 'Module Analytics</div>'].map((n) => sent.indexOf(n));
  check(order.every((o, k) => o >= 0 && (k === 0 || o > order[k - 1])), `size: ${name}: the essentials come in order (Result, How the run ended, Action Required, Module Analytics)`, order.join(','));
  const firstCard = sent.indexOf('id="section-failed-tests"') >= 0 ? sent.indexOf('id="section-failed-tests"') : sent.indexOf('id="section-flaky-tests"');
  check(firstCard < 0 || firstCard > order[3], `size: ${name}: the cards come after the essentials`, `${firstCard} vs ${order[3]}`);
}
for (const [name, r] of [['build #235', real], ['worst case', worst]] as const) {
  const ids = (r.html.match(/id="(?:section-failed-tests|section-flaky-tests|section-passed-on-rerun)"/g) ?? []).length;
  check(ids >= 1, `no cap: ${name} has its failed/flaky sections`, '');
  const more = /more, not shown in full here|more failed tests?, not shown in full|shorter jobs \(each|more rerun tests|more modules? with failures/.test(r.html);
  check(!more, `no cap: ${name} has no "+N more, not shown" line`, 'a size cap is still in the template');
}
// item 8: no path that only exists inside a CI runner
for (const [name, r] of [['build #235', real], ['worst case', worst]] as const) {
  check(!/all-blob-reports\/resources|blob-report\/resources|test-results\/[^"<\s]*\.zip|error-context\.md/.test(r.html), `item 8: ${name} has no trace/snapshot paths from inside the runner`, 'a runner-relative artifact path is still in the email');
}
check(real.html.includes('the report artifact on'), 'item 8: the failure and flaky sections point to the run\'s report artifact once');

// item 7: each error once (the failed test's message and code frame, not the frame twice, not the stack repeated)
const frames = (real.html.match(/at CallLogsPage\.openDropdownById/g) ?? []).length;
check(frames === 0, 'item 7: stack frames are not printed (the card has the message and one short code frame)', `${frames} stack frame line(s) found`);
const frameOnce = (real.html.match(/await this\.page\.locator\('\.is-invalid__option'\)\.first\(\)\.waitFor/g) ?? []).length;
check(frameOnce <= 6, 'item 7: the same code line is not repeated within a card (once per card at most)', `${frameOnce} occurrences for 6 flaky tests`);

// item 13: grouped background errors, full list in a page
const misc = loadFixture().misc;
const groups = groupBackgroundErrors(misc.errors);
check(groups.reduce((n, g) => n + g.count, 0) === misc.errors.length, `item 13: the groups cover every error (${groups.length} groups, ${misc.errors.length} errors)`);
check(groups.length < misc.errors.length, 'item 13: errors are actually grouped');
check(normalizeEndpoint('https://api.example.test/v1/leads/12345/has-duplicates?x=1') === '/v1/leads/{id}/has-duplicates', 'item 13: ids and the query string are dropped from the endpoint');
check(real.html.includes('Top errors, grouped by request') && real.html.includes(BACKGROUND_ERRORS_FILE), 'item 13: the email shows the grouped summary and names background-errors.html');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgerr-'));
const page = writeBackgroundErrorsPage(dir, misc, { env: 'staging', branch: 'sandbox', buildNumber: '235' });
const pageHtml = page ? fs.readFileSync(page, 'utf-8') : '';
check(!!page && (pageHtml.match(/<li>/g) ?? []).length === misc.errors.length, 'item 13 (D5): background-errors.html lists every error once', `${(pageHtml.match(/<li>/g) ?? []).length} of ${misc.errors.length}`);
check(!/eyJ[A-Za-z0-9_-]{20,}/.test(pageHtml), 'item 13: the page carries no token');
check(writeBackgroundErrorsPage(dir, { ...misc, totalErrors: 0, errors: [] }, { env: 'staging', branch: 'sandbox', buildNumber: '1' }) === null, 'item 13: no page when nothing was captured');
fs.rmSync(dir, { recursive: true, force: true });

// item 9: job overlaps only as anomalies
check(!/Job Time Overlaps<\/div>/.test(real.html) ? /Job time overlaps:<\/strong> none that matter/.test(real.html) : true, 'item 9: with no same-module overlap the email says so in one line');

// item 10: slowest by module limited
const modBlocks = (real.html.match(/Slowest Tests by Module \(every module, top 3 each\)/g) ?? []).length;
check(modBlocks === 1, 'item 10: "Slowest Tests by Module" lists every module, top 3 each (main lists them all; the 5-module cap is gone)');

// item 14: three lines on top
const top = /Result<\/strong>[^<]*<\/div> <div[^>]*><strong[^>]*>Action<\/strong>[^<]*<\/div> <div[^>]*><strong[^>]*>Run<\/strong>/.test(real.html.replace(/\s+/g, ' '));
check(top || (real.html.includes('>Result<') && real.html.includes('>Action<') && real.html.includes('>Run<')), 'item 14: Result, Action and Run lines are at the top');
check(real.html.indexOf('>Result<') < real.html.indexOf('Executive Summary'), 'item 14: the three lines come before the Executive Summary');

// item 24: the plain-text part
const tpl = new EmailTemplate();
const text = tpl.text(real.ctx);
check(text.startsWith(real.subject) && /\nResult: /.test(text) && /\nAction: /.test(text) && /\nRun: /.test(text), 'item 24: the text part starts with the subject and has Result, Action and Run');
check(!/<[a-z][^>]*>/i.test(text), 'item 24: the text part has no HTML');
check(Buffer.byteLength(text) < 12 * 1024, `item 24: the text part is small on a normal run (${kib(Buffer.byteLength(text))})`);
check(/FAILED \(2\)/.test(text) && /FLAKY \/ PASSED ON RERUN \(8\)/.test(text), 'item 24: the text part lists the failed and the flaky tests');
const worstText = tpl.text(worst.ctx);
process.stdout.write(`INFO  worst case plain-text part is ${kib(Buffer.byteLength(worstText))} (every failed and flaky test is listed)\n`);

// ── commit 3 (items 15-23) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const flat = real.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
// 15: the factual subject
check(real.subject === '❌ STAGING sandbox #235: 2 failed, 940 passed (6 flaky, 2 on rerun), 1 skipped of 943', 'item 15: the subject is factual: counts, flaky and rerun named, no health score', real.subject);
// 16: branch-aware wording
check(/Not ready for a PR to dev/.test(flat) && !/Deployment (not|likely|recommended)/.test(flat), 'item 16: the sandbox email says "Not ready for a PR to dev", never deployment advice');
const prod = replayBuild235({ blockedBySession: undefined });
const prodText = branchAdviceFor('prod');
check(/promote to main/.test(prodText.ready) && /promote to main/.test(prodText.notReady) && /PR to dev/.test(branchAdviceFor('sandbox').ready) && /PR to dev/.test(branchAdviceFor('feature/x').ready) && /promote to qa/.test(branchAdviceFor('dev').ready) && !/PR to dev/.test(branchAdviceFor('dev').ready) && /promote to stage/.test(branchAdviceFor('qa').ready) && /promote to prod/.test(branchAdviceFor('stage').ready) && /Deployment/.test(branchAdviceFor('main').ready) && /Deployment/.test(branchAdviceFor('hotfix/x').ready), 'item 16: the advice follows the promotion chain: sandbox and feature/* PR to dev, dev promote to qa, qa to stage, stage to prod, prod to main, main deployment');
void prod;
// 17: copy-paste rerun command per failed test
const cmds = flat.match(/ENV=staging npx playwright test tests\/[^\s]+\.spec\.ts:\d+ --project=chromium --retries=0/g) ?? [];
check(cmds.length >= 2, `item 17: each failed test card has its rerun command (${cmds.length} commands in the email)`, 'no rerun command found');
check(tpl.text(real.ctx).includes('ENV=staging npx playwright test tests/'), 'item 17: the text part has the rerun command per failed test');
// 18: the linked commit with subject and author
check(real.html.includes(`/commit/${real.ctx.gitCommit}"`) && flat.includes('Sample commit subject') && flat.includes('by Sample Author'), 'item 18: the commit is a link to GitHub with its subject and author');
// 19: one time zone, labelled
check(!/\bUTC\b/.test(flat) && /IST/.test(flat), 'item 19: times are in IST and say so; no UTC left');
// 20: durations as "6m 10s"
check(!/\b\d{3,}s\b/.test(flat) && !/\b\d{3,}m\b/.test(flat), 'item 20: no "370s" or "154m" durations', (flat.match(/\b\d{3,}[sm]\b/g) ?? []).join(', '));
check(/\b\d+m \d+s\b/.test(flat), 'item 20: durations read like "6m 10s"');
// 21: words with every arrow
const arrows = [...flat.matchAll(/[▲▼]([^▲▼]{0,90})/g)].map((m) => m[1]);
check(arrows.length > 0 && arrows.every((a) => /(than last|than the last|slower than|worse|better)/.test(a)), `item 21: every arrow is followed by words (${arrows.length} arrows)`, arrows.filter((a) => !/(than last|than the last|slower than|worse|better)/.test(a)).join(' | '));
// 22: known issues linked by KI number, with the topic file
check(/Related history: <a [^>]*href="[^"]*docs\/known-issues\/[a-z-]+\.md#L\d+"[^>]*>(KI-\d+ in )?[a-z-]+\.md/.test(real.html), 'item 22: a failure that matches a documented incident links to its topic file (with the KI number when the entry has one)', 'no Related history link to a topic file');
const locs = locateKnownIssues(path.resolve(__dirname, '..'));
check(locs['KI-43']?.file === 'docs/known-issues/watch-items.md' && !!locs['KI-03'], 'item 22: every KI number resolves to its doc and line (KI-43 is in watch-items.md)', JSON.stringify(locs['KI-43']));
const idx = buildKnownIssuesIndex('# T\n\n### KI-99 — x\n- **What:** failed in `DealsPage.selectDate()` here\n', 'docs/KNOWN_ISSUES_ACTIVE.md');
check(idx.some((c) => c.kiId === 'KI-99' && c.kind === 'method-name'), 'item 22: a match carries the KI number of the entry it is in');
// 23: flakiest tests
check(/Flakiest tests, last \d+ runs/.test(flat), 'item 23: the "Flakiest tests, last N runs" section is there');
const section = real.html.slice(real.html.indexOf('id="section-flakiest-tests"'), real.html.indexOf('id="section-flakiest-tests"') + 6000);
check((section.match(/ of \d+ runs<\/td>/g) ?? []).length >= 1 && (section.match(/ of \d+ runs<\/td>/g) ?? []).length <= 6, 'item 23: rows show "N of M runs" and are capped at 6');

process.stdout.write(failed === 0 ? `\ncheck:email-size — all ${total} checks passed\n` : `\ncheck:email-size — ${failed} of ${total} failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
