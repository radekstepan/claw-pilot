import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '@claw-pilot/shared-types';
import taskRoutes from './routes/tasks.js';
import chatRoutes from './routes/chat.js';
import agentRoutes from './routes/agents.js';
import modelRoutes from './routes/models.js';
import deliverableRoutes from './routes/deliverables.js';
import recurringRoutes from './routes/recurring.js';
import systemRoutes from './routes/system.js';
import { startSessionMonitor } from './monitors/sessionMonitor.js';
import { startStuckTaskMonitor } from './monitors/stuckTaskMonitor.js';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';

const fastify = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

fastify.setValidatorCompiler(validatorCompiler);
fastify.setSerializerCompiler(serializerCompiler);

await fastify.register(cors, {
    origin: '*',
});

fastify.get('/', async (request, reply) => {
    return { status: 'ClawController Gateway API Nominal' };
});

const start = async () => {
    try {
        const io = new Server<ClientToServerEvents, ServerToClientEvents>(fastify.server, {
            cors: {
                origin: '*'
            }
        });

        fastify.decorate('io', io);

        io.on('connection', (socket) => {
            fastify.log.info(`Socket connected: ${socket.id}`);
            socket.on('disconnect', () => {
                fastify.log.info(`Socket disconnected: ${socket.id}`);
            });
        });

        startSessionMonitor(fastify);
        startStuckTaskMonitor(fastify);

        fastify.register(taskRoutes, { prefix: '/api/tasks' });
        fastify.register(chatRoutes, { prefix: '/api/chat' });
        fastify.register(agentRoutes, { prefix: '/api/agents' });
        fastify.register(modelRoutes, { prefix: '/api/models' });
        fastify.register(deliverableRoutes, { prefix: '/api/deliverables' });
        fastify.register(recurringRoutes, { prefix: '/api/recurring' });
        fastify.register(systemRoutes, { prefix: '/api' });

        const port = parseInt(process.env.PORT ?? '54321', 10);
        await fastify.listen({ port, host: '0.0.0.0' });

        console.log(`Server listening on http://localhost:${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
