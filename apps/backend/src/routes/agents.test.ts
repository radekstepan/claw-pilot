/**
 * Integration tests for the Agent routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 * Gateway calls are fully mocked via vi.mock so no WebSocket connections are opened.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { setTestDb, runMigrations } from "../db/index.js";

// ---------------------------------------------------------------------------
// Mock all gateway calls. `...actual` spreads the real module so that
// class definitions like GatewayOfflineError remain the genuine constructors
// (the route does `instanceof GatewayOfflineError` — must be the same class).
// ---------------------------------------------------------------------------
vi.mock("../gateway/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../gateway/index.js")>();
  return {
    ...actual,
    getGateway: vi.fn(),
    GatewayOfflineError: class extends Error {
      name = "GatewayOfflineError";
    },
  };
});

const mockGateway = {
  getAgents: vi.fn().mockResolvedValue([
    {
      id: "architect",
      name: "Architect",
      status: "OFFLINE",
      model: "claude-sonnet-4",
      capabilities: ["planning", "review"],
    },
    {
      id: "developer",
      name: "Developer",
      status: "OFFLINE",
      model: "claude-sonnet-4",
      capabilities: ["coding", "testing"],
    },
  ]),
  getLiveSessions: vi.fn().mockResolvedValue([
    {
      agentId: "architect",
      agent: "architect",
      status: "IDLE",
      key: "session-001",
    },
    {
      agentId: "developer",
      agent: "developer",
      status: "WORKING",
      key: "session-002",
    },
  ]),
  updateAgentMeta: vi.fn().mockResolvedValue(undefined),
  setAgentFiles: vi.fn().mockResolvedValue(undefined),
  deleteAgent: vi.fn().mockResolvedValue({ success: true }),
  getAgentFile: vi.fn().mockResolvedValue(""),
  getAgentWorkspaceFiles: vi
    .fn()
    .mockResolvedValue({ soul: "", tools: "", agentsMd: "" }),
  createAgent: vi.fn().mockResolvedValue(undefined),
  generateAgentConfig: vi.fn(),
  routeChatToAgent: vi.fn(),
  spawnTaskSession: vi.fn(),
};

import { getGateway, GatewayOfflineError } from "../gateway/index.js";

// ---------------------------------------------------------------------------
// Auth header used in every authenticated request
// ---------------------------------------------------------------------------
const AUTH = { Authorization: "Bearer test-api-key" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Agent routes — integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
    vi.clearAllMocks();
    vi.mocked(getGateway).mockReturnValue(mockGateway as any);
    // Restore the default resolved values after clearAllMocks()
    vi.mocked(mockGateway.getAgents).mockResolvedValue([
      {
        id: "architect",
        name: "Architect",
        status: "OFFLINE",
        model: "claude-sonnet-4",
        capabilities: ["planning", "review"],
      },
      {
        id: "developer",
        name: "Developer",
        status: "OFFLINE",
        model: "claude-sonnet-4",
        capabilities: ["coding", "testing"],
      },
    ]);
    vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([
      {
        agentId: "architect",
        agent: "architect",
        status: "IDLE",
        key: "session-001",
      },
      {
        agentId: "developer",
        agent: "developer",
        status: "WORKING",
        key: "session-002",
      },
    ]);
    vi.mocked(mockGateway.updateAgentMeta).mockResolvedValue(undefined);
    vi.mocked(mockGateway.setAgentFiles).mockResolvedValue(undefined);
    vi.mocked(mockGateway.deleteAgent).mockResolvedValue({ success: true });
    vi.mocked(mockGateway.getAgentFile).mockResolvedValue("");
    vi.mocked(mockGateway.getAgentWorkspaceFiles).mockResolvedValue({
      soul: "",
      tools: "",
      agentsMd: "",
    });
  });

  afterEach(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------------
  // GET /api/agents
  // -----------------------------------------------------------------------
  describe("GET /api/agents", () => {
    it("merges live session status — IDLE and WORKING are reflected", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/agents",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const agents = res.json<Array<{ id: string; status: string }>>();
      expect(agents).toHaveLength(2);

      const architect = agents.find((a) => a.id === "architect");
      const developer = agents.find((a) => a.id === "developer");
      expect(architect?.status).toBe("IDLE");
      expect(developer?.status).toBe("WORKING");
    });

    it("agents with no matching session get status OFFLINE", async () => {
      vi.mocked(mockGateway.getLiveSessions).mockResolvedValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/agents",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const agents = res.json<Array<{ id: string; status: string }>>();
      expect(agents.every((a) => a.status === "OFFLINE")).toBe(true);
    });

    it("returns 503 when the gateway is unreachable", async () => {
      vi.mocked(mockGateway.getAgents).mockRejectedValueOnce(
        new GatewayOfflineError("config.get", new Error("ECONNREFUSED")),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/agents",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(503);
      expect(res.json<{ error: string }>().error).toMatch(/gateway/i);
    });
  });

  // -----------------------------------------------------------------------
  // PATCH /api/agents/:id
  // -----------------------------------------------------------------------
  describe("PATCH /api/agents/:id", () => {
    it("updates model and capabilities — calls updateAgentMeta with correct args", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/agents/architect",
        headers: AUTH,
        payload: {
          model: "claude-opus-4",
          capabilities: ["planning", "review", "architecture"],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(mockGateway.updateAgentMeta)).toHaveBeenCalledWith(
        "architect",
        {
          model: "claude-opus-4",
          capabilities: ["planning", "review", "architecture"],
        },
      );
    });

    it("updates SOUL.md and TOOLS.md files — calls setAgentFiles with correct args", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/agents/developer",
        headers: AUTH,
        payload: { soul: "# Dev\nYou are a developer.", tools: "# Tools" },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(mockGateway.setAgentFiles)).toHaveBeenCalledWith(
        "developer",
        {
          soul: "# Dev\nYou are a developer.",
          tools: "# Tools",
        },
      );
    });

    it("returns 400 when the payload has no fields", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/api/agents/architect",
        headers: AUTH,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 503 when the gateway is unreachable", async () => {
      vi.mocked(mockGateway.updateAgentMeta).mockRejectedValueOnce(
        new GatewayOfflineError("updateAgentMeta", new Error("ECONNREFUSED")),
      );

      const res = await app.inject({
        method: "PATCH",
        url: "/api/agents/architect",
        headers: AUTH,
        payload: { model: "claude-opus-4" },
      });

      expect(res.statusCode).toBe(503);
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/agents/:id/files
  // -----------------------------------------------------------------------
  describe("GET /api/agents/:id/files", () => {
    it("returns SOUL.md, TOOLS.md and AGENTS.md content from the gateway", async () => {
      vi.mocked(mockGateway.getAgentWorkspaceFiles).mockResolvedValue({
        soul: "# Architect Soul",
        tools: "# Architect Tools",
        agentsMd: "# Architect Agents",
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/agents/architect/files",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        soul: string;
        tools: string;
        agentsMd: string;
      }>();
      expect(body.soul).toBe("# Architect Soul");
      expect(body.tools).toBe("# Architect Tools");
      expect(body.agentsMd).toBe("# Architect Agents");
    });

    it("returns empty strings when the gateway reports no file content", async () => {
      vi.mocked(mockGateway.getAgentFile).mockResolvedValue("");

      const res = await app.inject({
        method: "GET",
        url: "/api/agents/developer/files",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        soul: string;
        tools: string;
        agentsMd: string;
      }>();
      expect(body.soul).toBe("");
      expect(body.tools).toBe("");
      expect(body.agentsMd).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // DELETE /api/agents/:id
  // -----------------------------------------------------------------------
  describe("DELETE /api/agents/:id", () => {
    it("calls deleteAgent with the correct id and returns { success: true }", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/api/agents/developer",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
      expect(vi.mocked(mockGateway.deleteAgent)).toHaveBeenCalledWith(
        "developer",
      );
    });

    it("returns 503 when the gateway is unreachable", async () => {
      vi.mocked(mockGateway.deleteAgent).mockRejectedValueOnce(
        new GatewayOfflineError("agents.delete", new Error("ECONNREFUSED")),
      );

      const res = await app.inject({
        method: "DELETE",
        url: "/api/agents/developer",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(503);
    });
  });
});
