/**
 * Validates that every workflow's `run-formfields-tests` job matrix agrees
 * with `config/sharedConfigSuites.json`'s `formFields.entities` — the single
 * source of truth `scripts/plan-shards.ts` already reads for its own
 * exclusion list (see that file's header).
 *
 * WHY this exists instead of making every workflow's matrix dynamically
 * READ the config file directly (2026-09-30 — a real, deliberate design
 * reversal, not an oversight): an earlier version of this change added a
 * `needs: plan` dependency to `qa.yml`/`stage.yml`/`main.yml`'s
 * `run-formfields-tests` job so its matrix could read
 * `fromJSON(needs.plan.outputs.formfields_entities_json)` — but that job
 * previously had NO `needs:` at all and ran fully in parallel with
 * `plan`/`run-tests`. Adding the dependency introduced REAL new latency on
 * that job's own critical path (waiting for `plan`'s checkout+npm-ci+list
 * run to finish first) purely to save a human from occasionally
 * re-checking 3 short array literals — a bad trade given how rarely this
 * array changes (once per new formFields entity, historically ~every few
 * weeks at most). This script gets the real benefit (drift can never ship
 * unnoticed) without the latency cost: `qa.yml`/`stage.yml`/`main.yml` keep
 * their original hardcoded, zero-dependency, zero-latency matrix; this
 * check (wired into CI or run manually) catches the moment it goes stale
 * instead of preventing staleness by construction. `sandbox.yml` is the one
 * exception — its `run-formfields-tests` already depended on its own
 * `detect` job for an UNRELATED reason (the `run_formfields_track` gate),
 * so making its matrix genuinely dynamic there was free (no new latency) —
 * it's checked here for internal consistency (uses the dynamic form
 * correctly), not for content drift (which is structurally impossible for
 * it by construction).
 *
 * Run via `npm run check:formfields-matrix-sync`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

const REPO_ROOT = path.join(__dirname, '..');
const SHARED_CONFIG_SUITES_PATH = path.join(REPO_ROOT, 'config/sharedConfigSuites.json');

// WHY these 3 specifically checked for a HARDCODED array, not sandbox.yml
// too (2026-09-30): see this file's own header WHY comment — sandbox.yml
// deliberately uses the dynamic `fromJSON(...)` form instead, checked
// separately below.
const HARDCODED_MATRIX_WORKFLOWS = ['qa.yml', 'stage.yml', 'main.yml'];
const DYNAMIC_MATRIX_WORKFLOWS = ['sandbox.yml'];

const ENTITY_ARRAY_PATTERN = /entity:\s*\[([^\]]*)\]/;
const DYNAMIC_ENTITY_PATTERN = /entity:\s*\$\{\{\s*fromJSON\(needs\.\w+\.outputs\.formfields_entities_json\)\s*\}\}/;

function loadExpectedEntities(): string[] {
  const raw = JSON.parse(fs.readFileSync(SHARED_CONFIG_SUITES_PATH, 'utf-8')) as {
    formFields: { entities: string[] };
  };
  return raw.formFields.entities;
}

function sortedEqual(a: string[], b: string[]): boolean {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function main(): void {
  const expected = loadExpectedEntities();
  const violations: string[] = [];

  for (const workflow of HARDCODED_MATRIX_WORKFLOWS) {
    const workflowPath = path.join(REPO_ROOT, '.github/workflows', workflow);
    const text = fs.readFileSync(workflowPath, 'utf-8');
    const match = text.match(ENTITY_ARRAY_PATTERN);
    if (!match) {
      violations.push(`${workflow}: no "entity: [...]" matrix line found — expected a hardcoded array here (see this script's own WHY comment for why this workflow deliberately does NOT use the dynamic fromJSON form)`);
      continue;
    }
    const actual = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!sortedEqual(actual, expected)) {
      violations.push(
        `${workflow}: matrix entities [${actual.join(', ')}] do not match config/sharedConfigSuites.json's formFields.entities [${expected.join(', ')}] — update this workflow's "entity: [...]" line to match`
      );
    }
  }

  for (const workflow of DYNAMIC_MATRIX_WORKFLOWS) {
    const workflowPath = path.join(REPO_ROOT, '.github/workflows', workflow);
    const text = fs.readFileSync(workflowPath, 'utf-8');
    if (!DYNAMIC_ENTITY_PATTERN.test(text)) {
      violations.push(
        `${workflow}: expected a dynamic "entity: \${{ fromJSON(needs.<job>.outputs.formfields_entities_json) }}" matrix line — none found (or it no longer matches the expected shape)`
      );
    }
  }

  if (violations.length === 0) {
    logger.success(
      `check-formfields-matrix-sync: all ${HARDCODED_MATRIX_WORKFLOWS.length} hardcoded-matrix workflows match config/sharedConfigSuites.json, all ${DYNAMIC_MATRIX_WORKFLOWS.length} dynamic-matrix workflows use the expected form`
    );
    return;
  }

  logger.error(`check-formfields-matrix-sync: ${violations.length} violation(s):`);
  for (const v of violations) logger.error(`  ${v}`);
  process.exitCode = 1;
}

main();
