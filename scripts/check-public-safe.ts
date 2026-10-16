/**
 * Public-repo safety scan — run via `npm run check:public-safe` (offline, ~1s). NOT wired into the
 * pre-commit hook or CI — see docs/CONTRIBUTING_TESTS.md §"Pre-commit checklist" for the proposed hook.
 *
 * Scans every tracked text file (`git ls-files`, minus package-lock.json) for:
 *  - email addresses
 *  - the non-production application domain (any subdomain, or the bare domain)
 *  - private IPv4 addresses (10.x, 172.16-31.x, 192.168.x) and *.svc.cluster.local hosts
 * Each file is scanned twice: line by line, and again with line breaks and leading comment markers
 * (`//`, `/*`, `*`, `#`) collapsed, so a hostname or address wrapped across two comment lines is
 * still caught (the first pass alone missed one in src/fixtures/index.ts).
 *
 * Exit 1 with `file:line  kind  matched-text` per finding; never prints more than the matched text.
 *
 * ALLOWLIST (every entry has a reason; add new ones here, never a global switch):
 *  - emails: example.com / example.test (reserved placeholder domains), invalid@email.com (the
 *    deliberate invalid-login test input), TOKEN@github.com (git remote URL template),
 *    qa-bot@users.noreply.github.com (non-personal default git identity), and any address directly
 *    adjacent to a `<...>` placeholder (`<NOTIFY_TO>` style).
 *  - CI secret references: `${{ ... }}` expressions are stripped before scanning, and lines holding a
 *    Jenkins `credentialsId:` are skipped (they carry names, never values).
 *  - the non-production domain, per file only (NOT global): see DOMAIN_ALLOWED_FILES below.
 * Ignored-but-still-tracked files (e.g. a file added to .gitignore but not yet `git rm --cached`) are
 * still scanned; they fail until untracked.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../src/utils/logger';

const root = process.env.PUBLIC_SAFE_ROOT
  ? path.resolve(process.env.PUBLIC_SAFE_ROOT)
  : path.resolve(__dirname, '..');

// Built from parts so this file does not itself contain the domain it hunts for.
const DOMAIN = ['sling', 'dev'].join('-');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const DOMAIN_RE = new RegExp(`(?:[A-Za-z0-9-]+\\.)*${DOMAIN}(?:\\\\?\\.com)?`, 'gi');
const IPV4_RE = /(?<![\w.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?![\w])/g;
const CLUSTER_RE = /[A-Za-z0-9.-]+\.svc\.cluster\.local/gi;

const ALLOWED_EMAIL_DOMAINS = ['example.com', 'example.test'];
const ALLOWED_EMAILS = new Set([
  'invalid@email.com',
  'token@github.com',
  'qa-bot@users.noreply.github.com',
]);

/** file -> reason the non-production domain may appear there. */
const DOMAIN_ALLOWED_FILES: Record<string, string> = {
  'src/error-collector/ErrorCollector.ts':
    'live traffic-matching rule (decides whether an ERR_ABORTED URL is app traffic)',
  'scripts/hooks/pre-push': 'warning regex for hardcoded URLs in a push',
};

const SKIP_FILES = new Set(['package-lock.json']);

interface Finding {
  file: string;
  line: number;
  kind: string;
  text: string;
}

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function isText(buf: Buffer): boolean {
  return !buf.subarray(0, 8000).includes(0);
}

function isPrivateIp(m: RegExpMatchArray): boolean {
  const o = m.slice(1, 5).map(Number);
  if (o.some((n) => n > 255)) return false;
  return (
    o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)
  );
}

function emailAllowed(text: string, before: string, after: string): boolean {
  const lower = text.toLowerCase();
  if (ALLOWED_EMAILS.has(lower)) return true;
  const domain = lower.split('@')[1];
  if (ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  return before === '>' || after === '<';
}

interface Hit {
  kind: string;
  text: string;
  index: number;
}

function scanText(text: string, file: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of text.matchAll(EMAIL_RE)) {
    const i = m.index ?? 0;
    // a leading `.` or digits-only local part is a version/path artifact, not an address
    if (!emailAllowed(m[0], text[i - 1] ?? '', text[i + m[0].length] ?? ''))
      hits.push({ kind: 'email', text: m[0], index: i });
  }
  if (!(file in DOMAIN_ALLOWED_FILES)) {
    for (const m of text.matchAll(DOMAIN_RE))
      hits.push({ kind: 'non-production-domain', text: m[0], index: m.index ?? 0 });
  }
  for (const m of text.matchAll(IPV4_RE))
    if (isPrivateIp(m)) hits.push({ kind: 'private-ip', text: m[0], index: m.index ?? 0 });
  for (const m of text.matchAll(CLUSTER_RE))
    hits.push({ kind: 'cluster-host', text: m[0], index: m.index ?? 0 });
  return hits;
}

function rawMatches(line: string): string[] {
  return [...line.matchAll(EMAIL_RE), ...line.matchAll(DOMAIN_RE)].map((m) => m[0]);
}

const stripSecretRefs = (line: string): string => line.replace(/\$\{\{[^}]*\}\}/g, ' ');
const COMMENT_PREFIX = /^\s*(?:\/\/+|\/\*+|\*+\/?|#+|<!--)?\s?/;

function scanFile(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  const seen = new Set<string>();
  const push = (line: number, kind: string, text: string, tag = ''): void => {
    const key = `${line}|${kind}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ file, line, kind: tag ? `${kind} ${tag}` : kind, text });
  };

  const scannable = lines.map((l) => (/credentialsId\s*:/.test(l) ? '' : stripSecretRefs(l)));

  // pass 1: line by line
  scannable.forEach((l, i) => scanText(l, file).forEach((h) => push(i + 1, h.kind, h.text)));

  // pass 2: comment markers and line breaks collapsed; keep only matches that cross a line boundary
  let collapsed = '';
  const starts: number[] = [];
  const ends: number[] = [];
  scannable.forEach((l) => {
    starts.push(collapsed.length);
    collapsed += l.replace(COMMENT_PREFIX, '').trimEnd();
    ends.push(collapsed.length);
  });
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  for (const h of scanText(collapsed, file)) {
    const first = lineOf(h.index);
    const last = lineOf(h.index + h.text.length - 1);
    if (last <= first) continue;
    // WHY: joining lines can glue the next line's first word onto a complete match (allowed or not);
    // a collapsed match that merely extends something already matched on its first line is that artifact.
    const lowerText = h.text.toLowerCase();
    const extendsPlain = rawMatches(scannable[first]).some((r) =>
      lowerText.startsWith(r.toLowerCase())
    );
    if (!extendsPlain) push(first + 1, h.kind, h.text, '(split across lines)');
  }
  return findings;
}

function main(): void {
  const findings: Finding[] = [];
  let scanned = 0;
  for (const file of trackedFiles()) {
    if (SKIP_FILES.has(path.basename(file))) continue;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const buf = fs.readFileSync(abs);
    if (!isText(buf)) continue;
    scanned++;
    findings.push(...scanFile(file, buf.toString('utf8')));
  }
  if (findings.length === 0) {
    logger.success(`[check:public-safe] ${scanned} tracked text file(s) scanned — no findings`);
    return;
  }
  for (const f of findings)
    logger.error(`[check:public-safe] ${f.file}:${f.line}  ${f.kind}  ${f.text}`);
  logger.error(`[check:public-safe] FAILED — ${findings.length} finding(s) in ${scanned} file(s)`);
  process.exit(1);
}

main();
