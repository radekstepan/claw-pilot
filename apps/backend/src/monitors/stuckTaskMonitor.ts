import { FastifyInstance } from "fastify";
import {
  db,
  tasks as tasksTable,
  chatMessages as chatTable,
  activities as activitiesTable,
  notArchived,
} from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { ChatMessage, Task } from "@claw-pilot/shared-types";
import {
  getGateway,
  GatewayOfflineError,
  GatewayPairingRequiredError,
} from "../gateway/index.js";
import { markTaskStuck } from "../services/taskLifecycle.js";

const notifiedStuckTasks = new Set<string>();

export function resetStuckTaskMonitor(): void {
  notifiedStuckTasks.clear();
}

export function startStuckTaskMonitor(
  fastify: FastifyInstance,
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const now = new Date();
      const stuckThreshold = 24 * 60 * 60 * 1000; // 24 hours in ms

      const inProgressTasks = db
        .select()
        .from(tasksTable)
        .where(and(eq(tasksTable.status, "IN_PROGRESS"), notArchived))
        .all();

      if (inProgressTasks.length === 0) return;

      let liveSessions: any[] = [];
      let sessionsAvailable = false;
      let getSessionKey: ((id: string) => string) | null = null;

      try {
        const gw = getGateway();
        liveSessions = await gw.getLiveSessions();
        getSessionKey = gw.agentIdToSessionKey.bind(gw);
        sessionsAvailable = true;
      } catch (err) {
        if (
          err instanceof GatewayPairingRequiredError ||
          err instanceof GatewayOfflineError
        ) {
          // Normal offline scenarios, we can't do the live session check.
        } else {
          fastify.log.error(
            { err },
            "stuckTaskMonitor: error or gateway unavailable, falling back to 24h idle checks",
          );
        }
      }

      const activeSessionKeys = new Set(
        liveSessions
          .map((s) => s.key)
          .filter((k): k is string => typeof k === "string"),
      );

      for (const task of inProgressTasks) {
        // 1. Time-based fallback (24 hours) for tasks that are IN_PROGRESS and seemingly doing nothing
        const timeDiff = task.updatedAt
          ? now.getTime() - new Date(task.updatedAt).getTime()
          : 0;
        const isTimeStuck = task.updatedAt && timeDiff > stuckThreshold;

        // 2. Active session check — if we can verify the agent disconnected, it's immediately stuck.
        // We allow a 30-minute grace period for the agent's session to be established after updating.
        let isSessionStuck = false;
        const sessionGracePeriodMs = 30 * 60 * 1000;
        const passedGracePeriod = task.updatedAt ? timeDiff > sessionGracePeriodMs : true;

        if (sessionsAvailable && getSessionKey && passedGracePeriod) {
          const sessionKey = task.agentId
            ? getSessionKey(task.agentId)
            : null;
          isSessionStuck = sessionKey === null || !activeSessionKeys.has(sessionKey);
        }

        if (!isTimeStuck && !isSessionStuck) continue;
        if (notifiedStuckTasks.has(task.id)) continue;

        const reason = isSessionStuck
          ? `agent offline (no active session for ${task.agentId || "unknown"})`
          : "exceeded 24h idle threshold";

        fastify.log.warn(`Task ${task.id} is stuck: ${reason}. Marking as STUCK.`);

        markTaskStuck(task.id, task.agentId, reason, fastify.io);

        notifiedStuckTasks.add(task.id);
      }
    } catch (error: unknown) {
      fastify.log.error(
        `Error in stuck task monitor loop: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, 30_000);
}
