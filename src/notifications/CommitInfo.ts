// The commit a run tested, as the email shows it (2026-11-25, build #239: "Merge branch 'feature/...' into sandbox by akashrn1801" is the sandbox merge,
// not the change under test). When the pushed commit is a merge, the reader wants the feature branch's real head commit (its message and author), and
// the merge shown only as "merged into <branch> as <sha>". Pure parsing here; NotificationService runs the two read-only `git show` / `git log` calls
// (CI checks out with fetch-depth 0, so the second parent is present) and falls back to the pushed commit itself when git cannot answer.
export interface CommitFacts {
  sha: string;
  author: string;
  subject: string;
  parents: string[];
}

/** Output of `git show -s --format=%H%x1f%an%x1f%s%x1f%P`. */
export function parseCommitFacts(raw: string): CommitFacts | undefined {
  const [sha, author, subject, parents] = raw.trim().split('\u001f');
  if (!sha) return undefined;
  return { sha, author: author ?? '', subject: subject ?? '', parents: (parents ?? '').split(/\s+/).filter(Boolean) };
}

export function isMergeCommit(c: CommitFacts): boolean {
  return c.parents.length >= 2 && /^Merge\b/i.test(c.subject);
}

/** "Merge branch 'feature/x' into sandbox" -> "sandbox"; undefined when the subject does not say. */
export function mergeTargetBranch(subject: string): string | undefined {
  return /\binto\s+([\w./-]+)\s*$/i.exec(subject)?.[1];
}

// ── Resolving the commit through git (E1, 2026-11-25) ─────────────────────────────────────────────────────────────────────────────────────────────────
// Build #240's email showed the sandbox merge commit although the fixture replay showed the feature head. Cause: the notify job's checkout is shallow
// (`actions/checkout` without `fetch-depth: 0` keeps one commit). `git show` of the merge commit works and lists its parents (%P prints the hashes), but the
// second parent's object is not in a one-commit clone, so `git log <parent>` failed and the code fell back to the merge. Now the second parent is fetched
// on demand (`git fetch --depth=1 origin <sha>`), and the workflows that notify from a merge job check out with full history. A runner is injected so
// every path (full clone, shallow clone, fetch refused, the parent itself a merge) is tested without a repository.

export type GitRunner = (args: string[], timeoutMs?: number) => string | undefined;

export interface ResolvedCommit {
  sha: string;
  url: string | null;
  message: string | null;
  author: string | null;
  merge?: { sha: string; url: string | null; into: string | null };
}

const FORMAT = '--format=%H%x1f%an%x1f%s%x1f%P';

export function resolveCommit(gitCommit: string, git: GitRunner, urlOf: (sha: string) => string | null): ResolvedCommit {
  const pushedRaw = git(['show', '-s', FORMAT, gitCommit]);
  const pushed = pushedRaw ? parseCommitFacts(pushedRaw) : undefined;
  if (!pushed) return { sha: gitCommit, url: urlOf(gitCommit), message: null, author: null };
  const asPushed: ResolvedCommit = { sha: pushed.sha, url: urlOf(pushed.sha), message: pushed.subject || null, author: pushed.author || null };
  if (!isMergeCommit(pushed)) return asPushed;
  const parent = pushed.parents[1];
  // the feature branch's newest non-merge commit; fetch the parent first when this is a shallow clone and it is not there
  const read = (): CommitFacts | undefined => {
    const raw = git(['log', '-1', '--no-merges', FORMAT, parent]) ?? git(['show', '-s', FORMAT, parent]);
    return raw ? parseCommitFacts(raw) : undefined;
  };
  let head = read();
  if (!head) {
    git(['fetch', '--no-tags', '--depth=1', 'origin', parent], 30000);
    head = read();
  }
  if (!head) return asPushed; // git cannot say: the merge commit itself, never a guess
  return { sha: head.sha, url: urlOf(head.sha), message: head.subject || null, author: head.author || null, merge: { sha: pushed.sha, url: urlOf(pushed.sha), into: mergeTargetBranch(pushed.subject) ?? null } };
}
