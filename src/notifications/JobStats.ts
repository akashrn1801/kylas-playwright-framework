/**
 * Real per-job CI timing data — Phase 3 items #1 (per-shard/job timestamps)
 * and #6 (total CI job-minutes), sharing one GitHub Jobs API call per the
 * approved design.
 *
 * WHY one shared fetch for both #1 and #6, not two separate calls: both
 * questions ("what did each job cost" and "what did the whole run cost in
 * summed job-minutes") are read off the exact same
 * `GET .../actions/runs/{id}/jobs` response — a second call would be a
 * wasted, rate-limit-consuming duplicate for zero new data.
 *
 * WHY GitHub-Actions-only, with no Jenkins equivalent attempted here:
 * Jenkins has no REST concept of "jobs within a run" this way — its own
 * pipeline stages aren't queryable through this API, and building an
 * equivalent would be a separate, much larger effort. `notify.ts` only calls
 * `loadJobStats()` when `resolveNotificationInput()` already determined
 * `runSource === 'github-actions'`; a Jenkins run simply never gets this
 * section in its email (graceful omission, not a broken feature).
 *
 * WHY this must never fail the build, matching every other script in this
 * pipeline (syncHistory.ts, notify.ts, estimateDuration.ts): job-timing data
 * is informational only. `loadJobStats()` catches every failure (missing
 * token, missing run id, network error, non-2xx response, malformed body)
 * and returns `null` — the caller renders nothing rather than crashing.
 */

export interface GitHubJobEntry {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JobTiming {
  name: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

export interface JobStats {
  jobs: JobTiming[];
  totalJobMinutes: number;
  // WHY tracked explicitly rather than silently dropped: a job still
  // `in_progress` at query time (most commonly this very merge+notify job
  // itself) has no `completed_at` yet and is excluded from both `jobs` and
  // `totalJobMinutes` — this count makes that exclusion visible in the
  // rendered email instead of an unexplained gap between "N jobs ran" and
  // `jobs.length`.
  incompleteJobCount: number;
}

const GITHUB_API_BASE = 'https://api.github.com';

// WHY paginated (100/page, GitHub's own per_page max), not a single request:
// a large sharded run (qa.yml/stage.yml/main.yml/sandbox.yml can already
// exceed 15 jobs today between the rest-of-suite track and the formFields
// per-entity track, and per this repo's own known-issues.md entry on
// formFields' shard count not self-scaling, job count is expected to keep
// growing) could exceed a single page well within this feature's lifetime.
export async function fetchGitHubJobs(
  repo: string,
  runId: string,
  token: string
): Promise<GitHubJobEntry[]> {
  const jobs: GitHubJobEntry[] = [];
  let page = 1;
  for (;;) {
    const res = await fetch(
      `${GITHUB_API_BASE}/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (!res.ok) {
      throw new Error(`GitHub Jobs API returned HTTP ${res.status} on page ${page}`);
    }
    const body = (await res.json()) as {
      jobs: {
        name: string;
        status: string;
        conclusion: string | null;
        started_at: string | null;
        completed_at: string | null;
      }[];
    };
    for (const j of body.jobs) {
      jobs.push({
        name: j.name,
        status: j.status,
        conclusion: j.conclusion,
        startedAt: j.started_at,
        completedAt: j.completed_at,
      });
    }
    if (body.jobs.length < 100) break;
    page += 1;
  }
  return jobs;
}

// WHY pure and separate from fetchGitHubJobs() above (this pipeline's own
// established enrichment-layer convention — see known-issues.md's
// "Notification/reporting pipeline" entry, matching FailureDetailBuilder.ts's
// precedent): testable with zero network access; the caller wires the
// loader's real output into this function's input.
export function computeJobStats(rawJobs: GitHubJobEntry[]): JobStats {
  const jobs: JobTiming[] = [];
  let incompleteJobCount = 0;
  for (const j of rawJobs) {
    if (!j.startedAt || !j.completedAt) {
      incompleteJobCount += 1;
      continue;
    }
    const durationMs = new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime();
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      incompleteJobCount += 1;
      continue;
    }
    jobs.push({ name: j.name, startedAt: j.startedAt, completedAt: j.completedAt, durationMs });
  }
  const totalJobMinutes = Math.round(jobs.reduce((sum, j) => sum + j.durationMs, 0) / 60000);
  return { jobs, totalJobMinutes, incompleteJobCount };
}

// ===================== Cross-shard overlap detection (Phase 3 item #2, v1) =====================

// WHY module attribution is only ever derived for the formFields track, and
// explicitly undefined otherwise — NOT a placeholder to fill in later, a
// real, honest scope limit for this v1 (2026-09-29): the formFields
// per-entity matrix job names are a fixed, known template
// (`playwright-formFields (${{ matrix.entity }})` — see qa.yml/stage.yml/
// main.yml/sandbox.yml's `run-formfields-tests` job), so the entity name is
// recoverable directly from the job name with no ambiguity. The rest-of-
// suite track's dynamic shard planner (`scripts/plan-shards.ts`, this same
// day's own earlier work) assigns each shard an arbitrary bin-packed set of
// FILES, not a single named module, and its job has no explicit `name:`
// override — GitHub auto-generates one from the matrix object, which does
// not cleanly encode which files/modules that shard actually ran. Building
// real per-shard module attribution for that track would need a structural
// change (the shard's own file list published as a queryable output, or a
// per-shard artifact carrying it) — a real v2, not attempted here. This
// function still reports TIME overlaps for every job pair regardless of
// whether a module tag is derivable, so nothing is silently dropped; only
// the module-specific "same module raced" flag is scoped to what's
// genuinely knowable today.
const FORMFIELDS_JOB_NAME_PATTERN = /playwright-formFields \(([^)]+)\)/i;

export function deriveModuleTag(jobName: string): string | undefined {
  const match = jobName.match(FORMFIELDS_JOB_NAME_PATTERN);
  return match ? `formFields:${match[1]}` : undefined;
}

export interface JobOverlap {
  jobA: string;
  jobB: string;
  overlapStartMs: number;
  overlapEndMs: number;
  overlapDurationMs: number;
  // WHY undefined, not false, when a tag can't be derived for either job
  // (see this section's own top WHY comment): "not the same module" and
  // "unknown whether it's the same module" are different facts a reader
  // needs told apart, exactly the same honesty principle already applied to
  // hasHistoryEverExisted/trendGlyph elsewhere in this pipeline.
  sameModuleTag: string | undefined;
}

// WHY pure, taking JobTiming[] directly (this file's own established
// enrichment-layer convention, matching computeJobStats() immediately
// above): O(n²) pairwise interval-intersection check — deliberately simple
// given real job counts today (qa.yml: 10, stage/main.yml: 11) make an O(n²)
// scan trivially fast; a smarter sweep-line algorithm would be premature
// optimization for this scale, exactly the kind of yes-there's-a-fancier-way
// tradeoff CLAUDE.md rule "don't design for hypothetical future
// requirements" argues against here.
export function detectJobOverlaps(jobs: JobTiming[]): JobOverlap[] {
  const overlaps: JobOverlap[] = [];
  for (let i = 0; i < jobs.length; i++) {
    for (let j = i + 1; j < jobs.length; j++) {
      const a = jobs[i];
      const b = jobs[j];
      const aStart = new Date(a.startedAt).getTime();
      const aEnd = new Date(a.completedAt).getTime();
      const bStart = new Date(b.startedAt).getTime();
      const bEnd = new Date(b.completedAt).getTime();
      const overlapStartMs = Math.max(aStart, bStart);
      const overlapEndMs = Math.min(aEnd, bEnd);
      if (overlapEndMs <= overlapStartMs) continue;
      const tagA = deriveModuleTag(a.name);
      const tagB = deriveModuleTag(b.name);
      overlaps.push({
        jobA: a.name,
        jobB: b.name,
        overlapStartMs,
        overlapEndMs,
        overlapDurationMs: overlapEndMs - overlapStartMs,
        sameModuleTag: tagA && tagA === tagB ? tagA : undefined,
      });
    }
  }
  return overlaps;
}

// ===================== Recovery events lined up against job windows (2026-10-06) =====================

// WHY this exists: Changes to CI sequencing/fixture creation (qa/stage/main/
// sandbox.yml run-formfields-tests now `needs: run-tests`; globalSetup skips
// product fixtures when unused) were made to cut peak concurrent load on the
// shared backend. Whether they helped can only be judged by lining up how
// often tests hit the app's 429 page / "Something is broken" boundary /
// globalSetup transient retries against how many jobs were running at that
// moment — so each test job gets its own counts next to its own start/end and
// the peak number of test jobs running concurrently.
export interface RecoveryEventLike {
  kind: string;
  outcome: string;
  timestamp: string;
}

export interface JobRecoveryRow {
  jobName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  rateLimitPages: number;
  errorBoundaryPages: number;
  setupRetries: number;
  // recoveries whose own retried action threw again (the recovery did NOT save the test)
  failedAfterRecovery: number;
  // Peak number of test jobs (names starting `playwright-`) running at once
  // during this job's whole window, and at the instants its own events fired.
  peakConcurrentInWindow: number;
  maxConcurrentAtEvents: number | undefined;
  // true when no shard label could be attributed to this job (counts are 0
  // because nothing matched, NOT because it was verified clean)
  attributed: boolean;
}

const TEST_JOB_PATTERN = /^playwright-/i;

// Shard labels come from merge-misc-errors.ts (artifact dir minus
// `misc-errors-`): "<env>-<n>" for the dynamic core shards and
// "<env>-formfields-<entity>" for the per-entity formFields matrix.
function jobMatchesShardLabel(jobName: string, label: string): boolean {
  const formFields = label.match(/^[a-z]+-formfields-(.+)$/i);
  if (formFields) {
    return jobName.toLowerCase().includes('formfields') && jobName.includes(`(${formFields[1]})`);
  }
  const core = label.match(/^[a-z]+-(\d+)$/i);
  if (core) {
    return !/formfields/i.test(jobName) && new RegExp(`\\(shard ${core[1]}/`).test(jobName);
  }
  return false;
}

function concurrentAt(jobs: JobTiming[], tMs: number): number {
  return jobs.filter(
    (j) =>
      TEST_JOB_PATTERN.test(j.name) &&
      new Date(j.startedAt).getTime() <= tMs &&
      tMs <= new Date(j.completedAt).getTime()
  ).length;
}

export function buildJobRecoveryRows(
  jobs: JobTiming[],
  recoveryByShard: { shard: string; events: RecoveryEventLike[] }[] | undefined
): JobRecoveryRow[] {
  const shards = recoveryByShard ?? [];
  const rows: JobRecoveryRow[] = [];
  for (const job of jobs.filter((j) => TEST_JOB_PATTERN.test(j.name))) {
    const startMs = new Date(job.startedAt).getTime();
    const endMs = new Date(job.completedAt).getTime();
    const matching = shards.filter((sh) => jobMatchesShardLabel(job.name, sh.shard));
    const events = matching.flatMap((sh) => sh.events);
    // Peak concurrency over the whole window: it can only change at some job's start instant.
    const probes = [startMs, ...jobs.map((j) => new Date(j.startedAt).getTime())].filter(
      (t) => t >= startMs && t <= endMs
    );
    const peakConcurrentInWindow = Math.max(0, ...probes.map((t) => concurrentAt(jobs, t)));
    const atEvents = events
      .map((e) => new Date(e.timestamp).getTime())
      .filter((t) => Number.isFinite(t))
      .map((t) => concurrentAt(jobs, t));
    rows.push({
      jobName: job.name,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      durationMs: job.durationMs,
      rateLimitPages: events.filter((e) => e.kind === 'rate-limit-page').length,
      errorBoundaryPages: events.filter((e) => e.kind === 'error-boundary-page').length,
      setupRetries: events.filter((e) => e.kind === 'globalsetup-transient-retry').length,
      failedAfterRecovery: events.filter((e) => e.outcome === 'failed').length,
      peakConcurrentInWindow,
      maxConcurrentAtEvents: atEvents.length > 0 ? Math.max(...atEvents) : undefined,
      attributed: matching.length > 0,
    });
  }
  return rows.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

// WHY this top-level wrapper exists at all, rather than letting notify.ts
// call fetchGitHubJobs()+computeJobStats() directly: centralizes the single
// "never fail the build" try/catch in one place, matching
// estimateDuration.ts's/syncHistory.ts's own convention of degrading to a
// safe empty/null result rather than letting a network hiccup or a missing
// secret take down the whole notification step.
export async function loadJobStats(
  repo: string | undefined,
  runId: string | undefined,
  token: string | undefined
): Promise<JobStats | null> {
  if (!repo || !runId || !token) return null;
  try {
    const rawJobs = await fetchGitHubJobs(repo, runId, token);
    return computeJobStats(rawJobs);
  } catch {
    return null;
  }
}
