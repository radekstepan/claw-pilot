/**
 * Tests for backupMonitor.
 *
 * Tests the hourly database backup logic.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { createMockFastify } from "../test/helpers.js";
import { startBackupMonitor } from "../monitors/backupMonitor.js";

const { backupDb: backupDbFn } = vi.hoisted(() => ({
  backupDb: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  backupDb: backupDbFn,
}));

vi.mock("../config/env.js", () => ({
  env: { PUBLIC_URL: undefined, PORT: 3000, API_KEY: "test-key" },
}));

describe("backupMonitor", () => {
  let mock: ReturnType<typeof createMockFastify>;
  let handle: NodeJS.Timeout;

  beforeEach(() => {
    mock = createMockFastify();
    vi.useFakeTimers();
    vi.clearAllMocks();
    backupDbFn.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (handle) {
      clearInterval(handle);
    }
  });

  it("returns an interval handle", () => {
    handle = startBackupMonitor(mock.fastify);
    expect(handle).toBeDefined();
  });

  it("timer is unref'd so it doesn't block process exit", () => {
    handle = startBackupMonitor(mock.fastify);
    expect(handle.unref).toBeDefined();
  });

  it("does not call backupDb before interval elapses", () => {
    handle = startBackupMonitor(mock.fastify);
    vi.advanceTimersByTime(30 * 60 * 1000);
    expect(backupDbFn).not.toHaveBeenCalled();
  });

  it("calls backupDb after interval elapses", () => {
    handle = startBackupMonitor(mock.fastify);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(backupDbFn).toHaveBeenCalled();
  });
});
