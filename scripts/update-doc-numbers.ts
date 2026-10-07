/**
 * Regenerates every `<!-- GEN:<name>:START -->` ... `<!-- GEN:<name>:END -->`
 * block in the repo's docs from the real repo (test counts, module table,
 * tag counts, shard plan, CI workflow matrix) — never hand-edited. The figure
 * definitions live in scripts/lib/docFigures.ts and are shared with
 * `npm run check:docs`, so what this writes is exactly what the guard checks.
 *
 * Run via `npm run docs:refresh` (alias: `npm run update:doc-numbers`). It
 * runs one `playwright test --list` per tag plus the shard planner (no app
 * access, no login), then rewrites each block in place. Part of the
 * Definition of Done in CLAUDE.md / docs/CONTRIBUTING_TESTS.md.
 *
 * Refresh docs/figures only AFTER `npm run generate:test-counts` if the suite
 * changed — the offline blocks derive from config/expected-test-counts.json.
 */
import * as fs from 'fs';
import * as path from 'path';
import { applyBlock, computeBlocks, findBlocks, REPO_ROOT } from './lib/docFigures';
import { logger } from '../src/utils/logger';

function listDocFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(path.join(REPO_ROOT, 'docs'));
  for (const f of ['CLAUDE.md', 'README.md', 'APPLICATION_BUGS.md', 'CHANGELOG.md']) {
    const full = path.join(REPO_ROOT, f);
    if (fs.existsSync(full)) out.push(full);
  }
  return out;
}

function main(): void {
  logger.info('[docs:refresh] Computing generated figures (live: one --list per tag + shard planner)...');
  const blocks = computeBlocks(true);
  let changed = 0;
  const used = new Set<string>();
  for (const file of listDocFiles()) {
    const before = fs.readFileSync(file, 'utf-8');
    let after = before;
    for (const { name } of findBlocks(before)) {
      const body = blocks[name as keyof typeof blocks];
      if (body === undefined) {
        logger.error(`[docs:refresh] ${path.relative(REPO_ROOT, file)} has unknown block "GEN:${name}" — known: ${Object.keys(blocks).join(', ')}`);
        process.exitCode = 1;
        continue;
      }
      used.add(name);
      after = applyBlock(after, name, body);
    }
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed++;
      logger.success(`[docs:refresh] updated ${path.relative(REPO_ROOT, file)}`);
    }
  }
  const unused = Object.keys(blocks).filter((n) => !used.has(n));
  if (unused.length > 0) logger.warn(`[docs:refresh] figure(s) defined but not embedded in any doc: ${unused.join(', ')}`);
  logger.success(`[docs:refresh] done — ${changed} file(s) changed.`);
}

main();
