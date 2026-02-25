import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';
import { getAgents, getLiveSessions } from '../openclaw/cli.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const systemRoutes: FastifyPluginAsync = async (fastify, opts) => {
    fastify.get('/stats', async (request, reply) => {
        try {
            const agents = await getAgents();
            const activeSessions = await getLiveSessions();

            const tasksInQueue = db.data.tasks.filter((t: any) => t.status === 'TODO' || t.status === 'BACKLOG').length;

            const today = new Date().toISOString().split('T')[0];
            const completedToday = db.data.tasks.filter((t: any) => t.status === 'DONE' && t.updatedAt && t.updatedAt.startsWith(today)).length;

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
            await execFileAsync('openclaw', ['--version']);
            return reply.send({ status: 'HEALTHY' });
        } catch (e) {
            return reply.send({ status: 'DOWN', error: (e as any).message });
        }
    });

    fastify.post('/monitoring/gateway/restart', async (request, reply) => {
        try {
            await execFileAsync('openclaw', ['daemon', 'restart']);
            return reply.send({ success: true, message: 'Gateway restart triggered' });
        } catch (e) {
            return reply.status(500).send({ error: 'Failed to restart gateway' });
        }
    });

    fastify.get('/monitoring/stuck-tasks/check', async (request, reply) => {
        const now = new Date();
        const stuckThreshold = 24 * 60 * 60 * 1000;

        const stuckTasks = db.data.tasks.filter((task: any) => {
            if (task.status === 'IN_PROGRESS' && task.updatedAt) {
                const updatedAt = new Date(task.updatedAt);
                return now.getTime() - updatedAt.getTime() > stuckThreshold;
            }
            return false;
        });

        return reply.send({ stuckTasks });
    });
};

export default systemRoutes;
