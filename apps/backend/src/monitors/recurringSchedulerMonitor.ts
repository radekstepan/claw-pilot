/**
 * recurringSchedulerMonitor
 *
 * Runs every 60 s. For each ACTIVE recurring template, checks whether
 * enough time has elapsed since last_triggered_at (or createdAt when
 * the template has never been triggered). If so, spawns a concrete Task
 * in the database and emits socket events.
 *
 * Supported schedule_types and their intervals:
 *   HOURLY  — 1 hour
 *   DAILY   — 24 hours
 *   WEEKLY  — 7 days
 *   CUSTOM  — Not auto-triggered; use the "Trigger" button manually.
 */

import { FastifyInstance } from 'fastify';
import { db, recurringTasks as recurringTable, tasks as tasksTable, activities as activitiesTable } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { Task, TaskStatus } from '@claw-pilot/shared-types';
import { spawnTaskSession } from '../openclaw/cli.js';
import { env } from '../config/env.js';

const POLL_INTERVAL_MS = 60_000; // check every minute

const SCHEDULE_INTERVALS: Record<string, number> = {
    HOURLY: 60 * 60 * 1000,
    DAILY:  24 * 60 * 60 * 1000,
    WEEKLY: 7 * 24 * 60 * 60 * 1000,
};

function isDue(scheduleType: string, lastTriggeredAt: string | null, createdAt: string): boolean {
    const intervalMs = SCHEDULE_INTERVALS[scheduleType.toUpperCase()];
    if (!intervalMs) return false; // CUSTOM or unknown — skip auto-triggering

    const reference = lastTriggeredAt ?? createdAt;
    const msSinceLast = Date.now() - new Date(reference).getTime();
    return msSinceLast >= intervalMs;
}

export function startRecurringSchedulerMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    return setInterval(() => {
        try {
            const activeTemplates = db
                .select()
                .from(recurringTable)
                .where(eq(recurringTable.status, 'ACTIVE'))
                .all();

            for (const template of activeTemplates) {
                if (!isDue(template.schedule_type, template.last_triggered_at ?? null, template.createdAt)) {
                    continue;
                }

                const now = new Date().toISOString();
                const assignedAgentId = template.assigned_agent_id ?? null;
                const newTask: Task = {
                    id: randomUUID(),
                    title: template.title,
                    description: template.description ?? `Auto-generated from recurring template: ${template.title}`,
                    status: assignedAgentId ? 'ASSIGNED' : 'TODO',
                    priority: 'MEDIUM',
                    agentId: assignedAgentId ?? undefined,
                    createdAt: now,
                    updatedAt: now,
                };

                db.insert(tasksTable).values({
                    id: newTask.id,
                    title: newTask.title ?? null,
                    description: newTask.description ?? null,
                    status: newTask.status,
                    priority: newTask.priority ?? null,
                    tags: null,
                    assignee_id: null,
                    agentId: assignedAgentId,
                    deliverables: null,
                    createdAt: now,
                    updatedAt: now,
                }).run();

                db.update(recurringTable)
                    .set({ last_triggered_at: now, updatedAt: now })
                    .where(eq(recurringTable.id, template.id))
                    .run();

                fastify.log.info(`recurringScheduler: auto-triggered template "${template.title}" (${template.schedule_type}) → task ${newTask.id}${assignedAgentId ? ` → routing to agent '${assignedAgentId}'` : ''}`);

                if (fastify.io) {
                    fastify.io.emit('task_created', { id: newTask.id, title: newTask.title });
                    fastify.io.emit('task_updated', newTask);
                }

                if (assignedAgentId) {
                    // Write routing activity
                    const routeActivityId = randomUUID();
                    db.insert(activitiesTable).values({
                        id: routeActivityId,
                        taskId: newTask.id,
                        agentId: 'system',
                        message: `Task auto-routed to agent '${assignedAgentId}' from recurring template '${template.title}' — dispatching…`,
                        timestamp: now,
                    }).run();

                    if (fastify.io) {
                        fastify.io.emit('activity_added', {
                            id: routeActivityId,
                            taskId: newTask.id,
                            agentId: 'system',
                            message: `Task auto-routed to agent '${assignedAgentId}' from recurring template '${template.title}' — dispatching…`,
                            timestamp: now,
                        });
                    }

                    const taskId = newTask.id;
                    const baseUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT}`;
                    const callbackUrl = `${baseUrl}/api/tasks/${taskId}/activity`;
                    const taskContext = [
                        [newTask.title, newTask.description].filter(Boolean).join('\n\n'),
                        `---`,
                        `TASK METADATA (do not include in your work output):`,
                        `taskId: ${taskId}`,
                        `When you have finished, POST your result to:`,
                        `  POST ${callbackUrl}`,
                        `  Authorization: Bearer ${env.API_KEY}`,
                        `  Content-Type: application/json`,
                        `  Body: { "agent_id": "${assignedAgentId}", "message": "completed: <FULL OUTPUT HERE>" }`,
                        `IMPORTANT: The "message" field must contain your COMPLETE work output. Do NOT abbreviate.`,
                        `Start the message with "completed: " followed by the full output.`,
                        `On error use: { "agent_id": "${assignedAgentId}", "message": "error: <description>" }`,
                    ].join('\n');

                    void (async () => {
                        try {
                            await spawnTaskSession(assignedAgentId, taskId, taskContext);

                            const successNow = new Date().toISOString();
                            const successActivityId = randomUUID();

                            const inProgressRow = db.update(tasksTable).set({
                                status: 'IN_PROGRESS',
                                updatedAt: successNow,
                            }).where(eq(tasksTable.id, taskId)).returning().get();

                            db.insert(activitiesTable).values({
                                id: successActivityId,
                                taskId,
                                agentId: assignedAgentId,
                                message: `Agent '${assignedAgentId}' picked up the task and is now working on it.`,
                                timestamp: successNow,
                            }).run();

                            if (fastify.io) {
                                if (inProgressRow) fastify.io.emit('task_updated', {
                                    id: inProgressRow.id,
                                    title: inProgressRow.title ?? undefined,
                                    description: inProgressRow.description ?? undefined,
                                    status: inProgressRow.status as TaskStatus,
                                    priority: (inProgressRow.priority ?? undefined) as Task['priority'],
                                    agentId: inProgressRow.agentId ?? undefined,
                                    assignee_id: inProgressRow.assignee_id ?? undefined,
                                    createdAt: inProgressRow.createdAt,
                                    updatedAt: inProgressRow.updatedAt,
                                });
                                fastify.io.emit('activity_added', {
                                    id: successActivityId,
                                    taskId,
                                    agentId: assignedAgentId,
                                    message: `Agent '${assignedAgentId}' picked up the task and is now working on it.`,
                                    timestamp: successNow,
                                });
                            }
                        } catch (err: unknown) {
                            fastify.log.error(err, `recurringScheduler: spawnTaskSession failed for task ${newTask.id}`);
                            const errNow = new Date().toISOString();
                            const errMsg = err instanceof Error ? err.message : String(err);
                            const errActivityId = randomUUID();

                            const stuckRow = db.update(tasksTable).set({ status: 'STUCK', updatedAt: errNow })
                                .where(eq(tasksTable.id, taskId)).returning().get();

                            db.insert(activitiesTable).values({
                                id: errActivityId,
                                taskId,
                                agentId: assignedAgentId,
                                message: `error: Agent dispatch failed — ${errMsg}`,
                                timestamp: errNow,
                            }).run();

                            if (fastify.io) {
                                if (stuckRow) fastify.io.emit('task_updated', {
                                    id: stuckRow.id,
                                    title: stuckRow.title ?? undefined,
                                    description: stuckRow.description ?? undefined,
                                    status: stuckRow.status as TaskStatus,
                                    priority: (stuckRow.priority ?? undefined) as Task['priority'],
                                    agentId: stuckRow.agentId ?? undefined,
                                    assignee_id: stuckRow.assignee_id ?? undefined,
                                    createdAt: stuckRow.createdAt,
                                    updatedAt: stuckRow.updatedAt,
                                });
                                fastify.io.emit('activity_added', {
                                    id: errActivityId,
                                    taskId,
                                    agentId: assignedAgentId,
                                    message: `error: Agent dispatch failed — ${errMsg}`,
                                    timestamp: errNow,
                                });
                                fastify.io.emit('agent_error', { agentId: assignedAgentId, error: errMsg });
                            }
                        }
                    })();
                }
            }
        } catch (err: unknown) {
            fastify.log.error(`recurringSchedulerMonitor error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }, POLL_INTERVAL_MS);
}
