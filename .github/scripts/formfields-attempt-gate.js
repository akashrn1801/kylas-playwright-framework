/**
 * Decides, on a RE-RUN of a workflow run (github.run_attempt > 1), whether a formFields matrix job or the field-config
 * reset job can skip itself (ADR 0015). Replaces the gh + jq version (2026-11-24): the mcr.microsoft.com/playwright
 * image has neither gh nor jq (canary run 45379221092), so the same GitHub REST calls are made here with Node's
 * built-in fetch and the job's token. Plain CommonJS, no packages, no ts-node: the gate step runs BEFORE
 * `npm ci`/setup-node in sandbox.yml, so only the node that is already on the runner/image is available.
 *
 *   node .github/scripts/formfields-attempt-gate.js ff|reset      (sandbox.yml calls the .sh wrapper next to it)
 *     ff    needs env JOB_NAME (exact job name, e.g. "playwright-formFields (lead)"), ARTIFACT_NAME (that entity's blob
 *           artifact), LABEL (for log lines)
 *     reset (no extra env) skips when no formFields job ran tests in THIS attempt
 *   Both need GH_TOKEN or GITHUB_TOKEN (actions: read), GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT,
 *   GITHUB_OUTPUT; optional DETECT_JOB_NAME, GITHUB_API_URL.
 *
 * Prints skip=true|false to $GITHUB_OUTPUT and ALWAYS exits 0. Any doubt (API error, odd answer, artifact missing, a
 * missing variable) means skip=false, i.e. run exactly as today: this gate may only ever save time, never hide a test
 * run. "Re-run all jobs" re-runs the detect job too, so its job entry carries run_attempt == the current attempt; that
 * is treated as a deliberate full re-run and nothing is skipped (UNVERIFIED: how GitHub reports a job that was NOT
 * re-run; if it also showed run_attempt == current, nothing would ever be skipped, the safe direction). The test step
 * name prefix below is shared with sandbox.yml's formFields job: keep both in sync.
 * Tested offline by `npm run check:formfields-gate` (scripts/check-formfields-gate.ts).
 */
'use strict';
const fs = require('fs');

const TEST_STEP_PREFIX = 'Run formFields tests for ';
const FF_JOB_PREFIX = 'playwright-formFields (';

const normally = (line) => ({ skip: false, lines: [line] });
const failOpen = (why) => ({
  skip: false,
  lines: [`::warning title=formFields attempt gate::${why} — running normally (never skipping on uncertainty)`],
});

const ranTests = (job) =>
  job.steps.some((s) => s.name.startsWith(TEST_STEP_PREFIX) && s.conclusion !== null && s.conclusion !== 'skipped');
const passedTests = (job) => job.steps.some((s) => s.name.startsWith(TEST_STEP_PREFIX) && s.conclusion === 'success');

/**
 * @typedef {{ name: string, conclusion: string | null }} GateStep
 * @typedef {{ name: string, conclusion: string | null, run_attempt: number, steps: GateStep[] }} GateJob
 * @typedef {{ jobs(attempt: number): Promise<GateJob[]>, aliveArtifacts(name: string): Promise<number> }} GateApi
 * @param {{ mode: string, attempt: string, repo: string, runId: string, detectJobName: string, jobName?: string, artifactName?: string, label?: string }} input
 * @param {GateApi} api
 * @returns {Promise<{ skip: boolean, lines: string[] }>}
 */
async function decide(input, api) {
  const { mode, repo, runId, detectJobName } = input;
  const attempt = Number(input.attempt);
  if (!/^[0-9]+$/.test(input.attempt) || attempt <= 1) return normally('First attempt: nothing to skip.');
  if (!repo || !runId) return failOpen('GITHUB_REPOSITORY / GITHUB_RUN_ID missing');

  let current;
  try {
    current = await api.jobs(attempt);
  } catch {
    return failOpen(`could not read the jobs of attempt ${attempt}`);
  }
  if (current.some((j) => j.name === detectJobName && j.run_attempt === attempt)) {
    return normally(`Attempt ${attempt} re-ran '${detectJobName}' too (Re-run all jobs): nothing is skipped.`);
  }

  if (mode === 'reset') {
    const ff = current.filter((j) => j.name.startsWith(FF_JOB_PREFIX));
    const total = ff.length;
    const ran = ff.filter(ranTests).length;
    if (total === 0) return failOpen(`no formFields job found in attempt ${attempt}`);
    if (ran === 0) {
      return {
        skip: true,
        lines: [`::notice title=Field-config reset skipped::no formFields job ran tests in attempt ${attempt} (${total} skipped as already passed); the earlier attempt's reset result stands`],
      };
    }
    return normally(`${ran} of ${total} formFields job(s) ran tests in attempt ${attempt}: reset runs.`);
  }

  if (mode !== 'ff') return failOpen(`unknown mode '${mode}'`);
  const { jobName, artifactName } = input;
  if (!jobName || !artifactName) return failOpen('JOB_NAME / ARTIFACT_NAME missing');
  const label = input.label || jobName;

  for (let n = attempt - 1; n >= 1; n--) {
    let prior;
    try {
      prior = await api.jobs(n);
    } catch {
      return failOpen(`could not read the jobs of attempt ${n}`);
    }
    if (!prior.some((j) => j.name === jobName && j.conclusion === 'success' && passedTests(j))) continue;
    // The skipped job uploads nothing, so the merge needs that attempt's artifact to still exist.
    let alive;
    try {
      alive = await api.aliveArtifacts(artifactName);
    } catch {
      return failOpen('could not list the artifacts of the run');
    }
    if (alive > 0) {
      return {
        skip: true,
        lines: [
          `::notice title=formFields ${label} skipped::formFields ${label} already passed in attempt ${n} — skipped (artifact ${artifactName} from that attempt is used by the merge)`,
          `formFields ${label} already passed in attempt ${n} — skipped`,
        ],
      };
    }
    return normally(`formFields ${label} passed in attempt ${n} but artifact ${artifactName} is gone (expired/deleted): running it again.`);
  }
  return normally(`formFields ${label} did not pass in any earlier attempt: running normally.`);
}

/** GitHub REST over built-in fetch; follows Link rel="next" like `gh api --paginate`. */
function createApi({ baseUrl, token, repo, runId, timeoutMs = 30000 }) {
  async function pages(firstPath, pick) {
    const all = [];
    let url = `${baseUrl}${firstPath}`;
    for (let guard = 0; url && guard < 50; guard++) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'kylas-formfields-attempt-gate',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
      all.push(...pick(await res.json()));
      const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '');
      url = next ? next[1] : null;
    }
    return all;
  }
  return {
    async jobs(attempt) {
      const raw = await pages(`/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`, (b) => b.jobs || []);
      return raw.map((j) => ({
        name: j.name,
        conclusion: j.conclusion,
        run_attempt: j.run_attempt,
        steps: (j.steps || []).map((s) => ({ name: s.name, conclusion: s.conclusion })),
      }));
    },
    async aliveArtifacts(name) {
      const found = await pages(`/repos/${repo}/actions/runs/${runId}/artifacts?name=${encodeURIComponent(name)}&per_page=100`, (b) => b.artifacts || []);
      return found.filter((a) => a.expired === false).length;
    },
  };
}

function emit(skip) {
  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `skip=${skip}\n`);
  else process.stdout.write(`skip=${skip}\n`);
}

async function main() {
  const env = process.env;
  const input = {
    mode: process.argv[2] || '',
    attempt: env.GITHUB_RUN_ATTEMPT || '1',
    repo: env.GITHUB_REPOSITORY || '',
    runId: env.GITHUB_RUN_ID || '',
    detectJobName: env.DETECT_JOB_NAME || 'detect target + shard plan',
    jobName: env.JOB_NAME,
    artifactName: env.ARTIFACT_NAME,
    label: env.LABEL,
  };
  const token = env.GH_TOKEN || env.GITHUB_TOKEN || '';
  let result;
  if (!token && /^[0-9]+$/.test(input.attempt) && Number(input.attempt) > 1) {
    result = failOpen('no GH_TOKEN / GITHUB_TOKEN');
  } else {
    result = await decide(input, createApi({ baseUrl: env.GITHUB_API_URL || 'https://api.github.com', token, repo: input.repo, runId: input.runId }));
  }
  for (const line of result.lines) process.stdout.write(`${line}\n`);
  emit(result.skip);
}

module.exports = { decide, createApi, TEST_STEP_PREFIX, FF_JOB_PREFIX };

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`::warning title=formFields attempt gate::${err.message} — running normally (never skipping on uncertainty)\n`);
    emit(false);
  });
}
