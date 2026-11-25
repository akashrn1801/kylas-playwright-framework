/**
 * Offline checks against the REAL build #239 (sandbox, run 45553181980, 2026-11-25), replayed from scripts/fixtures/build-239 through the real
 * pipeline (scripts/lib/build239Fixture.ts). Piece 1 of the build #239 email redesign: the data bugs A1-A7.
 *
 * Run: npm run check:build239
 */
import * as fs from 'fs';
import * as path from 'path';
import { isExpectedBackgroundNoise } from '../src/error-collector/errorFilters';
import { isMergeCommit, mergeTargetBranch, parseCommitFacts } from '../src/notifications/CommitInfo';
import { RunHistoryRecord, computeSlowTestTrend } from '../src/notifications/RunHistory';
import { be, nounFor, plural, wasWere } from '../src/notifications/wording';
import { rerunTiles } from './check-scenarios';
import { loadFixture239, replayBuild239 } from './lib/build239Fixture';

let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}\n`);
};
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/\s+/g, ' ').trim();

function main(): void {
  const fx = loadFixture239();
  const r = replayBuild239();
  const t = text(r.html);
  const real = JSON.parse(fx.files['rerun-summary.original.json']) as { firstRun: Record<string, number>; afterRerun: Record<string, number> };

  // ── the fixture is faithful to the run ──
  check(r.report.total === 943 && fx.modules.reduce((n, m) => n + m.total, 0) === 943 && fx.modules.length === 34, 'fixture: 943 tests in 34 modules');
  check(JSON.stringify(r.summary.firstRun) === JSON.stringify(real.firstRun) && JSON.stringify(r.summary.afterRerun) === JSON.stringify(real.afterRerun), 'fixture: first run (940/1/1/1) and after-rerun counts equal the run\'s own rerun-summary.json', JSON.stringify(r.summary.firstRun));
  check(r.subject === '⚠️ STAGING sandbox #239: 942 passed (1 flaky, 1 on rerun), 1 skipped of 943', 'replay: the subject is the one the run sent', r.subject);

  // ── A1: an expected failure (test.fail(), the Leads RBAC known-bug tests) is a pass, in the report, the history record and the module row ──
  const leadsRbac = r.report.modules.find((m) => m.name === 'Leads' && m.type === 'RBAC');
  check(r.report.firstRun.passed === 940 && r.report.firstRun.failed === 1 && r.report.firstRun.flaky === 1, 'A1: the parsed first run is 940 passed / 1 failed / 1 flaky (it was 937 / 4 / 1)', JSON.stringify(r.report.firstRun));
  check(leadsRbac?.firstRun.failed === 0 && leadsRbac.firstRun.passed === 40, 'A1: Leads RBAC has no failed-first test (3 test.fail() tests are expected failures)', JSON.stringify(leadsRbac?.firstRun));
  check(r.record.passed === 940 && r.record.failed === 1 && r.record.modules.find((m) => m.name === 'Leads' && m.type === 'RBAC')?.failed === 0, 'A1: the history record stores 940 / 1 and Leads RBAC with 0 failed');
  check(!/unstable this run: 3 of 40/.test(t) && !/3 failed first/.test(t), 'A1: the email no longer says Leads RBAC "3 of 40 (3 failed first)"');
  check(r.report.passRate === 99.7, 'A1: Passed first time is 99.7% (940 of 943), not 99.4%', String(r.report.passRate));

  // ── A2: the cause line counts the test that failed every attempt ──
  check(!/none failed outright/.test(t) && /failed every attempt and passed on the rerun/.test(t), 'A2: the cause line names the test that failed every attempt and passed only on the rerun', (/Suspected cause of the[^.]*\./.exec(t) ?? [''])[0]);

  // ── A3: a slowdown of the whole run is not a regression per test ──
  const flagged = (r.ctx.slowTestTrend ?? []).filter((x) => x.regression).length;
  check(flagged === 0 && !/performance regression/.test(t), 'A3: 0 performance regressions in build #239 (every slow test was 0-54% slower while the whole run was slower; it was 13)', String(flagged));
  const rec = (slow: Array<[string, number]>): RunHistoryRecord => ({ slowestTests: slow.map(([title, duration]) => ({ title, duration })) } as unknown as RunHistoryRecord);
  const many = (f: number, extra: Array<[string, number]> = []): Array<[string, number]> => [...[1, 2, 3, 4, 5, 6].map((i): [string, number] => [`t${i}`, 100_000 * f]), ...extra];
  const prior = [rec(many(1, [['outlier', 100_000]]))];
  const slowed = computeSlowTestTrend(prior, [...many(1.4).map(([title, duration]) => ({ title, duration })), { title: 'outlier', duration: 300_000 }]);
  check(slowed.filter((x) => x.regression).map((x) => x.title).join() === 'outlier', 'A3: with the whole run 40% slower, only the test that is 3x slower than before is a regression');
  const small = computeSlowTestTrend([rec([['quick', 40_000]])], [{ title: 'quick', duration: 55_000 }]);
  check(!small[0].regression, 'A3: a rise under a minute is not a regression even at +37%');
  const stale = computeSlowTestTrend([rec([['old', 100_000]]), ...Array.from({ length: 5 }, () => rec([]))], [{ title: 'old', duration: 500_000 }]);
  check(stale[0].previousDuration === null && !stale[0].regression, 'A3: an appearance older than the last 5 runs is not compared');

  // ── A4 / A5 ──
  check(r.report.projects.join() === 'chromium' && /Browsers tested\s*\|?\s*chromium(?![,\s]*chromium)/.test(t.replace(/\|/g, ' ')) , 'A4: the browser is listed once (the merged report has 11 shard configs)', r.report.projects.join());
  check(plural(1, 'test') === '1 test' && plural(2, 'test') === '2 tests' && plural(1, 'retry', 'retries') === '1 retry' && be(1) === 'is' && be(2) === 'are' && wasWere(1) === 'was' && nounFor(0, 'error') === 'errors', 'A5: the wording helpers agree with the count');
  check(!/\(s\)/.test(r.html) && !/\b1 (?:tests|errors|failures|shards|hours|days)\b/.test(t) && !/\b1 are\b|\b1 were\b/.test(t), 'A5: no "(s)", no "1 tests", no "1 are/were" anywhere in the email');

  // ── A6: a merge into the run's branch shows the feature head commit ──
  const merge = parseCommitFacts("f3dee9ed9cbb88b014fbaa8d7f19a62b98b4e75a\u001fakashrn1801\u001fMerge branch 'feature/framework-hardening-20261104' into sandbox\u001f061c53ec08869e292cbc3a7138e057feb4df5063 5a1c0de0b2d94f7e8a1b3c4d5e6f708192a3b4c5");
  check(!!merge && isMergeCommit(merge) && merge.parents[1].startsWith('5a1c0de') && mergeTargetBranch(merge.subject) === 'sandbox', 'A6: a two-parent "Merge branch ... into sandbox" commit is a merge; its second parent is the feature head; the target branch is read from the subject');
  const plain = parseCommitFacts('abc\u001fdev\u001ffix: a change\u001fdef');
  check(!!plain && !isMergeCommit(plain), 'A6: an ordinary commit (and a one-parent "Merge"-looking subject) is not a merge');
  check(/Sample feature commit subject/.test(t) && /merged into sandbox as/.test(t) && !/Merge branch/.test(t), 'A6: the email shows the feature head commit and "merged into sandbox as <sha>"');

  // ── A7: "no pipeline attached" is app behaviour for a record without a pipeline ──
  const body404 = '{"timestamp":null,"code":"01001007","message":"Uhoh! There is no pipeline attached with the deal. Attach a pipeline and try again.","errorDetails":null}';
  const body400 = '{"code":"002056","message":"Uhoh! There is no pipeline attached with the lead. Attach a pipeline and try again.","errorDetails":[]}';
  check(isExpectedBackgroundNoise('HTTP 404 [GET] https://api.example.test/v1/deals/110097/pipeline', 'https://api.example.test/v1/deals/110097/pipeline', body404) && isExpectedBackgroundNoise('HTTP 400 [GET] https://api.example.test/v1/leads/179051/pipeline', 'https://api.example.test/v1/leads/179051/pipeline', body400), 'A7: both "no pipeline attached" responses (deal 404 01001007, lead 400 002056) are known background noise');
  check(!isExpectedBackgroundNoise('HTTP 500 [GET] https://api.example.test/v1/deals/1/pipeline', 'https://api.example.test/v1/deals/1/pipeline', '{"message":"Internal error"}') && !isExpectedBackgroundNoise('HTTP 400 [GET] https://api.example.test/v1/leads/1/other', 'https://api.example.test/v1/leads/1/other', body400), 'A7: a 5xx on the same endpoint, or the same message on another URL, stays unexpected');
  check(fx.misc.unexpectedErrors === 27 && fx.misc.expectedBackgroundNoiseErrors === 103, 'A7: build #239 has 27 unexpected errors (it was 120) and 103 known noise (it was 10)', `${fx.misc.unexpectedErrors} / ${fx.misc.expectedBackgroundNoiseErrors}`);
  check(/27 unexpected/.test(t), 'A7: the email reports 27 unexpected background errors');

  const rt = rerunTiles(r.html);
  check(!!rt && rt['Rerun']?.value === '1' && rt['Passed on rerun']?.value === '1' && rt['Still failing']?.value === '0' && rt['Not rerun']?.value === '1' && rt['Not rerun']?.sub === 'passed on retry' && rt['Rerun duration']?.value === '1m 4s', 'Rerun Summary tiles for #239: Rerun 1 | Passed on rerun 1 | Still failing 0 | Not rerun 1 (passed on retry) | 1m 4s', JSON.stringify(rt));
  check(r.html.indexOf('Run Summary</div>') < r.html.indexOf('How the run ended</div>') && r.html.indexOf('How the run ended</div>') < r.html.indexOf('Rerun Summary</div>') && r.html.indexOf('Rerun Summary</div>') < r.html.indexOf('id="section-rerun"'), 'Rerun Summary tiles are the right half of the "How the run ended" card, under the Run Summary tiles');

  // ── piece A (visual polish): the colour system, contrast, mobile rules ──
  const src = fs.readFileSync(path.join(__dirname, '../src/notifications/EmailTemplate.ts'), 'utf8');
  const hex = (n: string): string => src.match(new RegExp(`const ${n} = '(#[0-9A-Fa-f]{6})'`))?.[1] ?? '';
  const lum = (h: string): number => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const fills: Record<string, string> = { green: hex('SUCCESS'), amber: hex('WARN'), red: hex('FAIL'), blue: hex('ACCENT'), grey: '#6E7781' };
  check(Object.entries(fills).every(([, c]) => contrast(c, '#FFFFFF') >= 4.5), 'polish: white text on every tile fill (green, amber, red, blue, grey) is at least 4.5:1 (WCAG AA)', Object.entries(fills).map(([k, c]) => `${k} ${contrast(c, '#FFFFFF').toFixed(2)}`).join(', '));
  const tileFill = (label: string): string => {
    for (const chunk of r.html.split('<td style="width:').slice(1)) {
      if (new RegExp(`<div class="tl"[^>]*>${label}</div>`).test(chunk)) return /background:(#[0-9A-Fa-f]{6})/.exec(chunk)?.[1] ?? '';
    }
    return '';
  };
  check(tileFill('Failed') === '#6E7781' && tileFill('Still failing') === '#6E7781', 'polish: a zero Failed / Still failing tile is grey, not red', `${tileFill('Failed')} / ${tileFill('Still failing')}`);
  check(tileFill('Passed') === fills.green && tileFill('Total') === fills.blue && tileFill('Flaky') === fills.amber, 'polish: Passed is green, Total is blue (information), Flaky is amber', `${tileFill('Passed')} ${tileFill('Total')} ${tileFill('Flaky')}`);
  check(tileFill('Skipped') === '#6E7781' && tileFill('Skipped') !== fills.amber, 'polish: the Skipped tile (1 skipped test) is slate grey, not amber: skipped is deliberate, amber is for retry, rerun and flaky');
  check(!/class="tv"[^>]*><code>/.test(r.html) && !/class="tv"[^>]*><a[^>]*><code>/.test(r.html) && (r.html.match(/class="tv"/g) ?? []).length >= 14, 'polish: tile numbers are bold sans-serif text, not <code> / monospace');
  check(/@media only screen and \(max-width: 480px\)/.test(r.html) && (r.html.match(/class="kpi"/g) ?? []).length >= 14 && /class="mh"/.test(r.html), 'polish: the mobile rules are there (tiles two per row, side padding, secondary table columns hidden at 375 px)');
  check(!/<script|display:flex|display:grid|position:(?:absolute|fixed)/i.test(r.html), 'polish: no script, flex, grid or absolute positioning in the email');

  // ── wording: singular, and plain words for the retry (2026-11-25) ──
  check(r.ctx.verdict?.headline === 'Likely ready for a PR to dev — but 1 test failed every attempt and passed only on the rerun; review it', 'wording: "1 test ... passed only on the rerun; review it" (singular), not "review them"', r.ctx.verdict?.headline);
  check(/942 of 943 tests passed in the end: 1 passed on its retry and 1 only on the rerun — not clean the first time\./.test(t) && !/in-job retry \(flaky\)/.test(t.slice(t.indexOf('Executive Summary'), t.indexOf('Run Details'))), 'wording: the summary says "1 passed on its retry and 1 only on the rerun", not "after an in-job retry (flaky)"');
  check(/Likely ready for a PR to dev/.test(t) && !/promote to/.test(t), 'branch: the sandbox build #239 email names the PR to dev');

  // ── layout of "How the run ended": legend beside the donut, both halves vertically centred ──
  const card = r.html.slice(r.html.indexOf('id="section-outcome-chart"'), r.html.indexOf('id="section-outcome-chart"') + 4000);
  const dn = card.match(/<td class="dn" valign="middle"/g) ?? [];
  check(dn.length === 2 && card.indexOf('<img') < card.lastIndexOf('class="lt"') && /<td class="col" width="40%" valign="middle"/.test(card) && /<td class="col" width="60%" valign="middle"/.test(card), 'layout: the legend sits beside the donut (one nested row, donut first) and both outer halves (40% / 60%) are vertically centred');

  process.stdout.write(`\ncheck:build239 — ${total - failed}/${total} checks pass\n`);
  if (failed > 0) process.exit(1);
}

main();
