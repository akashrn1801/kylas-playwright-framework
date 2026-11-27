/**
 * Checks .github/scripts/escalate-selective-target.sh: a selective target above
 * the threshold escalates to "--grep @regression" with every formFields entity
 * (what detect-tests.sh's full selection writes); a small one, @smoke and
 * @regression stay as they are. Run via `npm run check:selective-escalation`.
 * Background: sandbox run 45942780971 (450 tests as one shard hit the 3h limit).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT = '.github/scripts/escalate-selective-target.sh';
const ALL_ENTITIES: string[] = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'config/sharedConfigSuites.json'), 'utf-8')
).formFields.entities;

function run(target: string, count: number): Record<string, string> {
  const res = spawnSync('bash', [SCRIPT, target, String(count)], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (res.status !== 0) {
    throw new Error(`script exited ${res.status} for ${target} / ${count}: ${res.stderr}`);
  }
  const out: Record<string, string> = {};
  for (const line of res.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

const SELECTIVE = 'tests/ui/leads/ tests/rbac/leads.rbac.spec.ts';
const cases: Array<{ name: string; check: () => boolean }> = [
  {
    name: 'selective 450 escalates to the full sharded selection with every entity',
    check: () => {
      const r = run(SELECTIVE, 450);
      return r.escalated === 'true' && r.target === '--grep @regression' &&
        JSON.stringify(JSON.parse(r.formfields_entities_json)) === JSON.stringify(ALL_ENTITIES);
    },
  },
  {
    name: 'selective 151 escalates (just above the threshold)',
    check: () => run(SELECTIVE, 151).escalated === 'true',
  },
  {
    name: 'selective 150 stays selective (at the threshold)',
    check: () => { const r = run(SELECTIVE, 150); return r.escalated === 'false' && r.target === SELECTIVE; },
  },
  {
    name: 'selective 30 stays selective',
    check: () => { const r = run(SELECTIVE, 30); return r.escalated === 'false' && r.target === SELECTIVE && !('formfields_entities_json' in r); },
  },
  {
    name: '--grep @smoke is never escalated, whatever the count',
    check: () => run('--grep @smoke', 400).escalated === 'false',
  },
  {
    name: '--grep @regression is unchanged (already the sharded path)',
    check: () => { const r = run('--grep @regression', 500); return r.escalated === 'false' && r.target === '--grep @regression'; },
  },
];

let failed = 0;
for (const c of cases) {
  let ok = false;
  try { ok = c.check(); } catch (err) { logger.error(`  ${(err as Error).message}`); }
  if (ok) logger.info(`PASS ${c.name}`); else { failed++; logger.error(`FAIL ${c.name}`); }
}
if (failed > 0) { logger.error(`${failed} of ${cases.length} escalation checks failed`); process.exit(1); }
logger.info(`All ${cases.length} escalation checks passed`);
