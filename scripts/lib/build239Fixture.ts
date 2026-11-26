/**
 * Build #239 (sandbox, run 45553181980, 2026-11-25) as a second offline fixture, replayed through the same real pipeline as #235
 * (scripts/lib/build235Fixture.ts, parameterised with BuildMeta). Provenance: scripts/fixtures/build-239/README.md.
 *
 * What the replay must reproduce (from the run's own email and rerun-summary.json): 943 tests; first run 940 passed / 1 failed / 1 flaky /
 * 1 skipped (the 3 Leads RBAC known-bug tests, test.fail(), are passed); the rerun recovered the 1 failure; final 942 passed.
 */
import * as path from 'path';
import { GitHubJobEntry } from '../../src/notifications/JobStats';
import { isExpectedBackgroundNoise } from '../../src/error-collector/errorFilters';
import { BuildMeta, ReplayOptions, Replay, loadFixture, replayBuild235 } from './build235Fixture';

export const FIXTURE_DIR_239 = path.resolve(__dirname, '../fixtures/build-239');

export const BUILD_239: BuildMeta = {
  runId: '45553181980',
  buildNumber: '239',
  env: 'staging',
  branch: 'sandbox',
  commit: 'f3dee9ed9cbb88b014fbaa8d7f19a62b98b4e75a',
  triggeredBy: 'akashrn1801',
  startTime: '2026-11-25T05:45:06.398Z',
  // "Duration 2h 55m 17s" includes the rerun shard's 63,911 ms.
  totalDurationMs: 10_517_117,
  rerunDurationMs: 63_911.158935546875,
  workers: 22,
  playwrightVersion: '1.60.0',
  generatedAt: '2026-11-25T08:42:57.000Z',
  runUrl: 'https://github.com/akashrn1801/kylas-playwright-framework/actions/runs/45553181980',
  history: { current: 239, tailExcludes: '999' },
  includeFlaky: false,
};

// Job windows are the email's Load Signals times (IST) minus 5 h 30 min, to the minute.
export function buildJobs239(): GitHubJobEntry[] {
  const d = '2026-11-25';
  const job = (name: string, from: string, to?: string): GitHubJobEntry => ({ name, startedAt: `${d}T${from}Z`, ...(to ? { completedAt: `${d}T${to}Z` } : {}) }) as GitHubJobEntry;
  return [
    job('detect target + shard plan', '05:42:00', '05:43:10'),
    job('renew session if under the run window', '05:43:15', '05:44:00'),
    job('playwright-selective (shard 1/5)', '05:44:00', '07:46:40'),
    job('playwright-selective (shard 2/5)', '05:44:00', '07:04:41'),
    job('playwright-selective (shard 3/5)', '05:44:00', '07:15:08'),
    job('playwright-selective (shard 4/5)', '05:44:00', '07:14:41'),
    job('playwright-selective (shard 5/5)', '05:44:00', '06:04:00'),
    job('playwright-rerun (failed+flaky)', '07:47:00', '07:48:04'),
    job('playwright-formFields (productsAndServices)', '07:49:00', '08:28:00'),
    job('playwright-formFields (deal)', '07:49:00', '08:31:00'),
    job('playwright-formFields (company)', '07:49:00', '08:38:58'),
    job('playwright-formFields (task)', '07:49:00', '08:29:00'),
    job('playwright-formFields (lead)', '07:49:00', '08:37:00'),
    job('playwright-formFields (contact)', '07:49:00', '08:29:00'),
    job('reset dedicated form-field limits', '08:39:30', '08:40:30'),
    job('merge report + notify', '08:41:00'),
  ];
}

export interface Replay239Options extends Pick<ReplayOptions, 'withSkipReason'> {
  /** Replay the run with the redesigned email (default) is the same code path; kept for symmetry with replayBuild235. */
  keepDir?: boolean;
}

/**
 * The stored errors carry the classification the collector made on the day (before the "no pipeline attached" rule, 2026-11-25). A replay applies
 * the CURRENT rule to the errors that were unexpected, so the render shows what the next run's email will show; the real email is the "before".
 */
export function loadFixture239(): ReturnType<typeof loadFixture> {
  const fx = loadFixture(FIXTURE_DIR_239);
  for (const e of fx.misc.errors) {
    if (!e.expectedReason && isExpectedBackgroundNoise(e.message, e.url, e.responseBody)) e.expectedReason = 'background-noise';
  }
  fx.misc.unexpectedErrors = fx.misc.errors.filter((e) => !e.expectedReason).length;
  fx.misc.expectedRbacErrors = fx.misc.errors.filter((e) => e.expectedReason === 'rbac').length;
  fx.misc.expectedBackgroundNoiseErrors = fx.misc.errors.filter((e) => e.expectedReason === 'background-noise').length;
  return fx;
}

export function replayBuild239(opts: Replay239Options = {}): Replay {
  return replayBuild235({
    ...opts,
    fixture: loadFixture239(),
    meta: BUILD_239,
    jobs: buildJobs239(),
    sessions: [
      { role: 'admin', endIso: '2026-11-25T16:28:47.000Z', minutesLeft: 644 },
      { role: 'restricted', endIso: '2026-11-25T17:24:39.000Z', minutesLeft: 700 },
    ],
    // The run's commit is the sandbox merge; the feature branch's head commit text is SAMPLE (the fixture has no git history).
    commit: {
      sha: '5a1c0de0b2d94f7e8a1b3c4d5e6f708192a3b4c5',
      url: 'https://github.com/akashrn1801/kylas-playwright-framework/commit/5a1c0de0b2d94f7e8a1b3c4d5e6f708192a3b4c5',
      message: 'Sample feature commit subject (fixture)',
      author: 'akashrn1801',
      merge: { sha: BUILD_239.commit, url: `https://github.com/akashrn1801/kylas-playwright-framework/commit/${BUILD_239.commit}`, into: 'sandbox' },
    },
  });
}
