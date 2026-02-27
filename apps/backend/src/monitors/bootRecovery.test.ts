/**
 * Tests for bootRecovery.
 *
 * Tests the orphan task detection logic that runs on server startup.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import {
  createTestDb,
  createMockFastify,
  getEmittedEvents,
} from "../test/helpers.js";
import { tasks as tasksTable } from "../db/index.js";
import { runBootRecovery } from "../monitors/bootRecovery.js";

vi.mock("../openclaw/cli.js", async () => {
  return {
    getLiveSessions: vi.fn(),
    agentIdToSessionKey: vi.fn((agentId: string) => `mc:mc-${agentId}:main`),
    GatewayOfflineError: class GatewayOfflineError extends Error {
      constructor(method: string, cause: Error) {
        super(`OpenClaw gateway unreachable (${method}): ${cause.message}`);
        this.name = "GatewayOfflineError";
      }
    },
    GatewayPairingRequiredError: class GatewayPairingRequiredError extends Error {
      constructor(public deviceId: string) {
        super(`Gateway pairing required for device ${deviceId}`);
        this.name = "GatewayPairingRequiredError";
      }
    },
  };
});

describe("bootRecovery", () => {
  let mock: ReturnType<typeof createMockFastify>;

  beforeEach(async () => {
    createTestDb();
    mock = createMockFastify();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns early when no IN_PROGRESS tasks exist", async () => {
    const { db } = await import("../db/index.js");
    db.insert(tasksTable)
      .values({
        id: "task-todo",
        title: "Todo Task",
        status: "TODO",
        priority: "MEDIUM",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    await runBootRecovery(mock.fastify);

    expect(mock.log.info).toHaveBeenCalledWith(
      "bootRecovery: no IN_PROGRESS tasks — nothing to recover",
    );
  });

  it("leaves IN_PROGRESS task unchanged when it has an active session", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(tasksTable)
      .values({
        id: "task-active",
        title: "Active Task",
        status: "IN_PROGRESS",
        priority: "HIGH",
        agentId: "worker-agent",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const { getLiveSessions } = await import("../openclaw/cli.js");
    vi.mocked(getLiveSessions).mockResolvedValue([
      {
        key: "mc:mc-worker-agent:main",
        agent: "worker-agent",
        status: "WORKING",
      },
    ]);

    await runBootRecovery(mock.fastify);

    const tasks = db.select().from(tasksTable).all();
    const task = tasks.find((t) => t.id === "task-active");
    expect(task?.status).toBe("IN_PROGRESS");

    const emitted = getEmittedEvents(mock, "task_updated");
    expect(emitted).toHaveLength(0);
  });

  it("marks orphaned task as STUCK when no active session exists", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(tasksTable)
      .values({
        id: "task-orphan",
        title: "Orphan Task",
        status: "IN_PROGRESS",
        priority: "HIGH",
        agentId: "worker-agent",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const { getLiveSessions } = await import("../openclaw/cli.js");
    vi.mocked(getLiveSessions).mockResolvedValue([]);

    await runBootRecovery(mock.fastify);

    const tasks = db.select().from(tasksTable).all();
    const task = tasks.find((t) => t.id === "task-orphan");
    expect(task?.status).toBe("STUCK");

    const emitted = getEmittedEvents(mock, "task_updated");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      id: "task-orphan",
      status: "STUCK",
    });
  });

  it("marks task without agentId as STUCK", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(tasksTable)
      .values({
        id: "task-no-agent",
        title: "Task Without Agent",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        agentId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const { getLiveSessions } = await import("../openclaw/cli.js");
    vi.mocked(getLiveSessions).mockResolvedValue([]);

    await runBootRecovery(mock.fastify);

    const tasks = db.select().from(tasksTable).all();
    const task = tasks.find((t) => t.id === "task-no-agent");
    expect(task?.status).toBe("STUCK");
  });

  it("handles GatewayOfflineError gracefully", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(tasksTable)
      .values({
        id: "task-offline",
        title: "Offline Task",
        status: "IN_PROGRESS",
        priority: "HIGH",
        agentId: "worker-agent",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const { getLiveSessions, GatewayOfflineError } =
      await import("../openclaw/cli.js");
    vi.mocked(getLiveSessions).mockRejectedValue(
      new GatewayOfflineError("getLiveSessions", new Error("ENOTFOUND")),
    );

    await runBootRecovery(mock.fastify);

    expect(mock.log.warn).toHaveBeenCalledWith(
      "bootRecovery: gateway is offline — skipping recovery (tasks left IN_PROGRESS)",
    );

    const tasks = db.select().from(tasksTable).all();
    const task = tasks.find((t) => t.id === "task-offline");
    expect(task?.status).toBe("IN_PROGRESS");
  });

  it("handles GatewayPairingRequiredError gracefully", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(tasksTable)
      .values({
        id: "task-pairing",
        title: "Pairing Task",
        status: "IN_PROGRESS",
        priority: "HIGH",
        agentId: "worker-agent",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const { getLiveSessions, GatewayPairingRequiredError } =
      await import("../openclaw/cli.js");
    vi.mocked(getLiveSessions).mockRejectedValue(
      new GatewayPairingRequiredError("device-123"),
    );

    await runBootRecovery(mock.fastify);

    expect(mock.log.warn).toHaveBeenCalledWith(
      "bootRecovery: gateway requires device pairing — skipping recovery (tasks left IN_PROGRESS)",
    );

    const tasks = db.select().from(tasksTable).all();
    const task = tasks.find((t) => t.id === "task-pairing");
    expect(task?.status).toBe("IN_PROGRESS");
  });

  it("correctly discriminates between orphaned and active tasks", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(tasksTable)
      .values([
        {
          id: "task-active-1",
          title: "Active 1",
          status: "IN_PROGRESS",
          priority: "HIGH",
          agentId: "agent-1",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "task-active-2",
          title: "Active 2",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          agentId: "agent-2",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "task-orphan-1",
          title: "Orphan 1",
          status: "IN_PROGRESS",
          priority: "HIGH",
          agentId: "agent-3",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "task-orphan-2",
          title: "Orphan 2",
          status: "IN_PROGRESS",
          priority: "LOW",
          agentId: "agent-4",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const { getLiveSessions } = await import("../openclaw/cli.js");
    vi.mocked(getLiveSessions).mockResolvedValue([
      { key: "mc:mc-agent-1:main", agent: "agent-1", status: "WORKING" },
      { key: "mc:mc-agent-2:main", agent: "agent-2", status: "IDLE" },
    ]);

    await runBootRecovery(mock.fastify);

    const tasks = db.select().from(tasksTable).all();
    expect(tasks.find((t) => t.id === "task-active-1")?.status).toBe(
      "IN_PROGRESS",
    );
    expect(tasks.find((t) => t.id === "task-active-2")?.status).toBe(
      "IN_PROGRESS",
    );
    expect(tasks.find((t) => t.id === "task-orphan-1")?.status).toBe("STUCK");
    expect(tasks.find((t) => t.id === "task-orphan-2")?.status).toBe("STUCK");

    const emitted = getEmittedEvents(mock, "task_updated");
    expect(emitted).toHaveLength(2);
  });
});
