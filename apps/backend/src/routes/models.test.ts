/**
 * Integration tests for the Models routes.
 *
 * Every test uses `fastify.inject()` — no TCP socket, no port binding.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { setTestDb, runMigrations } from "../db/index.js";

vi.mock("../gateway/index.js", async () => {
  const actual = await vi.importActual("../gateway/index.js");
  return {
    ...actual,
    getGateway: vi.fn(),
    GatewayOfflineError: class extends Error {
      name = "GatewayOfflineError";
    },
    GatewayPairingRequiredError: class extends Error {
      name = "GatewayPairingRequiredError";
    },
  };
});

import { getGateway, GatewayOfflineError } from "../gateway/index.js";

const mockGateway = {
  getModels: vi.fn(),
};

const AUTH = { Authorization: "Bearer test-api-key" };

function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

describe("Models routes — integration", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    createTestDb();
    app = await buildApp();
    vi.clearAllMocks();
    vi.mocked(getGateway).mockReturnValue(mockGateway as any);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/models", () => {
    it("returns models list when gateway online", async () => {
      vi.mocked(mockGateway.getModels).mockResolvedValue([
        { id: "gpt-4", name: "GPT-4" },
        { id: "gpt-3.5", name: "GPT-3.5 Turbo" },
      ]);

      const res = await app.inject({
        method: "GET",
        url: "/api/models",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<Array<{ id: string; name: string }>>();
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe("gpt-4");
    });

    it("returns 503 with error when gateway offline", async () => {
      vi.mocked(mockGateway.getModels).mockRejectedValue(
        new GatewayOfflineError(
          "test-method",
          new Error("Gateway unreachable"),
        ),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/models",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(503);
      const body = res.json<{ error: string; gatewayUrl: string }>();
      expect(body.error).toContain("unreachable");
      expect(body.gatewayUrl).toBeDefined();
    });

    it("returns 500 on unexpected error", async () => {
      vi.mocked(mockGateway.getModels).mockRejectedValue(
        new Error("Unexpected error"),
      );

      const res = await app.inject({
        method: "GET",
        url: "/api/models",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json<{ error: string }>()).toHaveProperty("error");
    });

    it("returns empty array when no models available", async () => {
      vi.mocked(mockGateway.getModels).mockResolvedValue([]);

      const res = await app.inject({
        method: "GET",
        url: "/api/models",
        headers: AUTH,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json<unknown[]>()).toEqual([]);
    });
  });

  describe("Auth enforcement", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await app.inject({ method: "GET", url: "/api/models" });
      expect(res.statusCode).toBe(401);
    });
  });
});
