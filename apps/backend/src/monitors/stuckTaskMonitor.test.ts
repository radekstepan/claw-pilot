/**
 * Tests for the stuckTaskMonitor.
 *
 * Uses vi.useFakeTimers() to control time-based behavior without waiting
 * for the actual 60s interval.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import {
  createTestDb,
  createMockFastify,
  getEmittedEvents,
} from "../test/helpers.js";
import { tasks as tasksTable } from "../db/index.js";
import { eq } from "drizzle-orm";
import {
  startStuckTaskMonitor,
  resetStuckTaskMonitor,
} from "../monitors/stuckTaskMonitor.js";

describe("stuckTaskMonitor", () => {
  let mock: ReturnType<typeof createMockFastify>;
  let intervalHandle: NodeJS.Timeout | null;

  beforeEach(async () => {
    createTestDb();
    mock = createMockFastify();
    resetStuckTaskMonitor();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  });

  it("does not flag tasks that have been IN_PROGRESS for less than 24 hours", async () => {
    const now = new Date();
    const recentTime = new Date(
      now.getTime() - 23 * 60 * 60 * 1000,
    ).toISOString();

    const { db } = await import("../db/index.js");
    db.insert(tasksTable)
      .values({
        id: "task-recent",
        title: "Recent Task",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        createdAt: recentTime,
        updatedAt: recentTime,
      })
      .run();

    intervalHandle = startStuckTaskMonitor(mock.fastify);

    vi.advanceTimersByTime(60_000);

    const chatMessages = getEmittedEvents(mock, "chat_message");
    expect(chatMessages).toHaveLength(0);
  });

  it("flags tasks that have been IN_PROGRESS for more than 24 hours", async () => {
    const now = new Date();
    const oldTime = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    const { db } = await import("../db/index.js");
    db.insert(tasksTable)
      .values({
        id: "task-old",
        title: "Old Task",
        status: "IN_PROGRESS",
        priority: "HIGH",
        createdAt: oldTime,
        updatedAt: oldTime,
      })
      .run();

    intervalHandle = startStuckTaskMonitor(mock.fastify);

    vi.advanceTimersByTime(60_000);

    const chatMessages = getEmittedEvents(mock, "chat_message");
    expect(chatMessages).toHaveLength(1);
    expect(chatMessages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining(
        "has been stuck IN_PROGRESS for over 24 hours",
      ),
    });
  });

  it("does not send duplicate notifications for the same task", async () => {
    const now = new Date();
    const oldTime = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    const { db } = await import("../db/index.js");
    db.insert(tasksTable)
      .values({
        id: "task-dup",
        title: "Duplicate Task",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        createdAt: oldTime,
        updatedAt: oldTime,
      })
      .run();

    intervalHandle = startStuckTaskMonitor(mock.fastify);

    vi.advanceTimersByTime(60_000);
    expect(getEmittedEvents(mock, "chat_message")).toHaveLength(1);

    vi.advanceTimersByTime(60_000);
    expect(getEmittedEvents(mock, "chat_message")).toHaveLength(1);
  });

  it("handles multiple stuck tasks correctly", async () => {
    const now = new Date();
    const oldTime = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    const { db } = await import("../db/index.js");
    db.insert(tasksTable)
      .values([
        {
          id: "task-1",
          title: "Stuck 1",
          status: "IN_PROGRESS",
          priority: "HIGH",
          createdAt: oldTime,
          updatedAt: oldTime,
        },
        {
          id: "task-2",
          title: "Stuck 2",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          createdAt: oldTime,
          updatedAt: oldTime,
        },
        {
          id: "task-3",
          title: "Stuck 3",
          status: "IN_PROGRESS",
          priority: "LOW",
          createdAt: oldTime,
          updatedAt: oldTime,
        },
      ])
      .run();

    intervalHandle = startStuckTaskMonitor(mock.fastify);

    vi.advanceTimersByTime(60_000);

    const chatMessages = getEmittedEvents(mock, "chat_message");
    expect(chatMessages).toHaveLength(3);
  });

  it("runs cleanly with no IN_PROGRESS tasks", async () => {
    intervalHandle = startStuckTaskMonitor(mock.fastify);

    vi.advanceTimersByTime(60_000);

    const chatMessages = getEmittedEvents(mock, "chat_message");
    expect(chatMessages).toHaveLength(0);
    expect(mock.log.warn).not.toHaveBeenCalled();
  });

  it("only checks IN_PROGRESS tasks", async () => {
    const now = new Date();
    const oldTime = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();

    const { db } = await import("../db/index.js");
    db.insert(tasksTable)
      .values([
        {
          id: "task-todo",
          title: "Todo Task",
          status: "TODO",
          priority: "MEDIUM",
          createdAt: oldTime,
          updatedAt: oldTime,
        },
        {
          id: "task-done",
          title: "Done Task",
          status: "DONE",
          priority: "MEDIUM",
          createdAt: oldTime,
          updatedAt: oldTime,
        },
        {
          id: "task-stuck",
          title: "Stuck Task",
          status: "STUCK",
          priority: "MEDIUM",
          createdAt: oldTime,
          updatedAt: oldTime,
        },
      ])
      .run();

    intervalHandle = startStuckTaskMonitor(mock.fastify);

    vi.advanceTimersByTime(60_000);

    const chatMessages = getEmittedEvents(mock, "chat_message");
    expect(chatMessages).toHaveLength(0);
  });

  it("does not notify again even after task is updated (dedup persists)", async () => {
    const now = new Date();
    const oldTime = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const recentTime = new Date(
      now.getTime() - 1 * 60 * 60 * 1000,
    ).toISOString();

    const { db } = await import("../db/index.js");
    db.insert(tasksTable)
      .values({
        id: "task-updated",
        title: "Updated Task",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        createdAt: oldTime,
        updatedAt: oldTime,
      })
      .run();

    intervalHandle = startStuckTaskMonitor(mock.fastify);

    vi.advanceTimersByTime(60_000);
    expect(getEmittedEvents(mock, "chat_message")).toHaveLength(1);

    db.update(tasksTable)
      .set({ updatedAt: recentTime })
      .where(eq(tasksTable.id, "task-updated"))
      .run();

    vi.advanceTimersByTime(60_000);
    expect(getEmittedEvents(mock, "chat_message")).toHaveLength(1);
  });
});
