/**
 * Syncs the current run's result into the rolling run-history ledger (P2 of the
 * 2026-07-07 reporting overhaul, extended 2026-07-14 with deeper multi-run
 * trending) and writes a small delta/trend summary that NotificationService.ts
 * optionally reads, the same way it already optionally reads misc-errors.json.
 *
 * WHY a dedicated git branch, not an artifact or an external store — see the
 * WHY comment on HISTORY_BRANCH_NAME below for the full tradeoff writeup.
 *
 * WHY this step must NEVER fail the build: history tracking is a nice-to-have
 * layered on top of the actual test results, not a build gate. Any failure here
 * (no push permission configured yet, network issue, merge race that exhausts
 * its retries) is caught, logged, and degrades to "no delta available" — the
 * same graceful-absence pattern already used for misc-errors.json in
 * NotificationService.ts. This script must exit 0 in every case.
 */
import { execSync, ExecException } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadDotEnv } from './loadDotEnv';
import { ReportParser } from '../ReportParser';
import {
  appendAndPrune,
  parseHistory,
  computeDelta,
  computeRecurringFlaky,
  computeRecurringFailures,
  computeModuleTrend,
  computeSlowTestTrend,
  computeSuiteDrift,
  buildPassRateSeries,
  RunHistoryRecord,
  RunDelta,
  RecurringIssue,
  ModuleTrend,
  SlowTestTrend,
  SuiteDrift,
  PassRatePoint,
} from '../RunHistory';

// WHY: must load before reading process.env.ENV below — see loadDotEnv.ts for
// why this matters specifically for Jenkinsfile (main)'s pipeline.
loadDotEnv();

// ── Secret redaction — the ONE chokepoint every log line in this file must
// route through ──────────────────────────────────────────────────────────
//
// WHY this exists at all: confirmed real, 2026-08-25 (see the dated entry in
// .claude/known-issues.md's "CI reporting-history ledger" section) — this
// script's temp clone (see resolveGitRemoteUrl()'s own WHY comment) never
// received the PIPELINE_TOKEN credential that authenticates every OTHER git
// operation in this repo's CI, so every `git push` it ever attempted was a
// silent, unauthenticated, anonymous request — guaranteed to fail, every
// single run, forever. That gap is fixed below by handing this script its
// own credential via `gitAuthEnv()`. The moment a real secret exists inside
// this process, this file's own risk profile changes completely: any future
// edit that adds a `console.log(someGitOutput)` or rethrows a caught error
// verbatim now has a real chance of printing that secret into a public CI
// log, unless something prevents it structurally.
//
// WHY a single registered-secret + redact()-on-every-output-path design,
// rather than "just be careful not to log the token variable directly" at
// each call site: that second approach is exactly the discipline that
// already failed once in this same file, in a different form — the push
// loop's "assume concurrent update" classification (see the git failure
// classification registry below, particularly AUTH_FAILURE_CLASSIFIER's own
// WHY comment) was itself an unverified assumption baked into one call
// site, trusted by every reader since, until real evidence proved it wrong.
// Secret-handling deserves a stronger guarantee than "this specific line
// happens to be safe today" — it must hold even if someone
// adds a new console.log to this file next year with no knowledge of this
// comment. Routing every single console.log/console.warn in this file
// through log()/warn() below, which unconditionally scrub the one
// registered secret from any string before it reaches an actual output
// sink, makes that guarantee structural rather than a matter of discipline.
//
// This is deliberately layered ON TOP OF (not a replacement for) choosing a
// credential-delivery mechanism that never puts the secret in a command
// line, URL, or persisted file in the first place (see gitAuthEnv()'s own
// WHY comment for that mechanism and the real, live evidence backing it) —
// defense in depth: the primary defense is "the secret is never in a string
// that could be logged," and this redaction layer is the backstop for the
// case that assumption is ever wrong, now or after a future change.
let registeredSecret: string | null = null;

function registerSecretForRedaction(secret: string): void {
  registeredSecret = secret;
}

function redact(text: string): string {
  if (!registeredSecret) return text;
  return text.split(registeredSecret).join('[REDACTED]');
}

// WHY log()/warn() exist, and why EVERY console.log/console.warn call in
// this file (including inside functions defined below) is written through
// these two instead of calling console.* directly: this is the structural
// guarantee itself — there is no code path left in this file that can print
// a string without it passing through redact() first. A future contributor
// adding a new log line only needs to know "use log()/warn(), not
// console.*" — they don't need to separately remember "and also, don't
// print the token" for that specific new line, because there is no way to
// bypass the scrub short of deliberately calling console.* directly.
function log(message: string): void {
  console.log(redact(message));
}

function warn(message: string, err?: unknown): void {
  if (err === undefined) {
    console.warn(redact(message));
    return;
  }
  // WHY stringified here (losing Node's default Error pretty-printing),
  // rather than passing `err` through to console.warn as its own object:
  // redact() only operates on strings — an un-stringified Error/unknown
  // value could carry the secret in a property redact() would never see
  // (e.g. a future ExecException whose .cmd embeds an env var value some
  // future Node version starts including). Flattening to one already-
  // redacted string is a deliberate, small readability cost for a
  // guarantee that holds regardless of the error's real shape.
  const errText = err instanceof Error ? `${err.message}${err.stack ? `\n${err.stack}` : ''}` : String(err);
  console.warn(redact(message), redact(errText));
}

// WHY: a dedicated, never-merged branch — NOT main/dev/qa/stage/prod — so this
// ledger's commits (a) can never trip branch-protection rules configured on
// deployment branches, (b) never show up in a code PR's diff, and (c) isolate
// the one real risk of this mechanism (two pipelines racing to push at once) to
// a branch where a rebase-retry is the ONLY thing that can conflict, never a
// real code change.
const HISTORY_BRANCH_NAME = process.env.HISTORY_BRANCH_NAME || 'ci/reporting-history';
// WHY: Confirmed live (2026-07-07) — `git clone` needs an actual URL/path, it
// cannot resolve a remote NAME the way `git pull origin main` can, since a
// fresh clone target has no `.git/config` yet to look "origin" up in. The
// original version of this passed the literal string "origin" straight to
// `git clone`, which fails with "repository 'origin' does not exist" every
// single time — caught gracefully by the try/catch (so it never broke the
// build), but it meant the whole history feature silently never persisted
// anything, defeating its purpose. Resolve the real URL from the ALREADY-
// checked-out repo's own configured "origin" remote (present in real CI via
// `checkout scm` / actions/checkout) instead of assuming the name resolves on
// its own. HISTORY_GIT_REMOTE remains a full override (a URL or local path)
// for verification against a throwaway repo without ever touching the real one.
function resolveGitRemoteUrl(): string {
  if (process.env.HISTORY_GIT_REMOTE) return process.env.HISTORY_GIT_REMOTE;
  try {
    return execSync('git remote get-url origin', { cwd: process.cwd() }).toString().trim();
  } catch {
    throw new Error(
      'Could not resolve origin remote URL — set HISTORY_GIT_REMOTE explicitly or ensure this runs inside a checked-out git repo with an "origin" remote configured'
    );
  }
}
const MAX_PUSH_RETRIES = 3;

// WHY: confirmed real via TWO separate CI occurrences now — sandbox.yml runs
// 32748451285 (2026-08-24) and 32822096101 (2026-08-25) — see the dated
// entries in .claude/known-issues.md's "CI reporting-history ledger" section
// for both. A push REJECTION on HISTORY_BRANCH_NAME (below) proves the
// branch already exists on GitHub's primary (a competing writer's push
// landed first) — but the very next `git fetch` of that same ref, fired
// with zero delay, can still fail with "couldn't find remote ref" if it
// lands on a GitHub backend replica that hasn't yet caught up with the ref
// JUST created moments earlier. This is a narrow, transient replication-lag
// window specific to the instant a ref is first created under concurrent
// competition — NOT the same as the ref genuinely, permanently not existing
// (that case is handled separately, by the initial cloneAttempt/orphan-
// branch-creation path above, which must stay untouched by this).
//
// WHY elapsed-time-bounded exponential backoff, not a fixed short list of
// delays: the first version of this fix used 3 fixed delays
// (300/800/1500ms, ~2.6s total) — confirmed INSUFFICIENT by the second
// occurrence above, which exhausted that exact budget and failed again with
// the identical signature. GitHub's replication lag is not a fixed,
// predictable duration, and there is no public API to query it directly —
// confirmed by checking: GitHub's REST "get a reference" endpoint
// (`GET /repos/{owner}/{repo}/git/refs/{ref}`) exposes exactly the same
// exists-or-not information `git fetch` already gives us, no propagation/
// consistency metadata; the only replication-status introspection GitHub
// exposes anywhere is `ghe-repl-status`, for GitHub ENTERPRISE SERVER's own
// self-hosted HA replica nodes — irrelevant to github.com, which is what
// this repo uses. Blind bounded retry is therefore the correct approach in
// principle (nothing better is available), but "bounded" must mean a real
// ELAPSED-TIME ceiling, not a specific guessed delay count — any fixed
// number of fixed delays can fail again the moment a real lag happens to
// exceed it, exactly as just proven twice.
//
// ── Git failure classification — an open registry, not an if/else chain ──
//
// WHY this exists, replacing an unconditional assumption, not just a wrong
// one: confirmed real, 2026-08-25 (see .claude/known-issues.md) — the push
// loop below used to log EVERY non-zero exit from `git push` as "rejected
// (concurrent update)" with NO check of the actual error text at all. That
// unconditional guess is what hid the real bug (Bug 1 above — no
// credentials at all, so `git push` always failed with a genuine
// authentication error) through two entire prior fix attempts that both
// tuned a retry budget for a race condition that was never actually
// happening. The lesson generalizes: a hardcoded "when this fails, it must
// mean X" is exactly as dangerous whether X is "concurrent update" or
// anything else convenient to assume — the fix is to always check the real
// error text, and to have an honest, first-class outcome for "text I don't
// recognize," never a default that pretends to know.
//
// WHY a data-driven list of classifiers rather than a growing if/else
// chain: adding a THIRD (or fourth, fifth...) known failure shape in the
// future — for either fetch or push — is adding one entry to the relevant
// array below, not restructuring conditional logic. Each classifier states
// its own real, evidence-backed error-text pattern and whether that
// specific, NAMED failure is safe to retry — nothing about "everything not
// otherwise matched" is ever assumed to be retryable.
interface GitFailureClassifier {
  readonly kind: string;
  readonly pattern: RegExp;
  readonly retryable: boolean;
}

// WHY checked before every other classifier, in both the fetch and push
// registries below: an authentication/permission failure is the one
// outcome that must never be retried under any circumstances (retrying it
// can never succeed, only waste the retry budget and, as happened here,
// disguise the real problem as something benign) — checking it first
// guarantees it can never be shadowed by a coincidental match against a
// less urgent pattern. Grounded in real, observed git client behavior, not
// research alone — see gitAuthEnv()'s own WHY comment for the live HTTP
// server test that produced `could not read Username for '<url>': No such
// device or address` as the actual text a non-interactive git client emits
// on a genuine 401; the remaining alternatives in this pattern are git/
// GitHub's own well-documented standard wording for the same failure class
// (a missing/invalid/insufficiently-scoped credential) that this session's
// local-only test server cannot itself produce (e.g. GitHub's own
// server-side 403/"Invalid username or token" responses for a real,
// rejected PAT), included for completeness against the real github.com
// backend this script actually talks to in CI.
const AUTH_FAILURE_CLASSIFIER: GitFailureClassifier = {
  kind: 'auth-failure',
  retryable: false,
  pattern:
    /authentication failed|could not read username|permission denied|permission to .* denied|\b401\b|\b403\b|invalid username or token|terminal prompts disabled|repository not found|support for password authentication was removed/i,
};

// WHY this exact pattern, and why it's retryable: git's own client-side
// wording for "the remote has a commit I don't have locally" — confirmed
// standard, stable git terminology, not GitHub-specific. This is the ONE
// genuine case the recompute-and-retry logic below exists for: a real
// second writer's push landed first. Never reached in this session's own
// investigation (every real occurrence turned out to be Bug 1's
// authentication failure instead, caught above before this is ever
// checked) — kept because a genuine race becomes newly POSSIBLE now that
// pushes can actually succeed at all.
const NON_FAST_FORWARD_CLASSIFIER: GitFailureClassifier = {
  kind: 'non-fast-forward',
  retryable: true,
  pattern: /\[rejected\]|non-fast-forward|\(fetch first\)|failed to push some refs/i,
};

// WHY this exact pattern: unchanged from the original fix (see the dated
// entries above) — confirmed real via two separate CI occurrences. Kept as
// its own named classifier (not folded into NON_FAST_FORWARD_CLASSIFIER)
// because it is fetch-specific vocabulary (a ref genuinely or transiently
// absent), never push-specific, and because — now that Bug 1 is fixed and
// this app confirmed public (a `git fetch` never needed auth for this repo
// during this whole investigation) — a recurrence of this exact fetch
// signature has a real chance of finally being genuine GitHub replication
// lag rather than a symptom of some entirely different bug, which the
// classifier registry below (AUTH_FAILURE_CLASSIFIER checked first) can now
// tell apart instead of blindly retrying anything that isn't this pattern.
const MISSING_REMOTE_REF_CLASSIFIER: GitFailureClassifier = {
  kind: 'missing-remote-ref',
  retryable: true,
  pattern: /couldn't find remote ref/i,
};

// WHY the caller supplies its OWN ordered classifier list rather than this
// function hardcoding one global list: fetch failures and push failures
// have genuinely different retryable vocabularies (a fetch can plausibly
// be "missing remote ref"; a push can plausibly be "non-fast-forward"; the
// reverse never applies to either) — sharing one flat list would let a
// push-only pattern wrongly match fetch output or vice versa. Both
// contexts still share AUTH_FAILURE_CLASSIFIER by listing it explicitly.
// WHY the fallback is an explicit, honestly-named `unclassified` outcome
// rather than defaulting to either retryable or not: this is the single
// most important property of this whole redesign — an error text this
// script has never seen before must never be silently assumed to be
// anything. `retryable: false` on the fallback is a deliberate, safe
// default (never loop on an unknown condition), not a guess about what the
// error means.
function classifyGitFailure(
  rawOutput: string,
  classifiers: readonly GitFailureClassifier[]
): { kind: string; retryable: boolean } {
  for (const classifier of classifiers) {
    if (classifier.pattern.test(rawOutput)) {
      return { kind: classifier.kind, retryable: classifier.retryable };
    }
  }
  return { kind: 'unclassified', retryable: false };
}

// WHY a single shared formatter for every thrown/logged classification
// outcome: guarantees the exact phrase "unclassified failure: <exact raw
// text>" for the one case nothing recognized, and an equally explicit,
// equally evidence-cited phrase for every recognized case — no call site
// can phrase either case ambiguously, since neither call site constructs
// this string by hand.
function describeGitFailure(
  commandLabel: string,
  classification: { kind: string; retryable: boolean },
  rawOutput: string
): string {
  if (classification.kind === 'unclassified') {
    return `${commandLabel} failed — unclassified failure: ${rawOutput}`;
  }
  return `${commandLabel} failed — classified as ${classification.kind} (confirmed from the real git error text, not assumed): ${rawOutput}`;
}
// WHY 45s specifically, not a guess: this codebase already has two
// established conventions for "how long to wait on a cross-process/cross-
// node eventual-consistency condition before giving up" — AuthManager.
// withFileLock()'s 30000ms-per-cycle stale-lock-detection window (the
// closest analogous case: a cross-process race with no way to directly
// query the other side's state), and config.timeouts.navigation's 60000ms
// default (this codebase's standard budget for a network-dependent wait
// that deserves generous headroom). 45s sits between the two established
// numbers rather than inventing a third, unrelated one. Being generous here
// costs nothing real: this whole sync step runs AFTER the test suite has
// already finished and reported its own pass/fail, wrapped in a "never fail
// the build" try/catch (see main()'s own catch block below) — a slow-but-
// eventually-successful history sync has zero effect on real test feedback.
const FETCH_RETRY_CEILING_MS = 45000;
const FETCH_RETRY_INITIAL_DELAY_MS = 300;
// WHY capped per-attempt instead of letting the doubling grow unboundedly:
// keeps retries (and their log lines) frequent enough to stay observable in
// a live CI log — an eventual multi-minute single sleep this deep into a
// background step would look indistinguishable from a genuine hang to
// anyone watching the log live, and finer-grained retries cost nothing
// extra against the 45s ceiling (worst case ~12 attempts, not excessive).
const FETCH_RETRY_MAX_DELAY_MS = 5000;
const FETCH_RETRY_BACKOFF_MULTIPLIER = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// WHY real exponential backoff (each delay roughly doubling, capped per
// attempt) bounded by ELAPSED TIME rather than a fixed attempt count: a
// fixed count paired with fixed delays (the original 300/800/1500ms
// version) is really just a disguised fixed ceiling (~2.6s total) — exactly
// what was already proven insufficient. Bounding by elapsed time instead
// means the number of attempts falls out of the time budget rather than
// being chosen in advance: a short-lived lag still resolves within the
// first fast retry or two with no wasted time, while a longer one keeps
// getting a real chance — for however many attempts that takes — right up
// to the 45s ceiling, adapting to whatever the actual lag turns out to be
// instead of a number guessed in advance. This only ever activates for the
// one specific, transient error signature confirmed above; any other fetch
// failure (auth, network, a genuinely absent branch) fails fast on the
// first attempt, unchanged from before. Retrying via the outer
// MAX_PUSH_RETRIES loop alone does not fix this, since that loop introduces
// no delay between attempts — all of its attempts could fire within
// milliseconds of each other, well inside the replication-lag window this
// is working around.
async function fetchHistoryBranchWithBackoff(repoDir: string, branch: string): Promise<void> {
  const startedAt = Date.now();
  let delayMs = FETCH_RETRY_INITIAL_DELAY_MS;
  let attempt = 0;

  // WHY `while (true)` is still safe here (never an indefinite hang): the
  // elapsed-time check below is a hard ceiling checked on every iteration
  // before ever sleeping again — this loop always either returns (fetch
  // succeeded) or throws (ceiling hit, or a genuinely different failure),
  // both of which are reachable in bounded real time.
  while (true) {
    attempt++;
    const result = shSafe(`git fetch origin ${branch}`, repoDir);
    if (result.ok) return;

    const classification = classifyGitFailure(result.output, [AUTH_FAILURE_CLASSIFIER, MISSING_REMOTE_REF_CLASSIFIER]);
    if (!classification.retryable) {
      // WHY this covers BOTH the confirmed auth-failure case and any
      // genuinely unrecognized error, with one honest code path: neither
      // should ever be retried, and describeGitFailure() names precisely
      // which of the two this is (never a guess) in the thrown message.
      throw new Error(describeGitFailure(`git fetch origin ${branch}`, classification, result.output));
    }

    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= FETCH_RETRY_CEILING_MS) {
      // WHY this still throws rather than looping forever: preserves the
      // exact same "never fail the build" contract as before — this throw
      // propagates to main()'s own outer try/catch, which logs and
      // continues without history for this run. The ceiling is a hard cap,
      // not a soft suggestion.
      throw new Error(
        `git fetch origin ${branch} failed after ${attempt} attempt(s) over ${elapsedMs}ms ` +
          `(ceiling ${FETCH_RETRY_CEILING_MS}ms), still classified as ${classification.kind}: ${result.output}`
      );
    }

    log(
      `[syncHistory] Fetch of ${branch} classified as ${classification.kind} (retryable) — likely GitHub ` +
        `replication lag on a just-created ref, not a real absence. Retrying in ${delayMs}ms ` +
        `(attempt ${attempt}, ${elapsedMs}ms elapsed of ${FETCH_RETRY_CEILING_MS}ms ceiling)`
    );
    await delay(delayMs);
    delayMs = Math.min(delayMs * FETCH_RETRY_BACKOFF_MULTIPLIER, FETCH_RETRY_MAX_DELAY_MS);
  }
}

// WHY: added 2026-07-14 — this file had its own, separate, older branch-name
// derivation that never received the local-git fallback fix applied to the
// email-facing code (notify.ts's resolveNotificationInput()). A bare local
// sync (no BRANCH_NAME/GITHUB_REF_NAME) wrote a literal "unknown" into the
// history ledger's own branch field, even though the real branch is one
// command away in any real git checkout. Mirrors notify.ts's identical
// helper exactly — same reasoning, same graceful degrade to null on error
// (e.g. a stripped checkout with no git metadata) rather than throwing,
// since this script must never fail the build.
function localGitFallback(cmd: string): string | null {
  try {
    const out = execSync(cmd, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
}

// WHY env-var-injected git config (`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/
// `GIT_CONFIG_VALUE_0`), rather than either alternative considered —
// confirmed root cause (2026-08-25, see .claude/known-issues.md): this
// script's temp clone (created by `git clone` into a fresh `os.tmpdir()`
// directory — see resolveGitRemoteUrl()'s own WHY comment) has NO
// relationship to the original checked-out CI workspace's git config, so it
// never inherits the `PIPELINE_TOKEN` credential `actions/checkout` sets up
// there. Confirmed via research (GitHub's own actions/checkout source and
// documented behavior) that checkout persists its credential via `git
// config --local http.https://github.com/.extraheader "AUTHORIZATION: basic
// <base64 x-access-token:TOKEN>"` — LOCAL scope, never inherited by an
// unrelated clone elsewhere on disk. Two ways to give THIS script's own temp
// clone the equivalent credential were considered and rejected in favor of
// this one:
//   (a) Embed the token directly in the remote URL
//       (https://x-access-token:TOKEN@github.com/...). Rejected: confirmed
//       via direct code inspection that `gitRemoteUrl` (built from this
//       embedded-token URL) gets interpolated into `sh()`/plain execSync
//       command strings elsewhere in this file (the clone/fetch/push calls
//       below) — Node's execSync embeds the FULL command string into its own
//       thrown error's `.message` the moment any of those commands fails for
//       ANY reason, which would print the token straight into this script's
//       own caught-and-logged error path. A URL is also the value most
//       likely to be echoed back verbatim inside git's own error text on a
//       real failure (e.g. "fatal: unable to access 'https://TOKEN@...'"),
//       an additional, independent leak vector this option can't avoid.
//   (b) `git config --local http.https://github.com/.extraheader ...`,
//       mirroring actions/checkout exactly, via a one-time setup call after
//       the temp clone exists. Avoids the URL-echo risk above, but still
//       requires a specific call site to remember to run it before the
//       first fetch/push, and persists the secret to a file on disk
//       (`repoDir/.git/config`) for the life of the temp directory.
//   (c) THIS: inject the identical `AUTHORIZATION: basic ...` header via
//       `GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` environment variables passed
//       to every git invocation through the shared sh()/shSafe() helpers —
//       the ONLY functions this entire file ever uses to run a git command
//       (confirmed via grep). This gets both properties (a) and (b)
//       individually lack: the secret is never in a command-line argument,
//       a URL, or a file on disk at any point — Node's execSync does NOT
//       include the `env` option's contents in a thrown error's `.message`
//       (confirmed: only the command string and exit code are), so a future
//       failure of ANY git command in this script cannot leak it via that
//       path — and because the injection lives in sh()/shSafe() themselves,
//       every git call in this file is authenticated automatically, present
//       and future, with no separate call site to place or forget.
// WHY verified live, not just reasoned from documentation: built a local
// HTTP server that logs the raw `Authorization` header it receives, pointed
// a real `git ls-remote` at it with this exact env-var mechanism configured
// for a test token, and confirmed the server received EXACTLY
// `Basic <base64 of x-access-token:test-token-abc123>` — byte-for-byte the
// same scheme actions/checkout itself uses. Separately confirmed (same
// local server, configured to require a specific header and reject any
// other with HTTP 401) that a real, non-interactive `git` client's own
// error text for an actual authentication failure is
// `fatal: could not read Username for '<url>': No such device or address` —
// this exact string is what AUTH_FAILURE_CLASSIFIER below is grounded in,
// not assumed from research alone.
function gitAuthEnv(): NodeJS.ProcessEnv {
  const token = process.env.PIPELINE_TOKEN;
  if (!token) return process.env;
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
  };
}

function sh(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: gitAuthEnv() }).toString().trim();
}

function shSafe(cmd: string, cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: sh(cmd, cwd) };
  } catch (err) {
    const e = err as ExecException;
    return { ok: false, output: e?.stderr?.toString() || e?.message || String(err) };
  }
}

// WHY this exists (2026-09-03, fixes a real false "Suite Drift Detected"
// alarm — see the dated known-issues.md entry): scripts/reset-sandbox.sh
// does `git reset --hard origin/dev` then force-pushes sandbox — a hard
// reset moves the branch pointer to dev's EXACT commit object, never a new
// one, so a reset run's own commit is always byte-identical to dev's HEAD.
// `git ls-remote` (not a full fetch/clone) is deliberately used here — it's
// a single lightweight network round-trip that only needs the ref's tip
// SHA, mirroring this file's own "shallow, only-what's-needed" git-usage
// convention elsewhere (see the --depth 50 clone's own WHY comment).
// Routed through sh()'s existing gitAuthEnv() (same as every other git call
// in this file) since a private repo's `dev` ref isn't readable anonymously
// in CI. Never throws — a resolution failure (offline, auth issue, `dev`
// genuinely absent) degrades to "not a dev-equivalent run," the same safe
// default as before this fix existed, never a false positive.
function detectDevEquivalentRun(gitRemoteUrl: string, gitCommit: string): boolean {
  if (!gitCommit || gitCommit === 'unknown') return false;
  const result = shSafe(`git ls-remote ${gitRemoteUrl} refs/heads/dev`, process.cwd());
  if (!result.ok) return false;
  const devHeadSha = result.output.split('\t')[0]?.trim();
  return !!devHeadSha && devHeadSha === gitCommit;
}

function buildCurrentRecord(
  env: string,
  branch: string,
  buildNumber: string,
  runSource: RunHistoryRecord['runSource'],
  jsonReportPath: string,
  gitCommit: string,
  isDevEquivalentRun: boolean
): RunHistoryRecord {
  const parser = new ReportParser();
  const report = parser.parse(jsonReportPath);
  return {
    timestamp: new Date(report.startTime).toISOString(),
    env,
    branch,
    buildNumber,
    runSource,
    gitCommit,
    isDevEquivalentRun,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    flaky: report.flaky,
    skipped: report.skipped,
    duration: report.duration,
    flakyTestTitles: report.flakyTests.map((t) => t.title),
    // WHY: added 2026-07-14 — mirrors flakyTestTitles; without this, "has this
    // test failed before" was structurally unanswerable from history.
    failedTestTitles: report.failedTests.map((t) => t.title),
    // WHY: added 2026-07-14 — top-20 (report.slowestTestsTop20), not the
    // email's top-5 display list — see ReportParser.ts's WHY comment on that
    // field for why 20 was chosen over "every test."
    slowestTests: report.slowestTestsTop20.map((t) => ({ title: t.title, duration: t.duration })),
    modules: report.modules.map((m) => ({
      name: m.name,
      // WHY: `type` and `total` added 2026-07-14 — see ModuleHistoryStats's
      // WHY comment in RunHistory.ts; without `type`, a same-named UI/RBAC
      // module pair collides on lookup.
      type: m.type,
      total: m.total,
      passed: m.passed,
      failed: m.failed,
      flaky: m.flaky,
      // WHY: previously hardcoded to 0 — "ReportParser's ModuleStats doesn't
      // track per-module duration today." Fixed 2026-07-14: ReportParser now
      // sums each result's duration into its module bucket.
      duration: m.duration,
    })),
  };
}

interface HistoryDeltaOutput {
  delta: RunDelta | null;
  recurringFlaky: RecurringIssue[];
  recurringFailures: RecurringIssue[];
  moduleTrend: ModuleTrend[];
  slowTestTrend: SlowTestTrend[];
  suiteDrift: SuiteDrift | null;
  passRateSeries: PassRatePoint[];
}

const EMPTY_DELTA_OUTPUT: HistoryDeltaOutput = {
  delta: null,
  recurringFlaky: [],
  recurringFailures: [],
  moduleTrend: [],
  slowTestTrend: [],
  // WHY: null, not {occurred:false,...} — a genuinely-computed "no drift"
  // and "sync never ran / failed before computing" are different states, and
  // NotificationService should be able to tell "no signal available" apart
  // from "computed, and there is no drift" if it ever needs to (today both
  // render identically — no drift banner — but the distinction is cheap to
  // keep and costs nothing to preserve).
  suiteDrift: null,
  passRateSeries: [],
};

async function main() {
  // WHY registered here, before a single line of this function's own logic
  // runs: this must happen before ANY git command executes, so that even a
  // failure in the very first clone attempt below is already covered by
  // redact(). registerSecretForRedaction() is a pure in-memory no-op when
  // PIPELINE_TOKEN is unset (local/HISTORY_GIT_REMOTE testing) — see
  // redact()'s own guard.
  if (process.env.PIPELINE_TOKEN) {
    registerSecretForRedaction(process.env.PIPELINE_TOKEN);
  }

  const env = process.env.ENV || 'qa';
  const branch =
    process.env.BRANCH_NAME ||
    process.env.GITHUB_REF_NAME ||
    localGitFallback('git branch --show-current') ||
    'unknown';
  const buildNumber = process.env.BUILD_NUMBER || process.env.GITHUB_RUN_NUMBER || 'local';
  const runSource: RunHistoryRecord['runSource'] = process.env.JENKINS_URL
    ? 'jenkins'
    : process.env.GITHUB_ACTIONS
      ? 'github-actions'
      : 'local';
  // WHY the FULL SHA here, not notify.ts's own `--short HEAD` fallback: this
  // value is compared byte-for-byte against `git ls-remote`'s own output
  // below (always full-length) to detect a dev-equivalent (reset) run — a
  // short SHA would never match and silently disable the whole feature for
  // any run relying on the local-git fallback instead of GITHUB_SHA.
  const gitCommit =
    process.env.GITHUB_SHA || localGitFallback('git rev-parse HEAD') || 'unknown';
  const gitRemoteUrl = resolveGitRemoteUrl();
  const isDevEquivalentRun = detectDevEquivalentRun(gitRemoteUrl, gitCommit);
  const jsonReportPath = path.resolve(
    process.env.REPORT_PATH ||
      (process.env.CI
        ? path.join(process.cwd(), 'reports', 'playwright-report', 'results.json')
        : path.join(process.cwd(), 'reports', env, 'latest', 'playwright-report', 'results.json'))
  );
  const deltaOutputPath = path.resolve(process.cwd(), 'reports', env, 'history-delta.json');

  // WHY: write a "no delta available" placeholder FIRST — if anything below
  // throws, notify.ts still finds a well-formed (empty) file instead of a
  // missing one, and the two failure modes ("sync never ran" vs "sync failed
  // partway") don't need to be distinguished by a downstream reader.
  const writeDeltaOutput = (output: HistoryDeltaOutput) => {
    try {
      fs.mkdirSync(path.dirname(deltaOutputPath), { recursive: true });
      fs.writeFileSync(deltaOutputPath, JSON.stringify(output, null, 2));
    } catch {
      /* best-effort */
    }
  };
  writeDeltaOutput(EMPTY_DELTA_OUTPUT);

  if (!fs.existsSync(jsonReportPath)) {
    warn(`[syncHistory] No results.json at ${jsonReportPath} — skipping history sync`);
    return;
  }

  let current: RunHistoryRecord;
  try {
    current = buildCurrentRecord(
      env,
      branch,
      buildNumber,
      runSource,
      jsonReportPath,
      gitCommit,
      isDevEquivalentRun
    );
  } catch (err) {
    warn('[syncHistory] Failed to parse current run for history — skipping:', err);
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reporting-history-'));
  const historyFileRelPath = `history/${env}.jsonl`;

  try {
    // WHY: shallow, single-branch clone — this branch only ever needs its tip,
    // never full history, and a shallow clone keeps every CI run's sync step
    // fast regardless of how many runs have accumulated over the project's life.
    const cloneAttempt = shSafe(
      `git clone --depth 50 --branch ${HISTORY_BRANCH_NAME} --single-branch ${gitRemoteUrl} "${tempDir}/repo"`,
      tempDir
    );
    const repoDir = path.join(tempDir, 'repo');

    if (!cloneAttempt.ok) {
      // WHY: branch doesn't exist yet (first-ever sync) — create it as an
      // orphan so this ledger never inherits or depends on the code branches'
      // history/size.
      log('[syncHistory] History branch not found — creating it as a fresh orphan branch');
      fs.mkdirSync(repoDir, { recursive: true });
      sh(`git clone ${gitRemoteUrl} .`, repoDir);
      sh(`git checkout --orphan ${HISTORY_BRANCH_NAME}`, repoDir);
      sh(`git rm -rf . --quiet || true`, repoDir);
      fs.writeFileSync(path.join(repoDir, '.gitkeep'), '');
      sh(`git config user.name "kylas-qa-bot"`, repoDir);
      sh(`git config user.email "qa-bot@kylas.io"`, repoDir);
      sh(`git add .gitkeep`, repoDir);
      sh(`git commit -m "chore: initialize reporting-history branch [skip ci]"`, repoDir);
    } else {
      sh(`git config user.name "kylas-qa-bot"`, repoDir);
      sh(`git config user.email "qa-bot@kylas.io"`, repoDir);
    }

    // WHY: Confirmed live during verification (2026-07-07) — an earlier version
    // of this retry loop used `git rebase` to reapply a stale local commit on
    // top of the freshly-fetched tip. That's WRONG for a plain-text, line-
    // appended JSONL file: two independent appends can land in the same textual
    // region and git's line-based rebase genuinely conflicts on them (reproduced
    // live with two concurrent synthetic runs), which this loop would then treat
    // as "give up" — silently losing that run's history entry, exactly the
    // failure mode this retry exists to prevent. The fix: never replay a diff at
    // all. On every attempt (including the first), re-read whatever the
    // CURRENT remote tip's file content is, recompute the append fresh with
    // appendAndPrune (a pure function of "latest content" + "my record"), and
    // commit that. Two concurrent runs computing "latest + my own record" can
    // never conflict with each other by construction — there is no patch to
    // reconcile, only ordinary lost-update races that a plain retry resolves.
    let pushed = false;
    let deltaOutput: HistoryDeltaOutput = EMPTY_DELTA_OUTPUT;
    for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
      if (attempt > 1) {
        log(`[syncHistory] Attempt ${attempt}/${MAX_PUSH_RETRIES} — fetching latest and recomputing fresh`);
        await fetchHistoryBranchWithBackoff(repoDir, HISTORY_BRANCH_NAME);
        sh(`git reset --hard origin/${HISTORY_BRANCH_NAME}`, repoDir);
      }

      const historyFilePath = path.join(repoDir, historyFileRelPath);
      const existingJsonl = fs.existsSync(historyFilePath) ? fs.readFileSync(historyFilePath, 'utf-8') : '';
      const historyBeforeAppend = parseHistory(existingJsonl);

      const delta = computeDelta(historyBeforeAppend, current);
      deltaOutput = {
        delta,
        recurringFlaky: computeRecurringFlaky(historyBeforeAppend, current),
        recurringFailures: computeRecurringFailures(historyBeforeAppend, current),
        moduleTrend: computeModuleTrend(historyBeforeAppend, current),
        slowTestTrend: computeSlowTestTrend(historyBeforeAppend, current.slowestTests),
        suiteDrift: computeSuiteDrift(historyBeforeAppend, current),
        passRateSeries: buildPassRateSeries(historyBeforeAppend, current),
      };

      const updatedJsonl = appendAndPrune(existingJsonl, current);
      fs.mkdirSync(path.dirname(historyFilePath), { recursive: true });
      fs.writeFileSync(historyFilePath, updatedJsonl);

      sh(`git add ${historyFileRelPath}`, repoDir);
      const commitResult = shSafe(
        `git commit -m "chore: record ${env} run #${buildNumber} [skip ci]"`,
        repoDir
      );
      if (!commitResult.ok) {
        // WHY still an assumption, deliberately NOT hardened in this pass:
        // this is the same SHAPE of unverified "if it fails, it must mean
        // X" reasoning as the push classification this fix corrects —
        // flagged honestly here (and in the dated known-issues.md entry)
        // rather than silently left implicit, but out of scope for this
        // fix, which is scoped to the two confirmed bugs above (missing
        // credentials, and the push-failure classification specifically).
        log('[syncHistory] Nothing to commit (identical record already present?) — treating as success');
        pushed = true;
        break;
      }

      const pushResult = shSafe(`git push origin ${HISTORY_BRANCH_NAME}`, repoDir);
      if (pushResult.ok) {
        pushed = true;
        break;
      }

      const classification = classifyGitFailure(pushResult.output, [AUTH_FAILURE_CLASSIFIER, NON_FAST_FORWARD_CLASSIFIER]);
      if (!classification.retryable) {
        // WHY this throws immediately, out of the retry loop entirely,
        // rather than logging and continuing to the next attempt: this is
        // the exact fix for Bug 2. An authentication failure can never
        // succeed on retry — looping on it only burns the retry budget and
        // (as happened here, twice) produces a misleading "concurrent
        // update" log that hides the real, fixable problem. An
        // `unclassified` failure is treated with the same discipline: never
        // assumed retryable just because it isn't the one recognized
        // retryable case.
        throw new Error(describeGitFailure(`git push origin ${HISTORY_BRANCH_NAME}`, classification, pushResult.output));
      }

      log(
        `[syncHistory] Push attempt ${attempt}/${MAX_PUSH_RETRIES} classified as ${classification.kind} ` +
          '(confirmed from the real git error text — a genuine concurrent writer landed first) — will fetch latest and retry'
      );
    }

    // WHY: write delta/trend output AFTER the loop, from whichever attempt
    // actually succeeded — an earlier attempt's numbers could be stale
    // (computed against a tip that a concurrent run has since moved past).
    writeDeltaOutput(deltaOutput);

    if (!pushed) {
      warn(
        `[syncHistory] Could not push history after ${MAX_PUSH_RETRIES} attempts — this run's own record was not persisted to the ledger this time. The delta/trend output above is still the best available (from the last attempt), but treat it as approximate.`
      );
    } else {
      log(`[syncHistory] History updated: ${historyFileRelPath} (${env}, build #${buildNumber})`);
    }
  } catch (err) {
    warn('[syncHistory] History sync failed — continuing without it:', err);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

// WHY: guarded behind require.main === module (2026-07-14) — added
// preventatively after discovering the identical unguarded pattern in
// notify.ts caused an unintended real email send when something imported
// from that file (see notify.ts's own WHY comment on this same guard for the
// full incident). This file has the same shape (real git push side effects
// on the real ci/reporting-history branch reachable from main()), so it gets
// the same fix even though it wasn't the one that misfired this time.
if (require.main === module) {
  main().catch((err) => {
    warn('[syncHistory] Fatal error — history sync skipped, build continues:', err);
    process.exit(0);
  });
}
