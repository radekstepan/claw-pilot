import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db, tasks as tasksTable } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { Deliverable, Task } from '@claw-pilot/shared-types';

function rowToTask(row: typeof tasksTable.$inferSelect): Task {
    return {
        id: row.id,
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        status: row.status as Task['status'],
        priority: row.priority as Task['priority'] ?? undefined,
        tags: row.tags ?? undefined,
        assignee_id: row.assignee_id ?? undefined,
        agentId: row.agentId ?? undefined,
        deliverables: row.deliverables ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

const deliverableRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.patch('/:id/complete', async (request, reply) => {
        const { id } = request.params as { id: string };

        // Find the task that owns this deliverable.
        const allTasks = db.select().from(tasksTable).all();

        let foundDeliverable: Deliverable | null = null;
        let ownerTaskId: string | null = null;

        for (const taskRow of allTasks) {
            const deliverables = taskRow.deliverables;
            if (deliverables) {
                const d = deliverables.find((d) => d.id === id);
                if (d) {
                    foundDeliverable = { ...d };
                    ownerTaskId = taskRow.id;
                    break;
                }
            }
        }

        if (!foundDeliverable || !ownerTaskId) {
            return reply.status(404).send({ error: 'Deliverable not found' });
        }

        // Toggle status.
        foundDeliverable.status = foundDeliverable.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';

        const now = new Date().toISOString();
        const taskRow = db.select().from(tasksTable).where(eq(tasksTable.id, ownerTaskId)).get()!;
        const deliverables = taskRow.deliverables ?? [];
        const idx = deliverables.findIndex((d) => d.id === id);
        if (idx !== -1) deliverables[idx] = foundDeliverable;

        const updatedRow = db.update(tasksTable).set({
            deliverables: deliverables,
            updatedAt: now,
        }).where(eq(tasksTable.id, ownerTaskId)).returning().get();

        if (fastify.io && updatedRow) {
            fastify.io.emit('task_updated', rowToTask(updatedRow));
        }

        return reply.send(foundDeliverable);
    });
};

export default deliverableRoutes;
