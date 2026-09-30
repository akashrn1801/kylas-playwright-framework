/**
 * Static guard-rail checks for this repo's test-writing conventions — see
 * docs/CONTRIBUTING_TESTS.md for the full narrative reasoning behind each
 * rule. Run via `npm run check:conventions`. Exits 1 with a clear,
 * file:line-anchored message on the FIRST rule that finds any violation
 * across the whole suite (all violations for that rule are printed, not
 * just the first one) — never silently passes on a rule it couldn't
 * evaluate; an unparseable file is itself reported as a violation, not
 * skipped quietly.
 *
 * WHY the TypeScript compiler API (`ts.createSourceFile`), not regex
 * scanning, for rules 1/2/5: a regex over raw source text is fragile
 * against ordinary formatting variance (multi-line call arguments, a title
 * built from a template literal, a commented-out call that still LOOKS like
 * a match) — this repo's own commit history already shows real bugs from
 * exactly this class of pattern-matching fragility (CLAUDE.md rule 15's
 * "ID-capture... bare substring" lesson, applied here to source-code
 * scanning rather than network predicates). `typescript` is already a
 * project dependency; parsing each spec file into a real AST and walking
 * actual CallExpression/ImportDeclaration nodes is barely more code and
 * categorically more correct.
 */
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

const REPO_ROOT = path.join(__dirname, '..');
const TESTS_ROOT = path.join(REPO_ROOT, 'tests');
const SHARED_CONFIG_SUITES_PATH = path.join(REPO_ROOT, 'config/sharedConfigSuites.json');

// WHY this exact exception list, not a broader pattern (2026-09-30): mirrors
// docs/CONTRIBUTING_TESTS.md §A.2's own documented exception — login.spec.ts
// tests the login UI itself and must not depend on the auth machinery it's
// testing, so it alone is allowed to import from '@playwright/test' directly.
const PLAYWRIGHT_TEST_IMPORT_EXCEPTIONS = new Set(['tests/ui/dashboard/login.spec.ts']);

// WHY this verb list (2026-09-30): a real, if necessarily incomplete,
// enumeration of this codebase's own mutating-method naming convention
// (createXxx/updateXxx/deleteXxx/saveXxx/editXxx/addXxx/removeXxx/
// cloneXxx/reassignXxx — confirmed via grep across every *Page.ts file's
// own "Workflow Wrappers"/"Form Actions"/"Edit Actions" sections). A
// verb-prefix + following-uppercase-letter check (camelCase method names)
// deliberately avoids flagging an unrelated method that merely CONTAINS one
// of these words (e.g. a getter named `getUpdatedAt`) — the uppercase
// boundary requirement means only a real "verbNoun" method name matches.
const MUTATING_METHOD_PATTERN = /^(create|update|delete|save|edit|add|remove|clone|reassign)[A-Z]/;

interface Violation {
  rule: string;
  file: string;
  line: number;
  message: string;
}

function toRepoRelative(absPath: string): string {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

function findSpecFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSpecFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

// WHY this heuristic for "is this call a test registration," not a full
// type-checker Program (2026-09-30): this repo's own real, consistent
// naming convention is that every test object is either the bare
// identifier `test` or an identifier ending in `Test` (`leadTest`,
// `companyTest`, `baseTest`, ... — confirmed via grep across every spec
// file touched this session). Building a full `ts.Program` with type
// information to trace these back to their real `@playwright/test` origin
// would be categorically more accurate but also far more code/runtime cost
// for a guard script meant to run on every commit — this heuristic has zero
// known false negatives against this repo's actual current test files (see
// this script's own verification section in known-issues.md/the session
// report for the real positive-control run confirming that).
function isTestRegistrationCall(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) {
    return expr.text === 'test' || /Test$/.test(expr.text);
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const baseIsTestObject = expr.expression.text === 'test' || /Test$/.test(expr.expression.text);
    return baseIsTestObject && (expr.name.text === 'skip' || expr.name.text === 'only' || expr.name.text === 'fixme');
  }
  return false;
}

function forEachDescendant(node: ts.Node, cb: (n: ts.Node) => void): void {
  cb(node);
  ts.forEachChild(node, (child) => forEachDescendant(child, cb));
}

function checkFile(
  filePath: string,
  sharedConfigDirs: string[]
): Violation[] {
  const violations: Violation[] = [];
  const relPath = toRepoRelative(filePath);
  const text = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  // ── Rule 5: no direct @playwright/test import except the documented exception ──
  for (const stmt of sourceFile.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      stmt.moduleSpecifier.text === '@playwright/test' &&
      !PLAYWRIGHT_TEST_IMPORT_EXCEPTIONS.has(relPath)
    ) {
      // WHY not flagging `import { Page } from '@playwright/test'`-style
      // TYPE-ONLY imports (2026-09-30): confirmed live in this repo
      // (companyFieldLimits.spec.ts imports `Page` this way) that a type
      // import has no bearing on the actual `test`/`expect` runtime
      // machinery rule 5 exists to protect — only flag when the import
      // brings in `test` and/or `expect` themselves.
      const bringsInTestOrExpect =
        stmt.importClause?.namedBindings &&
        ts.isNamedImports(stmt.importClause.namedBindings) &&
        stmt.importClause.namedBindings.elements.some((el) => el.name.text === 'test' || el.name.text === 'expect');
      if (bringsInTestOrExpect) {
        violations.push({
          rule: 'no-direct-playwright-test-import',
          file: relPath,
          line: lineOf(sourceFile, stmt),
          message: `imports test/expect from '@playwright/test' directly — import from 'src/fixtures/index.ts' instead (see docs/CONTRIBUTING_TESTS.md §A.2 for the one documented exception, login.spec.ts)`,
        });
      }
    }
  }

  // ── Rules 1 & 2: walk every test-registration call ──
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !isTestRegistrationCall(node)) return;
    const titleArg = node.arguments[0];
    if (!titleArg || !ts.isStringLiteralLike(titleArg)) return; // can't check a computed/dynamic title
    const title = titleArg.text;

    // Rule 1: every test must carry at least one @tag
    if (!/@\w+/.test(title)) {
      violations.push({
        rule: 'untagged-test',
        file: relPath,
        line: lineOf(sourceFile, node),
        message: `test has no @tag ("${title}") — every test must carry at least one of @smoke/@regression/@prodSafe (CLAUDE.md's Key Conventions)`,
      });
    }

    // Rule 2: an @prodSafe test must never call a create/update/delete method
    if (/@prodSafe\b/.test(title)) {
      const callbackArg = node.arguments[1];
      if (callbackArg && (ts.isArrowFunction(callbackArg) || ts.isFunctionExpression(callbackArg))) {
        forEachDescendant(callbackArg.body, (inner) => {
          if (
            ts.isCallExpression(inner) &&
            ts.isPropertyAccessExpression(inner.expression) &&
            MUTATING_METHOD_PATTERN.test(inner.expression.name.text)
          ) {
            violations.push({
              rule: 'prodsafe-mutating-call',
              file: relPath,
              line: lineOf(sourceFile, inner),
              message: `@prodSafe test ("${title}") calls "${inner.expression.name.text}(...)" — a create/update/delete/save/edit/add/remove/clone/reassign method must never run under @prodSafe (prod.yml runs this unsharded against the real production app)`,
            });
          }
        });
      }
    }
  });

  // ── Rule 3: spec filename must match detect-tests.sh's own convention ──
  // WHY these exact two conditions, not a fuller re-implementation of
  // .github/scripts/detect-tests.sh's own module-extraction logic
  // (2026-09-30): that script's own job is DISCOVERY (given a changed file,
  // which module's tests to run) — this rule's job is narrower and purely
  // structural (given a spec file that already exists, is its OWN name
  // shaped the way that script assumes every spec file's name is shaped).
  // Re-deriving the full module-name mapping here would duplicate that
  // script's own logic in a second place, risking exactly the kind of
  // drift CLAUDE.md rule 9 warns against — these two checks catch the
  // concrete, real failure mode (a UI file wrongly suffixed `.rbac.spec.ts`
  // or vice versa) without needing to re-implement the rest.
  const relDir = path.posix.dirname(relPath);
  if (relDir.startsWith('tests/ui/') && !relPath.endsWith('.spec.ts')) {
    violations.push({
      rule: 'spec-naming-convention',
      file: relPath,
      line: 1,
      message: `file under tests/ui/ must end in .spec.ts`,
    });
  }
  if (relDir.startsWith('tests/ui/') && relPath.endsWith('.rbac.spec.ts')) {
    violations.push({
      rule: 'spec-naming-convention',
      file: relPath,
      line: 1,
      message: `file under tests/ui/ must NOT end in .rbac.spec.ts — that suffix is reserved for tests/rbac/`,
    });
  }
  if (relDir.startsWith('tests/rbac/') && !relPath.endsWith('.rbac.spec.ts')) {
    violations.push({
      rule: 'spec-naming-convention',
      file: relPath,
      line: 1,
      message: `file under tests/rbac/ must end in .rbac.spec.ts (see .github/scripts/detect-tests.sh's own flat-file and subfolder conventions)`,
    });
  }

  // ── Rule 4: a spec importing a *Lock/*LockFactory module must live under a
  // directory registered in config/sharedConfigSuites.json ──
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    const basename = spec.split('/').pop() ?? '';
    if (!/Lock(Factory)?$/.test(basename)) continue;
    const isRegistered = sharedConfigDirs.some((dir) => relDir === dir || relDir.startsWith(`${dir}/`));
    if (!isRegistered) {
      violations.push({
        rule: 'unregistered-shared-config-suite',
        file: relPath,
        line: lineOf(sourceFile, stmt),
        message: `imports a cross-process lock module ("${spec}") but its directory ("${relDir}") isn't listed in config/sharedConfigSuites.json — a shared-config suite MUST be registered there so scripts/plan-shards.ts excludes it from ordinary bin-packing (see docs/CONTRIBUTING_TESTS.md §C and the 2026-09-29 known-issues.md cross-shard race entry this protects against)`,
      });
    }
  }

  return violations;
}

function loadSharedConfigDirs(): string[] {
  const raw = JSON.parse(fs.readFileSync(SHARED_CONFIG_SUITES_PATH, 'utf-8')) as Record<
    string,
    { uiDir: string; rbacDir: string }
  >;
  const dirs: string[] = [];
  for (const entry of Object.values(raw)) {
    dirs.push(entry.uiDir.replace(/\/+$/, ''), entry.rbacDir.replace(/\/+$/, ''));
  }
  return dirs;
}

function main(): void {
  const sharedConfigDirs = loadSharedConfigDirs();
  const specFiles = findSpecFiles(TESTS_ROOT);
  const allViolations: Violation[] = [];
  for (const file of specFiles) {
    allViolations.push(...checkFile(file, sharedConfigDirs));
  }

  if (allViolations.length === 0) {
    logger.success(`check-test-conventions: ${specFiles.length} spec file(s) checked, 0 violations`);
    return;
  }

  logger.error(`check-test-conventions: ${allViolations.length} violation(s) across ${specFiles.length} spec file(s):`);
  const byRule = new Map<string, Violation[]>();
  for (const v of allViolations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule)!.push(v);
  }
  for (const [rule, list] of byRule) {
    logger.error(`── ${rule} (${list.length}) ──`);
    for (const v of list) {
      logger.error(`  ${v.file}:${v.line} — ${v.message}`);
    }
  }
  process.exitCode = 1;
}

main();
