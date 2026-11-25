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
