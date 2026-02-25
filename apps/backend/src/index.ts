/**
 * Production entry-point.
 *
 * Responsibilities:
 *  1. Load .env into process.env (dotenv).
 *  2. Import `env` — the Zod-validated config — which crashes the process
 *     immediately with a descriptive message if any required variable is
 *     missing or invalid (T3 Env fail-fast pattern).
 *  3. Build the Fastify app via `buildApp()`.
 *  4. Attach Socket.io and start background monitors.
 *  5. Bind to the TCP port and begin accepting connections.
 */
import 'dotenv/config';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '@claw-pilot/shared-types';
import { startSessionMonitor } from './monitors/sessionMonitor.js';
import { startStuckTaskMonitor } from './monitors/stuckTaskMonitor.js';

const fastify = await buildApp();

// ---------------------------------------------------------------------------
// Socket.io — attaches to the same underlying HTTP server as Fastify.
// Must be decorated before the first request is served.
// ---------------------------------------------------------------------------
const io = new Server<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
    cors: { origin: env.ALLOWED_ORIGIN },
});

fastify.decorate('io', io);

io.on('connection', (socket) => {
    fastify.log.info(`Socket connected: ${socket.id}`);
    socket.on('disconnect', () => {
        fastify.log.info(`Socket disconnected: ${socket.id}`);
    });
});

// ---------------------------------------------------------------------------
// Background monitors
// ---------------------------------------------------------------------------
startSessionMonitor(fastify);
startStuckTaskMonitor(fastify);

// ---------------------------------------------------------------------------
// Start listening
// ---------------------------------------------------------------------------
await fastify.listen({ port: env.PORT, host: env.HOST });
console.log(`Server listening on http://${env.HOST}:${env.PORT}`);

