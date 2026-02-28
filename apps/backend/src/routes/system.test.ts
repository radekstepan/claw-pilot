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

vi.mock("../openclaw/cli.js", () => ({
  getAgents: vi.fn(),
  getLiveSessions: vi.fn(),
  gatewayCall: vi.fn(),
  GatewayOfflineError,
  GatewayPairingRequiredError,
}));

vi.mock("../services/aiQueue.js", () => ({
  aiQueue: { size: 0, pending: 0, isPaused: false },
}));

import { getAgents, getLiveSessions, gatewayCall } from "../openclaw/cli.js";
import { aiQueue as aiQueueModule } from "../services/aiQueue.js";

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
    vi.mocked(getAgents).mockResolvedValue([]);
    vi.mocked(getLiveSessions).mockResolvedValue([]);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/stats", () => {
    it("returns DB-only stats when gateway offline", async () => {
      vi.mocked(getAgents).mockRejectedValue(
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
      vi.mocked(getAgents).mockResolvedValue([
        { id: "agent-1", name: "Agent 1" },
      ] as any);
      vi.mocked(getLiveSessions).mockResolvedValue([
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
      vi.mocked(getAgents).mockRejectedValue(
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
      vi.mocked(gatewayCall).mockResolvedValue({});

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
      vi.mocked(gatewayCall).mockRejectedValue(
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
      vi.mocked(gatewayCall).mockRejectedValue(
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
    it("returns queue size, pending, concurrency, paused", async () => {
      Object.assign(aiQueueModule, { size: 10, pending: 2, isPaused: false });

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
      expect(body.size).toBe(10);
      expect(body.pending).toBe(2);
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
