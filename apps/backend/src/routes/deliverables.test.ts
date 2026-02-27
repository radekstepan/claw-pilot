/**
 * Integration tests for the Deliverables routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 * A fresh in-memory SQLite database is installed before each test.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { setTestDb, runMigrations, tasks as tasksTable } from "../db/index.js";

const AUTH = { Authorization: "Bearer test-api-key" };

function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

async function createTaskWithDeliverables(
  app: FastifyInstance,
  deliverables: Array<{
    id: string;
    title: string;
    status: "PENDING" | "COMPLETED";
  }>,
): Promise<{ taskId: string; deliverableIds: string[] }> {
  const createRes = await app.inject({
    method: "POST",
    url: "/api/tasks",
    headers: AUTH,
    payload: {
      title: "Task with Deliverables",
    },
  });
  const task = createRes.json<{ id: string }>();

  const deliverableIds: string[] = [];
  for (const d of deliverables) {
    const delRes = await app.inject({
      method: "POST",
      url: `/api/tasks/${task.id}/deliverables`,
      headers: AUTH,
      payload: { title: d.title },
    });
    deliverableIds.push(delRes.json<{ id: string }>().id);
  }

  return { taskId: task.id, deliverableIds };
}

describe("Deliverable routes — integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("PATCH /api/deliverables/:id/complete", () => {
    it("toggles deliverable from PENDING to COMPLETED", async () => {
      const { deliverableIds } = await createTaskWithDeliverables(app, [
        { id: "deliv-1", title: "Deliverable 1", status: "PENDING" },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/deliverables/${deliverableIds[0]}/complete`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe("COMPLETED");
    });

    it("toggles deliverable from COMPLETED to PENDING", async () => {
      const { deliverableIds } = await createTaskWithDeliverables(app, [
        { id: "deliv-2", title: "Deliverable 2", status: "PENDING" },
      ]);

      await app.inject({
        method: "PATCH",
        url: `/api/deliverables/${deliverableIds[0]}/complete`,
        headers: AUTH,
      });

      const res = await app.inject({
        method: "PATCH",
        url: `/api/deliverables/${deliverableIds[0]}/complete`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ status: string }>().status).toBe("PENDING");
    });

    it("returns 404 for non-existent deliverable", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/deliverables/non-existent-id/complete",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: string }>().error).toBe("Deliverable not found");
    });
  });

  describe("PATCH /api/deliverables/:taskId/reorder", () => {
    it("reorders deliverables correctly", async () => {
      const { taskId, deliverableIds } = await createTaskWithDeliverables(app, [
        { id: "deliv-a", title: "A", status: "PENDING" },
        { id: "deliv-b", title: "B", status: "PENDING" },
        { id: "deliv-c", title: "C", status: "PENDING" },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/deliverables/${taskId}/reorder`,
        headers: AUTH,
        payload: {
          ids: [deliverableIds[2], deliverableIds[0], deliverableIds[1]],
        },
      });

      expect(res.statusCode).toBe(200);
      const updated = res.json<{ deliverables: Array<{ id: string }> }>();
      expect(updated.deliverables.map((d) => d.id)).toEqual([
        deliverableIds[2],
        deliverableIds[0],
        deliverableIds[1],
      ]);
    });

    it("returns 404 for non-existent task", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/deliverables/non-existent-task/reorder",
        headers: AUTH,
        payload: { ids: ["deliv-1"] },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: string }>().error).toBe("Task not found");
    });

    it("returns 400 when reorder IDs don't match task deliverables", async () => {
      const { taskId, deliverableIds } = await createTaskWithDeliverables(app, [
        { id: "deliv-1", title: "A", status: "PENDING" },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/deliverables/${taskId}/reorder`,
        headers: AUTH,
        payload: { ids: ["wrong-id"] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toMatch(/do not belong/i);
    });
  });

  describe("Auth enforcement", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/deliverables/deliv-1/complete",
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
