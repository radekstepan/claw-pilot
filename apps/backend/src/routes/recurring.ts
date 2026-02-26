import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, recurringTasks as recurringTable, tasks as tasksTable, activities as activitiesTable } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { RecurringTaskSchema, RecurringTask, Task, TaskStatus } from '@claw-pilot/shared-types';
import { spawnTaskSession } from '../openclaw/cli.js';
import { env } from '../config/env.js';

const CreateRecurringSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    schedule_type: z.string(),
    schedule_value: z.string().optional(),
    assigned_agent_id: z.string().optional(),
});

const UpdateRecurringSchema = RecurringTaskSchema.partial();

type RecurringRow = typeof recurringTable.$inferSelect;

function rowToRecurring(row: RecurringRow): RecurringTask {
    return {
        id: row.id,
        title: row.title,
        description: row.description ?? undefined,
        schedule_type: row.schedule_type,
        schedule_value: row.schedule_value ?? undefined,
        assigned_agent_id: row.assigned_agent_id ?? undefined,
        status: row.status as RecurringTask['status'],
        last_triggered_at: row.last_triggered_at ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

const recurringRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.get('/', async (_request, _reply) => {
        const rows = db.select().from(recurringTable).all();
        return rows.map(rowToRecurring);
    });

    fastify.post('/', { schema: { body: CreateRecurringSchema } }, async (request, reply) => {
        const body = request.body as z.infer<typeof CreateRecurringSchema>;
        const now = new Date().toISOString();
        const id = randomUUID();

        db.insert(recurringTable).values({
            id,
            title: body.title,
            description: body.description ?? null,
            schedule_type: body.schedule_type,
            schedule_value: body.schedule_value ?? null,
            assigned_agent_id: body.assigned_agent_id ?? null,
            status: 'ACTIVE',
            last_triggered_at: null,
            createdAt: now,
            updatedAt: now,
        }).run();

        const row = db.select().from(recurringTable).where(eq(recurringTable.id, id)).get()!;
        return reply.status(201).send(rowToRecurring(row));
    });

    fastify.patch('/:id', { schema: { body: UpdateRecurringSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof UpdateRecurringSchema>;

        const existing = db.select().from(recurringTable).where(eq(recurringTable.id, id)).get();
        if (!existing) {
            return reply.status(404).send({ error: 'Recurring task not found' });
        }

        const updatedRow = db.update(recurringTable).set({
            title: body.title ?? existing.title,
            description: body.description !== undefined ? body.description : existing.description,
            schedule_type: body.schedule_type ?? existing.schedule_type,
            schedule_value: body.schedule_value !== undefined ? body.schedule_value : existing.schedule_value,
            assigned_agent_id: body.assigned_agent_id !== undefined ? (body.assigned_agent_id ?? null) : existing.assigned_agent_id,
            status: body.status ?? existing.status,
            updatedAt: new Date().toISOString(),
        }).where(eq(recurringTable.id, id)).returning().get()!;

        return reply.send(rowToRecurring(updatedRow));
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const existing = db.select({ id: recurringTable.id }).from(recurringTable).where(eq(recurringTable.id, id)).get();
        if (!existing) {
            return reply.status(404).send({ error: 'Recurring task not found' });
        }

        db.delete(recurringTable).where(eq(recurringTable.id, id)).run();
        return reply.status(204).send();
    });

    fastify.post('/:id/trigger', async (request, reply) => {
        const { id } = request.params as { id: string };

        const recurringTask = db.select().from(recurringTable).where(eq(recurringTable.id, id)).get();
        if (!recurringTask) {
            return reply.status(404).send({ error: 'Recurring task not found' });
        }

        if (recurringTask.status === 'PAUSED') {
            return reply.status(409).send({ error: 'Cannot trigger a paused recurring task' });
        }

        const now = new Date().toISOString();
        const assignedAgentId = recurringTask.assigned_agent_id ?? null;
        const newTask: Task = {
            id: randomUUID(),
            title: recurringTask.title ?? 'Triggered Task',
            description: recurringTask.description ?? `Auto-generated from recurring template: ${recurringTask.title}`,
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

        // Record when this template was last triggered
        db.update(recurringTable).set({ last_triggered_at: now, updatedAt: now })
            .where(eq(recurringTable.id, id)).run();

        if (fastify.io) {
            fastify.io.emit('task_created', { id: newTask.id, title: newTask.title });
            fastify.io.emit('task_updated', newTask);
        }

        if (!assignedAgentId) {
            // No pre-assigned agent — task sits in TODO for manual routing
            return reply.status(201).send(newTask);
        }

        // Pre-assigned agent: write a routing activity log and dispatch async
        const routeActivityId = randomUUID();
        db.insert(activitiesTable).values({
            id: routeActivityId,
            taskId: newTask.id,
            agentId: 'system',
            message: `Task auto-routed to agent '${assignedAgentId}' from recurring template '${recurringTask.title}' — dispatching…`,
            timestamp: now,
        }).run();

        if (fastify.io) {
            fastify.io.emit('activity_added', {
                id: routeActivityId,
                taskId: newTask.id,
                agentId: 'system',
                message: `Task auto-routed to agent '${assignedAgentId}' from recurring template '${recurringTask.title}' — dispatching…`,
                timestamp: now,
            });
        }

        // Return 202 — the heavy AI dispatch runs detached
        reply.status(202).send({ id: newTask.id, status: 'pending' });

        const baseUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT}`;
        const callbackUrl = `${baseUrl}/api/tasks/${newTask.id}/activity`;
        const taskContext = [
            [newTask.title, newTask.description].filter(Boolean).join('\n\n'),
            `---`,
            `TASK METADATA (do not include in your work output):`,
            `taskId: ${newTask.id}`,
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
                await spawnTaskSession(assignedAgentId, newTask.id, taskContext);

                const successNow = new Date().toISOString();
                const successActivityId = randomUUID();

                const inProgressRow = db.update(tasksTable).set({
                    status: 'IN_PROGRESS',
                    updatedAt: successNow,
                }).where(eq(tasksTable.id, newTask.id)).returning().get();

                db.insert(activitiesTable).values({
                    id: successActivityId,
                    taskId: newTask.id,
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
                        taskId: newTask.id,
                        agentId: assignedAgentId,
                        message: `Agent '${assignedAgentId}' picked up the task and is now working on it.`,
                        timestamp: successNow,
                    });
                }
            } catch (err: unknown) {
                fastify.log.error(err, `spawnTaskSession failed for auto-routed recurring task ${newTask.id}`);
                const errNow = new Date().toISOString();
                const errMsg = err instanceof Error ? err.message : String(err);
                const errActivityId = randomUUID();

                const stuckRow = db.update(tasksTable).set({ status: 'STUCK', updatedAt: errNow })
                    .where(eq(tasksTable.id, newTask.id)).returning().get();

                db.insert(activitiesTable).values({
                    id: errActivityId,
                    taskId: newTask.id,
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
                        taskId: newTask.id,
                        agentId: assignedAgentId,
                        message: `error: Agent dispatch failed — ${errMsg}`,
                        timestamp: errNow,
                    });
                    fastify.io.emit('agent_error', { agentId: assignedAgentId, error: errMsg });
                }
            }
        })();
    });
};

export default recurringRoutes;
