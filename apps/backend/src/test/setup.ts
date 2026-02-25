/**
 * Vitest global setup for the backend test suite.
 *
 * This file is executed before any test module is loaded (configured via
 * vitest.config.ts `setupFiles`), guaranteeing that required environment
 * variables are set before the Zod env schema runs its parse.
 */

// Provide a deterministic API key that test auth headers can reference.
process.env.API_KEY = 'test-api-key';

// Silence session-monitor / stuck-task-monitor noise in test output.
process.env.NODE_ENV = 'test';
