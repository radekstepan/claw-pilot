import { z } from 'zod';
import os from 'os';
import path from 'path';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'] as const;

const EnvSchema = z.object({
    /** Required — app refuses to start without a non-empty API key. */
    API_KEY: z.string().min(1, 'API_KEY must be set to a non-empty secret value'),

    /** TCP port for the HTTP server. Defaults to 54321. */
    PORT: z.coerce.number().int().positive().default(54321),

    /**
     * Interface to bind to. Must be a loopback address so the server is never
     * exposed on a public network interface.
     */
    HOST: z
        .string()
        .default('127.0.0.1')
        .refine((h) => LOOPBACK_HOSTS.includes(h as (typeof LOOPBACK_HOSTS)[number]), {
            message: `HOST must be a loopback interface (${LOOPBACK_HOSTS.slice(0,3).join(', ')}) or 0.0.0.0 for Docker containers`,
        }),

    /**
     * Exact URL of the frontend that is allowed to make cross-origin requests.
     * Wildcard "*" is explicitly rejected.
     */
    ALLOWED_ORIGIN: z
        .string()
        .default('http://localhost:5173')
        .refine((o) => o.trim() !== '*', {
            message: 'ALLOWED_ORIGIN cannot be the wildcard "*" — use the exact frontend URL',
        }),

    /** Controls error-message verbosity in the global error handler. */
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    /** Timeout (ms) for fast informational CLI calls (sessions list, --version, etc.). */
    CLI_TIMEOUT: z.coerce.number().int().positive().default(15_000),

    /** Timeout (ms) for heavy AI calls (chat routing, session spawn). */
    AI_TIMEOUT: z.coerce.number().int().positive().default(120_000),

    /**
     * Root directory of the OpenClaw installation.
     * Defaults to ~/.openclaw so local dev works without any extra config.
     * Override in Docker / CI to point at a mounted config volume.
     */
    OPENCLAW_HOME: z.string().default(path.join(os.homedir(), '.openclaw')),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Parses and validates process.env against the schema.
 * Throws a descriptive Error (crashing the process) if any required variable is
 * missing or any constraint is violated — the T3 Env pattern for fail-fast boot.
 */
function parseEnv(): Env {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  • ${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('\n');
        throw new Error(
            `\n[claw-pilot] ❌ Invalid environment configuration:\n\n${issues}\n\n` +
                `Fix the above issues in apps/backend/.env and restart.\n`,
        );
    }
    return result.data;
}

export const env: Env = parseEnv();
