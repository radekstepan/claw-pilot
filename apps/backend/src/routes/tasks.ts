import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '@claw-pilot/shared-types';
import { randomUUID } from 'crypto';
import { routeChatToAgent } from '../openclaw/cli.js';

declare module 'fastify' {
    interface FastifyInstance {
        io: Server<ClientToServerEvents, ServerToClientEvents>;
    }
}

const taskRoutes: FastifyPluginAsync = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        return db.data.tasks;
    });

    fastify.post('/', async (request, reply) => {
        const body = request.body as any;
        const newTask = {
            id: randomUUID(),
            title: body.title || 'New Task',
            description: body.description || '',
            status: body.status || 'TODO',
            priority: body.priority || 'MEDIUM',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        db.data.tasks.push(newTask as any);
        await db.write();

        if (fastify.io) {
            fastify.io.emit('task_updated', newTask as any);
        }
        return reply.status(201).send(newTask);
    });

    fastify.patch('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const taskIndex = db.data.tasks.findIndex((t: any) => t.id === id);
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
            fastify.io.emit('task_updated', updatedTask as any);
        }
        return reply.send(updatedTask);
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };

        const initialLength = db.data.tasks.length;
        db.data.tasks = db.data.tasks.filter((t: any) => t.id !== id);

        if (db.data.tasks.length === initialLength) {
            return reply.status(404).send({ error: 'Task not found' });
        }
        await db.write();

        return reply.status(204).send();
    });

    fastify.post('/:id/activity', async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as any;

        const taskIndex = db.data.tasks.findIndex((t: any) => t.id === id);
        if (taskIndex === -1) {
            return reply.status(404).send({ error: 'Task not found' });
        }

        const task = db.data.tasks[taskIndex];
        let statusChanged = false;

        if (task.status === 'ASSIGNED') {
            task.status = 'IN_PROGRESS';
            statusChanged = true;
        }

        if (body.message && body.message.toLowerCase().includes('done')) {
            task.status = 'REVIEW';
            statusChanged = true;
            routeChatToAgent('main', `Task ${id} ready for review`).catch(console.error);
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
                fastify.io.emit('task_updated', task as any);
            }
        }

        return reply.status(201).send(newActivity);
    });
};

export default taskRoutes;
