import { FastifyPluginAsync } from "fastify";
import { db, tasks as tasksTable, aiJobs } from "../db/index.js";
import { eq, or, and, count, lt, like } from "drizzle-orm";
import {
  getGateway,
  GatewayOfflineError,
  GatewayPairingRequiredError,
} from "../gateway/index.js";
import { env } from "../config/env.js";
import { z } from "zod";

const systemRoutes: FastifyPluginAsync = async (fastify, opts) => {
  fastify.get("/stats", async (request, reply) => {
    const gw = getGateway();
    // DB-only stats — always available regardless of gateway state
    const [{ tasksInQueue }] = db
      .select({ tasksInQueue: count() })
      .from(tasksTable)
      .where(
        or(eq(tasksTable.status, "TODO"), eq(tasksTable.status, "BACKLOG")),
      )
      .all();

    const today = new Date().toISOString().split("T")[0]!;
    const [{ completedToday }] = db
      .select({ completedToday: count() })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.status, "DONE"),
          like(tasksTable.updatedAt, `${today}%`),
        ),
      )
      .all();

    // Gateway-dependent stats — degrade gracefully when gateway is unreachable
    let activeAgents = 0;
    let totalAgents = 0;
    let gatewayOnline = true;
    let pairingRequired = false;
    let gatewayDeviceId: string | undefined;
    try {
      const [agents, activeSessions] = await Promise.all([
        gw.getAgents(),
        gw.getLiveSessions(),
      ]);
      activeAgents = activeSessions.length;
      totalAgents = agents.length;
    } catch (gwErr) {
      if (gwErr instanceof GatewayPairingRequiredError) {
        gatewayOnline = false;
        pairingRequired = true;
        gatewayDeviceId = gwErr.deviceId;
        fastify.log.warn(
          `[stats] Device pairing required — deviceId: ${gwErr.deviceId}`,
        );
      } else if (gwErr instanceof GatewayOfflineError) {
        gatewayOnline = false;
        fastify.log.warn(`[stats] ${(gwErr as Error).message}`);
      } else {
        fastify.log.error(gwErr, "Unexpected error fetching gateway stats");
      }
    }

    return reply.send({
      activeAgents,
      totalAgents,
      tasksInQueue,
      completedToday,
      gatewayOnline,
      pairingRequired,
      gatewayDeviceId,
    });
  });

  fastify.get("/monitoring/gateway/status", async (request, reply) => {
    const gw = getGateway();
    const gatewayUrl = env.GATEWAY_URL;
    const start = Date.now();
    try {
      await gw.rawCall("sessions.list", {});
      return reply.send({
        status: "ONLINE",
        gatewayUrl,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      if (e instanceof GatewayPairingRequiredError) {
        return reply.send({
          status: "PAIRING_REQUIRED",
          gatewayUrl,
          deviceId: e.deviceId,
          instructions: [
            "Run on the gateway machine:",
            "  openclaw devices list",
            "  openclaw devices approve --latest",
            "Then restart Claw-Pilot or wait for the next health check.",
          ].join("\n"),
        });
      }
      const raw = e instanceof Error ? e.message : String(e);
      // Trim stack / aggregate noise — keep only the first meaningful line
      const detail = raw.split("\n")[0] ?? raw;
      return reply.send({
        status: "OFFLINE",
        gatewayUrl,
        error: detail,
      });
    }
  });

  fastify.post("/monitoring/gateway/restart", async (_request, reply) => {
    // The OpenClaw gateway does not expose a restart RPC method.
    return reply.status(501).send({
      error: "Gateway restart is not supported via the WebSocket API.",
    });
  });

  /**
   * GET /api/system/queue-stats
   * Returns live AI job queue depth and concurrency settings.
   * Useful for diagnosing back-pressure and tuning AI_QUEUE_CONCURRENCY.
   */
  fastify.get("/queue-stats", async (_request, reply) => {
    const [{ queuedCount }] = db
      .select({ queuedCount: count() })
      .from(aiJobs)
      .where(eq(aiJobs.status, "queued"))
      .all();

    const [{ runningCount }] = db
      .select({ runningCount: count() })
      .from(aiJobs)
      .where(eq(aiJobs.status, "running"))
      .all();

    return reply.send({
      /** Jobs queued but not yet running. */
      size: queuedCount,
      /** Jobs currently executing (≤ concurrency). */
      pending: runningCount,
      /** Maximum simultaneous AI calls (AI_QUEUE_CONCURRENCY). */
      concurrency: env.AI_QUEUE_CONCURRENCY,
      /** Queue is always running in persistent mode. */
      paused: false,
    });
  });

  fastify.get("/monitoring/stuck-tasks/check", async (request, reply) => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const stuckTasks = db
      .select()
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.status, "IN_PROGRESS"),
          lt(tasksTable.updatedAt, cutoff),
        ),
      )
      .all();

    return reply.send({ stuckTasks });
  });

  /**
   * GET /api/config
   * Returns the current runtime configuration derived from env vars.
   * The UI uses this to pre-fill settings fields (e.g. default workspace path).
   */
  fastify.get("/config", async (_request, reply) => {
    return reply.send({
      gatewayUrl: env.GATEWAY_URL,
      apiPort: env.PORT,
      autoRestart: false,
      defaultWorkspace: env.OPENCLAW_DEFAULT_WORKSPACE,
      notificationSounds: true, // Default to true initially
    });
  });

  /**
   * POST /api/config
   * Env-var driven — changes don't persist across restarts but the endpoint
   * acknowledges the submission and returns the effective values.
   */
  fastify.post(
    "/config",
    {
      schema: {
        body: z.object({
          gatewayUrl: z.string().optional(),
          apiPort: z.number().optional(),
          autoRestart: z.boolean().optional(),
          defaultWorkspace: z.string().optional(),
          notificationSounds: z.boolean().optional(),
        }),
      },
    },
    async (_request, reply) => {
      return reply.send({
        gatewayUrl: env.GATEWAY_URL,
        apiPort: env.PORT,
        autoRestart: false,
        defaultWorkspace: env.OPENCLAW_DEFAULT_WORKSPACE,
        notificationSounds: true, // Would implement persistence here in a production system
      });
    },
  );
};

export default systemRoutes;
