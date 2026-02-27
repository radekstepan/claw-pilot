/**
 * Integration tests for the Recurring Tasks routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 * Schedule validation and trigger functions are mocked.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { setTestDb, runMigrations } from "../db/index.js";

vi.mock("../services/recurringSchedule.js", () => ({
  validateRecurringScheduleInput: vi.fn().mockImplementation((type, value) => {
    if (type === "DAILY" && value === "invalid") {
      return { valid: false, error: "Invalid daily schedule" };
    }
    return {
      valid: true,
      value: { normalizedType: type, normalizedValue: value || "09:00" },
    };
  }),
}));

vi.mock("../services/recurringTrigger.js", () => ({
  triggerRecurringTemplate: vi.fn().mockImplementation(async () => ({
    dispatchAccepted: false,
    task: { id: "spawned-task-id", title: "Spawned Task", status: "TODO" },
  })),
}));

import { validateRecurringScheduleInput } from "../services/recurringSchedule.js";
import { triggerRecurringTemplate } from "../services/recurringTrigger.js";

const AUTH = { Authorization: "Bearer test-api-key" };

function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

describe("Recurring routes — integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/recurring", () => {
    it("returns empty array when no recurring tasks exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/recurring",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  describe("POST /api/recurring", () => {
    it("creates a recurring task with validated schedule", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: {
          title: "Daily Standup",
          schedule_type: "DAILY",
          schedule_value: "09:00",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{
        title: string;
        schedule_type: string;
        status: string;
      }>();
      expect(body.title).toBe("Daily Standup");
      expect(body.schedule_type).toBe("DAILY");
      expect(body.status).toBe("ACTIVE");
    });

    it("returns 400 when schedule validation fails", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: {
          title: "Bad Schedule",
          schedule_type: "DAILY",
          schedule_value: "invalid",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe(
        "Invalid daily schedule",
      );
    });

    it("returns 400 when title is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: {
          schedule_type: "DAILY",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /api/recurring/:id", () => {
    it("updates a recurring task", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: {
          title: "Original Title",
          schedule_type: "DAILY",
          schedule_value: "09:00",
        },
      });
      const { id } = createRes.json<{ id: string }>();

      const res = await app.inject({
        method: "PATCH",
        url: `/api/recurring/${id}`,
        headers: AUTH,
        payload: { title: "Updated Title" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ title: string }>().title).toBe("Updated Title");
    });

    it("returns 404 for non-existent recurring task", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/recurring/non-existent-id",
        headers: AUTH,
        payload: { title: "No Matter" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when schedule validation fails on update", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: {
          title: "Task",
          schedule_type: "DAILY",
          schedule_value: "09:00",
        },
      });
      const { id } = createRes.json<{ id: string }>();

      const res = await app.inject({
        method: "PATCH",
        url: `/api/recurring/${id}`,
        headers: AUTH,
        payload: { schedule_value: "invalid" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /api/recurring/:id", () => {
    it("deletes a recurring task and returns 204", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: {
          title: "To Delete",
          schedule_type: "DAILY",
        },
      });
      const { id } = createRes.json<{ id: string }>();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/recurring/${id}`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(204);

      const listRes = await app.inject({
        method: "GET",
        url: "/api/recurring",
        headers: AUTH,
      });

      expect(listRes.json()).toEqual([]);
    });

    it("returns 404 for non-existent recurring task", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/recurring/non-existent-id",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/recurring/:id/trigger", () => {
    it("triggers a recurring template manually", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: {
          title: "Manual Trigger",
          schedule_type: "DAILY",
        },
      });
      const { id } = createRes.json<{ id: string }>();

      const res = await app.inject({
        method: "POST",
        url: `/api/recurring/${id}/trigger`,
        headers: AUTH,
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(triggerRecurringTemplate)).toHaveBeenCalled();
    });

    it("returns 404 for non-existent recurring task", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/recurring/non-existent-id/trigger",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /api/recurring/export", () => {
    it("exports all recurring tasks", async () => {
      await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: { title: "Export Me", schedule_type: "DAILY" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/recurring/export",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Array<{ title: string }>>();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe("Export Me");
    });
  });

  describe("POST /api/recurring/import", () => {
    it("imports recurring tasks", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/recurring/import",
        headers: AUTH,
        payload: [
          {
            id: "imported-1",
            title: "Imported Task",
            schedule_type: "DAILY",
            schedule_value: "10:00",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ imported: number; skipped: number }>();
      expect(body.imported).toBe(1);
      expect(body.skipped).toBe(0);

      const listRes = await app.inject({
        method: "GET",
        url: "/api/recurring",
        headers: AUTH,
      });

      expect(listRes.json<Array<{ id: string }>>()).toContainEqual(
        expect.objectContaining({ id: "imported-1" }),
      );
    });

    it("skips duplicates on import", async () => {
      const createRes = await app.inject({
        method: "POST",
        url: "/api/recurring",
        headers: AUTH,
        payload: { title: "Existing", schedule_type: "DAILY" },
      });
      const existingId = createRes.json<{ id: string }>().id;

      const res = await app.inject({
        method: "POST",
        url: "/api/recurring/import",
        headers: AUTH,
        payload: [
          {
            id: existingId,
            title: "Existing",
            schedule_type: "DAILY",
            status: "ACTIVE",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ skipped: number }>().skipped).toBe(1);
    });
  });

  describe("Auth enforcement", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/api/recurring" });
      expect(res.statusCode).toBe(401);
    });
  });
});
