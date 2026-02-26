/**
 * aiQueue — concurrency-limited queue for heavy AI gateway calls.
 *
 * All calls to routeChatToAgent, spawnTaskSession, and generateAgentConfig
 * must go through this module instead of being launched as unbounded detached
 * async closures. This prevents OOM/resource exhaustion when many requests
 * arrive simultaneously.
 *
 * Concurrency is controlled by the AI_QUEUE_CONCURRENCY environment variable
 * (default: 3). Interactive chat jobs receive higher priority (1) than
 * automated task routing (0) so user-facing requests are never starved by
 * background work.
 */
import PQueue from 'p-queue';
import { env } from '../config/env.js';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Singleton queue — one shared instance for the lifetime of the process.
// ---------------------------------------------------------------------------
export const aiQueue = new PQueue({ concurrency: env.AI_QUEUE_CONCURRENCY });

// Emit a log line every time a slot becomes active, so operators can observe
// back-pressure at runtime via structured logs.
aiQueue.on('active', () => {
    // size = number of queued (not yet running) jobs
    // pending = number of currently-running jobs
    const size = aiQueue.size;
    const pending = aiQueue.pending;
    // We don't have direct access to fastify here, but process-level logging is fine.
    if (size > 0) {
        process.stdout.write(
            JSON.stringify({
                level: 30, // pino "info"
                time: Date.now(),
                msg: `[aiQueue] slot active — queued=${size} running=${pending} concurrency=${env.AI_QUEUE_CONCURRENCY}`,
            }) + '\n',
        );
    }
});

// ---------------------------------------------------------------------------
// Priority constants
// ---------------------------------------------------------------------------
/** Interactive chat messages — get processed before background task routing. */
export const AI_PRIORITY_HIGH = 1;

/** Background task routing / session spawning. */
export const AI_PRIORITY_NORMAL = 0;

// ---------------------------------------------------------------------------
// enqueueAiJob — primary public API
// ---------------------------------------------------------------------------
/**
 * Enqueues an AI job with a given priority. Returns immediately; the job runs
 * when a concurrency slot is available. Errors are logged and emitted via
 * Socket.io so the frontend can react without polling.
 *
 * @param label   Short human-readable name for log messages (e.g. 'chat', 'task-route').
 * @param priority Higher number = higher priority. Use AI_PRIORITY_HIGH or AI_PRIORITY_NORMAL.
 * @param fn      Async function that performs the actual gateway call.
 * @param fastify Fastify instance used for structured logging and Socket.io emission.
 */
export function enqueueAiJob(
    label: string,
    priority: number,
    fn: () => Promise<void>,
    fastify: FastifyInstance,
): void {
    void aiQueue.add(
        async () => {
            try {
                await fn();
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                fastify.log.error({ err, label }, `[aiQueue] job '${label}' failed: ${message}`);
                fastify.io?.emit('agent_error', { agentId: label, error: message });
            }
        },
        { priority },
    );
}
