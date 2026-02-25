/**
 * app.ts — Fastify application factory.
 *
 * Exports `buildApp()` so the production entry-point (index.ts) and integration
 * tests alike can obtain a fully-configured Fastify instance without binding
 * to a TCP port or starting background monitors.
 */
import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { authHook } from './middleware/auth.js';
import { env } from './config/env.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Route plugins
import taskRoutes from './routes/tasks.js';
import chatRoutes from './routes/chat.js';
import agentRoutes from './routes/agents.js';
import modelRoutes from './routes/models.js';
import deliverableRoutes from './routes/deliverables.js';
import recurringRoutes from './routes/recurring.js';
import systemRoutes from './routes/system.js';
import activityRoutes from './routes/activities.js';

export async function buildApp(): Promise<FastifyInstance> {
    const fastify = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

    fastify.setValidatorCompiler(validatorCompiler);
    fastify.setSerializerCompiler(serializerCompiler);

    // CORS — restricted to the configured frontend origin.
    await fastify.register(cors, {
        origin: env.ALLOWED_ORIGIN,
    });

    // Global rate limit: 100 requests per minute per IP.
    await fastify.register(rateLimit, {
        max: 100,
        timeWindow: '1 minute',
    });

    // Public health-check (no auth required) — registered BEFORE the auth hook.
    fastify.get('/', async (_request, _reply) => {
        return { status: 'ClawController Gateway API Nominal' };
    });

    // Bearer-token auth enforced on all routes registered after this point.
    fastify.addHook('onRequest', authHook);

    // ---------------------------------------------------------------------------
    // Global error handler — logs full details server-side, returns sanitised JSON
    // so internal stack traces are never exposed in responses.
    // ---------------------------------------------------------------------------
    fastify.setErrorHandler((error: FastifyError, request, reply) => {
        fastify.log.error({ err: error, url: request.url, method: request.method }, 'Unhandled error');

        // Fastify / Zod schema validation errors → 400 with field details
        if (error.validation) {
            return reply.status(400).send({
                statusCode: 400,
                error: 'Bad Request',
                message: error.message,
            });
        }

        const statusCode = error.statusCode ?? 500;
        const isServerError = statusCode >= 500;

        // Mask internal messages in production to avoid leaking implementation details.
        const message =
            isServerError && env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;

        return reply.status(statusCode).send({
            statusCode,
            error: error.name || 'Error',
            message,
        });
    });

    // ---------------------------------------------------------------------------
    // Route registrations
    // ---------------------------------------------------------------------------
    fastify.register(taskRoutes, { prefix: '/api/tasks' });
    fastify.register(chatRoutes, { prefix: '/api/chat' });
    fastify.register(agentRoutes, { prefix: '/api/agents' });
    fastify.register(modelRoutes, { prefix: '/api/models' });
    fastify.register(deliverableRoutes, { prefix: '/api/deliverables' });
    fastify.register(recurringRoutes, { prefix: '/api/recurring' });
    fastify.register(systemRoutes, { prefix: '/api' });
    fastify.register(activityRoutes, { prefix: '/api/activities' });

    // ---------------------------------------------------------------------------
    // Production static serving — serve the pre-built Vite frontend from
    // apps/frontend/dist when NODE_ENV=production.
    // In development the Vite dev server runs separately on port 5173.
    // ---------------------------------------------------------------------------
    if (env.NODE_ENV === 'production') {
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const frontendDist = path.resolve(__dirname, '../../frontend/dist');

        await fastify.register(staticPlugin, {
            root: frontendDist,
            prefix: '/',
            // Serve index.html for any unknown route so the React SPA handles routing.
            wildcard: false,
        });

        // SPA catch-all: any non-asset, non-API path serves index.html.
        fastify.setNotFoundHandler((_request, reply) => {
            return reply.sendFile('index.html');
        });
    }

    return fastify;
}
