/**
 * Scenario matrix for the reporting logic (2026-11-24): about 40 described runs go through the REAL pipeline (selection, combine, parser,
 * history, verdict, health, subject, HTML), and the same invariants are asserted on every one, from a reader's point of view: the numbers
 * agree everywhere, a failure is never green, flaky tests stay visible, a run where nothing ran never claims a pass rate, and the email
 * stays small enough for Gmail. Each scenario is also rendered to HTML so it can be read in a browser.
 *
 *   npm run check:scenarios                       checks, prints the matrix
 *   npx ts-node scripts/check-scenarios.ts --out ~/build235-render/scenarios     also writes <name>.html, index.html, matrix.md
 *
 * An invariant that fails on something this suite has already found and the maintainer has not decided on yet is listed as KNOWN (with
 * the reason) and does not fail the run; every other violation fails it. Remove an entry from KNOWN when its fix lands.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RenewalFailure } from '../src/auth/renewalFailure';
import { EmailTemplate } from '../src/notifications/EmailTemplate';
import { FLAKY_BUDGET } from '../src/notifications/AutomationHealth';
import { Def, SKIP_REASON_TEXT, ScenarioResult, ScenarioSpec, def, many, runScenario } from './lib/scenarioKit';
import { replayBuild235 } from './lib/build235Fixture';

// ── the matrix ─────────────────────────────────────────────────────────────────────────────────────────────────
const base = (n: number): Def[] => many(n, 'passed', 'base check', 'ui/base/base.spec.ts', 10);
const Q = 'ui/quotations/quotations.spec.ts';
const FF = 'ui/formFields/leadFieldLimits.spec.ts';
const renewal: RenewalFailure = {
  version: 1, role: 'admin', kind: 'not-renewed-after-logout', minutesLeft: 37, endIso: '2026-11-24T15:42:07.402Z', windowMin: 240,
  sameSession: true, oldTokenStatusAfterLogout: 200, message: 'The admin session has only 37 min left after logout and a fresh login', at: '2026-11-24T15:05:00.000Z',
};
const dec = (failing: string[]) => (title: string): 'passed' | 'failed' => (failing.includes(title) ? 'failed' : 'passed');

export const SCENARIOS: ScenarioSpec[] = [
  { name: '01-all-pass-first-time', title: 'All tests pass first time', expect: 'green PASSED, nothing else to say', first: base(30), rerun: true },
  { name: '02-flaky-only-rerun-passes', title: 'Only flaky tests; the rerun passes them', expect: 'no failure; flaky stay visible; see the green-or-amber question in the report', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: true },
  { name: '03-flaky-only-rerun-fails-one', title: 'Only flaky tests; one fails on the rerun', expect: 'still no failure (it passed on its in-job retry); amber', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: true, rerunResult: dec(['flaky 02']) },
  { name: '04-flaky-only-no-rerun', title: 'Only flaky tests; no rerun (kill switch / other branch)', expect: 'amber, flaky visible', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: false },
  { name: '05-failures-pass-on-rerun', title: 'Two failures; both pass on the rerun', expect: 'no failure left, but amber (they failed every first attempt)', first: [...base(25), ...many(2, 'failed', 'broken')], rerun: true },
  { name: '06-failures-fail-again', title: 'Two failures; both fail on the rerun', expect: 'red FAILED, 2 failed', first: [...base(25), ...many(2, 'failed', 'broken')], rerun: true, rerunResult: () => 'failed' },
  { name: '07-failures-mixed', title: 'Three failures; one passes on the rerun, two fail', expect: 'red, 2 failed, 1 passed on rerun', first: [...base(25), ...many(3, 'failed', 'broken')], rerun: true, rerunResult: dec(['broken 02', 'broken 03']) },
  { name: '08-failures-plus-flaky', title: 'Failures plus flaky tests (flaky not rerun because failures exist, like build #235)', expect: 'red; flaky inside Passed', first: [...base(25), ...many(2, 'failed', 'broken'), ...many(3, 'flaky', 'flaky')], rerun: true, rerunResult: dec(['broken 02']) },
  { name: '09-serial-file-failure', title: 'A failed test inside a serial file (the whole file is rerun)', expect: 'dependents did not run, then ran only on the rerun', first: [...base(20), def(Q, 'q0 passes', 4, 'passed'), def(Q, 'q1 fails', 5, 'failed'), def(Q, 'q2 dependent', 6, 'did-not-run'), def(Q, 'q3 dependent', 7, 'did-not-run')], rerun: true },
  { name: '10-serial-file-failure-fails-again', title: 'A failed test inside a serial file; it fails again', expect: 'red; dependents fail too', first: [...base(20), def(Q, 'q0 passes', 4, 'passed'), def(Q, 'q1 fails', 5, 'failed'), def(Q, 'q2 dependent', 6, 'did-not-run')], rerun: true, rerunResult: () => 'failed' },
  { name: '11-formfields-failure-never-rerun', title: 'A formFields failure (never rerun)', expect: 'red; the table says it was not rerun', first: [...base(25), def(FF, 'ff limit rejected', 3, 'failed')], rerun: true },
  { name: '12-skipped-with-reason', title: 'Skipped tests with a reason', expect: 'green; the reason is shown', first: [...base(25), ...many(2, 'skip-reason', 'skipped with reason', 'ui/skips/skips.spec.ts', 10)], rerun: true },
  { name: '13-skipped-without-reason', title: 'Skipped tests without a reason', expect: 'green; "No reason given"', first: [...base(25), ...many(2, 'skip-no-reason', 'skipped bare', 'ui/skips/skips.spec.ts', 10)], rerun: true },
  { name: '14-did-not-run-no-rerun', title: 'Tests that did not run (cut-off shard), no rerun', expect: 'amber, never green', first: [...base(20), ...many(3, 'cut-off', 'cut off')], rerun: false },
  { name: '15-did-not-run-rerun-passes', title: 'Tests that did not run; they pass on the rerun', expect: 'amber ("ran only on rerun")', first: [...base(20), ...many(3, 'cut-off', 'cut off')], rerun: true },
  { name: '16-incomplete-shard-crashed', title: 'Incomplete run: one of five shards crashed', expect: 'red INCOMPLETE; no pass-rate claim', first: [...base(18), ...many(2, 'failed', 'broken')], rerun: false, completeness: { expected: 5, reported: 4 } },
  { name: '17-incomplete-shard-timed-out', title: 'Incomplete run: three of five shards reported (two timed out)', expect: 'red INCOMPLETE; no pass-rate claim', first: base(12), rerun: false, completeness: { expected: 5, reported: 3 } },
  { name: '18-blocked-by-renew-session', title: 'Blocked by renew-session: no test job started', expect: 'red BLOCKED naming renew-session; no pass-rate claim', first: [], rerun: false, completeness: { expected: 5, reported: 0, cause: 'renew-session:failure' }, renewalFailure: renewal },
  { name: '19-infra-failure-no-report', title: 'Infra failure (browser install): no results file, no test ran', expect: 'report-unavailable alert, never a pass', first: [], noResults: true, unavailableReason: 'Report not found: reports/playwright-report/results.json', completeness: { expected: 5, reported: 0 } },
  { name: '20-zero-tests-selected', title: '0 tests selected (an empty sandbox selection)', expect: 'must not read as a pass', first: [], rerun: false },
  { name: '22-flaky-above-budget', title: 'Four flaky tests (budget is 3); the rerun is off', expect: 'amber: flaky above the budget; the subject names 4 flaky', first: [...base(25), ...many(4, 'flaky', 'flaky')], rerun: false },
  { name: '23-flaky-at-budget-plus-rerun-recovery', title: 'Three flaky tests plus one that failed every attempt and passed on the rerun (D2)', expect: 'amber because of the D2 test, not because of the flaky ones', first: [...base(25), ...many(3, 'flaky', 'flaky'), def('ui/d2/d2.spec.ts', 'd2 failing test', 5, 'failed')], rerun: true },
  { name: '24-flaky-at-budget-not-rerun-by-default', title: 'Three flaky tests; the flaky rerun is off by default (RERUN_INCLUDE_FLAKY=false)', expect: 'green, "(3 flaky)" in the subject; no rerun table', first: [...base(25), ...many(3, 'flaky', 'flaky')], rerun: true, includeFlaky: false },
  { name: '25-many-flaky-over-the-card-cap', title: 'Fourteen flaky tests and ten background-error groups; no rerun', expect: 'amber (above the flaky budget); full cards for at most 10, the others listed by title; background errors grouped', first: [...base(30), ...many(14, 'flaky', 'flaky', 'ui/flk/flk.spec.ts', 10)], rerun: false, unexpectedErrors: 60 },
  { name: '26-big-failure-cluster', title: 'Twenty failures with the same error message (one cluster)', expect: 'red; one full card for the cluster, the others one line each ("same cause")', first: [...base(30), ...many(20, 'failed', 'same cause', 'ui/same/same.spec.ts', 10)], rerun: true, rerunResult: () => 'failed' },
  { name: '21-very-bad-run', title: 'A very bad run: many failures, flaky tests and background errors (size)', expect: 'red; the email must stay under 100 KB', first: [...base(400), ...many(120, 'failed', 'broken', 'ui/bad/bad.spec.ts', 10), ...many(80, 'flaky', 'flaky', 'ui/flk/flk.spec.ts', 10)], rerun: true, maxTests: 60, unexpectedErrors: 790 },
];

// every branch with its environment (the deployment/PR advice differs by branch)
const BRANCHES: Array<{ branch: string; env: 'staging' | 'qa' | 'prod' }> = [
  { branch: 'sandbox', env: 'staging' }, { branch: 'dev', env: 'qa' }, { branch: 'qa', env: 'qa' },
  { branch: 'stage', env: 'staging' }, { branch: 'prod', env: 'prod' }, { branch: 'main', env: 'prod' },
];
for (const b of BRANCHES) {
  SCENARIOS.push(
    { name: `30-${b.branch}-clean`, title: `Branch ${b.branch} (${b.env}): all pass`, expect: 'green; advice fits the branch', env: b.env, branch: b.branch, first: base(30), rerun: false },
    { name: `31-${b.branch}-failures`, title: `Branch ${b.branch} (${b.env}): 2 failed, 2 flaky`, expect: 'red; advice fits the branch', env: b.env, branch: b.branch, first: [...base(26), ...many(2, 'failed', 'broken'), ...many(2, 'flaky', 'flaky')], rerun: false }
  );
}

// ── reading an email ────────────────────────────────────────────────────────────────────────────────────────────
const text = (h: string): string => h.replace(/<[^>]*>/g, ' ').replace(/&rarr;/g, '->').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

export interface Tile { value: string; sub: string }
export function tiles(html: string): Record<string, Tile> {
  const out: Record<string, Tile> = {};
  for (const chunk of html.split('<td style="width:').slice(1)) {
    const m = /^(\S+)\s+(Passed first time|Did not run|Total|Passed|Failed|Skipped|Flaky|Duration|Modules|Retries)\b\s*(.*)$/.exec(text(chunk.slice(chunk.indexOf('>') + 1, chunk.indexOf('</td>'))));
    if (m && !out[m[2]]) out[m[2]] = { value: m[1], sub: m[3] };
  }
  return out;
}
export function execFirstLine(html: string): string {
  const m = /<div style="font-size:12\.5px;color:#424A53;line-height:1\.55;margin-top:4px;">([^<]*)<\/div>/.exec(html);
  return m ? text(m[1]) : '';
}
export interface RerunRow { first: number; final: number; note: string }
export function rerunTable(html: string): Record<string, RerunRow> | null {
  const i = html.indexOf('id="section-rerun"');
  if (i < 0) return null;
  const end = html.indexOf('\n<tr><td', i);
  const section = html.slice(i, end < 0 ? undefined : end);
  const rows: Record<string, RerunRow> = {};
  for (const m of section.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => text(c[1]));
    if (cells.length === 3 && /^(Passed|Failed|Flaky|Skipped|Did not run|Total)$/.test(cells[0])) {
      const fin = /^(\d+)\s*(.*)$/.exec(cells[2]);
      rows[cells[0]] = { first: parseInt(cells[1], 10), final: fin ? parseInt(fin[1], 10) : NaN, note: fin?.[2] ?? '' };
    }
  }
  return Object.keys(rows).length > 0 ? rows : null;
}
export function rerunNotes(html: string): string {
  const t = rerunTable(html);
  const notRerun = /(\d+) failed\/flaky test\(s\) were not rerun[^:]*:/.exec(text(html));
  const notes = t ? Object.entries(t).filter(([, r]) => r.note).map(([k, r]) => `${k}: ${r.note}`) : [];
  if (notRerun) notes.push(`not rerun: ${notRerun[1]}`);
  if (/Not rerun:/.test(text(html))) notes.push(/Not rerun: ([^.]*)\./.exec(text(html))?.[1] ?? 'not rerun');
  return notes.join('; ');
}

// ── the matrix row ──────────────────────────────────────────────────────────────────────────────────────────────
export interface Row {
  name: string; first: string; final: string; tiles: string; subject: string; exec: string; verdict: string; health: string; history: string; rerun: string; sizeKiB: string;
}
const toneWord = (t: string): string => (t === 'success' ? 'green' : t === 'warning' ? 'amber' : 'red');
export function row(s: ScenarioResult): Row {
  const kib = `${(Buffer.byteLength(s.html) / 1024).toFixed(1)} KiB`;
  if (!s.report || !s.ctx) return { name: s.spec.name, first: '-', final: '-', tiles: '-', subject: s.subject, exec: '(report-unavailable alert)', verdict: 'red (no report)', health: '-', history: '(none written)', rerun: '-', sizeKiB: kib };
  const r = s.report;
  const t = tiles(s.html);
  const tr = (l: string): string => t[l]?.value ?? '-';
  const h = s.record;
  return {
    name: s.spec.name,
    first: `${r.firstRun.passed}/${r.firstRun.failed}/${r.firstRun.flaky}/${r.firstRun.skipped}/${r.firstRun.didNotRun}`,
    final: `${r.finalPassed}/${r.failed}/-/${r.skipped - r.didNotRun}/${r.didNotRun}`,
    tiles: `${tr('Passed')}·${tr('Flaky')}·${tr('Failed')}·${tr('Skipped')}`,
    subject: s.subject,
    exec: execFirstLine(s.html),
    verdict: `${s.ctx.verdict?.verdict} ${toneWord(s.ctx.verdict?.bannerTone ?? '')} "${s.ctx.verdict?.bannerLabel}"`,
    health: s.ctx.health ? `${s.ctx.health.score} ${s.ctx.health.label}` : '-',
    history: h ? `${h.passed}/${h.failed}/${h.flaky}/${h.skipped}${h.afterRerun ? ` after ${h.afterRerun.passed}/${h.afterRerun.failed}/${h.afterRerun.flaky}` : ''}` : '-',
    rerun: rerunNotes(s.html) || '-',
    sizeKiB: kib,
  };
}

// ── invariants ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface Violation { scenario: string; id: string; message: string }
const noTestRan = (s: ScenarioResult): boolean =>
  s.kind === 'unavailable' || !!s.spec.noResults || (s.spec.completeness !== undefined && s.spec.completeness.reported === 0) || (s.report?.total ?? 0) === 0;
const incomplete = (s: ScenarioResult): boolean => !!s.spec.completeness && s.spec.completeness.reported < s.spec.completeness.expected;

export function invariants(s: ScenarioResult): Violation[] {
  const v: Violation[] = [];
  const bad = (id: string, message: string): void => void v.push({ scenario: s.spec.name, id, message });
  const sizeBytes = Buffer.byteLength(s.html);
  if (sizeBytes > 100 * 1024) bad('size', `the email is ${(sizeBytes / 1024).toFixed(1)} KiB, over Gmail's 100 KiB clipping limit`);
  if (s.kind === 'unavailable') {
    if (/passed|✅/i.test(s.subject)) bad('no-pass-claim', `a run with no report claims a pass: ${s.subject}`);
    if (!/REPORT NOT AVAILABLE/.test(s.subject)) bad('says-what-it-is', `the subject does not say the report is unavailable: ${s.subject}`);
    if (!/^[^\w]*\S* ?STAGING sandbox #\d+: /.test(s.subject) && !new RegExp(`${s.env.toUpperCase()} ${s.branch} #\\d+: `).test(s.subject)) bad('alert-subject-format', `the report-unavailable subject uses another format than every other email: ${s.subject}`);
    return v;
  }
  const r = s.report!;
  const ctx = s.ctx!;
  const verdict = ctx.verdict!;
  const t = tiles(s.html);
  const table = rerunTable(s.html);
  const subjectIcon = s.subject.includes('✅') ? 'green' : s.subject.includes('❌') ? 'red' : 'amber';
  const blockedLike = noTestRan(s) || incomplete(s) || r.status === 'no-tests-executed';

  // 1-3: the numbers add up and only move in the allowed directions
  if (r.finalPassed + r.failed + r.skipped !== r.total) bad('outcomes-add-up', `Final passed ${r.finalPassed} + failed ${r.failed} + skipped/did-not-run ${r.skipped} = ${r.finalPassed + r.failed + r.skipped}, total ${r.total}`);
  if (r.firstRun.passed + r.firstRun.failed + r.firstRun.flaky + r.firstRun.skipped + r.firstRun.didNotRun !== r.total) bad('first-run-adds-up', `first run does not add up to ${r.total}: ${JSON.stringify(r.firstRun)}`);
  if (r.finalPassed < r.firstRun.passed) bad('final-passed-ge-first', `Final passed ${r.finalPassed} < first-run passed ${r.firstRun.passed}`);
  if (r.failed > r.firstRun.failed + r.firstRun.didNotRun) bad('final-failed-le-first', `Final failed ${r.failed} > first-run failed ${r.firstRun.failed} + did-not-run ${r.firstRun.didNotRun}`);
  if (table) {
    const sum = (i: 'first' | 'final'): number => (['Passed', 'Failed', 'Flaky', 'Skipped', 'Did not run'] as const).reduce((n, k) => n + (table[k]?.[i] ?? 0), 0);
    if (sum('first') !== table.Total.first || sum('final') !== table.Total.final) bad('table-adds-up', `the rerun table columns do not add up: first ${sum('first')}/${table.Total.first}, final ${sum('final')}/${table.Total.final}`);
    if (table.Passed.final !== r.finalPassed || table.Failed.final !== r.failed) bad('table-equals-report', `Final result Passed/Failed ${table.Passed.final}/${table.Failed.final} vs the report ${r.finalPassed}/${r.failed}`);
    const note = table.Passed.note;
    const noteSum = [...note.matchAll(/(\d+) (?:after a retry|after the rerun|ran only on rerun)/g)].reduce((n2, m) => n2 + parseInt(m[1], 10), 0);
    if (table.Passed.first + noteSum !== table.Passed.final) bad('table-note-adds-up', `Final Passed ${table.Passed.final} = first-run Passed ${table.Passed.first} + the note's parts ${noteSum} ("${note}")`);
    if (table.Flaky.final !== 0) bad('final-flaky-zero', `the Final result column shows ${table.Flaky.final} Flaky (a flaky test ends as Passed)`);
    if (table.Passed.first !== r.firstRun.passed || table.Flaky.first !== r.firstRun.flaky || table.Failed.first !== r.firstRun.failed) bad('table-first-run', `the First run column does not match the parsed first run`);
  }

  // 4: subject, tiles, table and executive summary quote the same numbers
  if (Object.keys(t).length > 0) {
    const n = (l: string): number => parseInt(t[l]?.value ?? 'NaN', 10);
    if (n('Total') !== r.total || n('Passed') !== r.finalPassed || n('Failed') !== r.failed) bad('tiles-quote-report', `tiles Total/Passed/Failed ${n('Total')}/${n('Passed')}/${n('Failed')} vs report ${r.total}/${r.finalPassed}/${r.failed}`);
    if (n('Flaky') !== r.firstRun.flaky) bad('tiles-flaky', `the Flaky tile shows ${n('Flaky')}, the first run had ${r.firstRun.flaky} flaky tests`);
    // the breakdown under Passed adds up to Passed: clean + after a retry + after the rerun + ran only on the rerun
    const sub = t['Passed']?.sub ?? '';
    const subSum = [...sub.matchAll(/(\d+) (?:after a retry|after the rerun|ran only on rerun)/g)].reduce((n2, m) => n2 + parseInt(m[1], 10), 0);
    if (r.firstRun.passed + subSum !== r.finalPassed) bad('tile-parts-add-up', `Passed ${r.finalPassed} = clean ${r.firstRun.passed} + the tile's breakdown ${subSum} ("${sub}")`);
    const tileSum = n('Passed') + n('Failed') + n('Skipped') + (t['Did not run'] ? n('Did not run') : 0);
    if (tileSum !== n('Total')) bad('tiles-add-up', `Passed + Failed + Skipped + Did not run = ${tileSum}, Total ${n('Total')}`);
  } else if (!blockedLike) bad('tiles-present', 'no Run Summary tiles found');
  const exec = execFirstLine(s.html);
  const countBased = !/BLOCKED|INCOMPLETE|NO TESTS|DRIFT/i.test(s.subject);
  if (countBased) {
    const sf = /(\d+) failed/.exec(s.subject);
    const sp = /(\d+) passed/.exec(s.subject);
    const so = /of (\d+)$/.exec(s.subject);
    if ((sf ? parseInt(sf[1], 10) : 0) !== r.failed || !sp || parseInt(sp[1], 10) !== r.finalPassed || !so || parseInt(so[1], 10) !== r.total) bad('subject-quotes-report', `subject numbers differ from the report (${r.failed} failed, ${r.finalPassed} passed, ${r.total} total): ${s.subject}`);
    const flakyInSubject = /(\d+) flaky/.exec(s.subject);
    if (r.firstRun.flaky > 0 && !(flakyInSubject && parseInt(flakyInSubject[1], 10) === r.firstRun.flaky)) bad('subject-shows-flaky', `${r.firstRun.flaky} flaky tests are not named in the subject: ${s.subject}`);
    const onRerunInSubject = /(\d+) on rerun/.exec(s.subject);
    if (r.recoveredOnRerun > 0 && !(onRerunInSubject && parseInt(onRerunInSubject[1], 10) === r.recoveredOnRerun)) bad('subject-shows-rerun', `${r.recoveredOnRerun} tests that passed only on the rerun are not named in the subject: ${s.subject}`);
    if (r.ranOnlyOnRerun > 0 && !/only on rerun/.test(s.subject)) bad('subject-shows-ran-only-on-rerun', `${r.ranOnlyOnRerun} tests that ran only on the rerun are not named in the subject (the verdict is amber because of them): ${s.subject}`);
    if (r.skipped - r.didNotRun > 0 && !/skipped/.test(s.subject)) bad('subject-accounts-for-skipped', `${r.skipped - r.didNotRun} skipped tests are in "of ${r.total}" but not named: failed + passed < total and the reader cannot see why: ${s.subject}`);
    if (r.failed > 0 ? !new RegExp(`^${r.failed} tests? failed`).test(exec) : !/^(No test failures this run|No test failed in the end|Nothing was verified)/.test(exec)) bad('exec-first-line', `the executive summary's first sentence does not state ${r.failed} failures: "${exec.slice(0, 80)}"`);
  }
  const execText = text(s.html);
  const execSentence = /(\d+) of (\d+) tests passed in the end: ([^—]*)—/.exec(execText);
  if (execSentence) {
    const parts = [...execSentence[3].matchAll(/(\d+) (?:after an in-job retry|after the rerun|that did not run)/g)].reduce((n2, m) => n2 + parseInt(m[1], 10), 0);
    if (r.firstRun.passed + parts !== r.finalPassed) bad('exec-parts-add-up', `the executive summary's breakdown does not add up: clean ${r.firstRun.passed} + ${parts} != ${r.finalPassed} ("${execSentence[3].trim()}")`);
  }
  const passedInEnd = /(\d+) of (\d+) tests passed in the end/.exec(text(s.html));
  if (passedInEnd && (parseInt(passedInEnd[1], 10) !== r.finalPassed || parseInt(passedInEnd[2], 10) !== r.total)) bad('exec-quotes-report', `"N of M passed in the end" is ${passedInEnd[1]} of ${passedInEnd[2]}, report ${r.finalPassed} of ${r.total}`);

  // 5-6: verdict, colour and icon
  if (r.failed > 0 && (verdict.verdict === 'clear' || verdict.bannerTone === 'success' || subjectIcon === 'green')) bad('failure-never-green', `a run with ${r.failed} failed tests is shown green (${verdict.bannerLabel})`);
  if (subjectIcon === 'green' && verdict.verdict !== 'clear') bad('icon-matches-verdict', `the subject is green but the verdict is ${verdict.verdict}`);
  if (r.failed === 0 && !blockedLike && (verdict.bannerTone === 'danger' || /failed/i.test(s.subject) || s.subject.includes('❌'))) bad('flaky-only-not-failed', `a run without failures is shown as failed: ${s.subject} / ${verdict.bannerLabel}`);
  // the colour rule (2026-11-25): by results only, whatever the CI setup
  const notVerified = r.didNotRun + r.ranOnlyOnRerun;
  const mustBeAmber = r.firstRun.flaky > FLAKY_BUDGET || r.recoveredOnRerun > 0 || notVerified > 0;
  if (!blockedLike && r.failed === 0 && !ctx.suiteDrift?.occurred && ctx.health!.label !== 'Needs Attention' && ctx.health!.label !== 'Critical') {
    if (mustBeAmber && verdict.verdict === 'clear') bad('instability-not-clean', `${r.firstRun.flaky} flaky (budget ${FLAKY_BUDGET}), ${r.recoveredOnRerun} passed-only-on-rerun, ${notVerified} not run but the verdict is clear`);
    if (!mustBeAmber && verdict.verdict !== 'clear') bad('colour-by-results', `flaky ${r.firstRun.flaky} <= ${FLAKY_BUDGET}, nothing failed every attempt, everything ran, yet the verdict is ${verdict.verdict}: ${verdict.bannerLabel}`);
  }
  if (blockedLike && verdict.verdict !== 'blocked' && !(r.total === 0)) bad('blocked-is-blocked', `an incomplete or blocked run has verdict ${verdict.verdict}`);
  if (r.total === 0 && verdict.verdict === 'clear') bad('zero-tests-never-green', `0 tests ran and the verdict is clear (${verdict.bannerLabel}, "${verdict.headline}")`);

  // 7: a blocked, incomplete or empty run never claims a pass rate
  if (blockedLike) {
    if (/\d+ passed|✅/.test(s.subject)) bad('no-pass-claim-subject', `the subject of a run where tests did not run claims passes: ${s.subject}`);
    if (t['Passed first time'] && t['Passed first time'].value !== 'n/a') bad('no-pass-rate-tile', `a run where tests did not run still shows "Passed first time ${t['Passed first time'].value}"`);
  }

  // 8: flaky tests stay visible somewhere
  if (r.firstRun.flaky > 0) {
    if (r.passRate >= 100) bad('flaky-visible-passrate', `${r.firstRun.flaky} flaky tests but "Passed first time" reads ${r.passRate}%`);
    if (r.flaky > 0 && !s.html.includes('id="section-flaky-tests"')) bad('flaky-visible-section', 'flaky tests but no Flaky Tests section');
    if (r.flaky === 0 && r.passedOnRerunTests.length > 0 && !s.html.includes('id="section-passed-on-rerun"')) bad('flaky-visible-rerun-section', 'flaky tests resolved on the rerun but no "Passed on rerun" section');
    if (table && table.Flaky.first !== r.firstRun.flaky) bad('flaky-visible-first-run', 'the First run column does not show the flaky count');
  }
  if (r.recoveredOnRerun > 0 && !s.html.includes('id="section-passed-on-rerun"')) bad('recovered-visible', 'tests that passed only on the rerun have no section');

  if (s.summary && !s.summary.ran && s.summary.reason === 'none' && s.summary.excluded.length > 0 && /no test failed or was flaky/.test(text(s.html))) bad('not-rerun-reason', 'the rerun section says "no test failed or was flaky" although failed tests could not be rerun');

  // reader-confusion checks (findings, see KNOWN): wording that contradicts the verdict or hides why a run is amber or red
  if (ctx.health && !ctx.health.notApplicable && r.failed > 0) {
    const severe = r.failed >= 3 || r.failed >= (r.total - r.skipped) * 0.05;
    if (ctx.health.label === 'Excellent' || (severe && ctx.health.label === 'Good')) bad('health-with-failures', `health says "${ctx.health.label}" (${ctx.health.score}) next to ${r.failed} failed tests of ${r.total - r.skipped}`);
  }
  if (ctx.health?.notApplicable && !/Health: n\/a|Automation Health: n\/a/.test(text(s.html))) bad('health-na-shown', 'health is not applicable but the email does not say "n/a"');
  if (countBased && verdict.verdict === 'caution' && r.failed === 0 && /Automation health is (Excellent|Good)/.test(exec)) bad('exec-health-sentence', `the executive summary explains an amber run with "${/Automation health is [^.]*\./.exec(exec)?.[0]}": health is fine, the real reason is not stated`);
  if (blockedLike && /^No test failures/.test(exec)) bad('exec-no-failures-when-nothing-ran', `the executive summary says "No test failures this run." for a run where ${noTestRan(s) ? 'no test ran' : 'shards are missing'}`);
  if (r.total === 0 && (/Passed/.test(verdict.bannerLabel) || /0 passed of 0/.test(s.subject))) bad('zero-tests-label', `0 tests ran and the email says "${verdict.bannerLabel}" / "${s.subject}"`);
  const labelFlaky = /Unstable — (\d+) flaky/.exec(verdict.bannerLabel);
  if (labelFlaky && parseInt(labelFlaky[1], 10) !== r.firstRun.flaky) bad('verdict-label-vs-tile', `the verdict label counts ${r.flaky} flaky, the Flaky tile ${r.firstRun.flaky} (the label counts only those the rerun did not confirm)`);
  if (r.recoveredOnRerun > 0 && r.failed === 0 && /^No test failures this run/.test(exec)) bad('exec-no-failures-after-rerun', `"No test failures this run." although ${r.recoveredOnRerun} tests failed every first attempt (they passed on the rerun)`);

  // 9: history
  const h = s.record;
  if (h) {
    if (h.passed + h.failed + h.flaky + h.skipped !== h.total) bad('history-adds-up', `history first-run counts ${h.passed}+${h.failed}+${h.flaky}+${h.skipped} != ${h.total}`);
    if (h.passed !== r.firstRun.passed || h.failed !== r.firstRun.failed || h.flaky !== r.firstRun.flaky) bad('history-first-run', 'history does not hold the first-run counts');
    if (h.afterRerun && (h.afterRerun.passed !== r.finalPassed || h.afterRerun.failed !== r.failed || h.afterRerun.flaky !== 0)) bad('history-after', `history afterRerun ${JSON.stringify(h.afterRerun)} vs final ${r.finalPassed}/${r.failed}/0`);
    if (r.flaky > 0 && h.flakyTestTitles.length < r.flaky) bad('history-flaky-titles', 'history lost flaky test titles');
  }

  // 10: skipped tests
  const skippedSpec = s.spec.first.filter((d) => d.kind === 'skip-reason' || d.kind === 'skip-no-reason');
  if (skippedSpec.length > 0) {
    if (!s.html.includes('Skipped Tests (')) bad('skipped-listed', 'skipped tests but no Skipped Tests section');
    if (skippedSpec.some((d) => d.kind === 'skip-reason') && !text(s.html).includes(SKIP_REASON_TEXT)) bad('skip-reason-shown', 'a skip reason is not shown');
    if (skippedSpec.some((d) => d.kind === 'skip-no-reason') && !text(s.html).includes('No reason given')) bad('skip-no-reason-said', 'a skip without a reason does not say so');
  }

  // 11: health
  if (blockedLike && ctx.health && !ctx.health.notApplicable) bad('health-of-blocked-run', `a run where tests did not run has health ${ctx.health.score} ${ctx.health.label}`);

  // 13: structure and size rules of commit 2 (items 7-10, 13, 14, 24)
  const plain = new EmailTemplate().text(ctx);
  const flat = s.html.replace(/\s+/g, ' ');
  const iResult = s.html.indexOf('>Result<');
  const iExec = s.html.indexOf('Executive Summary');
  if (iResult < 0 || !s.html.includes('>Action<') || !s.html.includes('>Run<') || (iExec >= 0 && iResult > iExec)) bad('top-summary', 'the Result / Action / Run lines are missing or come after the Executive Summary');
  if (!plain.startsWith(s.subject) || /<[a-z][^>]*>/i.test(plain) || !/\nResult: /.test(plain)) bad('text-part', 'the plain-text part does not start with the subject, has HTML in it or has no Result line');
  if (Buffer.byteLength(plain) > 12 * 1024) bad('text-part-size', `the plain-text part is ${(Buffer.byteLength(plain) / 1024).toFixed(1)} KiB`);
  const cardCount = (s.html.match(/<div id="test-/g) ?? []).length;
  if (cardCount > 12 + (s.html.match(/<tr id="test-/g)?.length ?? 0)) bad('cards-capped', `${cardCount} detail cards in one email`);
  if (/all-blob-reports\/resources|blob-report\/resources|error-context\.md|test-results\/[^"<\s]*\.zip/.test(flat)) bad('no-runner-paths', 'a runner-relative trace/snapshot path is in the email');
  if (!/Result<\/strong>/.test(s.html.replace(/\s+/g, ' ')) && s.html.includes('>Result<')) bad('top-summary-shape', 'the Result line is not in the expected markup');
  if (ctx.miscErrors && ctx.miscErrors.totalErrors > 0 && !s.html.includes('Top errors, grouped by request')) bad('background-errors-grouped', 'background errors are not shown as grouped');

  // 12: environment and branch
  if (!s.subject.includes(s.branch) || !s.subject.toUpperCase().includes(s.env.toUpperCase())) bad('subject-names-env-branch', `the subject does not name ${s.env} and ${s.branch}: ${s.subject}`);
  const prLike = ['sandbox', 'dev'].includes(s.branch);
  if (prLike && /Deployment/i.test(verdict.headline)) bad('branch-advice', `the ${s.branch} email gives deployment advice ("${verdict.headline}") where the question is "ready for a PR to dev?"`);
  if (!prLike && !blockedLike && ['prod', 'main'].includes(s.branch) && !/Deployment/i.test(verdict.headline)) bad('branch-advice-prod', `the ${s.branch} email gives no deployment advice`);
  return v;
}

// ── things this suite found that are not decided yet (listed, not failing) ──────────────────────────────────────
export const KNOWN: Array<{ id: string; scenarios?: RegExp; reason: string }> = [
  { id: 'branch-advice', reason: 'item 16 (branch-aware wording: "ready for a PR to dev" on sandbox/dev, deployment advice only on stage/prod/main) is planned in commit 3, not done' },
];
const isKnown = (v: Violation): string | null => KNOWN.find((k) => k.id === v.id && (!k.scenarios || k.scenarios.test(v.scenario)))?.reason ?? null;

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function main(): void {
  const outIdx = process.argv.indexOf('--out');
  const outDir = outIdx > 0 ? process.argv[outIdx + 1].replace(/^~(?=$|\/)/, os.homedir()) : null;
  const results: ScenarioResult[] = SCENARIOS.map((spec) => runScenario(spec));
  // the real build #235 and its blocked-by-renew-session replay (fixture), as two more scenarios
  for (const [name, title, expect, blocked] of [
    ['40-build-235', 'The real build #235 (replayed from the fixture)', 'red; 940 passed (6 flaky, 2 on rerun); too big (commit 2)', false],
    ['41-build-235-blocked', 'Build #235 data with the renew-session failure injected', 'BLOCKED naming renew-session', true],
  ] as const) {
    const rp = replayBuild235({ blockedBySession: blocked ? { renewalFailure: renewal, cause: 'renew-session:failure' } : undefined });
    results.push({ spec: { name, title, expect, first: [], completeness: blocked ? { expected: 11, reported: 0, cause: 'renew-session:failure' } : undefined }, env: 'staging', branch: 'sandbox', html: rp.html, subject: rp.subject, report: rp.report, ctx: rp.ctx, summary: rp.summary, list: rp.list, record: rp.record, kind: 'email' });
  }

  const rows = results.map(row);
  const violations = results.flatMap(invariants);
  const failing = violations.filter((x) => !isKnown(x));
  const known = violations.filter((x) => isKnown(x));

  const header = '| scenario | first run P/F/Fl/S/DNR | Final result P/F/-/S/DNR | tiles Passed·Flaky·Failed·Skipped | subject | executive summary, first line | verdict | health | history (first run; after) | rerun table notes | size |\n|---|---|---|---|---|---|---|---|---|---|---|';
  const md = [header, ...rows.map((r) => `| ${r.name} | ${r.first} | ${r.final} | ${r.tiles} | ${r.subject} | ${r.exec} | ${r.verdict} | ${r.health} | ${r.history} | ${r.rerun} | ${r.sizeKiB} |`)].join('\n');

  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    for (const s of results) fs.writeFileSync(path.join(outDir, `${s.spec.name}.html`), s.html);
    fs.writeFileSync(path.join(outDir, 'matrix.md'), `${md}\n\n## Findings (known, not failing)\n${known.map((k) => `- ${k.scenario}: [${k.id}] ${k.message}`).join('\n')}\n`);
    const esc = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const items = results
      .map((s, i) => {
        const vs = violations.filter((x) => x.scenario === s.spec.name);
        const flags = vs.map((x) => `<span class="${isKnown(x) ? 'k' : 'f'}" title="${esc(x.message)}">${x.id}${isKnown(x) ? ' (known)' : ''}</span>`).join(' ');
        return `<tr><td><a href="${s.spec.name}.html">${esc(s.spec.name)}</a></td><td>${esc(s.spec.title)}<br><small>${esc(s.spec.expect)}</small></td><td>${esc(s.subject)}</td><td>${rows[i].sizeKiB}</td><td>${flags || '<span class="ok">all invariants hold</span>'}</td></tr>`;
      })
      .join('\n');
    fs.writeFileSync(
      path.join(outDir, 'index.html'),
      `<!doctype html><meta charset="utf-8"><title>Reporting scenarios</title><style>body{font:13px system-ui;margin:20px;background:#f6f8fa}table{border-collapse:collapse;background:#fff}td,th{border:1px solid #d0d7de;padding:6px 10px;vertical-align:top}th{background:#eef1f5;text-align:left}small{color:#57606a}.ok{color:#1a7f37}.f{background:#ffebe9;color:#cf222e;padding:1px 5px;border-radius:4px}.k{background:#fff8c5;color:#7d4e00;padding:1px 5px;border-radius:4px}</style><h2>Reporting scenarios (${results.length})</h2><p>Each row is one run replayed through the real pipeline. Yellow tags are findings that are listed but not decided yet; hover for the explanation. <a href="matrix.md">matrix.md</a></p><table><tr><th>scenario</th><th>what it is, and what a reader should conclude</th><th>subject</th><th>size</th><th>invariants</th></tr>\n${items}</table>`
    );
  }

  process.stdout.write(`${md}\n\n`);
  for (const x of failing) process.stdout.write(`FAIL  ${x.scenario}: [${x.id}] ${x.message}\n`);
  const byId = new Map<string, Violation[]>();
  for (const k of known) byId.set(k.id, [...(byId.get(k.id) ?? []), k]);
  for (const [id, list] of byId) process.stdout.write(`KNOWN [${id}] ${list.length} scenario(s): ${list.map((l) => l.scenario).join(', ')}\n        ${KNOWN.find((k) => k.id === id)?.reason}\n`);
  const checksRun = results.length * 30;
  process.stdout.write(failing.length === 0 ? `\ncheck:scenarios — ${results.length} scenarios, invariants hold (${known.length} known finding(s) listed above)${outDir ? `; rendered to ${outDir}` : ''}\n` : `\ncheck:scenarios — ${failing.length} invariant violation(s) in ${new Set(failing.map((x) => x.scenario)).size} scenario(s) (of about ${checksRun} checks)\n`);
  process.exitCode = failing.length === 0 ? 0 : 1;
}

if (require.main === module) main();
