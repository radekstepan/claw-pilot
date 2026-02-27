/**
 * Integration tests for the Chat routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 * Gateway calls and AI queue are mocked so no external connections are made.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { setTestDb, runMigrations } from "../db/index.js";

vi.mock("../openclaw/cli.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../openclaw/cli.js")>();
  return {
    ...actual,
    routeChatToAgent: vi
      .fn()
      .mockResolvedValue({ message: "Mock AI response" }),
  };
});

vi.mock("../services/aiQueue.js", () => ({
  enqueueAiJob: vi.fn(),
  AI_PRIORITY_HIGH: 1,
  AI_PRIORITY_NORMAL: 0,
}));

import { routeChatToAgent } from "../openclaw/cli.js";
import { enqueueAiJob } from "../services/aiQueue.js";

const AUTH = { Authorization: "Bearer test-api-key" };

function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

describe("Chat routes — integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/chat", () => {
    it("returns empty array when no messages exist", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/chat",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<{ data: unknown[] }>().data).toHaveLength(0);
    });

    it("returns messages sorted by newest first", async () => {
      await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: AUTH,
        payload: { content: "First message" },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: AUTH,
        payload: { content: "Second message" },
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/chat",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const { data } = res.json<{ data: Array<{ content: string }> }>();
      expect(data[0].content).toBe("Second message");
      expect(data[1].content).toBe("First message");
    });

    it("supports cursor-based pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await app.inject({
          method: "POST",
          url: "/api/chat",
          headers: AUTH,
          payload: { content: `Message ${i}` },
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const firstPage = await app.inject({
        method: "GET",
        url: "/api/chat?limit=2",
        headers: AUTH,
      });

      const { data, nextCursor } = firstPage.json<{
        data: Array<{ id: string }>;
        nextCursor: string | null;
      }>();
      expect(data).toHaveLength(2);
      expect(nextCursor).not.toBeNull();

      const secondPage = await app.inject({
        method: "GET",
        url: `/api/chat?limit=2&cursor=${nextCursor}`,
        headers: AUTH,
      });

      const secondData = secondPage.json<{ data: Array<{ id: string }> }>()
        .data;
      expect(secondData).toHaveLength(2);
    });
  });

  describe("POST /api/chat/send-to-agent", () => {
    it("returns 202 and enqueues AI job", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat/send-to-agent",
        headers: AUTH,
        payload: { message: "Hello agent", agentId: "main" },
      });

      expect(res.statusCode).toBe(202);
      expect(res.json<{ status: string }>().status).toBe("pending");

      expect(vi.mocked(enqueueAiJob)).toHaveBeenCalled();
    });

    it("returns 400 when message is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat/send-to-agent",
        headers: AUTH,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/chat", () => {
    it("creates a user message when no agentId provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: AUTH,
        payload: { content: "Test message" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ role: string; content: string }>();
      expect(body.role).toBe("user");
      expect(body.content).toBe("Test message");
    });

    it("creates an assistant message when agentId provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: AUTH,
        payload: { content: "AI response", agentId: "assistant" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<{ role: string; content: string }>();
      expect(body.role).toBe("assistant");
      expect(body.content).toBe("AI response");
    });

    it("returns 400 when content is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: AUTH,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /api/chat", () => {
    it("clears all chat messages and returns 204", async () => {
      await app.inject({
        method: "POST",
        url: "/api/chat",
        headers: AUTH,
        payload: { content: "Message to clear" },
      });

      const res = await app.inject({
        method: "DELETE",
        url: "/api/chat",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(204);

      const listRes = await app.inject({
        method: "GET",
        url: "/api/chat",
        headers: AUTH,
      });

      expect(listRes.json<{ data: unknown[] }>().data).toHaveLength(0);
    });
  });

  describe("Auth enforcement", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/api/chat" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 401 when API key is wrong", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/chat",
        headers: { Authorization: "Bearer wrong-key" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
