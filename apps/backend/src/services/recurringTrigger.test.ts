/**
 * Tests for recurringTrigger — triggers recurring tasks and dispatches to agents.
 */
import { describe, it, beforeEach, expect, vi, afterEach } from "vitest";
import {
  createTestDb,
  createMockFastify,
  getEmittedEvents,
  resetModuleState,
} from "../test/helpers.js";
import {
  recurringTasks as recurringTable,
  tasks as tasksTable,
} from "../db/index.js";
import { eq } from "drizzle-orm";
import { triggerRecurringTemplate } from "./recurringTrigger.js";

vi.mock("../openclaw/cli.js", () => ({
  spawnTaskSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../config/env.js", () => ({
  env: { PUBLIC_URL: undefined, PORT: 3000, API_KEY: "test-key" },
}));

import { spawnTaskSession } from "../openclaw/cli.js";

describe("recurringTrigger", () => {
  beforeEach(() => {
    createTestDb();
    vi.clearAllMocks();
  });

  describe("triggerRecurringTemplate", () => {
    it("creates task with TODO status when no agent assigned", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-no-agent";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "Daily Standup",
          description: "Team sync",
          schedule_type: "DAILY",
          schedule_value: "09:00",
          status: "ACTIVE",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(result.task.status).toBe("TODO");
      expect(result.dispatchAccepted).toBe(false);
    });

    it("creates task with ASSIGNED status when agent assigned", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-with-agent";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "Agent Task",
          description: "Auto task",
          schedule_type: "DAILY",
          schedule_value: "09:00",
          status: "ACTIVE",
          assigned_agent_id: "agent-1",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(result.task.status).toBe("ASSIGNED");
      expect(result.dispatchAccepted).toBe(true);
    });

    it("updates recurring template last_triggered_at", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-update-test";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "Update Test",
          schedule_type: "DAILY",
          status: "ACTIVE",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      await triggerRecurringTemplate(mock.fastify, recurringRow);

      const updated = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      expect(updated?.last_triggered_at).not.toBeNull();
    });

    it("returns dispatchAccepted false when no agent", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-no-agent-2";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "No Agent Task",
          schedule_type: "DAILY",
          status: "ACTIVE",
          assigned_agent_id: null,
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(result.dispatchAccepted).toBe(false);
    });

    it("returns dispatchAccepted true when agent assigned", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-agent-2";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "Agent Task 2",
          schedule_type: "DAILY",
          status: "ACTIVE",
          assigned_agent_id: "agent-2",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(result.dispatchAccepted).toBe(true);
    });

    it("emits task_created and task_updated events", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-events-test";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "Events Test",
          schedule_type: "DAILY",
          status: "ACTIVE",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(getEmittedEvents(mock, "task_created")).toHaveLength(1);
      expect(getEmittedEvents(mock, "task_updated")).toHaveLength(1);
    });
  });

  describe("dispatchRecurringTaskToAgent", () => {
    it("calls spawnTaskSession with correct params", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-spawn-test";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "Spawn Test",
          description: "Testing spawn",
          schedule_type: "DAILY",
          schedule_value: "10:00",
          status: "ACTIVE",
          assigned_agent_id: "test-agent",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(spawnTaskSession).toHaveBeenCalledWith(
        "test-agent",
        expect.any(String),
        expect.stringContaining("Spawn Test"),
      );
    });

    it("updates task to IN_PROGRESS on successful spawn", async () => {
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-inprogress-test";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "In Progress Test",
          schedule_type: "DAILY",
          status: "ACTIVE",
          assigned_agent_id: "agent-ip",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const taskRow = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, result.task.id))
        .get();

      expect(taskRow?.status).toBe("IN_PROGRESS");
    });

    it("updates task to STUCK on spawn failure", async () => {
      vi.mocked(spawnTaskSession).mockRejectedValueOnce(
        new Error("Spawn failed"),
      );

      const { db } = await import("../db/index.js");

      const recurringId = "recurring-stuck-test";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "Stuck Test",
          schedule_type: "DAILY",
          status: "ACTIVE",
          assigned_agent_id: "agent-fail",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const taskRow = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, result.task.id))
        .get();

      expect(taskRow?.status).toBe("STUCK");
    });

    it.skip("uses PUBLIC_URL when available", async () => {
      resetModuleState();

      vi.doMock("../config/env.js", () => ({
        env: {
          PUBLIC_URL: "https://custom.url",
          PORT: 3000,
          API_KEY: "test-key",
        },
      }));

      createTestDb();

      const { triggerRecurringTemplate: triggerWithUrl } =
        await import("./recurringTrigger.js");
      const { db } = await import("../db/index.js");

      const recurringId = "recurring-url-test";
      db.insert(recurringTable)
        .values({
          id: recurringId,
          title: "URL Test",
          schedule_type: "DAILY",
          status: "ACTIVE",
          assigned_agent_id: "agent-url",
          last_triggered_at: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run();

      const recurringRow = db
        .select()
        .from(recurringTable)
        .where(eq(recurringTable.id, recurringId))
        .get();

      const mock = createMockFastify();
      await triggerWithUrl(mock.fastify, recurringRow);

      expect(spawnTaskSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringContaining("https://custom.url"),
      );
    });
  });
});
