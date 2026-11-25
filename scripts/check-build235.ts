/**
 * Offline checks of the email against the REAL build #235 (sandbox, run 45122485029), replayed from the committed fixture in
 * scripts/fixtures/build-235 through the real pipeline (scripts/lib/build235Fixture.ts). Commit 1 of the email fixes
 * (2026-11-24): rerun counting (ADR 0015 amendment), load signals, pass-rate series, module labels, background-error
 * reconciliation, cause wording, per-test "not rerun" reasons, skip reasons.
 *
 * Run: npm run check:build235
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildJobRecoveryRows } from '../src/notifications/JobStats';
import { RunHistoryRecord, buildPassRateSeries } from '../src/notifications/RunHistory';
import { BUILD_235, SKIP_REASON_AFTER, loadFixture, replayBuild235 } from './lib/build235Fixture';
import { RenewalFailure } from '../src/auth/renewalFailure';

let failed = 0;
let total = 0;
const check = (ok: boolean, name: string, detail = ''): void => {
  total += 1;
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `\n      ${detail}` : ''}\n`);
};
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&rarr;/g, '->').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function main(): void {
  const fx = loadFixture();
  const r = replayBuild235();
  const html = r.html;
  const t = text(html);

  // ── the fixture is faithful to the run's own counts ──
  const original = JSON.parse(fx.files['rerun-summary.original.json']) as { firstRun: Record<string, number>; rows: { key: string; first: string; rerun: string }[]; excluded: unknown[]; candidates: number };
  check(r.report.total === 943 && fx.modules.reduce((n, m) => n + m.total, 0) === 943 && fx.modules.length === 34, 'fixture: 943 tests in 34 modules');
  check(JSON.stringify(r.summary.firstRun) === JSON.stringify(original.firstRun), 'fixture: first-run counts equal the run\'s own rerun-summary.json (932 / 4 / 6 / 1 skipped)', JSON.stringify(r.summary.firstRun));
  check(JSON.stringify(r.summary.rows.map((x) => x.key).sort()) === JSON.stringify(original.rows.map((x) => x.key).sort()), 'fixture: the 4 rerun rows have the same keys (file, line, suite path, title) as the run\'s own summary');
  check(r.summary.excluded.length === original.excluded.length && r.summary.candidates === original.candidates, 'fixture: 4 candidates and 6 excluded flaky tests, as in the run');
  check(r.subject === '❌ STAGING sandbox #235: 2 failed, 940 passed (6 flaky, 2 on rerun) of 943' && r.ctx.health?.score === 74 && r.ctx.health.label === 'Needs Attention', 'replay: the subject is the factual form (2 failed, 940 passed (6 flaky, 2 on rerun) of 943) and the health score is that of the real email (Needs Attention 74/100), now in the body', r.subject);

  // ── item 1: after the rerun, a rerun pass is a pass ──
  check(JSON.stringify([r.summary.afterRerun.passed, r.summary.afterRerun.failed, r.summary.afterRerun.flaky]) === JSON.stringify([940, 2, 0]), 'Final result: Passed 940 / Failed 2 / Flaky 0 (every test that ultimately passed is Passed: 932 clean + 6 after an in-job retry + 2 after the rerun)', JSON.stringify(r.summary.afterRerun));
  check(r.report.passed === 934 && r.report.failed === 2 && r.report.flaky === 6 && r.report.skipped === 1, 'item 1: the parsed report (email tiles, verdict, health) uses the after-rerun counts', `${r.report.passed}/${r.report.failed}/${r.report.flaky}`);
  check(r.report.firstRun.passed === 932 && r.report.firstRun.failed === 4 && r.report.firstRun.flaky === 6, 'item 1: the first-run view is kept in the parsed report (932 / 4 / 6)', JSON.stringify(r.report.firstRun));
  check(r.report.passRate === 98.8, 'item 1: "Passed first time" stays the first-run figure, 932 of 943 = 98.8% (e700d3a: never 100% while a test did not pass first time)', String(r.report.passRate));
  const rows = Object.fromEntries(r.summary.rows.map((x) => [x.title, x]));
  check(rows['restricted user should reschedule their own meeting']?.final === 'passed' && rows['restricted should verify meeting report count matches actual filtered entity count on own reports']?.final === 'passed', 'item 1: the two tests that failed first and passed on the rerun are Passed (final)');
  check(t.includes('First run Final result') && /Passed 932 940 \(6 after a retry, 2 after the rerun\)/.test(t), 'Final result: the rerun table says First run 932 -> Final result 940 (6 after a retry, 2 after the rerun)');
  check(t.includes('Failed 4 2') && /Flaky 6 0 \(the 6 ended Passed\)/.test(t), 'Final result: ... Failed 4 -> 2 and Flaky 6 -> 0 "(the 6 ended Passed)"');
  check((t.match(/Passed on rerun/g) ?? []).length >= 4, 'item 1: per-test Final says "Passed on rerun"');
  check(!t.includes('recovered on rerun') && !t.includes('Flaky - recovered'), 'item 1: no "recovered on rerun" / "Flaky - recovered" wording is left');
  check(r.report.status === 'failed' && r.ctx.verdict?.verdict === 'blocked', 'item 1: the run is still red (2 tests failed after the rerun)');
  check(html.includes('id="section-passed-on-rerun"') && /Passed on rerun \(2\)/.test(t), 'item 1: the 2 tests that passed on the rerun are listed with their first-run failure in a "Passed on rerun (2)" section');
  check(/Flaky Tests \(6\)/.test(t), 'item 1: the Flaky Tests section lists the 6 that are flaky after the rerun');
  check(r.ctx.health?.score === 74, 'item 1 / D3: the health score stays 74 (a test that passed only on the rerun still weighs in the Flakiness factor)', String(r.ctx.health?.score));
  const rec = r.record;
  check(rec.passed === 932 && rec.failed === 4 && rec.flaky === 6 && rec.skipped === 1, 'item 1 / D4: the history record keeps the FIRST-RUN counts (932 / 4 / 6 / 1)', `${rec.passed}/${rec.failed}/${rec.flaky}/${rec.skipped}`);
  check(JSON.stringify(rec.afterRerun) === JSON.stringify({ passed: 940, failed: 2, flaky: 0 }), 'item 1 / D4: ... and the Final result is in afterRerun (940 / 2 / 0)', JSON.stringify(rec.afterRerun));
  check(rec.flakyTestTitles.length === 8 && rec.failedTestTitles.length === 2 && (rec.recoveredOnRerunTitles ?? []).length === 2, 'item 1 / D4: flakyTestTitles keeps the 2 that passed only on the rerun (8), failedTestTitles = the 2 still failing');
  const meetingsRbac = rec.modules.find((m) => m.name === 'Meetings' && m.type === 'RBAC');
  check(!!meetingsRbac && meetingsRbac.passed === 9 && meetingsRbac.flaky === 2 && meetingsRbac.failed === 1, 'item 1 / D4: per-module history counts are the first run too (Meetings RBAC 9 passed, 2 flaky, 1 failed)', JSON.stringify(meetingsRbac));

  // ── item 3: the pass-rate series ──
  const series = r.ctx.passRateSeries ?? [];
  const nums = series.map((p) => Number(p.buildNumber));
  check(!nums.includes(214), 'item 3: build #214 (a `stage` run, another workflow\'s counter) is not in the sandbox series', nums.join(' '));
  check(nums.every((n, i) => i === 0 || n > nums[i - 1]) && nums[nums.length - 1] === 235, 'item 3: the series is in increasing order and ends with the current build', nums.join(' '));
  const mixed: RunHistoryRecord[] = [
    { ...fx.history[0], buildNumber: '231', branch: 'sandbox', timestamp: '2026-11-19T17:49:23.943Z' },
    { ...fx.history[0], buildNumber: '214', branch: 'stage', timestamp: '2026-11-20T07:26:04.404Z' },
    { ...fx.history[0], buildNumber: '100', branch: 'sandbox', timestamp: '2026-11-21T00:00:00.000Z' },
  ];
  const cur: RunHistoryRecord = { ...fx.history[0], buildNumber: '235', branch: 'sandbox', timestamp: '2026-11-23T06:14:52.534Z' };
  check(JSON.stringify(buildPassRateSeries(mixed, cur).map((p) => p.buildNumber)) === JSON.stringify(['231', '100', '235']), 'item 3: sorted by run time, not by file position or build number across workflows; other branches left out');

  // ── item 4: module analytics ──
  const rowOf = (name: string, type: string): string => {
    const rowsHtml = html.split('<tr style="border-bottom:1px solid').filter((x) => x.includes(`>${name}</td>`) && x.includes(`>${type}</span>`));
    return text(rowsHtml[0] ?? '');
  };
  const mr = rowOf('Meetings', 'RBAC');
  check(/unstable this run: 3 of 12 \(1 failed first, 2 flaky\)/.test(mr), 'item 4: Meetings RBAC (3 of 12 unstable this run) says so in words', mr);
  check(!/– stable/.test(t) && !/stable \(\d+% unstable/.test(t), 'item 4: no bare "– stable (N% unstable / last N)" badge is left');
  check(/last \d+ runs: \d+% unstable, /.test(mr), 'item 4: the rolling window has its own label ("last N runs: N% unstable, ...")', mr);
  check(/clean this run/.test(rowOf('Call-logs', 'RBAC')), 'item 4: a module with nothing unstable says "clean this run"');
  check(html.includes('>vs last run</th>') && html.includes('>Stability</th>'), 'item 4: the Trend column is split into "vs last run" and "Stability"');

  // ── Final result rule (second amendment of ADR 0015, 2026-11-24): tiles, executive summary, modules, subject ──
  const tileText = (label: string): string => (t.match(new RegExp(`(\\d+) ${label}.{0,90}`)) ?? [])[0] ?? '';
  check(r.report.finalPassed === 940 && /^940 Passed 6 after a retry, 2 after the rerun/.test(tileText('Passed')), 'tiles: Passed 940 "6 after a retry, 2 after the rerun"', tileText('Passed'));
  check(/Total.*943/.test(t) || t.includes('943 Total'), 'tiles: Total 943');
  check(/\b2 Failed\b/.test(t) && /\b1 Skipped\b/.test(t), 'tiles: Failed 2 and Skipped 1');
  check(940 + 2 + 1 === 943 && r.report.finalPassed + r.report.failed + (r.report.skipped - r.report.didNotRun) + r.report.didNotRun === r.report.total, 'tiles: Passed + Failed + Skipped (+ Did not run) add up to the total');
  check(/\b6 Flaky passed on an in-job retry \(inside Passed\); \+2 passed only on the rerun/.test(t), 'tiles: a "Flaky 6" signal stays, marked as inside Passed, with the 2 that passed only on the rerun');
  check(/940 of 943 tests passed in the end: 6 after an in-job retry \(flaky\) and 2 after the rerun/.test(t) && /2 tests failed\./.test(t), 'executive summary: "2 tests failed" and "940 of 943 tests passed in the end: 6 after an in-job retry (flaky) and 2 after the rerun"');
  const mr2 = rowOf('Meetings', 'RBAC');
  check(/Meetings RBAC 12 3 needed a retry or rerun/.test(mr2) && !html.includes('>Flaky</th>') && html.includes('>Pass (final)</th>'), 'modules: Meetings RBAC Pass (final) 12 with "3 needed a retry or rerun" inside it; no separate Flaky column', mr2);
  check(r.report.passRate === 98.8 && /98\.8%/.test(t) && /Passed first time/.test(t), 'signals kept: "Passed first time" 98.8%, and the Flaky Tests section still lists each flaky test with its error');

  // ── item 5: background errors reconcile ──
  check(fx.misc.totalErrors === 158 && fx.misc.unexpectedErrors === 123 && fx.misc.expectedRbacErrors === 26 && fx.misc.expectedBackgroundNoiseErrors === 9, 'item 5: the run\'s misc errors are 158 = 123 unexpected + 26 expected RBAC + 9 known background noise');
  check(t.includes('123 unexpected + 26 expected RBAC + 9 known background noise = 158 total') && t.includes('9 known background noise'), 'item 5: the email shows that sum and a chip for the 9 known-noise errors');
  check(r.ctx.health?.factors.some((f) => /123 unexpected background/.test(f.note)) === true, 'item 5: the health score counts only the 123 unexpected errors (capped at 8 points), never the known noise');

  // ── item 6: cause wording ──
  check(t.includes('Suspected cause of the 2 failures and 8 flaky tests (hints, not verdicts)') && !/the 10 failures/.test(t), 'item 6: "Suspected cause of the 2 failures and 8 flaky tests", not "the 10 failures"');
  check(t.includes('of the 8 flaky tests, 6 passed on a retry and 2 passed only on the rerun'), 'item 6: ... and says how the 8 flaky tests passed');

  // ── item 11: per-test reasons ──
  check(/6 failed\/flaky test\(s\) were not rerun; their first-run result stands/.test(t) && /6 — the run has failed tests: only those are rerun, flaky tests are not: /.test(t), 'item 11: "not rerun" names the reason that applied, with the tests');
  check(!t.includes('form-field suites are never rerun; when the run has failed tests'), 'item 11: the old sentence listing every possible reason is gone');

  // ── item 2: load signals ──
  const events = [
    { kind: 'rate-limit-page', outcome: 'failed', timestamp: '2026-11-23T06:40:00.000Z' },
    { kind: 'api-429', outcome: 'observed', timestamp: '2026-11-23T06:41:00.000Z' },
    { kind: 'api-429', outcome: 'observed', timestamp: '2026-11-23T06:42:00.000Z' },
    { kind: 'error-boundary-page', outcome: 'failed', timestamp: '2026-11-23T06:43:00.000Z' },
  ];
  const jobs = r.ctx.jobStats!.jobs;
  const recRows = buildJobRecoveryRows(jobs, [
    { shard: 'sandbox-2', events },
    { shard: 'sandbox-rerun', events: [{ kind: 'api-429', outcome: 'observed', timestamp: '2026-11-23T07:50:00.000Z' }] },
  ]);
  const shard2 = recRows.find((x) => x.jobName === 'playwright-selective (shard 2/5)');
  const rerunRow = recRows.find((x) => /rerun/.test(x.jobName));
  check(!!shard2 && shard2.rateLimitPages === 1 && shard2.rateLimitApi === 2 && shard2.errorBoundaryPages === 1 && shard2.failedAfterRecovery === 2, 'item 2: page 429s, API 429s and error-boundary pages are counted per job', JSON.stringify(shard2));
  check(!!rerunRow && rerunRow.attributed && rerunRow.rateLimitApi === 1, 'item 2: the rerun job is matched to its shard label ("sandbox-rerun"), no longer "(no shard data)"', JSON.stringify(rerunRow));
  check(/429 API/.test(t), 'item 2: the Load Signals table has a "429 API" column');
  // the ErrorCollector records a 429 response although "HTTP 429" is a noise pattern (it is still not listed as an error)
  const cwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec429-'));
  process.chdir(dir);
  process.env.TEST_WORKER_INDEX = '97';
  process.env.ENV = 'staging';
  try {
    // loaded only now: the collector fixes its output paths from the current directory when first imported
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ErrorCollector } = require('../src/error-collector/ErrorCollector') as typeof import('../src/error-collector/ErrorCollector');
    ErrorCollector.reset();
    ErrorCollector.capture({ type: 'response-error', message: 'HTTP 429 [PUT] https://api.example.test/v1/meetings/14629?x=1', url: 'https://api.example.test/v1/meetings/14629?x=1', method: 'PUT', statusCode: 429 });
    ErrorCollector.capture({ type: 'response-error', message: 'HTTP 429 [PUT] https://api.example.test/v1/meetings/14629?x=1', url: 'https://api.example.test/v1/meetings/14629?x=1', method: 'PUT', statusCode: 429 });
    const rep = ErrorCollector.getReport();
    const ev = rep.recoveryEvents ?? [];
    check(ev.length === 1 && ev[0].kind === 'api-429' && ev[0].outcome === 'observed' && ev[0].detail === 'PUT https://api.example.test/v1/meetings/14629', 'item 2: ErrorCollector records an API 429 as a load event (same response seen twice within 2 s = one event, query string not stored)', JSON.stringify(ev));
    check(rep.totalErrors === 0 && rep.unexpectedErrors === 0, 'item 2: ... and the 429 is still NOT an error entry (it stays out of the unexpected count)', String(rep.totalErrors));
  } finally {
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ── item 12: skip reasons ──
  check(t.includes('No reason given'), 'item 12: build #235\'s own report (a bare test.skip) still shows "No reason given" (that is the bug being fixed in the spec)');
  const withReason = replayBuild235({ withSkipReason: true });
  check(text(withReason.html).includes(SKIP_REASON_AFTER), 'item 12: with the skip-reason annotation the Skipped Tests section shows the reason');
  check(!text(withReason.html).includes('No reason given'), 'item 12: ... and "No reason given" is gone');
  const callLogs = fs.readFileSync(path.resolve(__dirname, '../tests/ui/call-logs/call-logs.spec.ts'), 'utf8');
  check(/test\.skip\(\s*'@regression admin should see validation errors[^']*',\s*\{\s*annotation:\s*\{\s*type: 'skip-reason'/.test(callLogs), 'item 12: tests/ui/call-logs/call-logs.spec.ts carries the skip-reason annotation');

  // ── item 3 of the renew-session block (2026-11-24): a failed renew-session job is named, not "Incomplete run" ──
  const renewal: RenewalFailure = {
    version: 1, role: 'admin', kind: 'not-renewed-after-logout', minutesLeft: 37, endIso: '2026-11-24T15:42:07.402Z', windowMin: 240,
    sameSession: true, oldTokenStatusAfterLogout: 200, message: 'The admin session has only 37 min left after logout and a fresh login', at: '2026-11-24T15:05:00.000Z',
  };
  const blocked = replayBuild235({ blockedBySession: { renewalFailure: renewal, cause: 'renew-session:failure' } });
  const bt = text(blocked.html);
  check(blocked.ctx.verdict?.verdict === 'blocked' && blocked.ctx.verdict.bannerLabel === '🚫 BLOCKED — admin session not renewed', 'renew-session failure: the verdict is blocked with the label "BLOCKED — admin session not renewed"', blocked.ctx.verdict?.bannerLabel);
  check(blocked.subject.includes('BLOCKED — ADMIN SESSION NOT RENEWED') && !blocked.subject.includes('INCOMPLETE'), 'renew-session failure: the subject says BLOCKED — ADMIN SESSION NOT RENEWED, not INCOMPLETE', blocked.subject);
  check(bt.includes('No test ran — The admin session had only 37 min left (a run needs 240 min)') && bt.includes('ending 2026-11-24T15:42:07.402Z'), 'renew-session failure: the headline states no test ran, the minutes left, the window and when the session ends');
  check(bt.includes('Incomplete run: 0 of 11 shards reported — no test job started') && bt.includes('The test jobs need that job, so all 11 were skipped, not crashed') && bt.includes('renew-session'), 'renew-session failure: the incomplete-run banner names renew-session and says the jobs were skipped, not crashed');
  check(!bt.includes('crashed, hung or was cancelled'), 'renew-session failure: the banner does not claim a job crashed or hung');
  const causeOnly = replayBuild235({ blockedBySession: { cause: 'renew-session:failure' } });
  check(causeOnly.ctx.verdict?.bannerLabel === '🚫 BLOCKED — renew-session job failed' && causeOnly.subject.includes('BLOCKED — RENEW-SESSION JOB FAILED') && text(causeOnly.html).includes('The renew-session job did not succeed: failure'), 'renew-session failure with only the job result (artifact missing): still BLOCKED, naming the job');
  const crashed = replayBuild235({ blockedBySession: {} });
  check(crashed.ctx.verdict?.bannerLabel.startsWith('🚫 Incomplete Run') === true && text(crashed.html).includes('crashed, hung or was cancelled') && !text(crashed.html).includes('renew-session'), 'a real incomplete run (no renew-session cause) keeps the old "Incomplete run ... crashed, hung or was cancelled" wording');
  check(!r.html.includes('no test job started') && r.subject.includes('2 failed'), 'a normal run (build #235) is unchanged by the renew-session wording');

  process.stdout.write(failed === 0 ? `\ncheck:build235 — all ${total} checks passed\n` : `\ncheck:build235 — ${failed} of ${total} check(s) FAILED\n`);
  process.exitCode = failed === 0 ? 0 : 1;
  void BUILD_235;
}

main();
