/**
 * Offline checks against the REAL build #240 (sandbox, run 45630312674, 2026-11-25), replayed from scripts/fixtures/build-240, and unit checks of the
 * fixes it exposed (piece D of the build #240 review): E1 the commit line in CI, E2 plain rerun wording, E3 singular/plural, E4 the request age,
 * E5 the 429 columns split by host.
 *
 * Run: npm run check:build240
 */
import * as fs from 'fs';
import * as path from 'path';
import { describeRequestAge } from '../src/utils/requestAge';
import { GitRunner, resolveCommit } from '../src/notifications/CommitInfo';
import { buildJobRecoveryRows } from '../src/notifications/JobStats';
import { isThirdPartyUrl } from '../src/error-collector/errorFilters';
import { replayBuild240, loadFixture240 } from './lib/build240Fixture';
import { replayBuild235, buildWorstCaseFixture } from './lib/build235Fixture';
import { replayBuild239 } from './lib/build239Fixture';
import { EmailTemplate } from '../src/notifications/EmailTemplate';
import { RETRY } from '../src/notifications/EmailPalette';
import { allModulesTable, moduleCoverageViolations, normalizeTags } from './check-scenarios';

let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}\n`);
};
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&mdash;/g, '—').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function main(): void {
  const fx = loadFixture240();
  const r = replayBuild240();
  const t = text(r.html);

  // ── the fixture is faithful to the run's email ──
  check(r.report.total === 943 && fx.modules.length === 34 && fx.modules.reduce((n, m) => n + m.total, 0) === 943, 'fixture: 943 tests in 34 modules');
  check(r.subject === '⚠️ STAGING sandbox #240: 942 passed (8 flaky), 1 skipped of 943', 'replay: the subject is the one the run sent', r.subject);
  check(r.report.firstRun.passed === 934 && r.report.firstRun.flaky === 8 && r.report.failed === 0 && r.report.skipped === 1, 'replay: first run 934 passed / 8 flaky / 0 failed / 1 skipped');
  check(r.ctx.miscErrors?.totalErrors === 209 && r.ctx.miscErrors.unexpectedErrors === 72 && r.ctx.miscErrors.expectedRbacErrors === 28 && r.ctx.miscErrors.expectedBackgroundNoiseErrors === 109, 'replay: background errors 209 = 72 unexpected + 28 expected RBAC + 109 known noise, as in the email');
  const flakyFiles = r.report.flakyTests.map((x) => `${x.file.split('/').pop()}:${x.line}`).sort().join(',');
  check(flakyFiles === 'call-logs.spec.ts:56,contacts.spec.ts:149,dashboard.rbac.spec.ts:501,dashboard.rbac.spec.ts:523,deals.rbac.spec.ts:1518,leads.rbac.spec.ts:398,leads.spec.ts:141,meetings.rbac.spec.ts:263', 'replay: the 8 flaky tests are the run\'s (leads.rbac:398, leads.spec:141, meetings.rbac:263, dashboard.rbac:501 and :523, deals.rbac:1518, call-logs.spec:56, contacts.spec:149)', flakyFiles);

  // ── E1: the commit through git, in a full clone, a shallow clone and the failure paths ──
  const urlOf = (sha: string): string => `https://example.test/commit/${sha}`;
  const MERGE = 'aaaaaaaa\u001fakashrn1801\u001fMerge branch \'feature/x\' into sandbox\u001fbbbbbbbb cccccccc';
  const HEAD = 'cccccccc\u001fakashrn1801\u001ffix(email): the feature head\u001fdddddddd';
  const fake = (opts: { parentPresentAtStart: boolean; fetchWorks: boolean; mergeParent?: boolean }): { git: GitRunner; calls: string[][] } => {
    const calls: string[][] = [];
    let present = opts.parentPresentAtStart;
    const git: GitRunner = (args) => {
      calls.push(args);
      if (args[0] === 'show' && args[args.length - 1] === 'aaaaaaaa') return MERGE;
      if (args[0] === 'fetch') {
        if (opts.fetchWorks) present = true;
        return opts.fetchWorks ? '' : undefined;
      }
      if (args[args.length - 1] === 'cccccccc') {
        if (!present) return undefined; // a shallow clone: the parent's object is not there
        if (args[0] === 'log' && opts.mergeParent) return undefined; // --no-merges walks into missing history
        return HEAD;
      }
      return undefined;
    };
    return { git, calls };
  };
  const full = resolveCommit('aaaaaaaa', fake({ parentPresentAtStart: true, fetchWorks: true }).git, urlOf);
  check(full.sha === 'cccccccc' && full.message === 'fix(email): the feature head' && full.merge?.sha === 'aaaaaaaa' && full.merge.into === 'sandbox', 'E1: a full clone shows the feature head commit, "merged into sandbox as <merge>"');
  const shallow = fake({ parentPresentAtStart: false, fetchWorks: true });
  const sh = resolveCommit('aaaaaaaa', shallow.git, urlOf);
  check(sh.sha === 'cccccccc' && sh.merge?.sha === 'aaaaaaaa' && shallow.calls.some((c) => c[0] === 'fetch' && c.includes('--depth=1') && c.includes('cccccccc')), 'E1: a SHALLOW clone (the CI checkout of build #240, no fetch-depth) fetches the second parent on demand and still shows the feature head', JSON.stringify(sh));
  const refused = resolveCommit('aaaaaaaa', fake({ parentPresentAtStart: false, fetchWorks: false }).git, urlOf);
  check(refused.sha === 'aaaaaaaa' && refused.message?.startsWith('Merge branch') === true && refused.merge === undefined, 'E1: when the parent cannot be fetched the email shows the merge commit itself, never a guess');
  const mergeParent = resolveCommit('aaaaaaaa', fake({ parentPresentAtStart: false, fetchWorks: true, mergeParent: true }).git, urlOf);
  check(mergeParent.sha === 'cccccccc', 'E1: a feature head that is itself a merge (its history missing in a shallow clone) is shown as it is');
  check(resolveCommit('zzzz', () => undefined, urlOf).message === null, 'E1: not a git checkout: the link alone');
  const wf = (name: string): string => fs.readFileSync(path.join(__dirname, `../.github/workflows/${name}.yml`), 'utf8');
  const mergeJob = (y: string): string => y.slice(y.indexOf('\n  merge-and-report:'), y.indexOf('uses: actions/setup-node', y.indexOf('\n  merge-and-report:')));
  check(['sandbox', 'qa', 'stage', 'main'].every((n) => /fetch-depth:\s*0/.test(mergeJob(wf(n)))), 'E1: the merge-and-report job of sandbox, qa, stage and main checks out with full history (fetch-depth: 0), where the notify step runs');

  // ── E2: plain words, no setting name ──
  check(!/RERUN_INCLUDE_FLAKY|include_flaky/i.test(t), 'E2: no "RERUN_INCLUDE_FLAKY" in the reader-facing text');
  check(/Nothing was rerun\./.test(t) && /8 tests were not rerun: they had already passed on a retry \(/.test(t), 'E2: "8 tests were not rerun: they had already passed on a retry (...)", plain words', (/Rerun of failed and flaky tests.{0,300}/.exec(t) ?? [''])[0]);

  // ── E3: singular and plural ──
  check(/8 flaky tests are above the budget of 3; review them/.test(t) && !/tests is above/.test(t), 'E3: "8 flaky tests are above the budget of 3; review them"');

  // ── E4: the request age ──
  const now = 1_795_618_000_000;
  check(describeRequestAge(now, 0) === 'at an unknown time' && describeRequestAge(now, -1) === 'at an unknown time' && describeRequestAge(now, undefined) === 'at an unknown time' && describeRequestAge(now, Number.NaN) === 'at an unknown time', 'E4: a missing start time (0, -1, undefined, NaN) is "at an unknown time", not 56 years ("sent 1795618370s ago")');
  check(describeRequestAge(now, now - 12_400) === '12s ago' && describeRequestAge(now, now + 500) === '0s ago', 'E4: a real start time is a plain age, never negative');
  check(!/\d{9,}s ago/.test(describeRequestAge(now, 0)), 'E4: no ten-digit "s ago" can come out of a zero timestamp');

  // ── E5: 429s by host ──
  check(isThirdPartyUrl('POST https://o4507785857335296.ingest.us.sentry.io/api/4508368897114112/envelope/') && !isThirdPartyUrl('PUT https://api.example.test/v1/meetings/14629') && !isThirdPartyUrl('GET /v1/users/me') && !isThirdPartyUrl(undefined), 'E5: Sentry is third party; a Kylas API URL, a bare path and no detail are not');
  const ev = (detail: string | undefined): { kind: string; outcome: string; timestamp: string; detail?: string } => ({ kind: 'api-429', outcome: 'observed', timestamp: '2026-11-25T15:00:00.000Z', ...(detail ? { detail } : {}) });
  const jobs = [{ name: 'playwright-selective (shard 1/5)', startedAt: '2026-11-25T14:07:00Z', completedAt: '2026-11-25T15:42:00Z', durationMs: 1 }];
  const rows = buildJobRecoveryRows(jobs, [{ shard: 'sandbox-1', events: [ev('POST https://o1.ingest.us.sentry.io/api/1/envelope'), ev('POST https://o1.ingest.us.sentry.io/api/1/envelope'), ev('PUT https://api.example.test/v1/meetings/1'), ev(undefined)] }]);
  check(rows[0].rateLimitThirdParty === 2 && rows[0].rateLimitApi === 2, 'E5: per job, Sentry 429s are third-party (2) and the Kylas API ones (a Kylas host, or no host to say otherwise) are counted as real throttling (2)', JSON.stringify([rows[0].rateLimitApi, rows[0].rateLimitThirdParty]));
  const tp = r.ctx.jobStats ? buildJobRecoveryRows(r.ctx.jobStats.jobs, r.ctx.miscErrors?.recoveryByShard) : [];
  check(tp.length === 11 && tp.every((x) => x.rateLimitApi === 0) && tp.reduce((n, x) => n + x.rateLimitThirdParty, 0) === 699, 'E5: in build #240 (every 429 event is a Sentry POST) the Kylas API column is 0 for all 11 test jobs and the 699 events are third-party', JSON.stringify(tp.map((x) => [x.rateLimitApi, x.rateLimitThirdParty])));
  check(/429 Kylas API/.test(r.html.replace(/<[^>]*>/g, ' ')) && /429 third-party/.test(r.html.replace(/<[^>]*>/g, ' ')) && /real throttling; third-party 429s, such as Sentry telemetry sent by the app, are counted apart as noise, not rate limiting of our tests/.test(t), 'E5: Load Signals has "429 Kylas API" and "429 third-party" columns and says what the second one is');
  check(!/429 API/.test(t), 'E5: the old "429 API" column heading is gone');

  // ── E6: every module, UI and RBAC side by side ──
  const mt = allModulesTable(r.html) ?? [];
  const cov240 = moduleCoverageViolations(r.html, fx.modules.map((m) => ({ name: m.name, type: m.type, total: m.total })));
  check(cov240.length === 0, `every module in the results has its row, on its own side, with its own test count (${fx.modules.length} sides: ${[...new Set(fx.modules.map((m) => m.name))].join(', ')})`, cov240.join('; '));
  const byName = new Map(mt.map((x) => [x.name, x]));
  check(mt.length === new Set(fx.modules.map((m) => m.name)).size && /All 34 modules, UI and RBAC side by side/.test(t) && !/passed every test first time/.test(t), 'E6: one row per entity (every module of the 34 is shown), the "27 modules passed every test first time" one-liner is gone', `${mt.length} rows`);
  const dash = byName.get('Dashboard');
  const leads = byName.get('Leads');
  check(JSON.stringify(dash?.UI) === '[33,33,0,0,0,0]' && JSON.stringify(dash?.RBAC) === '[28,26,2,0,0,0]' && JSON.stringify(leads?.UI) === '[40,39,1,0,0,0]' && JSON.stringify(leads?.RBAC) === '[40,39,1,0,0,0]', 'E6: Dashboard (UI 33 | 33 | 0 | 0 | 0 | 0, RBAC 28 | 26 | 2 | 0 | 0 | 0) and Leads (1 retry on each side): tests, first time, retry, rerun, failed, skipped', JSON.stringify([dash, leads]));
  check(JSON.stringify(byName.get('Call-logs')?.UI) === '[29,27,1,0,0,1]' && mt.slice(0, 6).every((x) => [x.UI, x.RBAC].some((sd) => sd && sd[2] + sd[3] + sd[4] > 0)) && mt.slice(6).every((x) => [x.UI, x.RBAC].every((sd) => !sd || sd[2] + sd[3] + sd[4] === 0)), 'E6: the 6 entities with a retry (7 modules) come first, the other rows are clean; Call-logs UI 29 | 27 | 1 | 0 | 0 | 1', mt.slice(0, 9).map((x) => x.name).join(', '));
  check((byName.get('Dashboard')?.bgs ?? []).includes(RETRY.bg.toUpperCase()), 'E6: a cell with a retry is highlighted in the retry yellow');
  const detailRows = (r.html.match(/<td style="padding:8px;font-size:12px;color:#1B1F24;font-weight:500;">/g) ?? []).length;
  check(detailRows === 7 && !/more modules? with failures or flaky tests/.test(t), 'E7: the Module Analytics rows are not capped (all 7 modules with news, no "N more modules" line)', String(detailRows));

  // ── E7: sizes, content kept, nothing lost by the compaction ──
  const kib = (h: string): number => Buffer.byteLength(h) / 1024;
  const cardsIn = (h: string): number => (h.match(/<div id="test-/g) ?? []).length;
  check(kib(r.sent) < 98 && kib(r.html) > kib(r.sent) * 1.3 && cardsIn(r.sent) === 8, `E7: build #240 is ${kib(r.sent).toFixed(1)} KiB as sent (${kib(r.html).toFixed(1)} KiB with every style inline) and keeps all 8 detail cards`);
  const r235 = replayBuild235();
  check(kib(r235.sent) < 100 && cardsIn(r235.sent) === 10, `E7: build #235 is ${kib(r235.sent).toFixed(1)} KiB as sent and keeps all 10 detail cards`);
  const worst = replayBuild235({ fixture: buildWorstCaseFixture() });
  check(cardsIn(worst.sent) >= 80, `E7: the worst case (60 failed, 80 flaky, 790 background errors) keeps every card (${cardsIn(worst.sent)}) and is ${kib(worst.sent).toFixed(1)} KiB as sent (reported, not limited)`);
  const norm = (h: string): string => normalizeTags(h).replace(/Generated [^<·]*·/g, 'Generated ·');
  check(norm(EmailTemplate.expandStyles(new EmailTemplate().html(r.ctx))) === norm(new EmailTemplate().htmlReadable(r.ctx)), 'E7: the email as html() sends it, with its classes expanded, is exactly the readable email (nothing was removed or changed, only moved)');
  check(/<style>[^]*\.x0\{/.test(r.sent) && (r.sent.match(/ class="[^"]*\bx[0-9a-z]+/g) ?? []).length > 500 && !/ style="font-size:12px;color:#1B1F24;padding:6px 0;"/.test(r.sent), 'E7: repeated inline styles are classes of the head <style> block (x0, x1, ...)');
  check(/^[^]*<td style="width:\d+%;background:#[0-9A-Fa-f]{6};/.test(r.sent) && /<img /.test(new EmailTemplate().html(replayBuild239().ctx)) && /<img [^>]*style="[^"]*width:170px/.test(new EmailTemplate().html(replayBuild239().ctx)), 'E7: where a client would otherwise break the style stays inline: tile cells keep their fill, the donut image its size');

  process.stdout.write(`\ncheck:build240 — ${total - failed}/${total} checks pass\n`);
  if (failed > 0) process.exit(1);
}

main();
