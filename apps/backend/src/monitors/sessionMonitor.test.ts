/**
 * Tests for sessionMonitor.
 *
 * Tests the gateway polling and agent status tracking logic.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import {
  createTestDb,
  createMockFastify,
  getEmittedEvents,
} from "../test/helpers.js";
import { tasks as tasksTable } from "../db/index.js";
import { startSessionMonitor } from "../monitors/sessionMonitor.js";

const { GatewayOfflineError, GatewayPairingRequiredError } = vi.hoisted(() => {
  class GatewayOfflineError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "GatewayOfflineError";
    }
  }

  class GatewayPairingRequiredError extends Error {
    deviceId: string;
    constructor(deviceId: string) {
      super("Pairing required");
      this.name = "GatewayPairingRequiredError";
      this.deviceId = deviceId;
    }
  }

  return { GatewayOfflineError, GatewayPairingRequiredError };
});

vi.mock("../gateway/index.js", () => ({
  getGateway: vi.fn(),
  GatewayOfflineError,
  GatewayPairingRequiredError,
}));

const mockGateway = {
  getAgents: vi.fn(),
  getLiveSessions: vi.fn(),
  agentIdToSessionKey: vi.fn((id: string) => `mc-gateway:gateway:${id}`),
};

import { getGateway } from "../gateway/index.js";

describe("sessionMonitor", () => {
  let mock: ReturnType<typeof createMockFastify>;
  let handle: { interval: NodeJS.Timeout; shutdown: () => void };

  const tick = async () => {
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
  };

  const tickGracePeriod = async () => {
    vi.advanceTimersByTime(30 * 60 * 1000); // 30 minutes
    await Promise.resolve();
  };

  beforeEach(async () => {
    createTestDb();
    mock = createMockFastify();
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(getGateway).mockReturnValue(mockGateway as any);
    vi.mocked(mockGateway.getAgents).mockResolvedValue([]);
    vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (handle) {
      handle.shutdown();
    }
  });

  describe("gateway online flow", () => {
    it("emits gateway_status online=true on successful poll", async () => {
      handle = startSessionMonitor(mock.fastify);
      await tick();

      const events = getEmittedEvents(mock, "gateway_status");
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        online: true,
        pairingRequired: false,
        deviceId: undefined,
      });
    });

    it("emits agent_status_changed for each agent", async () => {
      const mockAgents = [
        { id: "agent-1", name: "Agent One", status: "OFFLINE" },
      ];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      const events = getEmittedEvents(mock, "agent_status_changed");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ id: "agent-1", status: "OFFLINE" });
    });

    it("first tick does NOT log agent status changes", async () => {
      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      expect(mock.log.info).not.toHaveBeenCalledWith(
        expect.stringContaining("Agent agent-1:"),
      );
    });
  });

  describe("gateway offline flow", () => {
    it("emits gateway_status online=false when GatewayOfflineError thrown", async () => {
      vi.mocked(mockGateway.getAgents).mockRejectedValue(
        new GatewayOfflineError("Gateway unreachable"),
      );

      handle = startSessionMonitor(mock.fastify);
      await tick();

      const events = getEmittedEvents(mock, "gateway_status");
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        online: false,
        pairingRequired: false,
        deviceId: undefined,
      });
    });

    it("logs warning message on gateway offline", async () => {
      vi.mocked(mockGateway.getAgents).mockRejectedValue(
        new GatewayOfflineError("Gateway unreachable"),
      );

      handle = startSessionMonitor(mock.fastify);
      await tick();

      expect(mock.log.warn).toHaveBeenCalled();
    });
  });

  describe("pairing required flow", () => {
    it("emits gateway_status with pairingRequired=true and deviceId", async () => {
      vi.mocked(mockGateway.getAgents).mockRejectedValue(
        new GatewayPairingRequiredError("device-123"),
      );

      handle = startSessionMonitor(mock.fastify);
      await tick();

      const events = getEmittedEvents(mock, "gateway_status");
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        online: false,
        pairingRequired: true,
        deviceId: "device-123",
      });
    });
  });

  describe("agent status transitions", () => {
    it("emits agent_status_changed only on actual status change", async () => {
      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);
      vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([
        { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
      ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      expect(getEmittedEvents(mock, "agent_status_changed")).toHaveLength(1);

      await tick();
      expect(getEmittedEvents(mock, "agent_status_changed")).toHaveLength(1);
    });

    it("logs status change on subsequent ticks", async () => {
      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      vi.mocked(mockGateway.getLiveSessions)
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
        ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      await tick();

      expect(mock.log.info).toHaveBeenCalledWith(
        "[sessionMonitor] Agent agent-1: WORKING → IDLE",
      );
    });
  });

  describe("ghost callback detection", () => {
    it("starts grace period timer when agent goes WORKING → IDLE", async () => {
      const { db } = await import("../db/index.js");
      const now = new Date().toISOString();

      db.insert(tasksTable)
        .values({
          id: "task-ghost",
          title: "Ghost Task",
          status: "IN_PROGRESS",
          agentId: "agent-1",
          priority: "HIGH",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      vi.mocked(mockGateway.getLiveSessions)
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
        ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      await tick();

      await tickGracePeriod();

      const stuckEvents = getEmittedEvents(mock, "task_updated");
      const stuckTask = stuckEvents.find(
        (e: unknown) => (e as { status?: string }).status === "STUCK",
      );
      expect(stuckTask).toBeDefined();
    });

    it("clears grace period timer when agent goes IDLE → WORKING", async () => {
      const { db } = await import("../db/index.js");
      const now = new Date().toISOString();

      db.insert(tasksTable)
        .values({
          id: "task-recovered",
          title: "Recovered Task",
          status: "IN_PROGRESS",
          agentId: "agent-1",
          priority: "HIGH",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      vi.mocked(mockGateway.getLiveSessions)
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
        ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      await tick();

      await tick();

      await tickGracePeriod();

      const stuckEvents = getEmittedEvents(mock, "task_updated");
      const stuckTask = stuckEvents.find(
        (e: unknown) => (e as { status?: string }).status === "STUCK",
      );
      expect(stuckTask).toBeUndefined();
    });

    it("emits agent_error event when marking task as STUCK", async () => {
      const { db } = await import("../db/index.js");
      const now = new Date().toISOString();

      db.insert(tasksTable)
        .values({
          id: "task-error",
          title: "Error Task",
          status: "IN_PROGRESS",
          agentId: "agent-1",
          priority: "HIGH",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      vi.mocked(mockGateway.getLiveSessions)
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
        ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      await tick();

      await tickGracePeriod();

      const errorEvents = getEmittedEvents(mock, "agent_error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({ agentId: "agent-1" });
    });

    it("does not notify same task twice", async () => {
      const { db } = await import("../db/index.js");
      const now = new Date().toISOString();

      db.insert(tasksTable)
        .values({
          id: "task-dedup",
          title: "Dedup Task",
          status: "IN_PROGRESS",
          agentId: "agent-1",
          priority: "HIGH",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      vi.mocked(mockGateway.getLiveSessions)
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
        ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      await tick();

      await tickGracePeriod();

      const stuckEvents1 = getEmittedEvents(mock, "task_updated");
      const stuckCount1 = stuckEvents1.filter(
        (e: unknown) => (e as { status?: string }).status === "STUCK",
      ).length;
      expect(stuckCount1).toBe(1);

      await tick();

      const stuckEvents2 = getEmittedEvents(mock, "task_updated");
      const stuckCount2 = stuckEvents2.filter(
        (e: unknown) => (e as { status?: string }).status === "STUCK",
      ).length;
      expect(stuckCount2).toBe(1);
    });
  });

  describe("shutdown", () => {
    it("clears interval and grace period timers", async () => {
      const { db } = await import("../db/index.js");
      const now = new Date().toISOString();

      db.insert(tasksTable)
        .values({
          id: "task-shutdown",
          title: "Shutdown Task",
          status: "IN_PROGRESS",
          agentId: "agent-1",
          priority: "HIGH",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      vi.mocked(mockGateway.getLiveSessions)
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
        ])
        .mockResolvedValueOnce([
          { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
        ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      await tick();

      handle.shutdown();

      await tickGracePeriod();

      const stuckEvents = getEmittedEvents(mock, "task_updated");
      const stuckTask = stuckEvents.find(
        (e: unknown) => (e as { status?: string }).status === "STUCK",
      );
      expect(stuckTask).toBeUndefined();
    });
  });

  describe("status mapping", () => {
    it("maps session status WORKING to agent status WORKING", async () => {
      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);
      vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([
        { agent: "agent-1", agentId: "agent-1", status: "WORKING" },
      ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      const events = getEmittedEvents(mock, "agent_status_changed");
      expect(events[0]).toMatchObject({ id: "agent-1", status: "WORKING" });
    });

    it("maps session status IDLE to agent status IDLE", async () => {
      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);
      vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([
        { agent: "agent-1", agentId: "agent-1", status: "IDLE" },
      ]);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      const events = getEmittedEvents(mock, "agent_status_changed");
      expect(events[0]).toMatchObject({ id: "agent-1", status: "IDLE" });
    });

    it("maps no session to agent status OFFLINE", async () => {
      const mockAgents = [{ id: "agent-1", name: "Test Agent" }];
      vi.mocked(mockGateway.getAgents).mockResolvedValue(mockAgents as any);

      handle = startSessionMonitor(mock.fastify);
      await tick();

      const events = getEmittedEvents(mock, "agent_status_changed");
      expect(events[0]).toMatchObject({ id: "agent-1", status: "OFFLINE" });
    });
  });
});
