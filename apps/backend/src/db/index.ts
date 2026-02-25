/**
 * db/index.ts — Drizzle ORM database singleton.
 *
 * Replaces the old LowDB flat-file approach with a proper SQLite database
 * backed by better-sqlite3.  All writes go through SQLite transactions, which
 * means no custom mutex / atomic-rename logic is needed.
 *
 * Design:
 *  - `db` is a module-level `let` so ESM live bindings let tests swap it via
 *    `setTestDb()` before calling `buildApp()`.
 *  - `runMigrations()` applies the Drizzle migration folder using the bundled
 *    SQL files produced by `drizzle-kit generate`.
 *  - Cursor helpers encode/decode pagination tokens for activities and chat.
 */

import BetterSqlite3 from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'path';
import { fileURLToPath } from 'url';
import * as schema from './schema.js';

export * from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the SQLite database file — under the existing `data/` volume. */
const dbPath = path.join(__dirname, '../../data/claw-pilot.db');

/** Absolute path to the Drizzle migrations folder checked in to source control. */
const migrationsFolder = path.join(__dirname, '../../drizzle');

// ---------------------------------------------------------------------------
// Singleton connection & Drizzle instance
// Exported as `let` so tests can swap in an in-memory instance via setTestDb().
// ---------------------------------------------------------------------------
let sqlite: BetterSqlite3.Database = new BetterSqlite3(dbPath);

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

export let db: DrizzleDb = drizzle(sqlite, { schema });

/**
 * Replace the global db singleton.
 * For tests only — call before `buildApp()` to get full isolation.
 */
export function setTestDb(testSqlite: BetterSqlite3.Database): void {
    sqlite = testSqlite;
    db = drizzle(testSqlite, { schema });
}

/**
 * Apply all pending Drizzle migrations synchronously.
 * Must be called once during server startup before any route handles a request.
 */
export function runMigrations(): void {
    migrate(db, { migrationsFolder });
}

// ---------------------------------------------------------------------------
// JSON column helpers
//
// `tags` and `deliverables` are stored as JSON text in SQLite for simplicity.
// An ORM-level custom type would also work, but these thin helpers keep the
// column definitions readable and avoid pulling in a custom codec dependency.
// ---------------------------------------------------------------------------

export function parseJsonField<T>(raw: string | null | undefined): T | undefined {
    if (raw == null) return undefined;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

export function stringifyJsonField(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Cursor-based pagination helpers
//
// The cursor encodes { timestamp, id } as a base64url string so the API never
// leaks internal sort keys.  Timestamp collisions are broken by secondary sort
// on `id` (both DESC), giving a stable page boundary.
// ---------------------------------------------------------------------------

export function encodeCursor(timestamp: string, id: string): string {
    return Buffer.from(`${timestamp}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { timestamp: string; id: string } {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const pipeIdx = decoded.indexOf('|');
    if (pipeIdx === -1) throw new Error('Invalid cursor');
    return {
        timestamp: decoded.slice(0, pipeIdx),
        id: decoded.slice(pipeIdx + 1),
    };
}
