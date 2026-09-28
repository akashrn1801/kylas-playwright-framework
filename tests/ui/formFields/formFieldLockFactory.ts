import * as fs from 'fs';
import * as path from 'path';
import { test as base } from '../../../src/fixtures/index';
import { config } from '../../../config/config';
import { logger } from '../../../src/utils/logger';

// WHY this factory exists, rather than a 6th (and later, 7th/8th/9th) copy
// of formFieldsTestLock.ts's own file (2026-09-22, Contact rollout — see
// LEAD_FEATURE_IMPLEMENTATION_CONTEXT.md §3's own explicit instruction to
// decide this before writing a new entity's lock): formFieldsTestLock.ts
// (Lead's own lock, already verified clean across 58/58 tests and left
// UNTOUCHED here — zero risk to that already-shipped work) is ~600 lines of
// extremely hard-won, incident-driven correctness — a heartbeat-based
// staleness window (not a fixed age), a FIFO fairness ticket queue, an
// atomic rename-claim for stale-lock recovery, and a ground-truth marker
// cross-check on release — each fixing a REAL, live-reproduced mutual-
// exclusion violation found during Lead's own rollout (see that file's own
// header comment for the full incident-by-incident history). Hand-copying
// that file per entity (5 more times, for Contact/Company/Task/Products &
// Services/Deal) would mean every one of those incidents' fixes has to be
// independently re-applied, in sync, forever — exactly the kind of drift
// risk CLAUDE.md rule 9 (ripple-check any shared code change) and rule 18
// (a bug fixed in one place is not fixed everywhere) already warn about.
// Extracting the identical, already-proven mechanism into one parameterized
// factory (entity key -> its own lock directory/heartbeat/queue, all
// otherwise byte-identical to formFieldsTestLock.ts's own logic) means a
// FUTURE fix to any of these mechanisms (found via a 6th entity's own real
// incident, say) is applied once and every entity's lock inherits it
// automatically — the same "build it once, generically" principle CLAUDE.md
// rule 1 already establishes for BasePage helpers, applied here to test
// infrastructure instead.
//
// WHY still per-entity LOCK_DIR/LOCK_PATH, not one shared lock across every
// entity: unrelated entities' field-limit tests (Contact's cfTextField vs.
// Company's cfTextField) mutate genuinely independent account-wide config —
// serializing them against each other would cost real wall-clock time for
// zero correctness benefit. See formFieldsTestLock.ts's own "WHY scoped
// per-ENTITY" comment for the identical reasoning, one level up (per-entity
// here, per-field there).

const LOCK_HEARTBEAT_INTERVAL_MS = 10000;
const LOCK_STALE_MS = 90000;
const LOCK_POLL_INTERVAL_MS = 250;
const TICKET_STALE_MS = 30000;

function randomHolderId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export interface FormFieldLock {
  /** Runs `fn()` while holding this entity's exclusive form-field-config lock. */
  withLock<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * A Playwright `test` whose every test auto-acquires this entity's lock
   * for the test's own duration (`auto: true`, `scope: 'test'`) — see
   * formFieldsTestLock.ts's own identical fixture for the full reasoning.
   */
  test: ReturnType<typeof base.extend<{ formFieldLock: void }>>;
}

// WHY entityKey is a free-form string (e.g. "contacts"), not further
// validated against FormFieldsEntityConfig.urlSlug: this module has no
// dependency on FormFieldsConfigPage at all — keeping it decoupled means a
// future caller can key the lock however makes sense for its own file
// layout without this factory needing to know about entity config shapes.
export function createFormFieldLock(entityKey: string): FormFieldLock {
  const LOCK_DIR = path.join(__dirname, '../../../.locks', config.env);
  const LOCK_PATH = path.join(LOCK_DIR, `${entityKey}-form-fields.lock`);
  const LOCK_MARKER_PATH = path.join(LOCK_PATH, 'holder.txt');
  const TICKET_DIR = path.join(LOCK_DIR, `${entityKey}-queue`);

  function ticketFilePath(ticketId: string): string {
    return path.join(TICKET_DIR, ticketId);
  }

  function buildTicketId(holderId: string): string {
    return `${Date.now().toString().padStart(15, '0')}-${holderId}`;
  }

  function buildLockMarkerContent(holderId: string, acquiredAtMs: number, heartbeatAtMs: number): string {
    return `${holderId} pid=${process.pid} acquiredAtMs=${acquiredAtMs} heartbeatAtMs=${heartbeatAtMs}`;
  }

  function readLockHeartbeatAtMs(): number | null {
    try {
      const raw = fs.readFileSync(LOCK_MARKER_PATH, 'utf8');
      const match = raw.match(/heartbeatAtMs=(\d+)/);
      return match ? Number(match[1]) : null;
    } catch {
      return null;
    }
  }

  function readTicketRefreshedAtMs(ticketId: string): number | null {
    try {
      const raw = fs.readFileSync(ticketFilePath(ticketId), 'utf8');
      return Number(raw) || null;
    } catch {
      return null;
    }
  }

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
      if (ageMs === null || ageMs < TICKET_STALE_MS) break;
      const staleClaimPath = `${ticketFilePath(ticketId)}.stale-${randomHolderId()}`;
      try {
        fs.renameSync(ticketFilePath(ticketId), staleClaimPath);
        fs.rmSync(staleClaimPath, { force: true });
        logger.warn(`[formFieldLock:${entityKey}] pruned stale queue ticket ${ticketId} (age ${ageMs}ms)`);
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
      return true;
    }
    return entries.length === 0 || entries[0] === myTicketId;
  }

  function refreshTicket(ticketId: string): void {
    try {
      fs.writeFileSync(ticketFilePath(ticketId), String(Date.now()));
    } catch {
      /* directory/ticket vanished (e.g. a concurrent stale-prune raced us) — the next loop iteration's isMyTicketAtFront() check will react correctly either way, nothing to do here */
    }
  }

  interface LockAcquisition {
    holderId: string;
    acquiredAtMs: number;
  }

  async function acquireLockInner(holderId: string, ticketId: string): Promise<LockAcquisition> {
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
          `[formFieldLock:${entityKey}] acquired by ${holderId} (pid ${process.pid}) at ${new Date().toISOString()}`
        );
        fs.rmSync(ticketFilePath(ticketId), { force: true });
        return { holderId, acquiredAtMs };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
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
          logger.warn(
            `[formFieldLock:${entityKey}] stale lock detected by ${holderId} (${lockAgeMs}ms since last heartbeat) — claiming and removing`
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

  async function acquireLock(): Promise<LockAcquisition> {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    fs.mkdirSync(TICKET_DIR, { recursive: true });
    const holderId = randomHolderId();
    const ticketId = buildTicketId(holderId);
    fs.writeFileSync(ticketFilePath(ticketId), String(Date.now()));
    try {
      return await acquireLockInner(holderId, ticketId);
    } finally {
      try {
        fs.rmSync(ticketFilePath(ticketId), { force: true });
      } catch {
        /* already removed (normal success path already does this) — nothing left to clean up */
      }
    }
  }

  function releaseLock(holderId: string): void {
    let mismatchDetected = false;
    try {
      const recorded = fs.readFileSync(LOCK_MARKER_PATH, 'utf8');
      if (!recorded.startsWith(`${holderId} `)) {
        mismatchDetected = true;
        logger.warn(
          `[formFieldLock:${entityKey}] MUTUAL-EXCLUSION VIOLATION DETECTED: ${holderId} (pid ${process.pid}) ` +
            `releasing, but lock marker recorded "${recorded}" — a different holder has since taken ` +
            `the lock. NOT removing LOCK_PATH (that would destroy their legitimate hold).`
        );
      }
    } catch {
      /* marker unreadable/missing — nothing to cross-check, fall through to normal release */
    }
    logger.info(`[formFieldLock:${entityKey}] released by ${holderId} (pid ${process.pid}) at ${new Date().toISOString()}`);
    if (mismatchDetected) return;
    try {
      fs.rmSync(LOCK_PATH, { recursive: true, force: true });
    } catch {
      /* already removed, or a concurrent stale-lock recovery beat us to it — either way, nothing left to release */
    }
  }

  function startHeartbeat(holderId: string, acquiredAtMs: number): NodeJS.Timeout {
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

  async function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const { holderId, acquiredAtMs } = await acquireLock();
    const heartbeatHandle = startHeartbeat(holderId, acquiredAtMs);
    try {
      return await fn();
    } finally {
      clearInterval(heartbeatHandle);
      releaseLock(holderId);
    }
  }

  const test = base.extend<{ formFieldLock: void }>({
    formFieldLock: [
      async ({}, use) => {
        await withLock(async () => {
          await use();
        });
      },
      { auto: true, scope: 'test' },
    ],
  });

  return { withLock, test };
}
