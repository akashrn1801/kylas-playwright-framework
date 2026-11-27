/**
 * Offline checks for .github/scripts/formfields-attempt-gate.js (the Node replacement of the gh + jq gate, ADR 0015):
 * the decision table against a fake GitHub API, then the real REST client and the .sh wrapper against a local stub
 * server (pagination, auth header, error answers, GITHUB_OUTPUT). No network, no GitHub, no token.
 * Run: npm run check:formfields-gate
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

interface Step { name: string; conclusion: string | null }
interface Job { name: string; conclusion: string | null; run_attempt: number; steps: Step[] }
interface Api { jobs(a: number): Promise<Job[]>; aliveArtifacts(n: string): Promise<number> }
interface Input { mode: string; attempt: string; repo: string; runId: string; detectJobName: string; jobName?: string; artifactName?: string; label?: string }
interface Result { skip: boolean; lines: string[] }
interface Gate { decide(i: Input, a: Api): Promise<Result>; createApi(o: { baseUrl: string; token: string; repo: string; runId: string; timeoutMs?: number }): Api }

const gateJs = path.resolve(__dirname, '../.github/scripts/formfields-attempt-gate.js');
const gateSh = path.resolve(__dirname, '../.github/scripts/formfields-attempt-gate.sh');
const gate = require(gateJs) as Gate; // eslint-disable-line @typescript-eslint/no-require-imports

let failed = 0;
const check = (ok: boolean, name: string): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
};

const DETECT = 'detect target + shard plan';
const TEST = 'Run formFields tests for lead (UI + RBAC together, always one shard)';
const ffJob = (entity: string, attempt: number, conclusion: string | null, testConclusion: string | null): Job => ({
  name: `playwright-formFields (${entity})`,
  conclusion,
  run_attempt: attempt,
  steps: [{ name: 'Set up job', conclusion: 'success' }, { name: TEST, conclusion: testConclusion }],
});
const base: Input = { mode: 'ff', attempt: '2', repo: 'o/r', runId: '9', detectJobName: DETECT, jobName: 'playwright-formFields (lead)', artifactName: 'blob-report-sandbox-formfields-lead', label: 'lead' };
const fake = (byAttempt: Record<number, Job[] | Error>, alive: number | Error = 1): Api => ({
  jobs: async (a) => { const v = byAttempt[a]; if (v instanceof Error) throw v; return v ?? []; },
  aliveArtifacts: async () => { if (alive instanceof Error) throw alive; return alive; },
});
const boom = new Error('boom');

async function decisions(): Promise<void> {
  let r = await gate.decide({ ...base, attempt: '1' }, fake({}));
  check(!r.skip && /First attempt/.test(r.lines[0]), 'attempt 1: nothing to skip, no API call needed');
  r = await gate.decide({ ...base, attempt: 'x' }, fake({}));
  check(!r.skip, 'a non-numeric attempt runs normally');
  r = await gate.decide({ ...base, repo: '' }, fake({}));
  check(!r.skip && /::warning/.test(r.lines[0]), 'missing GITHUB_REPOSITORY fails open with a warning');
  r = await gate.decide(base, fake({ 2: boom }));
  check(!r.skip && /could not read the jobs of attempt 2/.test(r.lines[0]), 'API error on the current attempt fails open');
  r = await gate.decide(base, fake({ 2: [{ name: DETECT, conclusion: 'success', run_attempt: 2, steps: [] }] }));
  check(!r.skip && /Re-run all jobs/.test(r.lines[0]), 'detect re-ran in this attempt (Re-run all jobs): nothing skipped');
  r = await gate.decide(base, fake({ 2: [{ name: DETECT, conclusion: 'success', run_attempt: 1, steps: [] }], 1: [ffJob('lead', 1, 'success', 'success')] }));
  check(r.skip && /already passed in attempt 1/.test(r.lines[1]), 'ff: passed in attempt 1 and its artifact is alive: skipped (notice + echo line)');
  check(/^::notice title=formFields lead skipped::/.test(r.lines[0]), 'ff: the skip notice keeps the exact annotation text');
  r = await gate.decide(base, fake({ 2: [], 1: [ffJob('lead', 1, 'success', 'success')] }, 0));
  check(!r.skip && /is gone \(expired\/deleted\)/.test(r.lines[0]), 'ff: passed earlier but the artifact is gone: runs again');
  r = await gate.decide(base, fake({ 2: [], 1: [ffJob('lead', 1, 'success', 'success')] }, boom));
  check(!r.skip && /could not list the artifacts/.test(r.lines[0]), 'ff: artifact lookup error fails open');
  r = await gate.decide(base, fake({ 2: [], 1: [ffJob('lead', 1, 'failure', 'failure')] }));
  check(!r.skip && /did not pass in any earlier attempt/.test(r.lines[0]), 'ff: failed in attempt 1: runs normally');
  r = await gate.decide(base, fake({ 2: [], 1: [ffJob('lead', 1, 'success', 'skipped')] }));
  check(!r.skip, 'ff: job success but its test step was skipped (nothing proven): runs normally');
  r = await gate.decide({ ...base, attempt: '3' }, fake({ 3: [], 2: [], 1: [ffJob('lead', 1, 'success', 'success')] }));
  check(r.skip && /attempt 1/.test(r.lines[1]), 'ff: attempt 3 looks back through attempt 2 to attempt 1');
  r = await gate.decide({ ...base, attempt: '3' }, fake({ 3: [], 2: boom, 1: [ffJob('lead', 1, 'success', 'success')] }));
  check(!r.skip && /attempt 2/.test(r.lines[0]), 'ff: error reading an earlier attempt fails open');
  r = await gate.decide({ ...base, jobName: undefined }, fake({ 2: [] }));
  check(!r.skip && /JOB_NAME/.test(r.lines[0]), 'ff: missing JOB_NAME fails open (the .sh used to exit non-zero here)');
  r = await gate.decide({ ...base, mode: 'nope' }, fake({ 2: [] }));
  check(!r.skip && /unknown mode 'nope'/.test(r.lines[0]), 'unknown mode fails open');

  const reset: Input = { ...base, mode: 'reset' };
  r = await gate.decide(reset, fake({ 2: [ffJob('lead', 2, 'success', 'skipped'), ffJob('deal', 2, 'success', 'skipped')] }));
  check(r.skip && /2 skipped as already passed/.test(r.lines[0]), 'reset: no formFields job ran tests: skipped');
  r = await gate.decide(reset, fake({ 2: [ffJob('lead', 2, 'success', 'skipped'), ffJob('deal', 2, 'failure', 'failure')] }));
  check(!r.skip && /1 of 2 formFields job\(s\) ran tests/.test(r.lines[0]), 'reset: one job ran tests: reset runs');
  r = await gate.decide(reset, fake({ 2: [ffJob('lead', 2, 'cancelled', null)] }));
  check(r.skip, 'reset: a test step with a null conclusion did not run: counted as not ran (same as the jq version)');
  r = await gate.decide(reset, fake({ 2: [] }));
  check(!r.skip && /no formFields job found/.test(r.lines[0]), 'reset: no formFields job at all fails open');
}

// ── real client + wrapper against a stub server ──────────────────────────────────────────────────────────────────
function serve(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler).listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function runWrapper(env: Record<string, string>): Promise<{ code: number | null; stdout: string; output: string }> {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ffgate-')), 'out');
  fs.writeFileSync(outFile, '');
  return new Promise((resolve) => {
    const child = spawn('bash', [gateSh, 'ff'], { env: { PATH: process.env.PATH ?? '', GITHUB_OUTPUT: outFile, ...env } });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, output: fs.readFileSync(outFile, 'utf8').trim() }));
  });
}

async function http_(): Promise<void> {
  const seen: { url: string; auth?: string; accept?: string }[] = [];
  const job = (name: string, attempt: number, conclusion: string, step: string): object => ({ name, conclusion, run_attempt: attempt, steps: [{ name: step, conclusion }] });
  const stub = await serve((req, res) => {
    const u = req.url ?? '';
    seen.push({ url: u, auth: req.headers.authorization, accept: req.headers.accept });
    res.setHeader('content-type', 'application/json');
    if (u.startsWith('/repos/o/r/actions/runs/9/attempts/1/jobs')) {
      if (!u.includes('page=2')) {
        res.setHeader('link', `<http://${req.headers.host}/repos/o/r/actions/runs/9/attempts/1/jobs?per_page=100&page=2>; rel="next"`);
        res.end(JSON.stringify({ jobs: [job('other', 1, 'success', 'x')] }));
      } else {
        res.end(JSON.stringify({ jobs: [job('playwright-formFields (lead)', 1, 'success', TEST)] }));
      }
    } else if (u.startsWith('/repos/o/r/actions/runs/9/attempts/2/jobs')) {
      res.end(JSON.stringify({ jobs: [] }));
    } else if (u.startsWith('/repos/o/r/actions/runs/9/artifacts')) {
      res.end(JSON.stringify({ artifacts: [{ expired: true }, { expired: false }] }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  const api = gate.createApi({ baseUrl: stub.url, token: 'tok', repo: 'o/r', runId: '9' });
  const jobs1 = await api.jobs(1);
  check(jobs1.length === 2 && jobs1[1].name === 'playwright-formFields (lead)', 'client: follows the Link rel="next" page (2 jobs from 2 pages)');
  check(jobs1[1].steps[0].name === TEST && Object.keys(jobs1[1]).sort().join() === 'conclusion,name,run_attempt,steps', 'client: keeps only name, conclusion, run_attempt, steps (as the jq filter did)');
  check(seen[0].auth === 'Bearer tok' && /github\+json/.test(seen[0].accept ?? ''), 'client: sends the Bearer token and the GitHub accept header');
  check((await api.aliveArtifacts('blob report')) === 1 && seen[seen.length - 1].url.includes('name=blob%20report'), 'client: counts only non-expired artifacts and url-encodes the name');
  let threw = false;
  try { await gate.createApi({ baseUrl: stub.url, token: 't', repo: 'x/y', runId: '1' }).jobs(1); } catch { threw = true; }
  check(threw, 'client: a 404 throws (so the gate fails open)');

  const env = { GITHUB_API_URL: stub.url, GH_TOKEN: 'tok', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '2', JOB_NAME: 'playwright-formFields (lead)', ARTIFACT_NAME: 'a', LABEL: 'lead' };
  let w = await runWrapper(env);
  check(w.code === 0 && w.output === 'skip=true' && /already passed in attempt 1/.test(w.stdout), 'wrapper: attempt 2, lead passed in attempt 1, artifact alive: skip=true, exit 0');
  w = await runWrapper({ ...env, JOB_NAME: 'playwright-formFields (deal)' });
  check(w.code === 0 && w.output === 'skip=false', 'wrapper: another entity did not pass earlier: skip=false, exit 0');
  w = await runWrapper({ ...env, GITHUB_REPOSITORY: 'x/y' });
  check(w.code === 0 && w.output === 'skip=false' && /::warning/.test(w.stdout), 'wrapper: API 404: skip=false with a warning, exit 0');
  w = await runWrapper({ ...env, GH_TOKEN: '' });
  check(w.code === 0 && w.output === 'skip=false' && /no GH_TOKEN/.test(w.stdout), 'wrapper: no token on a re-run: skip=false, exit 0');
  w = await runWrapper({ ...env, GITHUB_API_URL: 'http://127.0.0.1:1' });
  check(w.code === 0 && w.output === 'skip=false', 'wrapper: GitHub unreachable: skip=false, exit 0');
  w = await runWrapper({ ...env, GITHUB_RUN_ATTEMPT: '1' });
  check(w.code === 0 && w.output === 'skip=false' && seen.length > 0, 'wrapper: attempt 1: skip=false');
  await stub.close();
}

(async () => {
  await decisions();
  await http_();
  console.log(failed === 0 ? '\ncheck:formfields-gate — all checks passed' : `\ncheck:formfields-gate — ${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
