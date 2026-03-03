/**
 * Boot-time recovery: cross-reference IN_PROGRESS tasks against live gateway
 * sessions and immediately mark orphaned tasks as STUCK.
 *
 * Background: the aiQueue is memory-only. If the server restarts while tasks
 * are being processed, those tasks remain IN_PROGRESS in the DB forever but
 * have no corresponding active gateway session.  The stuckTaskMonitor only
 * alerts after 24 h — this check fires once on startup to recover orphans
 * immediately instead of waiting.
 *
 * Behaviour when the gateway is offline:
 *   - Silently skips the check (logs a warning). We cannot distinguish
 *     "orphaned" from "still running autonomously" without a live session
 *     list, so we err on the side of caution.
 */
import { eq, and } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db, tasks as tasksTable, aiJobs, notArchived } from "../db/index.js";
import type { Task } from "@claw-pilot/shared-types";
import {
  getGateway,
  GatewayOfflineError,
  GatewayPairingRequiredError,
} from "../gateway/index.js";
import { markTaskStuck } from "../services/taskLifecycle.js";

export async function runBootRecovery(fastify: FastifyInstance): Promise<void> {
  const gw = getGateway();

  // 0. Handle orphaned running AI jobs from previous process
  const runningJobs = db
    .select()
    .from(aiJobs)
    .where(eq(aiJobs.status, "running"))
    .all();

  if (runningJobs.length > 0) {
    fastify.log.info(
      `bootRecovery: found ${runningJobs.length} running AI job(s) from previous process`,
    );

    for (const job of runningJobs) {
      const attempts = Number(job.attempts);
      const maxAttempts = Number(job.maxAttempts);
      const newAttempts = attempts + 1;
      const now = new Date().toISOString();

      if (newAttempts >= maxAttempts) {
        db.update(aiJobs)
          .set({
            status: "stuck",
            attempts: newAttempts,
            error:
              "Job orphaned on restart - process likely crashed mid-execution",
            completedAt: now,
          })
          .where(eq(aiJobs.id, job.id))
          .run();

        fastify.io?.emit("agent_error", {
          agentId: String(job.label),
          error: "Job orphaned on restart",
        });

        fastify.log.warn(
          `bootRecovery: job ${job.id} (${String(job.label)}) marked STUCK (orphaned)`,
        );
      } else {
        db.update(aiJobs)
          .set({
            status: "queued",
            attempts: newAttempts,
            error: "Job orphaned on restart - re-queuing for retry",
            nextRetryAt: null,
            startedAt: null,
            lastHeartbeatAt: null,
          })
          .where(eq(aiJobs.id, job.id))
          .run();

        fastify.log.info(
          `bootRecovery: job ${job.id} (${String(job.label)}) re-queued for retry (attempt ${newAttempts})`,
        );
      }
    }
  }

  // 1. Find all tasks currently sitting IN_PROGRESS in the DB.
  const inProgressTasks = db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.status, "IN_PROGRESS"), notArchived))
    .all();

  if (inProgressTasks.length === 0) {
    fastify.log.info("bootRecovery: no IN_PROGRESS tasks — nothing to recover");
    return;
  }

  fastify.log.info(
    `bootRecovery: found ${inProgressTasks.length} IN_PROGRESS task(s), querying live sessions…`,
  );

  // 2. Fetch live gateway sessions.  Abort if the gateway is unreachable.
  let liveSessions: Awaited<ReturnType<typeof gw.getLiveSessions>>;
  try {
    liveSessions = await gw.getLiveSessions();
  } catch (err) {
    if (err instanceof GatewayPairingRequiredError) {
      fastify.log.warn(
        "bootRecovery: gateway requires device pairing — skipping recovery (tasks left IN_PROGRESS)",
      );
      return;
    }
    if (err instanceof GatewayOfflineError) {
      fastify.log.warn(
        "bootRecovery: gateway is offline — skipping recovery (tasks left IN_PROGRESS)",
      );
      return;
    }
    fastify.log.error(
      { err },
      "bootRecovery: unexpected error fetching sessions — skipping",
    );
    return;
  }

  // 3. Build a set of active session keys for O(1) lookup.
  const activeSessionKeys = new Set(
    liveSessions
      .map((s) => s.key)
      .filter((k): k is string => typeof k === "string"),
  );

  fastify.log.info(
    `bootRecovery: ${activeSessionKeys.size} active gateway session(s) found`,
  );

  // 4. Mark orphaned tasks as STUCK.
  const now = new Date().toISOString();
  let markedCount = 0;

  for (const task of inProgressTasks) {
    // If the task has an assigned agent, check whether its session is live.
    // Tasks with no agentId were somehow left IN_PROGRESS without being routed —
    // treat those as orphaned too.
    const sessionKey = task.agentId
      ? gw.agentIdToSessionKey(task.agentId)
      : null;
    const hasActiveSession =
      sessionKey !== null && activeSessionKeys.has(sessionKey);

    if (hasActiveSession) {
      fastify.log.debug(
        `bootRecovery: task ${task.id} has active session (${sessionKey}) — leaving IN_PROGRESS`,
      );
      continue;
    }

    const reason = task.agentId
      ? `agent offline (no active session on boot for ${task.agentId})`
      : "agent offline (no agentId on boot)";

    markTaskStuck(task.id, task.agentId, reason, fastify.io);

    fastify.log.info(
      `bootRecovery: task ${task.id} ("${task.title}") marked STUCK (${reason})`
    );
    markedCount++;
  }

  fastify.log.info(
    `bootRecovery: complete — ${markedCount} task(s) marked STUCK, ` +
    `${inProgressTasks.length - markedCount} left IN_PROGRESS`,
  );
}
