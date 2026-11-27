import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// ADR 0016 (S2): at most MAX_CONCURRENT_LOGINS logins at once per checkout/machine, across
// every Playwright worker process, so a burst of workers cannot trip the backend's login
// limits (observed: 400 {"code":"000004","message":"Database error"} at 4 parallel logins on
// staging, 429 at 5-10 on QA). Slots are atomic mkdir directories, like the per-role lock in
// authManager.ts. It limits one machine only; cross-job pacing is the workflow stagger (S3).
export const MAX_CONCURRENT_LOGINS = 2;
// A login attempt is bounded well below this; an older slot belongs to a crashed process.
const STALE_SLOT_MS = 4 * 60 * 1000;
// Longest a caller queues for a slot before failing with the named holders.
const SLOT_WAIT_BUDGET_MS = 3 * 60 * 1000;
const SLOT_POLL_MS = 250;

function slotDir(stateDir: string, index: number): string {
  return path.join(stateDir, 'login-slots', String(index));
}

function describeHolder(dir: string): string {
  try {
    return fs.readFileSync(path.join(dir, 'holder.txt'), 'utf8').trim();
  } catch {
    return 'unknown holder';
  }
}

function removeIfStale(dir: string): void {
  try {
    if (Date.now() - fs.statSync(dir).mtimeMs > STALE_SLOT_MS) {
      logger.warn(`Login slot ${dir} is older than ${STALE_SLOT_MS / 1000}s (${describeHolder(dir)}) — removing it`);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* released meanwhile */
  }
}

/** Removes every slot left by a crashed earlier run; call once from globalSetup. */
export function clearLoginSlots(stateDir: string): void {
  fs.rmSync(path.join(stateDir, 'login-slots'), { recursive: true, force: true });
}

/**
 * Waits for one of the login slots and returns its release function. The wait is for a slot to be
 * released (a real signal: mkdir succeeds), bounded, and fails naming who holds them.
 */
export async function acquireLoginSlot(stateDir: string, label: string): Promise<() => void> {
  fs.mkdirSync(path.join(stateDir, 'login-slots'), { recursive: true });
  const startedAt = Date.now();
  let held: string | null = null;

  while (held === null) {
    for (let i = 0; i < MAX_CONCURRENT_LOGINS && held === null; i++) {
      const dir = slotDir(stateDir, i);
      try {
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'holder.txt'), `${label} pid=${process.pid} since=${new Date().toISOString()}`);
        held = dir;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        removeIfStale(dir);
      }
    }
    if (held !== null) break;
    const waitedMs = Date.now() - startedAt;
    if (waitedMs > SLOT_WAIT_BUDGET_MS) {
      const holders = Array.from({ length: MAX_CONCURRENT_LOGINS }, (_, i) => describeHolder(slotDir(stateDir, i)));
      throw new Error(
        `${label}: no login slot free after ${waitedMs}ms (limit ${MAX_CONCURRENT_LOGINS} concurrent logins). Holders: ${holders.join(' | ')}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, SLOT_POLL_MS));
  }

  const waited = Date.now() - startedAt;
  if (waited > 1000) logger.info(`${label}: waited ${waited}ms for a login slot`);
  const heldDir = held;
  return () => fs.rmSync(heldDir, { recursive: true, force: true });
}

/** Runs `fn` while holding a login slot. */
export async function withLoginSlot<T>(stateDir: string, label: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLoginSlot(stateDir, label);
  try {
    return await fn();
  } finally {
    release();
  }
}
