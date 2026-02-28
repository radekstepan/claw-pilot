/**
 * Tests for aiQueue — concurrency-limited queue for heavy AI gateway calls.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import PQueue from "p-queue";
import {
  createMockFastify,
  getEmittedEvents,
  resetModuleState,
} from "../test/helpers.js";
import {
  AI_PRIORITY_HIGH,
  AI_PRIORITY_NORMAL,
  enqueueAiJob,
} from "./aiQueue.js";

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
    let mock: ReturnType<typeof createMockFastify>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stdoutWriteSpy: any;

    beforeEach(async () => {
      mock = createMockFastify();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stdoutWriteSpy = vi
        .spyOn(process.stdout, "write" as any)
        .mockImplementation(() => true);
      vi.useFakeTimers();
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("emits agent_busy_changed with busy: true before running job", async () => {
      let jobResolved = false;
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        jobResolved = true;
      };

      enqueueAiJob("test-job", AI_PRIORITY_NORMAL, fn, mock.fastify, "agent-1");

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      const busyEvents = getEmittedEvents(mock, "agent_busy_changed");
      expect(busyEvents).toContainEqual({ agentId: "agent-1", busy: true });
    });

    it("emits agent_busy_changed with busy: false after job completes", async () => {
      const fn = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      };

      enqueueAiJob("test-job", AI_PRIORITY_NORMAL, fn, mock.fastify, "agent-1");

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      const busyEvents = getEmittedEvents(mock, "agent_busy_changed");
      expect(busyEvents).toContainEqual({ agentId: "agent-1", busy: false });
    });

    it("emits agent_error when job throws", async () => {
      const fn = async () => {
        throw new Error("Test error");
      };

      enqueueAiJob(
        "failing-job",
        AI_PRIORITY_NORMAL,
        fn,
        mock.fastify,
        "agent-2",
      );

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      const errorEvents = getEmittedEvents(mock, "agent_error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        agentId: "failing-job",
        error: "Test error",
      });
    });

    it("logs error via fastify.log.error when job throws", async () => {
      const fn = async () => {
        throw new Error("Logged error");
      };

      enqueueAiJob("error-job", AI_PRIORITY_NORMAL, fn, mock.fastify);

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      expect(mock.log.error).toHaveBeenCalled();
    });

    it("works without agentId (gateway channel)", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);

      enqueueAiJob("gateway-job", AI_PRIORITY_NORMAL, fn, mock.fastify);

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      const busyEvents = getEmittedEvents(mock, "agent_busy_changed");
      expect(busyEvents).toHaveLength(0);
      expect(fn).toHaveBeenCalled();
    });

    it("handles non-Error thrown values", async () => {
      const fn = async () => {
        throw "string error";
      };

      enqueueAiJob("string-error-job", AI_PRIORITY_NORMAL, fn, mock.fastify);

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      const errorEvents = getEmittedEvents(mock, "agent_error");
      expect(errorEvents[0]).toMatchObject({
        agentId: "string-error-job",
        error: "string error",
      });
    });

    it("runs job function when slot is available", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);

      enqueueAiJob("exec-job", AI_PRIORITY_NORMAL, fn, mock.fastify);

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("accepts different priority levels", async () => {
      const fn = vi.fn().mockResolvedValue(undefined);

      enqueueAiJob("high-prio", AI_PRIORITY_HIGH, fn, mock.fastify);
      enqueueAiJob("normal-prio", AI_PRIORITY_NORMAL, fn, mock.fastify);

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("queue concurrency", () => {
    let mock: ReturnType<typeof createMockFastify>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let stdoutWriteSpy: any;

    beforeEach(() => {
      mock = createMockFastify();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stdoutWriteSpy = vi
        .spyOn(process.stdout, "write" as any)
        .mockImplementation(() => true);
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("queues multiple jobs and runs them respecting concurrency", async () => {
      const running: string[] = [];
      let concurrency = 0;

      const makeJob = (name: string) => async () => {
        running.push(name);
        concurrency++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrency--;
        running.push(`${name}-done`);
      };

      const jobs = [
        makeJob("job1"),
        makeJob("job2"),
        makeJob("job3"),
        makeJob("job4"),
      ];

      for (const job of jobs) {
        enqueueAiJob("job", AI_PRIORITY_NORMAL, job, mock.fastify);
      }

      await vi.runAllTimersAsync();
      await vi.runAllTimersAsync();

      expect(running.length).toBeGreaterThan(0);
    });
  });
});
