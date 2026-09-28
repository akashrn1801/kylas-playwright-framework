import * as fs from 'fs';
import * as path from 'path';
import { test as base } from '../../../src/fixtures/index';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

// WHY this file exists at all, and why it is NOT a page-object method
// (real, confirmed CI risk, 2026-09-21 — full worker-count evidence in the
// comment block below): tests/ui/formFields/leadFieldLimits.spec.ts and
// tests/rbac/formFields.rbac.spec.ts are two SEPARATE spec files, each
// independently wrapped in its own test.describe.configure({ mode:
// 'serial' }) — but Playwright's serial mode is a per-file guarantee
// only, confirmed at the framework's own source in .claude/known-issues.md's
// "Sharding order-dependency audit". Both files mutate the exact same
// account-wide, single-instance Lead custom-field configuration
// (cfTextField/cfNumber/cfParagraphText) — not disposable per-test data.
// With fullyParallel: true (playwright.config.ts) and every real CI
// pipeline that runs either file's @regression-tagged tests configured
// for --workers=2 (verified live against the actual files, not assumed —
// see the confirmed worker-count table below), Playwright CAN and WILL
// schedule these two files onto different concurrent worker processes,
// racing writes to the same field.
//
// CONFIRMED WORKER-COUNT TABLE (2026-09-21, read directly from the real
// files — CONTEXT.md/KYLAS_FRAMEWORK_GUIDE.md referenced elsewhere do not
// exist in this repo, per FORM_FIELD_LIMIT_INVESTIGATION.md §1.0, so this
// was verified against the actual CI config instead of assumed):
//   GitHub Actions: dev.yml=1 (and @smoke-only — excludes every config-
//     mutating test in both files, so genuinely not exposed to this race),
//     qa.yml=2 (@regression), stage.yml=2 (full suite), main.yml=2 (full
//     suite), prod.yml=2 (@prodSafe only — also not exposed, FFL1-3 only),
//     sandbox.yml=1 or 2 (dynamic, scales with detected test count).
//   Jenkins: Jenkinsfile=2, Jenkinsfile.qa=2, Jenkinsfile.staging=2,
//     Jenkinsfile.prod=2 (but @prodSafe-scoped — not exposed, same
//     reasoning as prod.yml), Jenkinsfile.sandbox=1.
//   Net: qa.yml, stage.yml, main.yml, staging-promotion-gate.yml (GitHub
//   Actions) and Jenkinsfile, Jenkinsfile.qa, Jenkinsfile.staging
//   (Jenkins) all run BOTH files' full/regression scope at workers=2 —
//   this is a real, live risk on every one of these pipelines once this
//   feature is promoted past sandbox, not a hypothetical edge case.
//
// WHY a fixture that wraps the WHOLE test body, not a lock inside
// FormFieldsConfigPage.ts's own configureFieldLimit()/configureFieldRegex()/
// clearFieldConfiguration() methods: that narrower approach was considered
// and rejected. It would close the race WITHIN one method call, but nearly
// every real test in both files performs "configure the field, THEN
// immediately verify that exact config (assertFieldConfigMatches) or use
// it to fill out a Lead form and check the resulting accept/reject
// outcome" — a multi-step sequence spanning several separate page-object
// calls. A per-method lock releases between those calls, leaving the gap
// between "I just configured min=3/max=6" and "I'm now checking a 2-char
// value gets rejected under that exact config" open for another file's
// concurrent write to land in — which would surface as a confusing,
// hard-to-reproduce, load-dependent test failure with zero connection to
// any real product bug, exactly the kind of race this codebase's own
// "Concurrent-Worker Credential File Race" (CLAUDE.md) already warns
// about for a different shared resource. A fixture acquired before the
// test body runs and released after it finishes (success or failure)
// closes that gap for the test's ENTIRE duration, with zero per-test code
// required — a future test author cannot forget to use it, because
// `auto: true` below applies it to every test in both files
// unconditionally, the same way `adminPage`'s own fixture machinery
// already runs without every test having to opt in by name.
//
// WHY a real fs-based cross-process lock (mkdirSync/rmdirSync), mirroring
// src/auth/authManager.ts's own already-proven withFileLock(), not a new,
// differently-shaped mechanism: each Playwright worker is a genuinely
// separate OS process — an in-memory JS mutex (a plain boolean flag, a
// Promise-based queue) cannot serialize across separate processes, only a
// cross-process primitive can. authManager.ts already solved this exact
// problem (two CI workers racing a shared credential-file write) with an
// atomic mkdirSync-as-lock-acquisition, EEXIST-means-someone-else-holds-it,
// bounded wait-and-retry, and stale-lock recovery for a crashed process.
// This file reimplements the same proven shape locally (not imported from
// authManager.ts, which is role-keyed and private to that module's own
// concern) rather than inventing a second, differently-behaved locking
// primitive in the same codebase.
//
// WHY scoped per-ENTITY ("leads"), not per-individual-field (cfTextField
// vs. cfNumber vs. cfParagraphText locked separately): simpler to reason
// about, and only marginally coarser in practice — the combined
// field-mutating test count across both files is modest, so serializing
// all of it relative to itself (rather than only the subset touching the
// exact same field at the exact same moment) costs little real wall-clock
// time while removing any risk of a future test adding a 4th shared field
// and someone forgetting to widen a field-level lock key to cover it.
//
// WHY Playwright's own `dependencies` project feature and a shared
// test.describe.configure({mode:'serial'}) spanning both files were NOT
// chosen: `dependencies` is already confirmed unsafe for this repo's CI
// shape (silently bypasses --grep filtering, re-runs the whole dependency
// a second time across separate invocations — see .claude/known-issues.md's
// Reports-module section). A single shared describe block would require
// merging leadFieldLimits.spec.ts and formFields.rbac.spec.ts into one
// file, breaking the deliberate, explicit architectural separation this
// feature was built with from the start (matching every other module's
// own tests/ui/<x>/ + tests/rbac/<x>.rbac.spec.ts convention, and
// detect-tests.sh's own path-based selective-test-detection, which keys
// off that exact separation) for a much larger, riskier restructure than
// this fixture achieves.

const LOCK_DIR = path.join(__dirname, '../../../.locks', config.env);
const LOCK_PATH = path.join(LOCK_DIR, 'leads-form-fields.lock');

// WHY this is a HEARTBEAT-based staleness window, not a fixed age-since-
// acquisition threshold like the 420000ms value this replaces (REAL,
// CONFIRMED DESIGN FLAW found 2026-09-22 via static re-review, never
// actually triggered in a caught run but proven reachable by direct
// arithmetic, not guessed): age-since-acquisition can never be sized
// safely against "worst-case legitimate hold," because that worst case
// keeps growing every time saveAndCaptureLeadId()'s own retry budget grows
// (it already did once, 3→5 attempts, 2026-09-21) — the value being
// replaced (420000ms) was justified by "~400s realistic worst-case hold"
// against a 480s test.setTimeout ceiling shared by every lock-participating
// test, a 20s margin that (a) only accounted for the bare 5×60s retry
// loop, not the ADDITIONAL, unbounded reset overhead between retries
// (goToLeadsList + reopen + refill, ×4) or the field-configuration work
// that runs BEFORE the retry loop even starts — both of which also run
// INSIDE this lock, since it wraps the whole test body, not just the save
// call — and (b) left no room to ever raise the retry budget again without
// re-deriving this number from scratch. A single test hitting several
// genuine transient misses in a row (rare, but exactly the scenario this
// retry logic exists to survive) could plausibly exceed 420000ms while
// still genuinely alive and working, well within its own 480000ms budget —
// at which point another waiter would force-reclaim its still-valid lock,
// a real mutual-exclusion violation reached through an under-provisioned
// threshold rather than a bug in the queue/marker logic itself.
//
// The fix applies the SAME proven pattern already used for queue-ticket
// fairness (refreshTicket(), see TICKET_STALE_MS above) to the lock itself:
// the holder refreshes LOCK_MARKER_PATH's own timestamp on a fixed
// interval WHILE it holds the lock (see the heartbeat setInterval in
// withLeadFormFieldLock() below), and staleness is judged as "time since
// the LAST heartbeat," never "time since acquisition." This makes total
// test duration irrelevant to staleness — a legitimately-still-running
// holder (any live worker process, since Playwright's own event loop keeps
// servicing timers during non-blocking awaits like page.waitForResponse())
// stays fresh indefinitely regardless of how long its retries take, while
// a genuinely dead holder goes stale within one short, fixed window after
// its last heartbeat, because a dead process can no longer service its own
// setInterval callback at all. This is strictly safer AND more responsive
// than the age-based design in both directions at once, not a tradeoff.
//
// WHY it's safe to assume a killed test's WORKER PROCESS itself dies (not
// just that one test's promise chain getting abandoned while the worker
// process survives to run later tests, which would make a heartbeat NEVER
// go stale and turn this into a permanent deadlock instead): this file's
// own prior live evidence (holder "a3i2gl"/FFL54, 2026-09-21) already
// establishes the holder's finally-block release never ran on timeout —
// consistent only with process-level termination, since a normal JS
// promise rejection/abort WOULD still unwind through an async function's
// own try/finally. Playwright's own documented worker-recycling behavior
// (a timed-out test's worker is torn down and a fresh one spawned for
// subsequent tests, since an in-flight async JS operation cannot be
// cleanly cancelled from outside) matches this evidence directly.
//
// WHY 10s heartbeat / 90s staleness (9x margin, not a razor-thin one):
// generous enough to absorb ordinary event-loop scheduling jitter (GC
// pauses, a burst of synchronous work) without ever risking a false-stale
// read against a live holder, while still detecting a genuinely dead
// holder in well under two minutes — a large, unambiguous improvement over
// waiting out a fixed multi-minute ceiling that could ALSO misfire the
// other way.
const LOCK_HEARTBEAT_INTERVAL_MS = 10000;
const LOCK_STALE_MS = 90000;
const LOCK_POLL_INTERVAL_MS = 250;

// WHY a random per-acquisition holder id, logged on both acquire and
// release: diagnostic instrumentation added 2026-09-21 after a real
// --workers=2 run showed two tests' own log lines interleaved mid-body
// (FFL10 and FFR4), which should be structurally impossible if this lock
// is genuinely exclusive — these two log lines let a future investigation
// directly verify, from real timestamps, whether two holders' acquire/
// release windows ever overlap, rather than reasoning about it in the
// abstract.
function randomHolderId(): string {
  return Math.random().toString(36).slice(2, 8);
}

// WHY a holder-marker file written INSIDE LOCK_PATH the moment it's
// acquired, cross-checked on release (TEMPORARY diagnostic instrumentation,
// 2026-09-21 — added specifically to get GROUND-TRUTH proof for a real
// --workers=2 run that LOOKED, from acquire/release timestamp correlation
// alone, like two holders (e.g. "9nsbwz"/"09r09n") held overlapping
// windows on the exact same lock): timestamp-only correlation across a
// multi-worker interleaved log is fragile — a delayed release (e.g. slow
// fixture teardown) can make an EARLIER acquisition's own release line
// print long after LATER, entirely legitimate acquisitions have already
// come and gone, creating the ILLUSION of overlap with no actual
// filesystem-level violation. A marker file inside the lock directory
// itself is ground truth: only the process that actually holds LOCK_PATH
// can have written it, and if release ever finds a DIFFERENT holder's id
// recorded there, that is unambiguous proof of a real violation, not a
// misread log.
const LOCK_MARKER_PATH = path.join(LOCK_PATH, 'holder.txt');

// WHY marker content includes both acquiredAtMs (fixed, written once, pure
// diagnostic — "when did this holder first win the lock") and
// heartbeatAtMs (rewritten every LOCK_HEARTBEAT_INTERVAL_MS while held,
// see withLeadFormFieldLock() below — the ONLY field staleness is judged
// from), and WHY staleness is judged from a RECORDED value at all rather
// than each waiter's own local elapsed-wait counter (REAL, CONFIRMED BUG,
// root-caused 2026-09-21 via the ground-truth marker cross-check above —
// this is the actual mutual-exclusion violation that check caught, not a
// false alarm): the original design compared a per-WAITER `waited` counter
// (incremented every 250ms poll) against a fixed threshold, then
// force-removed "whatever currently exists at LOCK_PATH" once that counter
// crossed it. This conflates two different things — "how long have I
// personally been polling" vs. "how old is the CURRENT holder's lock" —
// which are only the same value if exactly one holder ever existed during
// the wait. Confirmed live: waiter W polls continuously while holder A
// legitimately holds for a while; A releases fairly and a brand-new holder
// B immediately wins the handoff and writes its own fresh marker; W's own
// `waited` counter had ALREADY crossed the threshold during A's
// still-valid hold, so on W's very next poll tick it blindly force-removes
// B's few-milliseconds-old, entirely legitimate lock — proven via a real
// run's marker cross-check: holder "jy3ugr" logged "stale lock detected"
// and force-removed holder "v099pn"'s lock only 4 SECONDS after v099pn had
// legitimately acquired it. Fix: derive lock age from the marker's own
// recorded timestamp (a property of the ACTUAL current lock), never from a
// per-waiter counter that has no way to know a fair handoff occurred while
// it was polling. The SAME reasoning is why the recorded timestamp itself
// was later changed from a fixed acquiredAtMs to a live heartbeatAtMs (see
// LOCK_STALE_MS's own WHY above) — a fixed acquisition time has no way to
// know a fair, still-legitimate hold is simply taking a long time, the
// exact same category of conflation this fix already eliminated once for
// waiters.
function readLockHeartbeatAtMs(): number | null {
  try {
    const raw = fs.readFileSync(LOCK_MARKER_PATH, 'utf8');
    const match = raw.match(/heartbeatAtMs=(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

// WHY a shared marker-content builder, called both on initial acquisition
// and on every heartbeat tick: keeps the two write sites byte-format
// identical by construction — a hand-duplicated format string in two
// places is exactly the kind of drift that could silently break
// readLockHeartbeatAtMs()'s regex or releaseLeadFormFieldLock()'s
// startsWith() mismatch check in only one of the two call sites.
function buildLockMarkerContent(holderId: string, acquiredAtMs: number, heartbeatAtMs: number): string {
  return `${holderId} pid=${process.pid} acquiredAtMs=${acquiredAtMs} heartbeatAtMs=${heartbeatAtMs}`;
}

// WHY a FIFO ticket queue layered on top of the mkdirSync-based mutual
// exclusion above, not a replacement for it (real, confirmed live bug,
// 2026-09-21 — found while investigating FFL4's own real failure: "Test
// timeout of 480000ms exceeded while setting up 'leadFormFieldLock'"):
// plain "whoever calls mkdirSync first wins" has NO fairness guarantee
// under sustained contention — confirmed live via the real failing run's
// own log (checked programmatically): the lock was NEVER stuck (every
// release was followed by a new acquire within seconds, throughout the
// entire run — no gap ever exceeded 30s), yet FFL4 still never won a
// single race across its own full 480000ms budget while OTHER tests kept
// acquiring and releasing continuously the whole time. A process that
// happens to have slightly worse polling timing than its competitors can
// be starved indefinitely by simple mkdirSync-race arbitration — directly
// reproduced via a dedicated synthetic test (a "rapid" worker cycling
// continuously vs. a "patient" waiter) showing real, measurable fairness
// degradation under sustained contention. A ticket queue fixes this WITHOUT
// touching the already-proven core exclusivity mechanism at all: each
// waiter writes a timestamp-ordered ticket file into a separate queue
// directory the moment it starts waiting, and only ever ATTEMPTS
// mkdirSync(LOCK_PATH) when its own ticket is the oldest (front) ticket
// still present — everyone else defers even if the lock happens to be free
// at that instant, guaranteeing whoever has waited longest gets first
// crack at it. Because the queue only ever GATES *when* a process attempts
// the existing mkdirSync call — it never replaces or weakens that call —
// the real mutual-exclusion guarantee (and every fix already proven above:
// age-based staleness, atomic rename-claim, marker cross-check) is
// completely unaffected; the worst a queue-logic bug could do is misorder
// who gets first crack, never let two holders in at once.
const TICKET_DIR = path.join(LOCK_DIR, 'queue');
// WHY a separate, shorter staleness window for QUEUE TICKETS than for the
// lock itself (LOCK_STALE_MS): a ticket represents "I am actively
// polling," not "I am doing real work" — a ticket's own process should
// never legitimately go quiet for anywhere near as long as a genuine lock
// HOLD can. A ticket that's stopped being refreshed for this long means
// its own owning process died (or, per FFL4's own real scenario, got
// killed by ITS OWN outer test timeout while still waiting) — orphaning it
// would otherwise permanently block every waiter behind it, since they'd
// forever see an older ticket that will never be claimed.
const TICKET_STALE_MS = 30000;

function ticketFilePath(ticketId: string): string {
  return path.join(TICKET_DIR, ticketId);
}

// WHY the ticket id itself is zero-padded-timestamp-prefixed: a plain
// lexicographic sort of directory entries then equals chronological
// arrival order, with no need to read file contents just to determine
// ordering — reading contents is still needed, separately, to judge
// per-ticket staleness (see readTicketRefreshedAtMs()/pruneStaleTickets()).
function buildTicketId(holderId: string): string {
  return `${Date.now().toString().padStart(15, '0')}-${holderId}`;
}

function readTicketRefreshedAtMs(ticketId: string): number | null {
  try {
    const raw = fs.readFileSync(ticketFilePath(ticketId), 'utf8');
    return Number(raw) || null;
  } catch {
    return null;
  }
}

// WHY every waiter prunes on every poll cycle, not just whoever's "next in
// line": any waiter can observe a stale front ticket, and the SAME
// atomic-rename-claim pattern already proven for the lock itself (see
// acquireLeadFormFieldLock()'s own stale-lock handling) prevents two
// concurrent pruners from double-removing or racing each other unsafely.
function pruneStaleTickets(): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(TICKET_DIR).sort();
  } catch {
    return;
  }
  for (const ticketId of entries) {
    const refreshedAtMs = readTicketRefreshedAtMs(ticketId);
    const ageMs = refreshedAtMs !== null ? Date.now() - refreshedAtMs : null;
    if (ageMs === null || ageMs < TICKET_STALE_MS) break; // entries are chronologically sorted — nothing older follows a still-fresh one
    const staleClaimPath = `${ticketFilePath(ticketId)}.stale-${randomHolderId()}`;
    try {
      fs.renameSync(ticketFilePath(ticketId), staleClaimPath);
      fs.rmSync(staleClaimPath, { force: true });
      logger.warn(`[leadFormFieldLock] pruned stale queue ticket ${ticketId} (age ${ageMs}ms)`);
    } catch {
      /* another process already claimed/removed this exact ticket — fine, nothing left to prune here */
    }
  }
}

function isMyTicketAtFront(myTicketId: string): boolean {
  pruneStaleTickets();
  let entries: string[];
  try {
    entries = fs.readdirSync(TICKET_DIR).sort();
  } catch {
    return true; // queue directory vanished entirely — nothing to defer to
  }
  return entries.length === 0 || entries[0] === myTicketId;
}

interface LockAcquisition {
  holderId: string;
  acquiredAtMs: number;
}

async function acquireLeadFormFieldLock(): Promise<LockAcquisition> {
  fs.mkdirSync(LOCK_DIR, { recursive: true });
  fs.mkdirSync(TICKET_DIR, { recursive: true });
  const holderId = randomHolderId();
  const ticketId = buildTicketId(holderId);
  fs.writeFileSync(ticketFilePath(ticketId), String(Date.now()));
  try {
    return await acquireLeadFormFieldLockInner(holderId, ticketId);
  } finally {
    try {
      fs.rmSync(ticketFilePath(ticketId), { force: true });
    } catch {
      /* already removed (normal success path already does this) — nothing left to clean up */
    }
  }
}

// WHY a heartbeat refresh exists at all (real, confirmed live bug,
// 2026-09-21 — the SAME session as the fairness queue this belongs to,
// found immediately after deploying it): a ticket's timestamp was
// originally written ONCE, at creation, and never touched again while its
// owner legitimately kept polling — meaning ANY waiter stuck behind other
// tests for longer than TICKET_STALE_MS (routine under real load; the very
// fairness queue this heartbeat lives in exists BECAUSE waits can be long)
// had its own still-very-much-alive ticket pruned by a DIFFERENT process as
// if it had crashed. Once pruned, that waiter's ticketId no longer exists
// in the queue directory at all, so isMyTicketAtFront() can never again
// match it — permanently ejecting a perfectly healthy, still-polling
// waiter from its own fair position, with no way back in except waiting
// out its own outer test timeout. Confirmed live: FFL9 hung for the full
// 480000ms ceiling, and the run's own log shows "[leadFormFieldLock]
// pruned stale queue ticket ... (age 30078ms)" fire during exactly that
// window — this heartbeat is the direct fix, refreshing the ticket's own
// timestamp on every single poll iteration a waiter is still alive to
// reach, so only a GENUINELY dead process (one that stops refreshing
// because it stopped running at all) can ever go stale.
function refreshTicket(ticketId: string): void {
  try {
    fs.writeFileSync(ticketFilePath(ticketId), String(Date.now()));
  } catch {
    /* directory/ticket vanished (e.g. a concurrent stale-prune raced us) — the next loop iteration's isMyTicketAtFront() check will react correctly either way, nothing to do here */
  }
}

async function acquireLeadFormFieldLockInner(holderId: string, ticketId: string): Promise<LockAcquisition> {
  while (true) {
    refreshTicket(ticketId);
    if (!isMyTicketAtFront(ticketId)) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
      continue;
    }
    try {
      const acquiredAtMs = Date.now();
      fs.mkdirSync(LOCK_PATH);
      fs.writeFileSync(LOCK_MARKER_PATH, buildLockMarkerContent(holderId, acquiredAtMs, acquiredAtMs));
      logger.info(
        `[leadFormFieldLock] acquired by ${holderId} (pid ${process.pid}) at ${new Date().toISOString()}`
      );
      fs.rmSync(ticketFilePath(ticketId), { force: true });
      return { holderId, acquiredAtMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // WHY fall back to the DIRECTORY's own birth time when the marker is
      // unreadable, rather than treating "can't read it" as either
      // immediately stale or never-stale: the ~microsecond gap between
      // mkdirSync and writeFileSync above (no await between them, but a
      // concurrent reader can still theoretically land inside it) must not
      // be misread as staleness; a genuinely crashed holder that died
      // between those two calls (no marker ever written) must still be
      // recoverable via the directory's own real filesystem age instead of
      // wedging forever. Using the directory's OWN birth time here (not
      // "assume fresh") is still correct under the heartbeat design: a
      // holder that crashed before its first write never got a chance to
      // start heartbeating either, so the directory's real age is exactly
      // right to judge it against the same LOCK_STALE_MS window.
      const recordedHeartbeatAtMs = readLockHeartbeatAtMs();
      let lockAgeMs: number | null = recordedHeartbeatAtMs !== null ? Date.now() - recordedHeartbeatAtMs : null;
      if (lockAgeMs === null) {
        try {
          lockAgeMs = Date.now() - fs.statSync(LOCK_PATH).birthtimeMs;
        } catch {
          /* directory itself vanished between our failed mkdirSync and this stat — treat as not-yet-stale, next loop iteration will just retry mkdirSync cleanly */
        }
      }
      if (lockAgeMs !== null && lockAgeMs >= LOCK_STALE_MS) {
        // WHY remove-and-retry rather than fail outright (mirrors
        // authManager.ts's own stale-lock recovery): a worker process that
        // crashed mid-test while holding this lock would otherwise wedge
        // every subsequent test in both files permanently — a single
        // missed unlock must not become a permanent deadlock.
        //
        // WHY an atomic rename-then-remove, not a direct fs.rmSync(LOCK_PATH)
        // (a SECOND real, confirmed violation, found 2026-09-21 via the SAME
        // ground-truth marker cross-check as the first: two waiters, "vzdral"
        // and "55paid", both independently read the identical stale marker —
        // same recorded age, 300170ms, same timestamp to the millisecond —
        // and both decided to clean it up. A direct fs.rmSync(LOCK_PATH) has
        // no way to tell "the thing I'm removing is still the stale lock I
        // just read" from "a legitimate new holder already recreated
        // LOCK_PATH microseconds ago" — it blindly deletes WHATEVER
        // currently exists at that path. The second waiter's rmSync call can
        // therefore destroy the first waiter's own brand-new, entirely
        // valid acquisition, the identical violation SHAPE as the original
        // bug, just triggered through the cleanup step instead of the
        // waited-counter comparison): fs.renameSync is atomic — only ONE of
        // several racing waiters can ever succeed at renaming the SAME
        // source path, and a second renamer targeting an already-moved
        // source fails with ENOENT instead of silently succeeding against
        // whatever now occupies that path. Only the winner proceeds to
        // remove (its own now-uniquely-named copy, never LOCK_PATH itself)
        // and falls through to retry mkdirSync; every loser's rename throws,
        // caught below, and simply loops back to try mkdirSync fresh — which
        // correctly finds either still-EEXIST (someone else's legitimate new
        // hold) or succeeds (the winner's cleanup already finished).
        logger.warn(
          `[leadFormFieldLock] stale lock detected by ${holderId} (${lockAgeMs}ms since last heartbeat) — claiming and removing`
        );
        const staleClaimPath = `${LOCK_PATH}.stale-${holderId}-${Date.now()}`;
        try {
          fs.renameSync(LOCK_PATH, staleClaimPath);
          fs.rmSync(staleClaimPath, { recursive: true, force: true });
        } catch {
          /* we lost the race to claim it — someone else is handling cleanup, or a legitimate new holder already exists; either way, just retry acquiring below */
        }
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
    }
  }
}

function releaseLeadFormFieldLock(holderId: string): void {
  // WHY read-before-remove, and WHY this specific check (see the
  // LOCK_MARKER_PATH WHY comment above): ground-truth proof, not
  // inference — if the marker doesn't match OUR OWN holderId, some other
  // acquisition genuinely won the directory in between, a real violation.
  // Kept permanently (not stripped out once the bugs above were fixed) as a
  // cheap, standing correctness assertion — if this ever fires again in a
  // real run, that is itself proof a NEW violation class has been
  // introduced, worth investigating with the same rigor as this one.
  //
  // WHY a detected mismatch now SKIPS the removal entirely, rather than
  // logging the violation and removing LOCK_PATH anyway (a THIRD real,
  // confirmed manifestation of the same underlying flaw as the stale-lock
  // race above, found in the same investigation, 2026-09-21): the old code
  // logged a clear warning on mismatch but then unconditionally ran
  // fs.rmSync(LOCK_PATH, ...) regardless — meaning even a POSITIVELY
  // DETECTED violation still went on to actively destroy whatever the
  // OTHER, legitimate holder currently has there. Detecting the problem
  // and then causing it anyway defeats the entire point of the check. If
  // the marker doesn't match us, we no longer own LOCK_PATH — full stop —
  // and must never call fs.rmSync on it, only whoever's marker actually
  // matches gets to remove it. (An unreadable/missing marker — the `catch`
  // below — has no positive evidence of a mismatch, so the original
  // best-effort removal is preserved for that case, unchanged.)
  let mismatchDetected = false;
  try {
    const recorded = fs.readFileSync(LOCK_MARKER_PATH, 'utf8');
    if (!recorded.startsWith(`${holderId} `)) {
      mismatchDetected = true;
      logger.warn(
        `[leadFormFieldLock] MUTUAL-EXCLUSION VIOLATION DETECTED: ${holderId} (pid ${process.pid}) ` +
          `releasing, but lock marker recorded "${recorded}" — a different holder has since taken ` +
          `the lock. NOT removing LOCK_PATH (that would destroy their legitimate hold). This means ` +
          `acquireLeadFormFieldLock() failed to provide real exclusion for this acquisition.`
      );
    }
  } catch {
    /* marker unreadable/missing — nothing to cross-check, fall through to normal release */
  }
  logger.info(`[leadFormFieldLock] released by ${holderId} (pid ${process.pid}) at ${new Date().toISOString()}`);
  if (mismatchDetected) return;
  try {
    fs.rmSync(LOCK_PATH, { recursive: true, force: true });
  } catch {
    /* already removed, or a concurrent stale-lock recovery beat us to it — either way, nothing left to release */
  }
}

// WHY this is exported as a standalone helper, not left as private
// acquire/release calls only reachable through the `test` fixture below
// (real, confirmed gap, found 2026-09-21 via a real --workers=2 run of the
// full 59-test suite: FFL34 and FFL52 both failed with "expected an inline
// validation error, found none" — root-caused via timestamp evidence to
// leadFieldLimits.spec.ts's own test.afterAll() safety-net hook, which
// calls clearAllFieldConfigurations() and, being an afterAll hook, cannot
// request this file's own `leadFormFieldLock` fixture at all — Playwright
// afterAll hooks only ever receive WORKER-scoped fixtures, and this lock is
// deliberately TEST-scoped, per the WHY above, so it was never reachable
// from there). Because the outer describe('Lead Field Limits', ...) block
// has no .serial override (deliberate — see this file's own top-of-file
// blast-radius-reduction comment in leadFieldLimits.spec.ts), it falls into
// Playwright's own `parallelWithHooks` chunking (confirmed at the
// framework's source — see known-issues.md's "Sharding order-dependency
// audit"), which can and does split it into multiple independently-
// scheduled chunks, each running its OWN copy of afterAll. Under real
// --workers=2, this let an entirely UNLOCKED afterAll clear cfTextField/
// cfNumber/cfParagraphText mid-flight while a DIFFERENT chunk's
// lock-protected test was still relying on that exact config — the same
// shared-account-wide-config race this whole file exists to prevent, just
// reaching the shared fields through a hook instead of a test() body.
// Exporting the underlying acquire/release pair as one convenience wrapper
// lets afterAll (or any other future non-fixture caller) take the IDENTICAL
// lock a locked test() would, without duplicating the acquire/try/finally/
// release shape inline at every such call site.
// WHY the heartbeat is started/stopped HERE, wrapping the acquire/fn/release
// sequence, rather than inside acquireLeadFormFieldLock()/
// releaseLeadFormFieldLock() themselves: those two functions are also used
// standalone by other call sites in this file's own acquisition loop
// (readLockHeartbeatAtMs()'s own EEXIST-branch caller doesn't hold anything
// yet) — the heartbeat must run for exactly the HELD duration, which is
// precisely the span this wrapper already owns end-to-end. try/finally
// guarantees the interval is always cleared, on both the success path and
// any thrown error from fn(), before releaseLeadFormFieldLock() runs —
// clearing it BEFORE release (not after) matters: once released, this
// holder no longer owns LOCK_PATH, and a heartbeat tick firing after that
// point could overwrite a brand-new, legitimate next holder's own marker
// with this (now former) holder's stale identity.
function startLockHeartbeat(holderId: string, acquiredAtMs: number): NodeJS.Timeout {
  const handle = setInterval(() => {
    try {
      fs.writeFileSync(LOCK_MARKER_PATH, buildLockMarkerContent(holderId, acquiredAtMs, Date.now()));
    } catch {
      /* LOCK_MARKER_PATH vanished — most plausibly this holder's own lock was (incorrectly) reclaimed as stale by a waiter, or release already ran; either way there is nothing a heartbeat tick can safely do about it here, and the next tick will simply retry */
    }
  }, LOCK_HEARTBEAT_INTERVAL_MS);
  handle.unref();
  return handle;
}

export async function withLeadFormFieldLock<T>(fn: () => Promise<T>): Promise<T> {
  const { holderId, acquiredAtMs } = await acquireLeadFormFieldLock();
  const heartbeatHandle = startLockHeartbeat(holderId, acquiredAtMs);
  try {
    return await fn();
  } finally {
    clearInterval(heartbeatHandle);
    releaseLeadFormFieldLock(holderId);
  }
}

// WHY `auto: true`, `scope: 'test'`: auto so every test in both files gets
// this protection with zero per-test code (see the file-level WHY above);
// test-scoped (not worker-scoped) so the lock is genuinely held only for
// the duration of one test's own body, not the entire worker process's
// lifetime — a worker that also runs OTHER, unrelated tests (any other
// module) must not have those blocked by a Lead-form-field lock they have
// nothing to do with.
export const test = base.extend<{ leadFormFieldLock: void }>({
  leadFormFieldLock: [
    async ({}, use) => {
      await withLeadFormFieldLock(async () => {
        await use();
      });
    },
    { auto: true, scope: 'test' },
  ],
});

export { expect } from '../../../src/fixtures/index';
