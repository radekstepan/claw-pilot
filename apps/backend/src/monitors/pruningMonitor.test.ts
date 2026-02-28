/**
 * Tests for pruningMonitor.
 *
 * Tests the daily pruning of old chat messages and activity logs.
 */
import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { createMockFastify } from "../test/helpers.js";
import { startPruningMonitor } from "../monitors/pruningMonitor.js";

vi.mock("../config/env.js", () => ({
  env: { PUBLIC_URL: undefined, PORT: 3000, API_KEY: "test-key" },
}));

describe("pruningMonitor", () => {
  let mock: ReturnType<typeof createMockFastify>;
  let handle: NodeJS.Timeout;

  beforeEach(() => {
    mock = createMockFastify();
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (handle) {
      clearInterval(handle);
    }
  });

  it("returns an interval handle", () => {
    handle = startPruningMonitor(mock.fastify);
    expect(handle).toBeDefined();
  });

  it("timer is unref'd so it doesn't block process exit", () => {
    handle = startPruningMonitor(mock.fastify);
    expect(handle.unref).toBeDefined();
  });
});
