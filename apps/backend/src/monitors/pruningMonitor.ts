/**
 * pruningMonitor.ts — daily hard-delete of old chat messages and activity logs.
 *
 * Deletes records older than 60 days from `chat_messages` and `activities`
 * once every 24 hours.  Uses Drizzle's synchronous SQLite API so no async
 * work is needed — the monitor callback is simply a regular (non-async) function.
 */
import { FastifyInstance } from 'fastify';
import { db, chatMessages as chatTable, activities as activitiesTable } from '../db/index.js';
import { lt } from 'drizzle-orm';

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PRUNE_AGE_DAYS    = 60;

function buildCutoff(): string {
    const d = new Date();
    d.setDate(d.getDate() - PRUNE_AGE_DAYS);
    return d.toISOString();
}

export function startPruningMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    return setInterval(() => {
        try {
            const cutoff = buildCutoff();

            const { changes: chatDeleted } = db
                .delete(chatTable)
                .where(lt(chatTable.timestamp, cutoff))
                .run();

            const { changes: activityDeleted } = db
                .delete(activitiesTable)
                .where(lt(activitiesTable.timestamp, cutoff))
                .run();

            if (chatDeleted > 0 || activityDeleted > 0) {
                fastify.log.info(
                    `[pruning] Deleted ${chatDeleted} chat message(s) and ` +
                    `${activityDeleted} activity log(s) older than ${PRUNE_AGE_DAYS} days.`
                );
            }
        } catch (error: unknown) {
            fastify.log.error(`[pruning] Error in pruning monitor: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, PRUNE_INTERVAL_MS).unref(); // .unref() prevents this timer from blocking process exit
}
