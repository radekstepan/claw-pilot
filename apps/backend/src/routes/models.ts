import { FastifyPluginAsync } from 'fastify';
import { getModels } from '../openclaw/cli.js';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const modelRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        try {
            const models = await getModels();

            // Map the raw models to a friendlier format if necessary, 
            // or just return the raw array from openclaw.
            // Assuming openclaw models list returns an array of objects
            // with at least id, name, provider, etc.
            return models;
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch models.' });
        }
    });
};

export default modelRoutes;
