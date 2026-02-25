import { JSONFilePreset } from 'lowdb/node';
import { Low } from 'lowdb';
import path from 'path';
import { fileURLToPath } from 'url';
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

let writeLock: Promise<void> | null = null;
const originalWrite = db.write.bind(db);

db.write = async (): Promise<void> => {
    while (writeLock) {
        await writeLock;
    }

    let releaseLock!: () => void;
    writeLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });

    try {
        await originalWrite();
    } finally {
        writeLock = null;
        releaseLock();
    }
};

export async function updateDb(updater: (data: Data) => void | Promise<void>): Promise<void> {
    while (writeLock) {
        await writeLock;
    }

    let releaseLock!: () => void;
    writeLock = new Promise<void>((resolve) => {
        releaseLock = resolve;
    });

    try {
        await updater(db.data);
        await originalWrite();
    } finally {
        writeLock = null;
        releaseLock();
    }
}
