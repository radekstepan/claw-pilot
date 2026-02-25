import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { AppConfigSchema } from '@claw-pilot/shared-types';
import { db } from '../db.js';

const configRoutes: FastifyPluginAsyncZod = async (fastify) => {
    fastify.get('/', async (_request, reply) => {
        return reply.send(db.data.config);
    });

    fastify.post('/', { schema: { body: AppConfigSchema.partial() } }, async (request, reply) => {
        const patch = request.body;
        Object.assign(db.data.config, patch);
        await db.write();
        return reply.send(db.data.config);
    });
};

export default configRoutes;
