import type { FastifyRequest, FastifyReply } from 'fastify';
import { createHash, timingSafeEqual } from 'crypto';
import { env } from '../config/env.js';

/**
 * Fastify `onRequest` hook that enforces Bearer-token authentication.
 *
 * Reads API_KEY from the validated env config (guaranteed non-empty at boot).
 * Expects the caller to supply:
 *   Authorization: Bearer <key>
 *
 * Returns 401 if the header is absent, malformed, or the token does not match.
 * Only routes under `/api/*` require authentication. All other paths (the root
 * health-check, SPA HTML, and static frontend assets served by @fastify/static
 * in production) are intentionally public so the browser can load the UI without
 * needing to supply an API key.
 *
 * Security: comparison is done via SHA-256 digest + timingSafeEqual to prevent
 * timing-based side-channel attacks that could leak the API key length or value.
 */
export async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Let CORS preflight requests pass through without authentication.
    // OPTIONS is a browser-internal mechanism with no user identity context.
    if (request.method === 'OPTIONS') return;

    // Only protect the API surface. Static assets, the SPA entry-point, and the
    // health-check root are all public. This keeps the browser able to load the
    // frontend in production without requiring an Authorization header for every
    // JS/CSS bundle fetch.
    if (!request.url.startsWith('/api/')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Unauthorized: missing or malformed Authorization header.' });
    }

    const token = authHeader.slice('Bearer '.length);

    // Hash both values to a fixed-length digest before comparing, so
    // timingSafeEqual always receives equal-length Buffers and the comparison
    // time does not leak whether the token length is correct.
    const expectedHash = createHash('sha256').update(env.API_KEY).digest();
    const actualHash = createHash('sha256').update(token).digest();

    if (!timingSafeEqual(expectedHash, actualHash)) {
        return reply.status(401).send({ error: 'Unauthorized: invalid API key.' });
    }
}
