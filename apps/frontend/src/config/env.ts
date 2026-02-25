import { z } from 'zod';

/**
 * Zod-validated frontend environment config — T3 Env style.
 *
 * All variables are optional and fall back to sensible defaults so the app
 * still starts in dev without a .env.local file. A malformed URL (e.g. a
 * typo in VITE_API_URL) throws at module load time rather than silently
 * failing on the first fetch.
 */
const EnvSchema = z.object({
    /** Base URL of the Claw-Pilot backend. */
    VITE_API_URL: z.string().url('VITE_API_URL must be a valid URL').default('http://localhost:54321'),

    /** Bearer token that matches the backend API_KEY. */
    VITE_API_KEY: z.string().default(''),

    /** Socket.io server URL (usually the same as VITE_API_URL). */
    VITE_SOCKET_URL: z.string().url('VITE_SOCKET_URL must be a valid URL').default('http://localhost:54321'),
});

export type FrontendEnv = z.infer<typeof EnvSchema>;

function parseEnv(): FrontendEnv {
    const result = EnvSchema.safeParse(import.meta.env);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `  • ${i.path.join('.') || '<root>'}: ${i.message}`)
            .join('\n');
        // Log prominently so the dev notices immediately in the browser console.
        console.error(
            `[claw-pilot] ❌ Invalid frontend environment configuration:\n\n${issues}\n\n` +
                `Check your .env.local file and restart the dev server.`,
        );
        // In production builds, throw so the app fails fast rather than making
        // requests to a broken URL.
        if (import.meta.env.PROD) {
            throw new Error('Invalid frontend environment — see console for details.');
        }
    }
    // safeParse returns .data only when success; on failure we use defaults.
    return result.success ? result.data : (EnvSchema.parse({}) as FrontendEnv);
}

export const env: FrontendEnv = parseEnv();
