/**
 * Integration tests for the Sync routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 * A fresh in-memory SQLite database is installed before each test.
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

describe("Sync routes — integration", () => {
  let app: FastifyInstance;
  let baseTime: string;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
    baseTime = new Date().toISOString();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/sync", () => {
    it("returns all data types with since parameter", async () => {
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: AUTH,
        payload: { title: "Test Task" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/sync?since=${encodeURIComponent(baseTime)}`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        tasks: unknown[];
        activities: unknown[];
        chatHistory: unknown[];
        recurringTasks: unknown[];
        activeTaskIds: string[];
      }>();

      expect(Array.isArray(body.tasks)).toBe(true);
      expect(Array.isArray(body.activities)).toBe(true);
      expect(Array.isArray(body.chatHistory)).toBe(true);
      expect(Array.isArray(body.recurringTasks)).toBe(true);
      expect(Array.isArray(body.activeTaskIds)).toBe(true);
    });

    it("filters data by 'since' timestamp", async () => {
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: AUTH,
        payload: { title: "Old Task" },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const middleTime = new Date().toISOString();

      await new Promise((resolve) => setTimeout(resolve, 100));

      await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: AUTH,
        payload: { title: "New Task" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/sync?since=${encodeURIComponent(middleTime)}`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ tasks: Array<{ title: string }> }>();
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].title).toBe("New Task");
    });

    it("returns empty arrays when nothing updated since timestamp", async () => {
      const futureTime = new Date(Date.now() + 100000).toISOString();

      const res = await app.inject({
        method: "GET",
        url: `/api/sync?since=${encodeURIComponent(futureTime)}`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        tasks: unknown[];
        activities: unknown[];
        chatHistory: unknown[];
        recurringTasks: unknown[];
      }>();

      expect(body.tasks).toHaveLength(0);
      expect(body.activities).toHaveLength(0);
      expect(body.chatHistory).toHaveLength(0);
      expect(body.recurringTasks).toHaveLength(0);
    });

    it("includes activeTaskIds for all tasks", async () => {
      const time = new Date().toISOString();
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: AUTH,
        payload: { title: "Task 1" },
      });
      await app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: AUTH,
        payload: { title: "Task 2" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/sync?since=${encodeURIComponent(time)}`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ activeTaskIds: string[] }>();
      expect(body.activeTaskIds).toHaveLength(2);
    });
  });

  describe("Auth enforcement", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/api/sync" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 when API key is wrong", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/sync",
        headers: { Authorization: "Bearer wrong-key" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
