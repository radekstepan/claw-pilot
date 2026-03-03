import { FastifyInstance } from "fastify";
import {
  getGateway,
  GatewayOfflineError,
  GatewayPairingRequiredError,
} from "../gateway/index.js";
import { Agent, Task } from "@claw-pilot/shared-types";
import { db, tasks as tasksTable, notArchived } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import { markTaskStuck } from "../services/taskLifecycle.js";

const GRACE_PERIOD_MS = 30 * 60 * 1000; // 30 minutes

export interface SessionMonitorHandle {
  interval: NodeJS.Timeout;
  shutdown: () => void;
}

export function startSessionMonitor(
  fastify: FastifyInstance,
): SessionMonitorHandle {
  const gw = getGateway();
  const previousAgentStatuses: Record<string, string> = {};
  /** Tri-state: null = unknown (first tick), true = online, false = offline */
  let gatewayOnline: boolean | null = null;
  /** True when the device is awaiting pairing approval on the gateway machine. */
  let pairingPending = false;
  /** Tracks pending grace period timeouts: taskId -> timeout handle */
  const gracePeriods = new Map<string, NodeJS.Timeout>();
  /** Tracks tasks already notified as ghost callbacks to avoid duplicates */
  const notifiedGhostTasks = new Set<string>();

  function clearGhostCallbackTimer(taskId: string) {
    const timeout = gracePeriods.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      gracePeriods.delete(taskId);
      notifiedGhostTasks.delete(taskId);
    }
  }

  function markTaskAsStuck(taskId: string, agentId: string) {
    if (notifiedGhostTasks.has(taskId)) return;

    const reason = `Ghost callback detected for task "${taskId}" — marked STUCK`;
    markTaskStuck(taskId, agentId, reason, fastify.io);

    fastify.io?.emit("agent_error", {
      agentId,
      error: reason,
    });
    fastify.log.warn(
      `[sessionMonitor] Ghost callback detected for task ${taskId} (agent ${agentId}) — marked STUCK`,
    );

    notifiedGhostTasks.add(taskId);
    gracePeriods.delete(taskId);
  }

  function scheduleGhostCallbackCheck(taskId: string, agentId: string) {
    if (gracePeriods.has(taskId) || notifiedGhostTasks.has(taskId)) return;

    const timeout = setTimeout(() => {
      markTaskAsStuck(taskId, agentId);
    }, GRACE_PERIOD_MS);

    gracePeriods.set(taskId, timeout);
    fastify.log.info(
      `[sessionMonitor] Agent ${agentId} is IDLE — starting ${GRACE_PERIOD_MS / 60000}m grace period for task ${taskId}`,
    );
  }

  function emitGatewayStatus(
    online: boolean,
    pairingRequired = false,
    deviceId?: string,
  ) {
    const changed =
      gatewayOnline !== online || pairingPending !== pairingRequired;
    if (!changed) return;
    gatewayOnline = online;
    pairingPending = pairingRequired;
    if (fastify.io) {
      fastify.io.emit("gateway_status", { online, pairingRequired, deviceId });
    }
    if (pairingRequired) {
      fastify.log.warn(
        `[sessionMonitor] Device pairing required — run: openclaw devices approve --latest (deviceId: ${deviceId})`,
      );
    } else if (online) {
      fastify.log.info("[sessionMonitor] OpenClaw gateway is back online");
    } else {
      fastify.log.warn(
        "[sessionMonitor] OpenClaw gateway is unreachable — AI features offline",
      );
    }
  }

  const intervalHandle = setInterval(async () => {
    let agents: Agent[] = [];
    let sessions: Awaited<ReturnType<typeof gw.getLiveSessions>> = [];
    try {
      [agents, sessions] = await Promise.all([
        gw.getAgents(),
        gw.getLiveSessions(),
      ]);
      emitGatewayStatus(true);
    } catch (error: unknown) {
      if (error instanceof GatewayPairingRequiredError) {
        emitGatewayStatus(false, true, error.deviceId);
      } else if (error instanceof GatewayOfflineError) {
        emitGatewayStatus(false);
        fastify.log.warn(`[sessionMonitor] ${error.message}`);
      } else {
        fastify.log.error(
          `[sessionMonitor] Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    const activeSessions = sessions.filter(
      (s) => s.status === "WORKING" || s.status === "IDLE",
    );
    const isFirstTick = Object.keys(previousAgentStatuses).length === 0;

    for (const agent of agents) {
      const session = activeSessions.find(
        (s) => s.agent === agent.id || s.agentId === agent.id,
      );
      const currentStatus = session
        ? session.status === "WORKING"
          ? "WORKING"
          : "IDLE"
        : "OFFLINE";
      const previousStatus = previousAgentStatuses[agent.id];

      if (previousStatus === "WORKING" && currentStatus === "IDLE") {
        const inProgressTasks = db
          .select()
          .from(tasksTable)
          .where(and(eq(tasksTable.agentId, agent.id), notArchived))
          .all()
          .filter((t) => t.status === "IN_PROGRESS");

        for (const task of inProgressTasks) {
          scheduleGhostCallbackCheck(task.id, agent.id);
        }
      }

      if (currentStatus === "WORKING" && previousStatus === "IDLE") {
        const inProgressTasks = db
          .select()
          .from(tasksTable)
          .where(and(eq(tasksTable.agentId, agent.id), notArchived))
          .all()
          .filter((t) => t.status === "IN_PROGRESS");

        for (const task of inProgressTasks) {
          clearGhostCallbackTimer(task.id);
        }
      }

      if (isFirstTick || previousStatus !== currentStatus) {
        const updatedAgent: Agent = { ...agent, status: currentStatus };
        if (fastify.io) {
          fastify.io.emit("agent_status_changed", updatedAgent);
          if (!isFirstTick) {
            fastify.log.info(
              `[sessionMonitor] Agent ${agent.id}: ${previousStatus} → ${currentStatus}`,
            );
          }
        }
      }

      previousAgentStatuses[agent.id] = currentStatus;
    }
  }, 10_000);

  return {
    interval: intervalHandle,
    shutdown: () => {
      clearInterval(intervalHandle);
      for (const timeout of gracePeriods.values()) {
        clearTimeout(timeout);
      }
      gracePeriods.clear();
      notifiedGhostTasks.clear();
    },
  };
}
