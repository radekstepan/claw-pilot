import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import { ClientToServerEvents, ServerToClientEvents } from '@claw-pilot/shared-types';
import taskRoutes from './routes/tasks.js';
import chatRoutes from './routes/chat.js';
import agentRoutes from './routes/agents.js';
import { startSessionMonitor } from './monitors/sessionMonitor.js';
import { startStuckTaskMonitor } from './monitors/stuckTaskMonitor.js';

const fastify = Fastify({ logger: true });

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

        await fastify.listen({ port: 54321, host: '0.0.0.0' });

        console.log('Server listening on http://localhost:54321');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
