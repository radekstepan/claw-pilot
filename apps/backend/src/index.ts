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
// MUST be first: ESM evaluates this module fully before index.ts body runs,
// so process.env is populated before Zod validates it in config/env.ts.
import './loadEnv.js';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '@claw-pilot/shared-types';
import { startSessionMonitor } from './monitors/sessionMonitor.js';
import { startStuckTaskMonitor } from './monitors/stuckTaskMonitor.js';
import { startPruningMonitor } from './monitors/pruningMonitor.js';
import { startRecurringSchedulerMonitor } from './monitors/recurringSchedulerMonitor.js';
import { runMigrations } from './db/index.js';
import { aiQueue } from './services/aiQueue.js';

// Apply any pending DB schema migrations before the app starts.
runMigrations();

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
const sessionMonitorTimer  = startSessionMonitor(fastify);
const stuckTaskMonitorTimer = startStuckTaskMonitor(fastify);
const pruningMonitorTimer   = startPruningMonitor(fastify);
const recurringScheduler = startRecurringSchedulerMonitor(fastify);
const recurringSchedulerTimer = recurringScheduler.timer;
fastify.decorate('reconcileRecurring', recurringScheduler.reconcile);

// ---------------------------------------------------------------------------
// Start listening
// ---------------------------------------------------------------------------
await fastify.listen({ port: env.PORT, host: env.HOST });
console.log(`Server listening on http://${env.HOST}:${env.PORT}`);

// ---------------------------------------------------------------------------
// Graceful shutdown — handle SIGINT (Ctrl-C) and SIGTERM (container stop).
//
// Order of operations:
//   1. Stop timers so no new work is scheduled.
//   2. Flush any pending db state to disk.
//   3. Close the Fastify/HTTP/Socket.io server (drains in-flight requests).
//   4. Exit with code 0.
// ---------------------------------------------------------------------------
async function shutdown(signal: string): Promise<void> {
    console.log(`\n[claw-pilot] ${signal} received — shutting down gracefully…`);

    clearInterval(sessionMonitorTimer);
    clearInterval(stuckTaskMonitorTimer);
    clearInterval(pruningMonitorTimer);
    clearInterval(recurringSchedulerTimer);

    // Pause the AI job queue so no new jobs are dequeued, then wait for
    // any in-flight AI calls to finish before closing the HTTP server.
    // Cap the wait at 2× the AI timeout to avoid hanging forever.
    aiQueue.pause();
    const drainTimeout = new Promise<void>((resolve) =>
        setTimeout(resolve, env.OPENCLAW_AI_TIMEOUT * 2)
    );
    await Promise.race([aiQueue.onIdle(), drainTimeout]);
    if (aiQueue.pending > 0) {
        console.warn(`[claw-pilot] AI queue drain timed out — ${aiQueue.pending} jobs still in-flight.`);
    }

    try {
        await fastify.close();
    } catch (e) {
        console.error('[claw-pilot] fastify.close() failed during shutdown:', e);
    }

    process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

