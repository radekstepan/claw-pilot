/**
 * Integration tests for the Activities routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { setTestDb, runMigrations } from "../db/index.js";

const AUTH = { Authorization: "Bearer test-api-key" };

function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

describe("Activities routes — integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/activities", () => {
    it("returns empty array when no activities exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/activities",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ data: [], nextCursor: null });
    });

    it("returns activities sorted newest-first", async () => {
      const { db } = await import("../db/index.js");
      const { activities } = await import("../db/index.js");

      db.insert(activities)
        .values([
          {
            id: "activity-1",
            taskId: "task-1",
            agentId: "agent-1",
            message: "First activity",
            timestamp: "2024-01-01T10:00:00.000Z",
          },
          {
            id: "activity-2",
            taskId: "task-1",
            agentId: "agent-1",
            message: "Second activity",
            timestamp: "2024-01-01T11:00:00.000Z",
          },
        ])
        .run();

      const res = await app.inject({
        method: "GET",
        url: "/api/activities",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ id: string; message: string }> }>();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe("activity-2");
      expect(body.data[1].id).toBe("activity-1");
    });

    it("respects limit parameter", async () => {
      const { db } = await import("../db/index.js");
      const { activities } = await import("../db/index.js");

      for (let i = 0; i < 10; i++) {
        db.insert(activities)
          .values({
            id: `activity-${i}`,
            taskId: "task-1",
            agentId: "agent-1",
            message: `Activity ${i}`,
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
          })
          .run();
      }

      const res = await app.inject({
        method: "GET",
        url: "/api/activities?limit=5",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<unknown> }>();
      expect(body.data).toHaveLength(5);
    });

    it("returns data with correct ActivityLog shape", async () => {
      const { db } = await import("../db/index.js");
      const { activities } = await import("../db/index.js");

      db.insert(activities)
        .values({
          id: "activity-shape",
          taskId: "task-123",
          agentId: "agent-456",
          message: "Test message",
          timestamp: "2024-01-01T12:00:00.000Z",
        })
        .run();

      const res = await app.inject({
        method: "GET",
        url: "/api/activities",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        data: Array<{
          id: string;
          taskId: string;
          agentId?: string;
          message: string;
          timestamp: string;
          taskStatus?: string;
        }>;
      }>();
      expect(body.data[0]).toEqual({
        id: "activity-shape",
        taskId: "task-123",
        agentId: "agent-456",
        message: "Test message",
        timestamp: "2024-01-01T12:00:00.000Z",
        taskStatus: null,
      });
    });

    it("returns nextCursor when more results exist", async () => {
      const { db } = await import("../db/index.js");
      const { activities } = await import("../db/index.js");

      for (let i = 0; i < 55; i++) {
        db.insert(activities)
          .values({
            id: `activity-${i}`,
            taskId: "task-1",
            agentId: "agent-1",
            message: `Activity ${i}`,
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
          })
          .run();
      }

      const res = await app.inject({
        method: "GET",
        url: "/api/activities?limit=50",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        data: Array<unknown>;
        nextCursor: string | null;
      }>();
      expect(body.data).toHaveLength(50);
      expect(body.nextCursor).not.toBeNull();
    });

    it("returns null nextCursor when all results returned", async () => {
      const { db } = await import("../db/index.js");
      const { activities } = await import("../db/index.js");

      db.insert(activities)
        .values({
          id: "activity-only",
          taskId: "task-1",
          agentId: "agent-1",
          message: "Only activity",
          timestamp: "2024-01-01T12:00:00.000Z",
        })
        .run();

      const res = await app.inject({
        method: "GET",
        url: "/api/activities?limit=50",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ nextCursor: string | null }>();
      expect(body.nextCursor).toBeNull();
    });

    it("uses cursor to fetch next page correctly", async () => {
      const { db } = await import("../db/index.js");
      const { activities } = await import("../db/index.js");

      for (let i = 0; i < 10; i++) {
        db.insert(activities)
          .values({
            id: `activity-${i}`,
            taskId: "task-1",
            agentId: "agent-1",
            message: `Activity ${i}`,
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
          })
          .run();
      }

      const firstPage = await app.inject({
        method: "GET",
        url: "/api/activities?limit=5",
        headers: AUTH,
      });

      const firstBody = firstPage.json<{ nextCursor: string }>();
      const cursor = firstBody.nextCursor;

      const secondPage = await app.inject({
        method: "GET",
        url: `/api/activities?limit=5&cursor=${cursor}`,
        headers: AUTH,
      });

      expect(secondPage.statusCode).toBe(200);
      const secondBody = secondPage.json<{ data: Array<{ id: string }> }>();
      expect(secondBody.data).toHaveLength(5);

      const firstIds = firstPage
        .json<{ data: Array<{ id: string }> }>()
        .data.map((d) => d.id);
      const secondIds = secondBody.data.map((d) => d.id);
      expect(firstIds).not.toEqual(expect.arrayContaining(secondIds));
    });

    it("handles cursor with timestamp and id for tie-breaking", async () => {
      const { db } = await import("../db/index.js");
      const { activities } = await import("../db/index.js");

      const sameTime = "2024-01-01T12:00:00.000Z";
      db.insert(activities)
        .values([
          {
            id: "activity-a",
            taskId: "task-1",
            agentId: "agent-1",
            message: "Activity A",
            timestamp: sameTime,
          },
          {
            id: "activity-b",
            taskId: "task-1",
            agentId: "agent-1",
            message: "Activity B",
            timestamp: sameTime,
          },
          {
            id: "activity-c",
            taskId: "task-1",
            agentId: "agent-1",
            message: "Activity C",
            timestamp: sameTime,
          },
        ])
        .run();

      const res = await app.inject({
        method: "GET",
        url: "/api/activities?limit=2",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: Array<{ id: string }> }>();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe("activity-c");
      expect(body.data[1].id).toBe("activity-b");
    });
  });

  describe("Auth enforcement", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/api/activities" });
      expect(res.statusCode).toBe(401);
    });
  });
});
