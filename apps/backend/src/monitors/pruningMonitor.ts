/**
 * pruningMonitor.ts — daily hard-delete of old chat messages, activity logs, and AI jobs.
 *
 * Deletes records older than 60 days from `chat_messages` and `activities`
 * once every 24 hours. Also deletes completed/stuck AI jobs older than 7 days.
 * Uses Drizzle's synchronous SQLite API so no async work is needed.
 */
import { FastifyInstance } from "fastify";
import {
  db,
  chatMessages as chatTable,
  activities as activitiesTable,
  aiJobs,
} from "../db/index.js";
import { lt, and, inArray } from "drizzle-orm";

const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PRUNE_AGE_DAYS = 60;
const AI_JOB_PRUNE_AGE_DAYS = 7;

function buildCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - PRUNE_AGE_DAYS);
  return d.toISOString();
}

function buildAiJobCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - AI_JOB_PRUNE_AGE_DAYS);
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

      // Prune old completed/stuck AI jobs
      const aiJobCutoff = buildAiJobCutoff();
      const { changes: aiJobsDeleted } = db
        .delete(aiJobs)
        .where(
          and(
            inArray(aiJobs.status, ["completed", "stuck"]),
            lt(aiJobs.completedAt, aiJobCutoff),
          ),
        )
        .run();

      if (chatDeleted > 0 || activityDeleted > 0 || aiJobsDeleted > 0) {
        fastify.log.info(
          `[pruning] Deleted ${chatDeleted} chat message(s), ` +
            `${activityDeleted} activity log(s), and ` +
            `${aiJobsDeleted} AI job(s).`,
        );
      }
    } catch (error: unknown) {
      fastify.log.error(
        `[pruning] Error in pruning monitor: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, PRUNE_INTERVAL_MS).unref();
}
