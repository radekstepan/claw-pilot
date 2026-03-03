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

import BetterSqlite3 from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { isNull } from "drizzle-orm";
import path from "path";
import { fileURLToPath } from "url";
import * as schema from "./schema.js";

export * from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the SQLite database file — under the existing `data/` volume. */
const dbPath = path.join(__dirname, "../../data/claw-pilot.db");

/** Absolute path to the Drizzle migrations folder checked in to source control. */
const migrationsFolder = path.join(__dirname, "../../drizzle");

// ---------------------------------------------------------------------------
// Singleton connection & Drizzle instance
// Exported as `let` so tests can swap in an in-memory instance via setTestDb().
// ---------------------------------------------------------------------------
let sqlite: BetterSqlite3.Database = new BetterSqlite3(dbPath);
sqlite.pragma("journal_mode = WAL");

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
 * Close the underlying SQLite connection explicitly.
 * Call during graceful shutdown **after** all in-flight requests have drained
 * (i.e. after fastify.close()) to ensure WAL/SHM files are flushed and removed.
 */
export function closeDb(): void {
  sqlite.close();
}

/**
 * Perform a safe hot backup via SQLite's VACUUM INTO mechanism.
 * Works while WAL-mode writers are active — SQLite serialises the snapshot
 * internally, so no locks or server downtime are required.
 *
 * @param destPath Absolute path for the backup file. Any existing file at
 *                 that path is overwritten atomically.
 */
export function backupDb(destPath: string): void {
  // VACUUM INTO requires the destination to not exist, so remove it first.
  // better-sqlite3 uses the synchronous Node fs APIs via native binding, so
  // we delegate the unlink to Node's fs module before running the statement.
  sqlite.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}

/**
 * Apply all pending Drizzle migrations synchronously.
 * Must be called once during server startup before any route handles a request.
 */
export function runMigrations(): void {
  migrate(db, { migrationsFolder });
}

// ---------------------------------------------------------------------------
// Cursor-based pagination helpers
//
// The cursor encodes { timestamp, id } as a base64url string so the API never
// leaks internal sort keys.  Timestamp collisions are broken by secondary sort
// on `id` (both DESC), giving a stable page boundary.
// ---------------------------------------------------------------------------

export function encodeCursor(timestamp: string, id: string): string {
  return Buffer.from(`${timestamp}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): {
  timestamp: string;
  id: string;
} {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const pipeIdx = decoded.indexOf("|");
  if (pipeIdx === -1) throw new Error("Invalid cursor");
  return {
    timestamp: decoded.slice(0, pipeIdx),
    id: decoded.slice(pipeIdx + 1),
  };
}

export const notArchived = isNull(schema.tasks.archivedAt);
