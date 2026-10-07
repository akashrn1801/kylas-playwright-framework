/**
 * Documentation guard — run via `npm run check:docs` (fast, offline) or
 * `npm run check:docs -- --live` (adds the live-derived figures: tag counts +
 * shard plan; one `playwright test --list` per tag + the shard planner, no
 * app access). NOT wired into the pre-commit hook or CI — see
 * docs/CONTRIBUTING_TESTS.md §"Pre-commit checklist" for the proposed hook.
 *
 * Fails (exit 1) on:
 *  - a doc over its declared size budget, or over the 60k hard cap
 *    (warns at >=70% of budget)
 *  - a missing header field (Purpose / Read when / Size budget / Last verified)
 *  - a malformed or stale "Last verified" (bad shape, unknown commit, or a
 *    date older than the file's own last modification)
 *  - a dead internal markdown link, or a dead `#anchor` inside a link
 *  - a backticked repo path / bare file name / `npm run` script that no longer
 *    exists (opt out per line with `<!-- ref-ok -->`; CHANGELOG.md is exempt)
 *  - a CLAUDE.md route (link or backticked path) pointing at a missing file
 *  - a generated figure (GEN block) that differs from the real repo, or an
 *    unknown/unpaired GEN block
 *  - a hand-typed suite figure ("123 tests", "5 shards", ...) outside a GEN
 *    block in a "living" doc (opt out per line with `<!-- doc-figure-ok -->`)
 *  - CLAUDE.md or CONTRIBUTING_TESTS.md no longer carrying the Definition of
 *    Done (`docs:refresh`)
 * Warns on: a docs/ file not reachable from CLAUDE.md or docs/README.md.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { computeBlocks, findBlocks, LIVE_BLOCKS, OFFLINE_BLOCKS, REPO_ROOT } from './lib/docFigures';
import { logger } from '../src/utils/logger';

const HARD_CAP_CHARS = 60_000;
const WARN_RATIO = 0.7;
const REQUIRED_HEADER_FIELDS = ['Purpose', 'Read when', 'Size budget', 'Last verified'] as const;

// Docs whose numbers are history/evidence by nature — exempt from the
// hand-typed-figure scan and (for CHANGELOG) the stale-reference scan.
const HISTORY_DOC_PATTERNS = [/^docs\/known-issues\//, /^docs\/adr\//, /^CHANGELOG\.md$/, /^APPLICATION_BUGS\.md$/, /^docs\/KNOWN_ISSUES_ACTIVE\.md$/];
const HEADERLESS_DOCS = new Set(['.github/pull_request_template.md']);

interface Finding {
  level: 'error' | 'warn';
  file: string;
  message: string;
}
const findings: Finding[] = [];
const err = (file: string, message: string): void => void findings.push({ level: 'error', file, message });
const warn = (file: string, message: string): void => void findings.push({ level: 'warn', file, message });

const root = process.env.CHECK_DOCS_ROOT ? path.resolve(process.env.CHECK_DOCS_ROOT) : REPO_ROOT;
const rel = (p: string): string => path.relative(root, p).split(path.sep).join('/');

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function listDocs(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) out.push(full);
    }
  };
  walk(path.join(root, 'docs'));
  for (const f of ['CLAUDE.md', 'README.md', 'APPLICATION_BUGS.md', 'CHANGELOG.md', '.claude/AGENT_DELEGATION_GUIDE.md', '.github/pull_request_template.md']) {
    const full = path.join(root, f);
    if (fs.existsSync(full)) out.push(full);
  }
  return out;
}

function trackedFiles(): string[] {
  try {
    return git('ls-files --cached --others --exclude-standard').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function stripFences(text: string): string {
  return text.replace(/^(```|~~~)[\s\S]*?^\1/gm, (m) => m.replace(/[^\n]/g, ' '));
}

function slugify(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, (c) => (c === '_' ? '_' : ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function anchorsOf(text: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const m of stripFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slugify(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

const anchorCache = new Map<string, Set<string>>();
function anchorsForFile(abs: string): Set<string> {
  if (!anchorCache.has(abs)) anchorCache.set(abs, anchorsOf(fs.readFileSync(abs, 'utf-8')));
  return anchorCache.get(abs)!;
}

function checkHeader(file: string, text: string): void {
  const head = text.split('\n').slice(0, 14).join('\n');
  const fields: Record<string, string> = {};
  for (const f of REQUIRED_HEADER_FIELDS) {
    const m = head.match(new RegExp(`^>\\s*\\*\\*${f}:\\*\\*\\s*(.+)$`, 'm'));
    if (!m) err(file, `missing header field "${f}" (expected a "> **${f}:** ..." line within the first 14 lines)`);
    else fields[f] = m[1].trim();
  }
  const budgetMatch = fields['Size budget']?.match(/^(\d+)k\b/);
  if (fields['Size budget'] && !budgetMatch) err(file, `"Size budget" must start with "<N>k chars" — got "${fields['Size budget']}"`);
  const chars = [...text].length;
  const budget = budgetMatch ? Number(budgetMatch[1]) * 1000 : HARD_CAP_CHARS;
  if (chars > HARD_CAP_CHARS) err(file, `${chars} chars exceeds the ${HARD_CAP_CHARS} hard cap`);
  if (chars > budget) err(file, `${chars} chars exceeds its declared budget of ${budget}`);
  else if (chars >= budget * WARN_RATIO) warn(file, `${chars} chars is >=70% of its ${budget} budget — split/rotate before it overflows (see docs/CONTRIBUTING_TESTS.md size policy)`);
  if (budget > HARD_CAP_CHARS) err(file, `declared budget ${budget} exceeds the ${HARD_CAP_CHARS} hard cap`);

  const lv = fields['Last verified'];
  if (lv) {
    const m = lv.match(/^(\d{4}-\d{2}-\d{2}) @ ([0-9a-f]{7,40})\b/);
    if (!m) {
      err(file, `"Last verified" must look like "YYYY-MM-DD @ <commit>" — got "${lv}"`);
    } else {
      try {
        git(`cat-file -e ${m[2]}^{commit}`);
      } catch {
        err(file, `"Last verified" commit ${m[2]} is not a commit in this repo`);
      }
      const mtime = fs.statSync(path.join(root, file)).mtime;
      const mtimeDay = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}-${String(mtime.getDate()).padStart(2, '0')}`;
      if (m[1] < mtimeDay) err(file, `"Last verified" date ${m[1]} is older than the file's last modification (${mtimeDay}) — update it when you touch a doc`);
    }
  }
}

const PATH_TOKEN = /^(?:(?:src|tests|scripts|docs|config|\.claude|\.github)\/[^\s]*|CLAUDE\.md|README\.md|CHANGELOG\.md|APPLICATION_BUGS\.md|package\.json|playwright\.config\.ts|Jenkinsfile[\w.]*)$/;
const BARE_FILE = /^[\w.-]+\.(?:md|ts|yml|sh)$/;

function checkReferences(file: string, text: string, tracked: string[], trackedBase: Set<string>, scripts: Set<string>): void {
  const abs = path.join(root, file);
  const dir = path.dirname(abs);
  const body = stripFences(text);
  const lines = body.split('\n');

  lines.forEach((line, i) => {
    if (/<!--\s*ref-ok\s*-->/.test(line)) return;
    // markdown links
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [filePart, anchor] = target.split('#');
      const targetAbs = filePart === '' ? abs : path.resolve(dir, filePart);
      if (!fs.existsSync(targetAbs)) {
        err(file, `line ${i + 1}: dead link → ${target}`);
        continue;
      }
      if (anchor && fs.statSync(targetAbs).isFile() && targetAbs.endsWith('.md') && !anchorsForFile(targetAbs).has(anchor.toLowerCase())) {
        err(file, `line ${i + 1}: dead anchor → ${target}`);
      }
    }
    if (file === 'CHANGELOG.md') return;
    // backticked references
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      let tok = m[1].trim();
      const npm = tok.match(/^npm run ([\w:-]+)/);
      if (npm && !tok.includes('<') && !scripts.has(npm[1])) {
        err(file, `line ${i + 1}: \`${tok}\` — no such npm script in package.json`);
        continue;
      }
      if (/[*<>{}$]|\.\.\.|\s/.test(tok)) continue;
      tok = tok.replace(/#.*$/, '').replace(/:~?\d+(-\d+)?$/, '').replace(/\(\)$/, '');
      if (PATH_TOKEN.test(tok)) {
        const clean = tok.replace(/\/$/, '');
        if (!fs.existsSync(path.join(root, clean))) err(file, `line ${i + 1}: \`${tok}\` — path does not exist`);
      } else if (BARE_FILE.test(tok) && !tracked.includes(tok) && !trackedBase.has(tok)) {
        err(file, `line ${i + 1}: \`${tok}\` — no tracked file with that name`);
      }
    }
  });
}

function checkFigures(file: string, text: string, live: boolean): void {
  const known = new Set<string>([...OFFLINE_BLOCKS, ...LIVE_BLOCKS]);
  const starts = [...text.matchAll(/<!-- GEN:([\w-]+):START -->/g)].map((m) => m[1]);
  const ends = [...text.matchAll(/<!-- GEN:([\w-]+):END -->/g)].map((m) => m[1]);
  if (starts.join() !== ends.join()) err(file, `unpaired GEN markers (starts: ${starts.join(', ') || 'none'}; ends: ${ends.join(', ') || 'none'})`);
  const blocks = findBlocks(text);
  if (blocks.length === 0) return;
  const computed = computeBlocks(live);
  for (const b of blocks) {
    if (!known.has(b.name)) {
      err(file, `unknown generated block "GEN:${b.name}"`);
      continue;
    }
    const expected = computed[b.name as keyof typeof computed];
    if (expected === undefined) continue; // live block, not checked in offline mode
    if (b.body.trim() !== expected.trim()) err(file, `generated figure "GEN:${b.name}" is stale — run \`npm run docs:refresh\``);
  }
}

function checkHandTypedFigures(file: string, text: string): void {
  if (HISTORY_DOC_PATTERNS.some((re) => re.test(file))) return;
  let body = stripFences(text).replace(/<!-- GEN:([\w-]+):START -->[\s\S]*?<!-- GEN:\1:END -->/g, (m) => m.replace(/[^\n]/g, ' '));
  body = body.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
  body.split('\n').forEach((line, i) => {
    if (/<!--\s*doc-figure-ok\s*-->/.test(line)) return;
    const m = line.match(/\b(\d{2,4})\s+(tests|spec files|specs|modules|shards|workers)\b/i);
    if (m) err(file, `line ${i + 1}: hand-typed figure "${m[0]}" — use a GEN block (docs:refresh) or add <!-- doc-figure-ok --> if it is not a suite figure`);
  });
}

function checkRoutes(file: string, text: string): void {
  if (file !== 'CLAUDE.md') return;
  const dod = /docs:refresh/.test(text);
  if (!dod) err(file, 'router no longer carries the Definition of Done (expected a `docs:refresh` step)');
  const lines = text.split('\n').length;
  if (lines > 120) warn(file, `${lines} lines — the router target is ~100`);
  if (/^@\S+/m.test(text)) err(file, 'CLAUDE.md must not @-import files (each import is loaded into every session)');
}

function checkOrphans(docs: string[], texts: Map<string, string>): void {
  const roots = ['CLAUDE.md', 'docs/README.md', 'README.md'];
  const linked = new Set<string>();
  for (const r of roots) {
    const t = texts.get(r);
    if (!t) continue;
    for (const m of t.matchAll(/\]\(([^)#\s]+\.md)/g)) linked.add(rel(path.resolve(path.dirname(path.join(root, r)), m[1])));
    for (const m of t.matchAll(/`([^`\s]+\.md)`/g)) linked.add(m[1]);
  }
  for (const d of docs.map(rel)) {
    if (!d.startsWith('docs/') || roots.includes(d)) continue;
    if (!linked.has(d) && !/^docs\/(known-issues|adr)\//.test(d)) warn(d, 'not linked from CLAUDE.md, README.md or docs/README.md');
  }
}

function main(): void {
  const live = process.argv.includes('--live');
  const docs = listDocs();
  const tracked = trackedFiles();
  const trackedBase = new Set(tracked.map((f) => path.basename(f)));
  const scripts = new Set(Object.keys((JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as { scripts: Record<string, string> }).scripts));
  const texts = new Map<string, string>();
  for (const d of docs) texts.set(rel(d), fs.readFileSync(d, 'utf-8'));

  for (const [file, text] of texts) {
    if (!HEADERLESS_DOCS.has(file)) checkHeader(file, text);
    checkReferences(file, text, tracked, trackedBase, scripts);
    checkFigures(file, text, live);
    checkHandTypedFigures(file, text);
    checkRoutes(file, text);
  }
  const contributing = texts.get('docs/CONTRIBUTING_TESTS.md');
  if (contributing !== undefined && !/docs:refresh/.test(contributing)) {
    err('docs/CONTRIBUTING_TESTS.md', 'no longer carries the Definition of Done (expected a `docs:refresh` step)');
  }
  checkOrphans(docs, texts);

  for (const f of findings.filter((x) => x.level === 'warn')) logger.warn(`[check:docs] ${f.file}: ${f.message}`);
  const errors = findings.filter((x) => x.level === 'error');
  for (const f of errors) logger.error(`[check:docs] ${f.file}: ${f.message}`);
  if (errors.length > 0) {
    logger.error(`[check:docs] FAILED — ${errors.length} error(s), ${findings.length - errors.length} warning(s) across ${docs.length} docs${live ? ' (live figures included)' : ''}.`);
    process.exitCode = 1;
    return;
  }
  logger.success(`[check:docs] OK — ${docs.length} docs, ${findings.length} warning(s)${live ? ', live figures included' : ' (offline figures only; use --live for tag counts + shard plan)'}.`);
}

main();
