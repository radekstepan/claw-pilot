import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';

/**
 * Fastify `onRequest` hook that enforces Bearer-token authentication.
 *
 * Reads API_KEY from the validated env config (guaranteed non-empty at boot).
 * Expects the caller to supply:
 *   Authorization: Bearer <key>
 *
 * Returns 401 if the header is absent, malformed, or the token does not match.
 * This hook is registered on all API routes; the root health-check `GET /` is
 * registered before the hook and remains public.
 */
export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // The root health-check (GET /) is intentionally public.
    // Fastify applies global hooks to all routes regardless of registration order,
    // so we bypass auth explicitly here rather than relying on registration position.
    if (request.url === '/') return;

    const apiKey = env.API_KEY;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized: missing or malformed Authorization header.' });
    }

    const token = authHeader.slice('Bearer '.length);
    if (token !== apiKey) {
        return reply.status(401).send({ error: 'Unauthorized: invalid API key.' });
    }
}
