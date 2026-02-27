import Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { setTestDb, runMigrations } from "../db/index.js";
import { vi } from "vitest";

export function createTestDb(): Database.Database {
  const mem = new Database(":memory:");
  setTestDb(mem);
  runMigrations();
  return mem;
}

export interface MockFastify {
  fastify: FastifyInstance;
  emitted: Map<string, unknown[]>;
  log: {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
}

export function createMockFastify(): MockFastify {
  const emitted = new Map<string, unknown[]>();

  const mockIo = {
    emit: vi.fn((event: string, payload: unknown) => {
      if (!emitted.has(event)) {
        emitted.set(event, []);
      }
      emitted.get(event)!.push(payload);
    }),
  };

  const log = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };

  const fastify = {
    io: mockIo,
    log: log,
    addHook: vi.fn(),
  } as unknown as FastifyInstance;

  return { fastify, emitted, log };
}

export function getEmittedEvents(mock: MockFastify, event: string): unknown[] {
  return mock.emitted.get(event) ?? [];
}

export function resetModuleState(): void {
  vi.resetModules();
}
