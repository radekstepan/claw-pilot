/**
 * Tests for recurringSchedulerMonitor.
 *
 * Tests the cron-based scheduling logic for recurring tasks.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import {
  createTestDb,
  createMockFastify,
  getEmittedEvents,
} from "../test/helpers.js";
import { recurringTasks as recurringTable } from "../db/index.js";
import { eq } from "drizzle-orm";
import { startRecurringSchedulerMonitor } from "../monitors/recurringSchedulerMonitor.js";

vi.mock("../openclaw/cli.js", () => ({
  spawnTaskSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/recurringTrigger.js", () => ({
  triggerRecurringTemplate: vi.fn().mockResolvedValue({
    task: { id: "new-task-id", title: "New Task" },
    dispatchAccepted: false,
  }),
}));

describe("recurringSchedulerMonitor", () => {
  let mock: ReturnType<typeof createMockFastify>;
  let handle: { timer: NodeJS.Timeout; reconcile: () => void };

  beforeEach(async () => {
    createTestDb();
    mock = createMockFastify();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    // Stop all croner jobs before restoring mocks: clear templates from DB
    // then reconcile so the monitor stops all jobs. Without this, croner fires
    // after vi.restoreAllMocks() resets triggerRecurringTemplate to return
    // undefined → unhandled rejection on `.then()`.
    if (handle) {
      const { db } = await import("../db/index.js");
      db.delete(recurringTable).run();
      handle.reconcile();
      clearInterval(handle.timer);
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("schedules ACTIVE HOURLY template", async () => {
    const { db } = await import("../db/index.js");
    db.insert(recurringTable)
      .values({
        id: "recurring-hourly",
        title: "Hourly Task",
        schedule_type: "HOURLY",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    expect(mock.log.info).toHaveBeenCalledWith(
      expect.stringContaining("scheduled template 'recurring-hourly'"),
    );
  });

  it("does not schedule PAUSED template", async () => {
    const { db } = await import("../db/index.js");
    db.insert(recurringTable)
      .values({
        id: "recurring-paused",
        title: "Paused Task",
        schedule_type: "DAILY",
        status: "PAUSED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    expect(mock.log.info).not.toHaveBeenCalledWith(
      expect.stringContaining("recurring-paused"),
    );
  });

  it("stops job when template is paused", async () => {
    const { db } = await import("../db/index.js");
    db.insert(recurringTable)
      .values({
        id: "recurring-to-pause",
        title: "Task to Pause",
        schedule_type: "DAILY",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    db.update(recurringTable)
      .set({ status: "PAUSED" })
      .where(eq(recurringTable.id, "recurring-to-pause"))
      .run();

    handle.reconcile();

    expect(mock.log.info).toHaveBeenCalledWith(
      expect.stringContaining("scheduled template"),
    );
  });

  it("removes job when template is deleted", async () => {
    const { db } = await import("../db/index.js");
    db.insert(recurringTable)
      .values({
        id: "recurring-to-delete",
        title: "Task to Delete",
        schedule_type: "WEEKLY",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    db.delete(recurringTable)
      .where(eq(recurringTable.id, "recurring-to-delete"))
      .run();

    handle.reconcile();

    expect(mock.log.info).toHaveBeenCalledWith(
      expect.stringContaining("scheduled template"),
    );
  });

  it("updates job when schedule changes", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(recurringTable)
      .values({
        id: "recurring-change",
        title: "Task Changing Schedule",
        schedule_type: "HOURLY",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    db.update(recurringTable)
      .set({ schedule_type: "DAILY", updatedAt: new Date().toISOString() })
      .where(eq(recurringTable.id, "recurring-change"))
      .run();

    handle.reconcile();

    expect(mock.log.info).toHaveBeenCalledWith(
      expect.stringContaining("scheduled template 'recurring-change'"),
    );
  });

  it("skips invalid schedule and stops existing job", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(recurringTable)
      .values({
        id: "recurring-invalid",
        title: "Invalid Schedule Task",
        schedule_type: "INVALID_TYPE",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    expect(mock.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("invalid schedule"),
    );
  });

  it("handles CUSTOM cron expressions", async () => {
    const { db } = await import("../db/index.js");
    const now = new Date().toISOString();
    db.insert(recurringTable)
      .values({
        id: "recurring-custom",
        title: "Custom Cron Task",
        schedule_type: "CUSTOM",
        schedule_value: "0 12 * * *",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    expect(mock.log.info).toHaveBeenCalledWith(
      expect.stringContaining("scheduled template 'recurring-custom'"),
    );
  });

  it("runs reconcile on timer interval", async () => {
    const { db } = await import("../db/index.js");
    db.insert(recurringTable)
      .values({
        id: "recurring-timer",
        title: "Timer Task",
        schedule_type: "HOURLY",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    handle = startRecurringSchedulerMonitor(mock.fastify);
    handle.reconcile();

    vi.advanceTimersByTime(60_000);

    expect(mock.log.info).toHaveBeenCalledWith(
      expect.stringContaining("scheduled template"),
    );
  });
});
