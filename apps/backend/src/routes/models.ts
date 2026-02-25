import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getModels, GatewayOfflineError } from '../openclaw/cli.js';
import { env } from '../config/env.js';

const modelRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        try {
            const models = await getModels();
            return models;
        } catch (error) {
            if (error instanceof GatewayOfflineError) {
                fastify.log.warn(`[models] ${(error as Error).message}`);
                return reply.status(503).send({
                    error: 'OpenClaw gateway is unreachable. Model list unavailable.',
                    gatewayUrl: env.OPENCLAW_GATEWAY_URL,
                });
            }
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch models.' });
        }
    });
};

export default modelRoutes;
