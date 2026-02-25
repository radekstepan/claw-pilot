import { FastifyPluginAsync } from 'fastify';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db } from '../db.js';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents, CreateTaskSchema, UpdateTaskSchema, CreateTaskPayload, UpdateTaskPayload, OffsetPageQuerySchema, Task, Deliverable } from '@claw-pilot/shared-types';
import { randomUUID } from 'crypto';
import { routeChatToAgent } from '../openclaw/cli.js';
import { z } from 'zod';

declare module 'fastify' {
    interface FastifyInstance {
        io: Server<ClientToServerEvents, ServerToClientEvents>;
    }
}

const taskRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    // GET /api/tasks?limit=200&offset=0
    fastify.get('/', { schema: { querystring: OffsetPageQuerySchema } }, async (request, reply) => {
        const q = request.query as { limit: number; offset: number };
        const { limit, offset } = q;
        const all = db.data.tasks;
        const data = all.slice(offset, offset + limit);
        return { data, total: all.length };
    });

    fastify.post('/', { schema: { body: CreateTaskSchema } }, async (request, reply) => {
        const body = request.body as CreateTaskPayload;
        const newTask: Task = {
            id: randomUUID(),
            title: body.title ?? 'New Task',
            description: body.description ?? '',
            status: body.status ?? 'TODO',
            priority: body.priority ?? 'MEDIUM',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        db.data.tasks.push(newTask);
        await db.write();

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

        const taskIndex = db.data.tasks.findIndex((t) => t.id === id);
        if (taskIndex === -1) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const updatedTask = {
            ...db.data.tasks[taskIndex],
            ...body,
            updatedAt: new Date().toISOString()
        };
        db.data.tasks[taskIndex] = updatedTask;
        await db.write();

        if (fastify.io) {
            fastify.io.emit('task_updated', updatedTask);
        }
        return reply.send(updatedTask);
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const initialLength = db.data.tasks.length;
        db.data.tasks = db.data.tasks.filter((t) => t.id !== id);

        if (db.data.tasks.length === initialLength) {
            return reply.status(404).send({ error: 'Task not found' });
        }
        await db.write();

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

        const taskIndex = db.data.tasks.findIndex((t) => t.id === id);
        if (taskIndex === -1) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const task = db.data.tasks[taskIndex];
        let statusChanged = false;

        if (task.status === 'ASSIGNED') {
            task.status = 'IN_PROGRESS';
            statusChanged = true;
        }

        if (body.message && (body.message.toLowerCase().includes('done') || body.message.toLowerCase().includes('completed'))) {
            task.status = 'REVIEW';
            statusChanged = true;
            void routeChatToAgent('main', `Task ${id} ready for review`).catch((err: unknown) => {
                fastify.io.emit('agent_error', {
                    agentId: 'main',
                    error: err instanceof Error ? err.message : String(err),
                });
            });
        }

        if (statusChanged) {
            task.updatedAt = new Date().toISOString();
            db.data.tasks[taskIndex] = task;
        }

        const newActivity = {
            id: randomUUID(),
            taskId: id,
            agentId: body.agentId,
            message: body.message,
            timestamp: new Date().toISOString()
        };
        db.data.activities.push(newActivity);

        await db.write();

        if (fastify.io) {
            fastify.io.emit('activity_added', newActivity);
            if (statusChanged) {
                fastify.io.emit('task_updated', task);
            }
        }

        return reply.status(201).send(newActivity);
    });

    const CreateDeliverableSchema = z.object({
        title: z.string(),
        file_path: z.string().optional()
    });

    fastify.post('/:id/deliverables', { schema: { body: CreateDeliverableSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof CreateDeliverableSchema>;

        const taskIndex = db.data.tasks.findIndex((t) => t.id === id);
        if (taskIndex === -1) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const task = db.data.tasks[taskIndex];
        const newDeliverable: Deliverable = {
            id: randomUUID(),
            taskId: id,
            title: body.title,
            file_path: body.file_path,
            status: 'PENDING',
        };

        task.deliverables = task.deliverables ?? [];
        task.deliverables.push(newDeliverable);
        task.updatedAt = new Date().toISOString();

        await db.write();

        if (fastify.io) {
            fastify.io.emit('task_updated', task);
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

        const taskIndex = db.data.tasks.findIndex((t) => t.id === id);
        if (taskIndex === -1) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const task = db.data.tasks[taskIndex];

        if (body.action === 'approve') {
            task.status = 'DONE';
        } else {
            task.status = 'IN_PROGRESS';
            if (body.feedback) {
                // Determine agent ID dynamically if stored in task, else 'main'
                const assignedAgentId = task.agentId ?? 'main';
                void routeChatToAgent(assignedAgentId, `Review Feedback for task ${id}: ${body.feedback}`).catch((err: unknown) => {
                    fastify.io.emit('agent_error', {
                        agentId: assignedAgentId,
                        error: err instanceof Error ? err.message : String(err),
                    });
                });

                const newActivity = {
                    id: randomUUID(),
                    taskId: id,
                    agentId: 'system',
                    message: `Review rejected with feedback: ${body.feedback}`,
                    timestamp: new Date().toISOString()
                };
                db.data.activities.push(newActivity);
                if (fastify.io) {
                    fastify.io.emit('activity_added', newActivity);
                }
            }
        }

        task.updatedAt = new Date().toISOString();
        db.data.tasks[taskIndex] = task;
        await db.write();

        if (fastify.io) {
            fastify.io.emit('task_reviewed', { id, action: body.action });
            fastify.io.emit('task_updated', task);
        }

        return reply.send(task);
    });
};

export default taskRoutes;
