import { FastifyPluginAsync } from 'fastify';
import { db, tasks as tasksTable } from '../db/index.js';
import { eq, or, and, count, lt, like } from 'drizzle-orm';
import { getAgents, getLiveSessions, gatewayCall } from '../openclaw/cli.js';

const systemRoutes: FastifyPluginAsync = async (fastify, opts) => {
    fastify.get('/stats', async (request, reply) => {
        try {
            const agents = await getAgents();
            const activeSessions = await getLiveSessions();

            const [{ tasksInQueue }] = db
                .select({ tasksInQueue: count() })
                .from(tasksTable)
                .where(or(eq(tasksTable.status, 'TODO'), eq(tasksTable.status, 'BACKLOG')))
                .all();

            const today = new Date().toISOString().split('T')[0]!;
            const [{ completedToday }] = db
                .select({ completedToday: count() })
                .from(tasksTable)
                .where(and(eq(tasksTable.status, 'DONE'), like(tasksTable.updatedAt, `${today}%`)))
                .all();

            return reply.send({
                activeAgents: activeSessions.length,
                totalAgents: agents.length,
                tasksInQueue,
                completedToday
            });
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch stats.' });
        }
    });

    fastify.get('/monitoring/gateway/status', async (request, reply) => {
        try {
            const health = await gatewayCall('health', {});
            return reply.send({ status: 'HEALTHY', detail: health });
        } catch (e) {
            return reply.send({ status: 'DOWN', error: e instanceof Error ? e.message : String(e) });
        }
    });

    fastify.post('/monitoring/gateway/restart', async (_request, reply) => {
        // The OpenClaw gateway does not expose a restart RPC method.
        return reply.status(501).send({ error: 'Gateway restart is not supported via the WebSocket API.' });
    });

    fastify.get('/monitoring/stuck-tasks/check', async (request, reply) => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const stuckTasks = db
            .select()
            .from(tasksTable)
            .where(and(eq(tasksTable.status, 'IN_PROGRESS'), lt(tasksTable.updatedAt, cutoff)))
            .all();

        return reply.send({ stuckTasks });
    });
};

export default systemRoutes;
