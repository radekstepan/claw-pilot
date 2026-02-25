import { FastifyInstance } from 'fastify';
import { getAgents, getLiveSessions } from '../openclaw/cli.js';
import { Agent } from '@claw-pilot/shared-types';

export function startSessionMonitor(fastify: FastifyInstance) {
    const previousAgentStatuses: Record<string, string> = {};

    setInterval(async () => {
        try {
            const agents = await getAgents();
            const sessions = await getLiveSessions();

            const activeSessions = sessions.filter(s => s.status === 'WORKING' || s.status === 'IDLE');

            for (const agent of agents) {
                const session = activeSessions.find(s => s.agent === agent.id || s.agentId === agent.id);
                const currentStatus = session ? (session.status === 'WORKING' ? 'WORKING' : 'IDLE') : 'OFFLINE';

                const previousStatus = previousAgentStatuses[agent.id];

                if (previousStatus !== undefined && previousStatus !== currentStatus) {
                    const updatedAgent: Agent = { ...agent, status: currentStatus };

                    if (fastify.io) {
                        fastify.io.emit('agent_status_changed', updatedAgent);
                        fastify.log.info(`Agent ${agent.id} status changed from ${previousStatus} to ${currentStatus}`);
                    }
                }

                previousAgentStatuses[agent.id] = currentStatus;
            }
        } catch (error: any) {
            fastify.log.error(`Error in session monitor loop: ${error.message}`);
        }
    }, 10000);
}
