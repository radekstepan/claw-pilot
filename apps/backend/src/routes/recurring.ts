import { FastifyPluginAsync } from 'fastify';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db } from '../db.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { RecurringTaskSchema } from '@claw-pilot/shared-types';

const CreateRecurringSchema = z.object({
    title: z.string(),
    schedule_type: z.string(),
    schedule_value: z.string().optional()
});

const UpdateRecurringSchema = RecurringTaskSchema.partial();

const recurringRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        return db.data.recurring;
    });

    fastify.post('/', { schema: { body: CreateRecurringSchema } }, async (request, reply) => {
        const body = request.body as z.infer<typeof CreateRecurringSchema>;

        const newTask = {
            id: randomUUID(),
            title: body.title,
            schedule_type: body.schedule_type,
            schedule_value: body.schedule_value,
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        db.data.recurring.push(newTask as any);
        await db.write();

        return reply.status(201).send(newTask);
    });

    fastify.patch('/:id', { schema: { body: UpdateRecurringSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof UpdateRecurringSchema>;

        const index = db.data.recurring.findIndex((t: any) => t.id === id);
        if (index === -1) {
            return reply.status(404).send({ error: 'Recurring task not found' });
        }

        const updated = Object.assign({}, db.data.recurring[index], body, {
            updatedAt: new Date().toISOString()
        });
        db.data.recurring[index] = updated;
        await db.write();

        return reply.send(updated);
    });

    fastify.post('/:id/trigger', async (request, reply) => {
        const { id } = request.params as { id: string };

        const recurringTask = db.data.recurring.find((t: any) => t.id === id);
        if (!recurringTask) {
            return reply.status(404).send({ error: 'Recurring task not found' });
        }

        const newTask = {
            id: randomUUID(),
            title: recurringTask.title || 'Triggered Task',
            description: `Auto-generated from recurring template: ${recurringTask.title}`,
            status: 'TODO', // Use the standard strings instead of imported enums if undefined
            priority: 'MEDIUM',
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
};

export default recurringRoutes;
