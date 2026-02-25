import { JSONFilePreset } from 'lowdb/node';
import { Low } from 'lowdb';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { Task, ActivityLog, RecurringTask, ChatMessage, AppConfig } from '@claw-pilot/shared-types';

export type Data = {
    tasks: Task[];
    activities: ActivityLog[];
    chat: ChatMessage[];
    recurring: RecurringTask[];
    config: AppConfig;
};

/** Default (empty) database state used to initialise LowDB and in integration tests. */
export const defaultData: Data = {
    tasks: [],
    activities: [],
    chat: [],
    recurring: [],
    config: { gatewayUrl: 'http://127.0.0.1:8000', apiPort: 54321, autoRestart: false },
};

// Resolve the db file path relative to this module so it works regardless of
// the process working directory (e.g. when running vitest from the repo root).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'db.json');

/**
 * Singleton LowDB instance backed by the JSON file on disk.
 *
 * Exported as `let` so integration tests can swap in an in-memory instance
 * via `setDb()` before building the Fastify app under test.  Because ESM
 * named exports are *live bindings*, importing modules will automatically
 * see the reassigned value.
 */
export let db: Low<Data> = await JSONFilePreset<Data>(dbPath, defaultData);

/**
 * Replace the global db singleton.
 * Intended for use in tests only — swap in a `new Low(new Memory(), ...)` instance
 * before calling `buildApp()` to keep tests fully isolated from the file system.
 */
export function setDb(newDb: Low<Data>): void {
    db = newDb;
}

// ---------------------------------------------------------------------------
// Atomic write — serialise via a single shared mutex.
//
// Strategy:
//   1. Serialise all writes through `writeLock` so concurrent mutations don't
//      interleave or race at the fs layer.
//   2. Write JSON to `db.tmp.json` first, then atomically rename it over
//      `db.json`.  On POSIX systems rename(2) is atomic; a mid-write crash
//      therefore never leaves db.json half-written (the .tmp file is the only
//      one at risk, and it is discarded on the next write attempt).
// ---------------------------------------------------------------------------

let writeLock: Promise<void> | null = null;
const tmpPath = dbPath.replace('.json', '.tmp.json');

/** Performs the actual atomic file write — NO locking, callers hold the lock. */
async function atomicWrite(): Promise<void> {
    const json = JSON.stringify(db.data, null, 2);
    await fs.writeFile(tmpPath, json, 'utf-8');
    await fs.rename(tmpPath, dbPath);
}

/** Acquire the shared write lock, call fn(), then release. */
async function withLock(fn: () => Promise<void>): Promise<void> {
    while (writeLock) {
        await writeLock;
    }
    let releaseLock!: () => void;
    writeLock = new Promise<void>((resolve) => { releaseLock = resolve; });
    try {
        await fn();
    } finally {
        writeLock = null;
        releaseLock();
    }
}

// Override db.write so every call site benefits from the atomic strategy.
db.write = (): Promise<void> => withLock(atomicWrite);

/**
 * Mutate db.data and flush to disk under the shared write lock.
 *
 * The updater and the subsequent disk write are held under *one* lock
 * acquisition, so concurrent updateDb calls cannot interleave their mutations.
 */
export async function updateDb(updater: (data: Data) => void | Promise<void>): Promise<void> {
    return withLock(async () => {
        await updater(db.data);
        await atomicWrite();
    });
}

// ---------------------------------------------------------------------------
// Hourly rolling backup — copies db.json → db.backup.json every hour.
// The timer is exported so index.ts can clearInterval it during graceful shutdown.
// .unref() ensures the timer won't prevent process exit on its own.
// ---------------------------------------------------------------------------

const backupPath = dbPath.replace('.json', '.backup.json');

export const dbBackupTimer: NodeJS.Timeout = setInterval(async () => {
    try {
        await fs.copyFile(dbPath, backupPath);
    } catch (e) {
        console.error('[db] Hourly backup failed:', e);
    }
}, 60 * 60 * 1_000);

dbBackupTimer.unref();
