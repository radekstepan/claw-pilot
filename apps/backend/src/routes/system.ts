import { FastifyPluginAsync } from 'fastify';
import { db, tasks as tasksTable } from '../db/index.js';
import { eq, or, and, count, lt, like } from 'drizzle-orm';
import { getAgents, getLiveSessions, gatewayCall, GatewayOfflineError, GatewayPairingRequiredError } from '../openclaw/cli.js';
import { env } from '../config/env.js';

const systemRoutes: FastifyPluginAsync = async (fastify, opts) => {
    fastify.get('/stats', async (request, reply) => {
        // DB-only stats — always available regardless of gateway state
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

        // Gateway-dependent stats — degrade gracefully when gateway is unreachable
        let activeAgents = 0;
        let totalAgents = 0;
        let gatewayOnline = true;
        let pairingRequired = false;
        let gatewayDeviceId: string | undefined;
        try {
            const [agents, activeSessions] = await Promise.all([getAgents(), getLiveSessions()]);
            activeAgents = activeSessions.length;
            totalAgents = agents.length;
        } catch (gwErr) {
            if (gwErr instanceof GatewayPairingRequiredError) {
                gatewayOnline = false;
                pairingRequired = true;
                gatewayDeviceId = gwErr.deviceId;
                fastify.log.warn(`[stats] Device pairing required — deviceId: ${gwErr.deviceId}`);
            } else if (gwErr instanceof GatewayOfflineError) {
                gatewayOnline = false;
                fastify.log.warn(`[stats] ${(gwErr as Error).message}`);
            } else {
                fastify.log.error(gwErr, 'Unexpected error fetching gateway stats');
            }
        }

        return reply.send({ activeAgents, totalAgents, tasksInQueue, completedToday, gatewayOnline, pairingRequired, gatewayDeviceId });
    });

    fastify.get('/monitoring/gateway/status', async (request, reply) => {
        const gatewayUrl = env.OPENCLAW_GATEWAY_URL;
        const start = Date.now();
        try {
            await gatewayCall('sessions.list', {});
            return reply.send({
                status: 'ONLINE',
                gatewayUrl,
                latencyMs: Date.now() - start,
            });
        } catch (e) {
            if (e instanceof GatewayPairingRequiredError) {
                return reply.send({
                    status: 'PAIRING_REQUIRED',
                    gatewayUrl,
                    deviceId: e.deviceId,
                    instructions: [
                        'Run on the gateway machine:',
                        '  openclaw devices list',
                        '  openclaw devices approve --latest',
                        'Then restart Claw-Pilot or wait for the next health check.',
                    ].join('\n'),
                });
            }
            const raw = e instanceof Error ? e.message : String(e);
            // Trim stack / aggregate noise — keep only the first meaningful line
            const detail = raw.split('\n')[0] ?? raw;
            return reply.send({
                status: 'OFFLINE',
                gatewayUrl,
                error: detail,
            });
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
