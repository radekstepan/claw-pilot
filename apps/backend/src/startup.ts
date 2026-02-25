/**
 * Startup environment validation.
 * Called before Fastify is instantiated. Throws with a clear message if any
 * required variable is missing or has a dangerous value, so the process exits
 * immediately rather than starting in an insecure state.
 */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];

export function validateEnv(): void {
    const errors: string[] = [];

    // --- API_KEY ---
    if (!process.env.API_KEY || process.env.API_KEY.trim() === '') {
        errors.push('API_KEY must be set in .env to a non-empty secret value.');
    }

    // --- HOST (optional, but must never be a non-loopback address) ---
    const host = process.env.HOST;
    if (host !== undefined && !LOOPBACK_HOSTS.includes(host)) {
        errors.push(
            `HOST="${host}" is not allowed. This app must only bind to a loopback interface ` +
            `(${LOOPBACK_HOSTS.join(', ')}). Remove HOST from .env or set it to 127.0.0.1.`
        );
    }

    // --- ALLOWED_ORIGIN ---
    const origin = process.env.ALLOWED_ORIGIN;
    if (origin !== undefined && origin.trim() === '*') {
        errors.push(
            'ALLOWED_ORIGIN cannot be the wildcard "*". ' +
            'Set it to the exact URL of your frontend (e.g. http://localhost:5173).'
        );
    }

    if (errors.length > 0) {
        console.error('\n[claw-pilot] ❌ Invalid environment configuration:\n');
        for (const err of errors) {
            console.error(`  • ${err}`);
        }
        console.error('\nFix the above issues in apps/backend/.env and restart.\n');
        process.exit(1);
    }
}
