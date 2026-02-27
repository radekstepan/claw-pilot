import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    /**
     * `env` is processed by the Vitest worker before any module is loaded,
     * so `API_KEY` is present in `process.env` when `config/env.ts` runs
     * its Zod parse during import resolution.
     */
    env: {
      API_KEY: "test-api-key",
      NODE_ENV: "test",
    },
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 50,
        branches: 65,
      },
    },
  },
});
