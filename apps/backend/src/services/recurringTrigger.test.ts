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

vi.mock("../gateway/index.js", () => ({
  getGateway: vi.fn(() => ({
    spawnTaskSession: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../config/env.js", () => ({
  env: {
    PUBLIC_URL: undefined,
    PORT: 3000,
    API_KEY: "test-key",
    GATEWAY_URL: "ws://localhost:18789",
    GATEWAY_ID: "gateway",
    GATEWAY_WS_TIMEOUT: 15000,
    GATEWAY_AI_TIMEOUT: 120000,
    GATEWAY_DEVICE_IDENTITY_PATH: "data/device-identity.json",
    BACKEND_TYPE: "openclaw" as const,
    GATEWAY_TOKEN: undefined,
  },
}));

vi.mock("../services/aiQueue.js", () => ({
  enqueueAiJob: vi.fn(),
  AI_PRIORITY_NORMAL: 0,
}));

import { getGateway } from "../gateway/index.js";
import { enqueueAiJob, AI_PRIORITY_NORMAL } from "./aiQueue.js";

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
        .get()!;

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
        .get()!;

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
        .get()!;

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
        .get()!;

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
        .get()!;

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
        .get()!;

      const mock = createMockFastify();
      await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(getEmittedEvents(mock, "task_created")).toHaveLength(1);
      expect(getEmittedEvents(mock, "task_updated")).toHaveLength(1);
    });
  });

  describe("dispatchRecurringTaskToAgent", () => {
    it("calls enqueueAiJob to queue the dispatch", async () => {
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
        .get()!;

      const mock = createMockFastify();
      await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(enqueueAiJob).toHaveBeenCalledWith(
        "recurring-spawn",
        AI_PRIORITY_NORMAL,
        "recurring-spawn",
        expect.objectContaining({
          agentId: "test-agent",
          prompt: expect.stringContaining("Spawn Test"),
        }),
        "test-agent",
      );
    });

    it("sets task to ASSIGNED when agent is assigned (worker handles IN_PROGRESS async)", async () => {
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
        .get()!;

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(result.task.status).toBe("ASSIGNED");
      expect(result.dispatchAccepted).toBe(true);
    });

    it("queues the job and sets task to ASSIGNED (worker handles status async)", async () => {
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
        .get()!;

      const mock = createMockFastify();
      const result = await triggerRecurringTemplate(mock.fastify, recurringRow);

      expect(result.task.status).toBe("ASSIGNED");
      expect(result.dispatchAccepted).toBe(true);
      expect(enqueueAiJob).toHaveBeenCalled();
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
        .get()!;

      const mock = createMockFastify();
      await triggerWithUrl(mock.fastify, recurringRow);

      expect(getGateway().spawnTaskSession).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.stringContaining("https://custom.url"),
      );
    });
  });
});
