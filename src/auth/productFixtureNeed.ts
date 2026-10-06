import * as fs from 'fs';
import * as path from 'path';

// WHY this file exists (2026-10-06): globalSetup.ts's ensureProductFixtures()
// used to run unconditionally in every Playwright invocation — including the
// Lead/Contact/Company/Task/Deal formFields shards, none of which ever read
// the product fixtures — creating 3 products + 2 reference GETs per job on
// the same endpoint that produced the 2026-09-29 HTTP 429. This module
// answers ONE question: "can we PROVE this invocation selects no spec that
// needs product fixtures?" — and defaults to "no, create them" in every
// ambiguous case. A wrong "skip" would be the dangerous direction; a wrong
// "create" only costs a few API calls.
//
// WHY process.argv: globalSetup runs inside the main Playwright runner
// process, so process.argv holds the real CLI invocation (verified with a
// scratch config: argv = ["test","-c","pw.config.ts","t/a","--grep","@x",
// "--workers=1"]). Playwright's public FullConfig does NOT expose the
// positional file filters (confirmed: no cliArgs/filters key), so argv is the
// only available signal.

// Flags that take their value as a SEPARATE argv token (`--grep @x`, not
// `--grep=@x`). Their value must not be mistaken for a file filter. Only
// genuinely value-taking flags belong here — listing a boolean flag would
// swallow a real file filter that follows it (the unsafe direction).
const VALUE_TAKING_FLAGS = new Set([
  '-c',
  '--config',
  '-g',
  '--grep',
  '--grep-invert',
  '-gv',
  '--project',
  '-j',
  '--workers',
  '--reporter',
  '--retries',
  '--timeout',
  '--shard',
  '--output',
  '--repeat-each',
  '--max-failures',
  '--tsconfig',
  '--trace',
  '--global-timeout',
  '--ui-host',
  '--ui-port',
  '--update-snapshots',
  '--update-source-method',
  '--test-list',
  '--test-list-invert',
]);

export interface ProductFixtureNeed {
  needed: boolean;
  reason: string;
}

/** Extracts the positional file filters from a Playwright CLI argv (the part after `process.argv[0..1]`). */
export function extractFileFilters(cliArgs: string[]): { filters: string[]; ambiguous: boolean } {
  const testIdx = cliArgs.indexOf('test');
  if (testIdx === -1) return { filters: [], ambiguous: true };
  const filters: string[] = [];
  let ambiguous = false;
  for (let i = testIdx + 1; i < cliArgs.length; i++) {
    const token = cliArgs[i];
    if (token.startsWith('-')) {
      if (VALUE_TAKING_FLAGS.has(token)) i++; // skip its separate value token
      continue;
    }
    // A bare token that doesn't look like a path (e.g. a stray flag value we
    // don't know about) can't be proven to be a file filter OR not one.
    if (!/[\\/]|\.(spec|test)\.|\.[tj]s$/.test(token)) ambiguous = true;
    filters.push(token);
  }
  return { filters, ambiguous };
}

function listCandidateFiles(testDirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
      } else if (/\.spec\.ts$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  testDirs.forEach(walk);
  return out;
}

// A spec "needs product fixtures" if EITHER (a) it imports the fixture
// accessor (the only sanctioned reader — see productFixtureAccessor.ts), so a
// future reader is picked up automatically with no list to maintain, OR
// (b) its path names Products & Services at all (deliberately broader: covers
// the Products & Services formFields shard on request, and any future spec
// that touches the module without importing the accessor).
function needsFixtures(file: string): boolean {
  if (/productsAndServices/i.test(file)) return true;
  try {
    return fs.readFileSync(file, 'utf8').includes('productFixtureAccessor');
  } catch {
    return true; // unreadable → assume it needs them
  }
}

function filterMatches(filter: string, file: string): boolean {
  const posix = file.split(path.sep).join('/');
  try {
    return new RegExp(filter, 'i').test(posix);
  } catch {
    return posix.toLowerCase().includes(filter.toLowerCase());
  }
}

/**
 * Decides whether this Playwright invocation may need Products & Services
 * fixtures. `needed: false` is returned ONLY when positional file filters are
 * present, unambiguous, and none of them matches any fixture-needing spec.
 */
export function selectionNeedsProductFixtures(
  cliArgs: string[],
  testDirs: string[]
): ProductFixtureNeed {
  const { filters, ambiguous } = extractFileFilters(cliArgs);
  if (filters.length === 0) {
    return {
      needed: true,
      reason: 'no positional file filters (whole suite or grep-only selection) — cannot prove P&S specs are excluded',
    };
  }
  if (ambiguous) {
    return { needed: true, reason: `unrecognised filter token(s) in [${filters.join(' ')}] — cannot prove P&S specs are excluded` };
  }
  const candidates = listCandidateFiles(testDirs).filter(needsFixtures);
  if (candidates.length === 0) {
    // No fixture-needing spec found on disk at all — more likely a wrong
    // testDirs than a real absence, so do not skip on that basis.
    return { needed: true, reason: 'no fixture-needing specs found under the test dirs — refusing to infer a skip' };
  }
  const hit = candidates.find((file) => filters.some((filter) => filterMatches(filter, file)));
  if (hit) {
    return { needed: true, reason: `file filter [${filters.join(' ')}] matches ${path.basename(hit)}` };
  }
  return {
    needed: false,
    reason: `file filters [${filters.join(' ')}] match none of ${candidates.length} fixture-needing specs`,
  };
}
