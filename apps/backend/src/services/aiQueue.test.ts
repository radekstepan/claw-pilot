/**
 * Tests for aiQueue — SQLite-backed persistent queue for heavy AI gateway calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AI_PRIORITY_HIGH,
  AI_PRIORITY_NORMAL,
  enqueueAiJob,
} from "./aiQueue.js";
import { db, aiJobs } from "../db/index.js";
import { eq } from "drizzle-orm";

describe("aiQueue", () => {
  describe("priority constants", () => {
    it("exports AI_PRIORITY_HIGH as 1", () => {
      expect(AI_PRIORITY_HIGH).toBe(1);
    });

    it("exports AI_PRIORITY_NORMAL as 0", () => {
      expect(AI_PRIORITY_NORMAL).toBe(0);
    });
  });

  describe("enqueueAiJob", () => {
    beforeEach(() => {
      // Clear any existing jobs before each test
      db.delete(aiJobs).run();
    });

    afterEach(() => {
      // Clean up after each test
      db.delete(aiJobs).run();
    });

    it("inserts a chat job into the database", () => {
      enqueueAiJob(
        "test-job",
        AI_PRIORITY_NORMAL,
        "chat",
        { agentId: "agent-1", message: "Hello" },
        "agent-1",
      );

      const jobs = db
        .select()
        .from(aiJobs)
        .where(eq(aiJobs.label, "test-job"))
        .all();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobType).toBe("chat");
      expect(jobs[0].priority).toBe(AI_PRIORITY_NORMAL);
      expect(jobs[0].status).toBe("queued");
      expect(jobs[0].attempts).toBe(0);
    });

    it("inserts a task-route job into the database", () => {
      enqueueAiJob(
        "task-route",
        AI_PRIORITY_NORMAL,
        "task-route",
        { taskId: "task-123", agentId: "agent-1", prompt: "Do something" },
        "agent-1",
      );

      const jobs = db
        .select()
        .from(aiJobs)
        .where(eq(aiJobs.label, "task-route"))
        .all();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobType).toBe("task-route");
      expect(jobs[0].status).toBe("queued");
    });

    it("inserts a generate-config job into the database", () => {
      enqueueAiJob("generate-config", AI_PRIORITY_NORMAL, "generate-config", {
        requestId: "req-123",
        prompt: "Create agent",
        model: "claude",
      });

      const jobs = db
        .select()
        .from(aiJobs)
        .where(eq(aiJobs.label, "generate-config"))
        .all();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobType).toBe("generate-config");
      expect(jobs[0].status).toBe("queued");
    });

    it("assigns high priority correctly", () => {
      enqueueAiJob(
        "high-priority-job",
        AI_PRIORITY_HIGH,
        "chat",
        { agentId: "agent-1", message: "Hello" },
        "agent-1",
      );

      const jobs = db
        .select()
        .from(aiJobs)
        .where(eq(aiJobs.label, "high-priority-job"))
        .all();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].priority).toBe(AI_PRIORITY_HIGH);
    });

    it("works without agentId", () => {
      enqueueAiJob("no-agent-job", AI_PRIORITY_NORMAL, "activity-route", {
        message: "Activity message",
      });

      const jobs = db
        .select()
        .from(aiJobs)
        .where(eq(aiJobs.label, "no-agent-job"))
        .all();
      expect(jobs).toHaveLength(1);
      expect(jobs[0].agentId).toBeNull();
    });

    it("generates a unique job id for each job", () => {
      enqueueAiJob("job-1", AI_PRIORITY_NORMAL, "chat", {
        agentId: "a",
        message: "m",
      });
      enqueueAiJob("job-2", AI_PRIORITY_NORMAL, "chat", {
        agentId: "a",
        message: "m",
      });

      const jobs = db.select().from(aiJobs).all();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].id).not.toBe(jobs[1].id);
    });

    it("sets maxAttempts to 3 by default", () => {
      enqueueAiJob("test-job", AI_PRIORITY_NORMAL, "chat", {
        agentId: "agent-1",
        message: "Hello",
      });

      const jobs = db.select().from(aiJobs).all();
      expect(jobs[0].maxAttempts).toBe(3);
    });
  });
});
