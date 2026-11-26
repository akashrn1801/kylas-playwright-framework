import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config/config';
import { logger } from './logger';

// WHY (B7, KI-59): the admin's view, sort and page size for a smart list are stored on the SERVER per user, and every
// worker logs in as the same admin, so a test that flips the lead list to Kanban (L68) or re-sorts it (L65) changes
// what every other lead test sees while it runs. Serial mode is per file and per worker, and an exclusive lock for the
// writers alone cannot stop a reader in another worker, so this is a shared/exclusive lock: readers (any test that opens
// the list) hold it shared and never wait for each other; a writer holds it exclusively and waits until no reader is
// running. Same primitive as authManager.withFileLock / formFieldLockFactory: a `mkdirSync` lock across processes with
// a heartbeat, so a crashed holder is reclaimed, and a wait that runs out fails by name with the holder listed.
//
// Layout in `.locks/<env>/<key>-list-prefs/`: `writer.lock/` (mkdir = the exclusive claim, `holder.txt` heartbeat) and
// `readers/<id>` (one file per running reader, its mtime is the heartbeat). A writer takes `writer.lock` FIRST and
// only then scans `readers/`; a reader registers in `readers/` and only then re-checks `writer.lock`. Whichever side
// wrote second sees the other, so a reader and a writer can never both proceed (the same argument as Dekker's lock).
// Readers that arrive while a writer waits or runs wait too, so a writer cannot be starved by a stream of readers.

const HEARTBEAT_INTERVAL_MS = 10000;
const STALE_MS = 90000;
const POLL_INTERVAL_MS = 250;
const NAMED_FAILURE_MARGIN_MS = 15000;

export type ListPreferenceMode = 'shared' | 'exclusive';

export interface ListPreferenceLock {
  /** Resolves with a release function once the lock is held in `mode`; fails by name when the wait budget runs out. */
  acquire(mode: ListPreferenceMode, holder: string): Promise<() => void>;
}

export interface ListPreferenceLockOptions {
  /** Total wait budget; the named failure is thrown NAMED_FAILURE_MARGIN_MS before it so the fixture timeout never wins. */
  waitBudgetMs?: number;
  /** Lock directory root (tests use a temp dir); default `.locks/<env>`. */
  rootDir?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ageMs(file: string): number | null {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

export function createListPreferenceLock(key: string, options: ListPreferenceLockOptions = {}): ListPreferenceLock {
  const waitBudgetMs = options.waitBudgetMs ?? 600000;
  const rootDir = options.rootDir ?? path.join(__dirname, '../../.locks', config.env);
  const baseDir = path.join(rootDir, `${key}-list-prefs`);
  const writerLock = path.join(baseDir, 'writer.lock');
  const writerMarker = path.join(writerLock, 'holder.txt');
  const readersDir = path.join(baseDir, 'readers');
  const tag = `[listPreferenceLock:${key}]`;

  const readFile = (file: string): string => {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return 'unreadable';
    }
  };

  // The writer claim counts while its heartbeat is fresh; a stale one is a crashed holder and is removed.
  function writerActive(): boolean {
    if (!fs.existsSync(writerLock)) return false;
    const age = ageMs(writerMarker) ?? ageMs(writerLock);
    if (age !== null && age >= STALE_MS) {
      logger.warn(`${tag} stale writer lock (${age} ms since last heartbeat), removing`);
      const claim = `${writerLock}.stale-${process.pid}-${Date.now()}`;
      try {
        fs.renameSync(writerLock, claim);
        fs.rmSync(claim, { recursive: true, force: true });
      } catch {
        /* another process is handling the cleanup, or a new holder already exists: the next poll re-reads it */
      }
      return false;
    }
    return true;
  }

  function liveReaders(): string[] {
    let names: string[];
    try {
      names = fs.readdirSync(readersDir);
    } catch {
      return [];
    }
    const live: string[] = [];
    for (const name of names) {
      const file = path.join(readersDir, name);
      const age = ageMs(file);
      if (age === null) continue;
      if (age >= STALE_MS) {
        logger.warn(`${tag} stale reader ${name} (${age} ms since last heartbeat), removing`);
        fs.rmSync(file, { force: true });
        continue;
      }
      live.push(`${readFile(file)} (heartbeat ${Math.round(age / 1000)}s ago)`);
    }
    return live;
  }

  function heartbeat(touch: () => void): NodeJS.Timeout {
    const handle = setInterval(() => {
      try {
        touch();
      } catch {
        /* the claim vanished (released, or reclaimed as stale): nothing a tick can safely do, the next one retries */
      }
    }, HEARTBEAT_INTERVAL_MS);
    handle.unref();
    return handle;
  }

  function budgetLeft(startedAtMs: number): boolean {
    return Date.now() - startedAtMs <= waitBudgetMs - NAMED_FAILURE_MARGIN_MS;
  }

  async function acquireShared(holder: string): Promise<() => void> {
    fs.mkdirSync(readersDir, { recursive: true });
    const startedAtMs = Date.now();
    const id = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    const readerFile = path.join(readersDir, id);
    const content = `${holder} pid=${process.pid}`;
    while (true) {
      if (!budgetLeft(startedAtMs)) {
        throw new Error(
          `${tag} reader "${holder}" waited ${Math.round((Date.now() - startedAtMs) / 1000)}s for a writer to finish and gave up; ` +
            `current writer: ${readFile(writerMarker)}. The writer is a test still running (it keeps heartbeating), not a stale lock.`
        );
      }
      if (!writerActive()) {
        fs.writeFileSync(readerFile, content);
        // Registered: re-check, because a writer may have claimed the lock between the check above and the write.
        if (!writerActive()) {
          const beat = heartbeat(() => fs.writeFileSync(readerFile, content));
          return () => {
            clearInterval(beat);
            fs.rmSync(readerFile, { force: true });
          };
        }
        fs.rmSync(readerFile, { force: true });
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function acquireExclusive(holder: string): Promise<() => void> {
    fs.mkdirSync(baseDir, { recursive: true });
    const startedAtMs = Date.now();
    const marker = `${holder} pid=${process.pid} since=${new Date().toISOString()}`;
    // Phase 1: the writer claim (also what keeps new readers out).
    while (true) {
      if (!budgetLeft(startedAtMs)) {
        throw new Error(
          `${tag} writer "${holder}" waited ${Math.round((Date.now() - startedAtMs) / 1000)}s for the writer lock and gave up; ` +
            `current holder: ${readFile(writerMarker)}.`
        );
      }
      if (!writerActive()) {
        try {
          fs.mkdirSync(writerLock);
          fs.writeFileSync(writerMarker, marker);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
    const beat = heartbeat(() => fs.writeFileSync(writerMarker, marker));
    const release = (): void => {
      clearInterval(beat);
      // Only remove the claim if it is still ours (a stale-reclaim by a waiter would have replaced it).
      if (readFile(writerMarker) === marker) fs.rmSync(writerLock, { recursive: true, force: true });
    };
    // Phase 2: wait until no reader is running.
    try {
      while (true) {
        const readers = liveReaders();
        if (readers.length === 0) {
          logger.info(`${tag} exclusive lock held by "${holder}"`);
          return release;
        }
        if (!budgetLeft(startedAtMs)) {
          throw new Error(
            `${tag} writer "${holder}" waited ${Math.round((Date.now() - startedAtMs) / 1000)}s for ${readers.length} reader(s) to finish and gave up; ` +
              `readers still running: ${readers.join('; ')}.`
          );
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      release();
      throw error;
    }
  }

  return {
    acquire: (mode, holder) => (mode === 'exclusive' ? acquireExclusive(holder) : acquireShared(holder)),
  };
}
