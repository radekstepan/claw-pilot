import { FastifyPluginAsync } from 'fastify';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { db } from '../db.js';

const deliverableRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.patch('/:id/complete', async (request, reply) => {
        const { id } = request.params as { id: string };

        let foundDeliverable = null;
        let parentTaskIndex = -1;

        for (let i = 0; i < db.data.tasks.length; i++) {
            const task = db.data.tasks[i];
            if (task.deliverables) {
                const dIndex = task.deliverables.findIndex((d) => d.id === id);
                if (dIndex !== -1) {
                    foundDeliverable = task.deliverables[dIndex];
                    parentTaskIndex = i;

                    // Toggle status
                    foundDeliverable.status = foundDeliverable.status === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
                    break;
                }
            }
        }

        if (!foundDeliverable) {
            return reply.status(404).send({ error: 'Deliverable not found' });
        }

        const task = db.data.tasks[parentTaskIndex];
        task.updatedAt = new Date().toISOString();

        await db.write();

        if (fastify.io) {
            fastify.io.emit('task_updated', task);
        }

        return reply.send(foundDeliverable);
    });
};

export default deliverableRoutes;
