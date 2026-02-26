/**
 * Boot-time recovery: cross-reference IN_PROGRESS tasks against live gateway
 * sessions and immediately mark orphaned tasks as STUCK.
 *
 * Background: the aiQueue is memory-only. If the server restarts while tasks
 * are being processed, those tasks remain IN_PROGRESS in the DB forever but
 * have no corresponding active gateway session.  The stuckTaskMonitor only
 * alerts after 24 h — this check fires once on startup to recover orphans
 * immediately instead of waiting.
 *
 * Behaviour when the gateway is offline:
 *   - Silently skips the check (logs a warning). We cannot distinguish
 *     "orphaned" from "still running autonomously" without a live session
 *     list, so we err on the side of caution.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db, tasks as tasksTable } from '../db/index.js';
import type { Task } from '@claw-pilot/shared-types';
import {
    getLiveSessions,
    agentIdToSessionKey,
    GatewayOfflineError,
    GatewayPairingRequiredError,
} from '../openclaw/cli.js';

export async function runBootRecovery(fastify: FastifyInstance): Promise<void> {
    // 1. Find all tasks currently sitting IN_PROGRESS in the DB.
    const inProgressTasks = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.status, 'IN_PROGRESS'))
        .all();

    if (inProgressTasks.length === 0) {
        fastify.log.info('bootRecovery: no IN_PROGRESS tasks — nothing to recover');
        return;
    }

    fastify.log.info(
        `bootRecovery: found ${inProgressTasks.length} IN_PROGRESS task(s), querying live sessions…`,
    );

    // 2. Fetch live gateway sessions.  Abort if the gateway is unreachable.
    let liveSessions: Awaited<ReturnType<typeof getLiveSessions>>;
    try {
        liveSessions = await getLiveSessions();
    } catch (err) {
        if (err instanceof GatewayPairingRequiredError) {
            fastify.log.warn(
                'bootRecovery: gateway requires device pairing — skipping recovery (tasks left IN_PROGRESS)',
            );
            return;
        }
        if (err instanceof GatewayOfflineError) {
            fastify.log.warn(
                'bootRecovery: gateway is offline — skipping recovery (tasks left IN_PROGRESS)',
            );
            return;
        }
        fastify.log.error({ err }, 'bootRecovery: unexpected error fetching sessions — skipping');
        return;
    }

    // 3. Build a set of active session keys for O(1) lookup.
    const activeSessionKeys = new Set(
        liveSessions.map((s) => s.key).filter((k): k is string => typeof k === 'string'),
    );

    fastify.log.info(
        `bootRecovery: ${activeSessionKeys.size} active gateway session(s) found`,
    );

    // 4. Mark orphaned tasks as STUCK.
    const now = new Date().toISOString();
    let markedCount = 0;

    for (const task of inProgressTasks) {
        // If the task has an assigned agent, check whether its session is live.
        // Tasks with no agentId were somehow left IN_PROGRESS without being routed —
        // treat those as orphaned too.
        const sessionKey = task.agentId ? agentIdToSessionKey(task.agentId) : null;
        const hasActiveSession = sessionKey !== null && activeSessionKeys.has(sessionKey);

        if (hasActiveSession) {
            fastify.log.debug(
                `bootRecovery: task ${task.id} has active session (${sessionKey}) — leaving IN_PROGRESS`,
            );
            continue;
        }

        const stuckRow = db
            .update(tasksTable)
            .set({ status: 'STUCK', updatedAt: now })
            .where(eq(tasksTable.id, task.id))
            .returning()
            .get();

        if (stuckRow) {
            // Cast Drizzle row (status: string) to the shared Task type (status: enum).
            const taskPayload: Task = {
                id: stuckRow.id,
                title: stuckRow.title ?? undefined,
                description: stuckRow.description ?? undefined,
                status: stuckRow.status as Task['status'],
                priority: (stuckRow.priority as Task['priority']) ?? undefined,
                tags: stuckRow.tags ?? undefined,
                assignee_id: stuckRow.assignee_id ?? undefined,
                agentId: stuckRow.agentId ?? undefined,
                deliverables: stuckRow.deliverables ?? undefined,
                createdAt: stuckRow.createdAt,
                updatedAt: stuckRow.updatedAt,
            };
            fastify.io?.emit('task_updated', taskPayload);
            fastify.log.info(
                `bootRecovery: task ${task.id} ("${task.title}") marked STUCK` +
                    (task.agentId ? ` (no active session for agent ${task.agentId})` : ' (no agentId)'),
            );
            markedCount++;
        }
    }

    fastify.log.info(
        `bootRecovery: complete — ${markedCount} task(s) marked STUCK, ` +
            `${inProgressTasks.length - markedCount} left IN_PROGRESS`,
    );
}
