/**
 * backupMonitor.ts — hourly hot backup of the SQLite database.
 *
 * Uses SQLite's built-in `VACUUM INTO` statement, which creates a consistent
 * snapshot of the live database without requiring exclusive locks.  In WAL
 * mode (our default) this is fully safe while readers and writers are active.
 *
 * The backup is written to `data/claw-pilot.backup.db` in the same volume as
 * the primary database, overwriting any previous backup file.  This keeps disk
 * usage bounded — only one rolling backup is retained at a time.
 *
 * The timer is `.unref()`-d so it won't prevent the process from exiting
 * when every other async operation has finished.  The explicit
 * `clearInterval()` in `index.ts`'s shutdown handler is still the primary
 * mechanism for stopping the monitor during a graceful shutdown.
 */
import { FastifyInstance } from 'fastify';
import { backupDb } from '../db/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const BACKUP_PATH = path.resolve(__dirname, '../../data/claw-pilot.backup.db');

/**
 * Start the hourly database backup monitor.
 * Returns the `NodeJS.Timeout` handle so `index.ts` can `clearInterval` it
 * during graceful shutdown.
 */
export function startBackupMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    return setInterval(() => {
        try {
            // VACUUM INTO fails if the destination file already exists, so we
            // delete any previous backup first.  The removal + VACUUM are not
            // atomic at the filesystem level, but losing the backup file for a
            // brief moment is acceptable; the primary DB file is never touched.
            if (fs.existsSync(BACKUP_PATH)) {
                fs.unlinkSync(BACKUP_PATH);
            }

            backupDb(BACKUP_PATH);

            const { size } = fs.statSync(BACKUP_PATH);
            const sizeMb = (size / 1024 / 1024).toFixed(2);
            fastify.log.info(`[backup] SQLite backup written to ${BACKUP_PATH} (${sizeMb} MB)`);
        } catch (error: unknown) {
            fastify.log.error(
                `[backup] Hourly backup failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }, BACKUP_INTERVAL_MS).unref();
}
