/**
 * Build #240 (sandbox, run 45630312674, 2026-11-25; 0 failed, 942 passed, 8 flaky, 1 skipped; the Playwright container on) as a third offline fixture,
 * replayed through the same real pipeline (scripts/lib/build235Fixture.ts). Provenance: scripts/fixtures/build-240/README.md. Only the run's email was
 * available (no results.json, no run-meta), so this fixture is rebuilt FROM THE EMAIL: the 8 flaky tests, their errors and the slowest tests are real; the
 * background errors, the 429 events and the history record of the run itself are reconstructed to the email's counts.
 */
import * as path from 'path';
import { GitHubJobEntry } from '../../src/notifications/JobStats';
import { isExpectedBackgroundNoise } from '../../src/error-collector/errorFilters';
import { BuildMeta, Replay, loadFixture, replayBuild235 } from './build235Fixture';

export const FIXTURE_DIR_240 = path.resolve(__dirname, '../fixtures/build-240');

export const BUILD_240: BuildMeta = {
  runId: '45630312674',
  buildNumber: '240',
  env: 'staging',
  branch: 'sandbox',
  commit: '5c0c67b9a1f2e3d4c5b6a7980112233445566778',
  triggeredBy: 'akashrn1801',
  startTime: '2026-11-25T14:08:52.000Z',
  // "Duration 2h 23m 26s": no rerun ran
  totalDurationMs: 8_606_000,
  rerunDurationMs: 0,
  workers: 22,
  playwrightVersion: '1.60.0',
  generatedAt: '2026-11-25T16:36:27.000Z',
  runUrl: 'https://github.com/akashrn1801/kylas-playwright-framework/actions/runs/45630312674',
  history: { current: 240, tailExcludes: '999' },
  includeFlaky: false,
};

// Job windows are the email's Load Signals times (IST) minus 5 h 30 min, to the minute.
export function buildJobs240(): GitHubJobEntry[] {
  const d = '2026-11-25';
  const job = (name: string, from: string, to?: string): GitHubJobEntry => ({ name, startedAt: `${d}T${from}Z`, ...(to ? { completedAt: `${d}T${to}Z` } : {}) }) as GitHubJobEntry;
  return [
    job('detect target + shard plan', '14:04:00', '14:05:10'),
    job('renew session if under the run window', '14:05:15', '14:07:30'),
    job('playwright-selective (shard 1/5)', '14:07:00', '15:42:28'),
    job('playwright-selective (shard 2/5)', '14:07:00', '15:35:54'),
    job('playwright-selective (shard 3/5)', '14:07:00', '15:31:46'),
    job('playwright-selective (shard 4/5)', '14:07:00', '15:21:51'),
    job('playwright-selective (shard 5/5)', '14:07:00', '14:30:00'),
    job('playwright-formFields (contact)', '15:44:00', '16:24:00'),
    job('playwright-formFields (company)', '15:44:00', '16:25:00'),
    job('playwright-formFields (deal)', '15:44:00', '16:26:00'),
    job('playwright-formFields (lead)', '15:44:00', '16:32:05'),
    job('playwright-formFields (productsAndServices)', '15:44:00', '16:24:00'),
    job('playwright-formFields (task)', '15:44:00', '16:24:00'),
    job('reset dedicated form-field limits', '16:33:00', '16:34:30'),
    job('merge report + notify', '16:35:00'),
  ];
}

/** The stored errors carry the classification of the day; apply the CURRENT known-noise rules (as loadFixture239 does). */
export function loadFixture240(): ReturnType<typeof loadFixture> {
  const fx = loadFixture(FIXTURE_DIR_240);
  for (const e of fx.misc.errors) {
    if (!e.expectedReason && isExpectedBackgroundNoise(e.message, e.url, e.responseBody)) e.expectedReason = 'background-noise';
  }
  fx.misc.unexpectedErrors = fx.misc.errors.filter((e) => !e.expectedReason).length;
  fx.misc.expectedRbacErrors = fx.misc.errors.filter((e) => e.expectedReason === 'rbac').length;
  fx.misc.expectedBackgroundNoiseErrors = fx.misc.errors.filter((e) => e.expectedReason === 'background-noise').length;
  return fx;
}

export function replayBuild240(): Replay {
  return replayBuild235({
    fixture: loadFixture240(),
    meta: BUILD_240,
    jobs: buildJobs240(),
    sessions: [
      { role: 'admin', endIso: '2026-11-26T02:07:21.000Z', minutesLeft: 720, renewedAt: '2026-11-25T14:07:21.000Z' },
      { role: 'restricted', endIso: '2026-11-26T02:07:22.000Z', minutesLeft: 720, renewedAt: '2026-11-25T14:07:23.000Z' },
    ],
    // The pushed commit is the sandbox merge. The fixture has no git history, so the feature head's subject and author are placeholders.
    commit: {
      sha: '9d3e5f7a1b2c4d6e8f0a1b2c3d4e5f6a7b8c9d0e',
      url: 'https://github.com/akashrn1801/kylas-playwright-framework/commit/9d3e5f7a1b2c4d6e8f0a1b2c3d4e5f6a7b8c9d0e',
      message: 'Sample feature commit subject (fixture)',
      author: 'akashrn1801',
      merge: { sha: BUILD_240.commit, url: `https://github.com/akashrn1801/kylas-playwright-framework/commit/${BUILD_240.commit}`, into: 'sandbox' },
    },
  });
}
