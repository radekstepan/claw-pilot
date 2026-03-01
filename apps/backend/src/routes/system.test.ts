/**
 * Integration tests for the System routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { setTestDb, runMigrations } from "../db/index.js";

const { GatewayOfflineError, GatewayPairingRequiredError } = vi.hoisted(() => {
  class GatewayOfflineError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "GatewayOfflineError";
    }
  }

  class GatewayPairingRequiredError extends Error {
    deviceId: string;
    constructor(deviceId: string) {
      super("Pairing required");
      this.name = "GatewayPairingRequiredError";
      this.deviceId = deviceId;
    }
  }

  return { GatewayOfflineError, GatewayPairingRequiredError };
});

vi.mock("../gateway/index.js", () => ({
  getGateway: vi.fn(),
  GatewayOfflineError,
  GatewayPairingRequiredError,
  __resetGatewayForTest: vi.fn(),
}));

vi.mock("../services/aiQueue.js", () => ({
  startQueueWorker: vi.fn(),
  stopQueueWorker: vi.fn(),
  enqueueAiJob: vi.fn(),
  AI_PRIORITY_NORMAL: 0,
  AI_PRIORITY_HIGH: 1,
}));

import { getGateway } from "../gateway/index.js";

const mockGateway = {
  getAgents: vi.fn(),
  getLiveSessions: vi.fn(),
  rawCall: vi.fn(),
  agentIdToSessionKey: vi.fn(
    (agentId: string) => `mc-gateway:gateway:${agentId}`,
  ),
  getModels: vi.fn(),
  routeChatToAgent: vi.fn(),
  spawnTaskSession: vi.fn(),
  generateAgentConfig: vi.fn(),
  createAgent: vi.fn(),
  updateAgentMeta: vi.fn(),
  deleteAgent: vi.fn(),
  getAgentFile: vi.fn(),
  getAgentWorkspaceFiles: vi.fn(),
  setAgentFiles: vi.fn(),
};
import {
  startQueueWorker,
  stopQueueWorker,
  enqueueAiJob,
  AI_PRIORITY_NORMAL,
  AI_PRIORITY_HIGH,
} from "../services/aiQueue.js";

const AUTH = { Authorization: "Bearer test-api-key" };

function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

describe("System routes — integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
    vi.clearAllMocks();
    vi.mocked(getGateway).mockReturnValue(mockGateway as any);
    vi.mocked(mockGateway.getAgents).mockResolvedValue([]);
    vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([]);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/stats", () => {
    it("returns DB-only stats when gateway offline", async () => {
      vi.mocked(mockGateway.getAgents).mockRejectedValue(
        new GatewayOfflineError("Gateway unreachable"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/stats",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        activeAgents: number;
        totalAgents: number;
        tasksInQueue: number;
        completedToday: number;
        gatewayOnline: boolean;
      }>();
      expect(body.tasksInQueue).toBe(0);
      expect(body.completedToday).toBe(0);
      expect(body.gatewayOnline).toBe(false);
    });

    it("returns tasksInQueue count for TODO + BACKLOG", async () => {
      const { db } = await import("../db/index.js");
      const { tasks } = await import("../db/index.js");

      db.insert(tasks)
        .values([
          {
            id: "task-1",
            title: "Task 1",
            status: "TODO",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "task-2",
            title: "Task 2",
            status: "BACKLOG",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: "task-3",
            title: "Task 3",
            status: "DONE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ])
        .run();

      const res = await app.inject({
        method: "GET",
        url: "/api/stats",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ tasksInQueue: number }>().tasksInQueue).toBe(2);
    });

    it("returns gateway stats when online", async () => {
      vi.mocked(mockGateway.getAgents).mockResolvedValue([
        { id: "agent-1", name: "Agent 1" },
      ] as any);
      vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([
        { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/stats",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        activeAgents: number;
        totalAgents: number;
        gatewayOnline: boolean;
      }>();
      expect(body.activeAgents).toBe(1);
      expect(body.totalAgents).toBe(1);
      expect(body.gatewayOnline).toBe(true);
    });

    it("returns pairingRequired=true when pairing needed", async () => {
      vi.mocked(mockGateway.getAgents).mockRejectedValue(
        new GatewayPairingRequiredError("device-123"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/stats",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        gatewayOnline: boolean;
        pairingRequired: boolean;
        gatewayDeviceId?: string;
      }>();
      expect(body.gatewayOnline).toBe(false);
      expect(body.pairingRequired).toBe(true);
      expect(body.gatewayDeviceId).toBe("device-123");
    });
  });

  describe("GET /api/monitoring/gateway/status", () => {
    it("returns ONLINE when gateway reachable", async () => {
      vi.mocked(mockGateway.rawCall).mockResolvedValue({});

      const res = await app.inject({
        method: "GET",
        url: "/api/monitoring/gateway/status",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string }>();
      expect(body.status).toBe("ONLINE");
    });

    it("returns OFFLINE with error when gateway unreachable", async () => {
      vi.mocked(mockGateway.rawCall).mockRejectedValue(
        new GatewayOfflineError("Connection refused"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/monitoring/gateway/status",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; error?: string }>();
      expect(body.status).toBe("OFFLINE");
      expect(body.error).toBeDefined();
    });

    it("returns PAIRING_REQUIRED with deviceId when pairing needed", async () => {
      vi.mocked(mockGateway.rawCall).mockRejectedValue(
        new GatewayPairingRequiredError("device-456"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/monitoring/gateway/status",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        status: string;
        deviceId?: string;
        instructions?: string;
      }>();
      expect(body.status).toBe("PAIRING_REQUIRED");
      expect(body.deviceId).toBe("device-456");
      expect(body.instructions).toContain("openclaw devices");
    });
  });

  describe("POST /api/monitoring/gateway/restart", () => {
    it("returns 501 with error message", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/monitoring/gateway/restart",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(501);
      expect(res.json<{ error: string }>().error).toContain("not supported");
    });
  });

  describe("GET /api/queue-stats", () => {
    it("returns queue stats from database", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/queue-stats",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        size: number;
        pending: number;
        concurrency: number;
        paused: boolean;
      }>();
      expect(body.size).toBe(0);
      expect(body.pending).toBe(0);
      expect(body.concurrency).toBeDefined();
      expect(body.paused).toBe(false);
    });
  });

  describe("GET /api/monitoring/stuck-tasks/check", () => {
    it("returns tasks IN_PROGRESS for more than 24 hours", async () => {
      const { db } = await import("../db/index.js");
      const { tasks } = await import("../db/index.js");

      const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      db.insert(tasks)
        .values({
          id: "stuck-task",
          title: "Stuck Task",
          status: "IN_PROGRESS",
          createdAt: oldTime,
          updatedAt: oldTime,
        })
        .run();

      const res = await app.inject({
        method: "GET",
        url: "/api/monitoring/stuck-tasks/check",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ stuckTasks: Array<{ id: string }> }>();
      expect(body.stuckTasks).toHaveLength(1);
      expect(body.stuckTasks[0].id).toBe("stuck-task");
    });

    it("excludes recently updated tasks", async () => {
      const { db } = await import("../db/index.js");
      const { tasks } = await import("../db/index.js");

      const recentTime = new Date(
        Date.now() - 1 * 60 * 60 * 1000,
      ).toISOString();
      db.insert(tasks)
        .values({
          id: "recent-task",
          title: "Recent Task",
          status: "IN_PROGRESS",
          createdAt: recentTime,
          updatedAt: recentTime,
        })
        .run();

      const res = await app.inject({
        method: "GET",
        url: "/api/monitoring/stuck-tasks/check",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ stuckTasks: unknown[] }>().stuckTasks).toHaveLength(0);
    });
  });

  describe("GET /api/config", () => {
    it("returns runtime configuration", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/config",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        gatewayUrl: string;
        apiPort: number;
        autoRestart: boolean;
        defaultWorkspace: string;
        notificationSounds: boolean;
      }>();
      expect(body.gatewayUrl).toBeDefined();
      expect(body.apiPort).toBeDefined();
    });
  });

  describe("POST /api/config", () => {
    it("accepts config options and returns effective values", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/config",
        headers: AUTH,
        payload: {
          notificationSounds: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ notificationSounds: boolean }>();
      expect(body.notificationSounds).toBe(true);
    });
  });

  describe("Auth enforcement", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/api/stats" });
      expect(res.statusCode).toBe(401);
    });
  });
});
