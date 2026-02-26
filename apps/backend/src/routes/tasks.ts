import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, tasks as tasksTable, activities as activitiesTable, parseJsonField, stringifyJsonField } from '../db/index.js';
import { eq, count, desc } from 'drizzle-orm';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents, CreateTaskSchema, UpdateTaskSchema, CreateTaskPayload, UpdateTaskPayload, OffsetPageQuerySchema, Task, Deliverable, ActivityLog } from '@claw-pilot/shared-types';
import { randomUUID } from 'crypto';
import { routeChatToAgent, spawnTaskSession } from '../openclaw/cli.js';
import { env } from '../config/env.js';
import { z } from 'zod';

declare module 'fastify' {
    interface FastifyInstance {
        io: Server<ClientToServerEvents, ServerToClientEvents>;
    }
}

// ---------------------------------------------------------------------------
// Row ↔ domain-object mappers
// ---------------------------------------------------------------------------

type TaskRow = typeof tasksTable.$inferSelect;

function rowToTask(row: TaskRow): Task {
    return {
        id: row.id,
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        status: row.status as Task['status'],
        priority: row.priority as Task['priority'] ?? undefined,
        tags: parseJsonField<string[]>(row.tags),
        assignee_id: row.assignee_id ?? undefined,
        agentId: row.agentId ?? undefined,
        deliverables: parseJsonField<Deliverable[]>(row.deliverables),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function activityRowToLog(row: { id: string; taskId: string | null; agentId: string | null; message: string; timestamp: string }): ActivityLog {
    return {
        id: row.id,
        taskId: row.taskId ?? '',
        agentId: row.agentId ?? undefined,
        message: row.message,
        timestamp: row.timestamp,
    };
}

const taskRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    // GET /api/tasks?limit=200&offset=0
    fastify.get('/', { schema: { querystring: OffsetPageQuerySchema } }, async (request, reply) => {
        const q = request.query as { limit: number; offset: number };
        const { limit, offset } = q;

        const [{ total }] = db.select({ total: count() }).from(tasksTable).all();
        const rows = db.select().from(tasksTable).limit(limit).offset(offset).all();

        return { data: rows.map(rowToTask), total };
    });

    fastify.post('/', { schema: { body: CreateTaskSchema } }, async (request, reply) => {
        const body = request.body as CreateTaskPayload;
        const now = new Date().toISOString();
        const newTask: Task = {
            id: randomUUID(),
            title: body.title ?? 'New Task',
            description: body.description ?? '',
            status: body.status ?? 'TODO',
            priority: body.priority ?? 'MEDIUM',
            assignee_id: body.assignee_id,
            createdAt: now,
            updatedAt: now,
        };

        db.insert(tasksTable).values({
            id: newTask.id,
            title: newTask.title ?? null,
            description: newTask.description ?? null,
            status: newTask.status,
            priority: newTask.priority ?? null,
            tags: stringifyJsonField(newTask.tags),
            assignee_id: newTask.assignee_id ?? null,
            agentId: null,
            deliverables: null,
            createdAt: newTask.createdAt!,
            updatedAt: newTask.updatedAt!,
        }).run();

        if (fastify.io) {
            fastify.io.emit('task_created', { id: newTask.id, title: newTask.title });
            fastify.io.emit('task_updated', newTask);
        }
        return reply.status(201).send(newTask);
    });

    fastify.patch('/:id', { schema: { body: UpdateTaskSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as UpdateTaskPayload;

        if (body.agentId && body.status === 'DONE') {
            return reply.status(403).send({ error: 'AI agents are not allowed to mark tasks as DONE. They must be put in REVIEW.' });
        }

        const existing = db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
        if (!existing) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const updatedRow = db.update(tasksTable).set({
            title: body.title ?? existing.title,
            description: body.description ?? existing.description,
            status: body.status ?? existing.status,
            priority: body.priority ?? existing.priority,
            tags: body.tags !== undefined ? stringifyJsonField(body.tags) : existing.tags,
            assignee_id: body.assignee_id ?? existing.assignee_id,
            agentId: body.agentId ?? existing.agentId,
            updatedAt: new Date().toISOString(),
        }).where(eq(tasksTable.id, id)).returning().get();

        if (!updatedRow) return reply.status(404).send({ error: 'Task not found' });

        const updatedTask = rowToTask(updatedRow);
        if (fastify.io) {
            fastify.io.emit('task_updated', updatedTask);
        }
        return reply.send(updatedTask);
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const existing = db.select({ id: tasksTable.id }).from(tasksTable).where(eq(tasksTable.id, id)).get();
        if (!existing) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        db.delete(tasksTable).where(eq(tasksTable.id, id)).run();

        if (fastify.io) {
            fastify.io.emit('task_deleted', { id });
        }
        return reply.status(204).send();
    });

    const ActivityPayloadSchema = z.object({
        agentId: z.string().optional(),
        message: z.string()
    });

    fastify.post('/:id/activity', { schema: { body: ActivityPayloadSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof ActivityPayloadSchema>;

        const taskRow = db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
        if (!taskRow) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        let newStatus: string | undefined;

        if (taskRow.status === 'ASSIGNED') {
            newStatus = 'IN_PROGRESS';
        }

        if (body.message && (body.message.toLowerCase().includes('done') || body.message.toLowerCase().includes('completed'))) {
            newStatus = 'REVIEW';
            void routeChatToAgent('main', `Task ${id} ready for review`).catch((err: unknown) => {
                fastify.io?.emit('agent_error', {
                    agentId: 'main',
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }

        const now = new Date().toISOString();

        const newActivityRow = {
            id: randomUUID(),
            taskId: id,
            agentId: body.agentId ?? null,
            message: body.message,
            timestamp: now,
        };

        const updatedTaskRow = db.transaction(() => {
            if (newStatus) {
                db.update(tasksTable).set({ status: newStatus, updatedAt: now }).where(eq(tasksTable.id, id)).run();
            }
            db.insert(activitiesTable).values(newActivityRow).run();
            return db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
        });

        const newActivity = activityRowToLog(newActivityRow);

        if (fastify.io) {
            fastify.io.emit('activity_added', newActivity);
            if (newStatus && updatedTaskRow) {
                fastify.io.emit('task_updated', rowToTask(updatedTaskRow));
            }
        }

        return reply.status(201).send(newActivity);
    });

    // POST /api/tasks/:id/route — dispatch a task to an AI agent via spawnTaskSession
    const RouteTaskSchema = z.object({
        agentId: z.string(),
        prompt: z.string().optional(),
    });

    fastify.post('/:id/route', { schema: { body: RouteTaskSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof RouteTaskSchema>;

        const taskRow = db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
        if (!taskRow) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        if (taskRow.status === 'IN_PROGRESS' || taskRow.status === 'REVIEW' || taskRow.status === 'DONE') {
            return reply.status(409).send({ error: `Task is already in '${taskRow.status}' state and cannot be re-routed.` });
        }

        const now = new Date().toISOString();

        // Persist agentId + ASSIGNED status synchronously before returning
        const updatedRow = db.update(tasksTable).set({
            agentId: body.agentId,
            status: 'ASSIGNED',
            updatedAt: now,
        }).where(eq(tasksTable.id, id)).returning().get();

        if (!updatedRow) return reply.status(404).send({ error: 'Task not found' });

        const updatedTask = rowToTask(updatedRow);

        // Persist the routing activity log
        const routeActivityId = randomUUID();
        db.insert(activitiesTable).values({
            id: routeActivityId,
            taskId: id,
            agentId: 'system',
            message: `Task routed to agent '${body.agentId}' — dispatching…`,
            timestamp: now,
        }).run();

        if (fastify.io) {
            fastify.io.emit('task_updated', updatedTask);
            fastify.io.emit('activity_added', {
                id: routeActivityId,
                taskId: id,
                agentId: 'system',
                message: `Task routed to agent '${body.agentId}' — dispatching…`,
                timestamp: now,
            });
        }

        // Return 202 immediately — the heavy AI work runs detached
        reply.status(202).send({ id, status: 'pending' });

        const baseUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT}`;
        const callbackUrl = `${baseUrl}/api/tasks/${id}/activity`;
        const taskContext = [
            body.prompt ?? [taskRow.title, taskRow.description].filter(Boolean).join('\n\n'),
            `---`,
            `TASK METADATA (do not include in your work output):`,
            `taskId: ${id}`,
            `When you have finished, report your result by calling:`,
            `  POST ${callbackUrl}`,
            `  Authorization: Bearer ${env.API_KEY}`,
            `  Content-Type: application/json`,
            `  Body: { "agent_id": "${body.agentId}", "message": "completed: <your summary>" }`,
            `The word "completed" in the message is required to move this task to Review.`,
            `On error use: { "agent_id": "${body.agentId}", "message": "error: <description>" }`,
        ].join('\n');
        const prompt = taskContext;

        void (async () => {
            try {
                await spawnTaskSession(body.agentId, id, prompt);

                const successNow = new Date().toISOString();
                const successActivityId = randomUUID();

                // Transition to IN_PROGRESS
                const inProgressRow = db.update(tasksTable).set({
                    status: 'IN_PROGRESS',
                    updatedAt: successNow,
                }).where(eq(tasksTable.id, id)).returning().get();

                db.insert(activitiesTable).values({
                    id: successActivityId,
                    taskId: id,
                    agentId: body.agentId,
                    message: `Agent '${body.agentId}' picked up the task and is now working on it.`,
                    timestamp: successNow,
                }).run();

                if (fastify.io) {
                    if (inProgressRow) fastify.io.emit('task_updated', rowToTask(inProgressRow));
                    fastify.io.emit('activity_added', {
                        id: successActivityId,
                        taskId: id,
                        agentId: body.agentId,
                        message: `Agent '${body.agentId}' picked up the task and is now working on it.`,
                        timestamp: successNow,
                    });
                }
            } catch (err: unknown) {
                fastify.log.error(err, `spawnTaskSession failed for task ${id}`);
                fastify.io?.emit('agent_error', {
                    agentId: body.agentId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        })();
    });

    const CreateDeliverableSchema = z.object({
        title: z.string(),
        file_path: z.string().optional()
    });

    fastify.post('/:id/deliverables', { schema: { body: CreateDeliverableSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof CreateDeliverableSchema>;

        const taskRow = db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
        if (!taskRow) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const existingDeliverables = parseJsonField<Deliverable[]>(taskRow.deliverables) ?? [];
        const newDeliverable: Deliverable = {
            id: randomUUID(),
            taskId: id,
            title: body.title,
            file_path: body.file_path,
            status: 'PENDING',
        };

        existingDeliverables.push(newDeliverable);
        const now = new Date().toISOString();

        const updatedRow = db.update(tasksTable).set({
            deliverables: stringifyJsonField(existingDeliverables),
            updatedAt: now,
        }).where(eq(tasksTable.id, id)).returning().get();

        if (fastify.io && updatedRow) {
            fastify.io.emit('task_updated', rowToTask(updatedRow));
        }

        return reply.status(201).send(newDeliverable);
    });

    const ReviewTaskSchema = z.object({
        action: z.enum(['approve', 'reject']),
        feedback: z.string().optional()
    });

    fastify.post('/:id/review', { schema: { body: ReviewTaskSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof ReviewTaskSchema>;

        const taskRow = db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
        if (!taskRow) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const newStatus = body.action === 'approve' ? 'DONE' : 'IN_PROGRESS';
        const now = new Date().toISOString();

        const updatedRow = db.transaction(() => {
            db.update(tasksTable).set({ status: newStatus, updatedAt: now }).where(eq(tasksTable.id, id)).run();

            if (body.action === 'reject' && body.feedback) {
                const assignedAgentId = taskRow.agentId ?? 'main';
                void routeChatToAgent(assignedAgentId, `Review Feedback for task ${id}: ${body.feedback}`).catch((err: unknown) => {
                    fastify.io?.emit('agent_error', {
                        agentId: assignedAgentId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                });

                db.insert(activitiesTable).values({
                    id: randomUUID(),
                    taskId: id,
                    agentId: 'system',
                    message: `Review rejected with feedback: ${body.feedback}`,
                    timestamp: now,
                }).run();
            }

            return db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
        });

        const updatedTask = updatedRow ? rowToTask(updatedRow) : rowToTask({ ...taskRow, status: newStatus, updatedAt: now });

        if (fastify.io) {
            fastify.io.emit('task_reviewed', { id, action: body.action });
            fastify.io.emit('task_updated', updatedTask);
            if (body.action === 'reject' && body.feedback) {
                const activityLog: ActivityLog = {
                    id: randomUUID(),
                    taskId: id,
                    agentId: 'system',
                    message: `Review rejected with feedback: ${body.feedback}`,
                    timestamp: now,
                };
                fastify.io.emit('activity_added', activityLog);
            }
        }

        return reply.send(updatedTask);
    });
};

export default taskRoutes;
