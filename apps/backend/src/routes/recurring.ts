import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, recurringTasks as recurringTable, tasks as tasksTable } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { RecurringTaskSchema, RecurringTask, Task } from '@claw-pilot/shared-types';

const CreateRecurringSchema = z.object({
    title: z.string(),
    schedule_type: z.string(),
    schedule_value: z.string().optional()
});

const UpdateRecurringSchema = RecurringTaskSchema.partial();

type RecurringRow = typeof recurringTable.$inferSelect;

function rowToRecurring(row: RecurringRow): RecurringTask {
    return {
        id: row.id,
        title: row.title,
        schedule_type: row.schedule_type,
        schedule_value: row.schedule_value ?? undefined,
        status: row.status as RecurringTask['status'],
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
            schedule_type: body.schedule_type,
            schedule_value: body.schedule_value ?? null,
            status: 'ACTIVE',
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
            schedule_type: body.schedule_type ?? existing.schedule_type,
            schedule_value: body.schedule_value ?? existing.schedule_value,
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
        const newTask: Task = {
            id: randomUUID(),
            title: recurringTask.title ?? 'Triggered Task',
            description: `Auto-generated from recurring template: ${recurringTask.title}`,
            status: 'TODO',
            priority: 'MEDIUM',
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
            agentId: null,
            deliverables: null,
            createdAt: now,
            updatedAt: now,
        }).run();

        if (fastify.io) {
            fastify.io.emit('task_created', { id: newTask.id, title: newTask.title });
            fastify.io.emit('task_updated', newTask);
        }

        return reply.status(201).send(newTask);
    });
};

export default recurringRoutes;
