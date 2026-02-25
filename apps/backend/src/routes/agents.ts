import { FastifyPluginAsync } from 'fastify';
import { getAgents, getLiveSessions, generateAgentConfig } from '../openclaw/cli.js';
import { Agent } from '@claw-pilot/shared-types';

const agentRoutes: FastifyPluginAsync = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        try {
            const agents = await getAgents();
            const sessions = await getLiveSessions();

            // Find active sessions that correspond to the agents
            const activeSessions = sessions.filter(s => s.status === 'WORKING' || s.status === 'IDLE');

            const updatedAgents: Agent[] = agents.map(agent => {
                const session = activeSessions.find(s => s.agent === agent.id || s.agentId === agent.id);
                if (session) {
                    return { ...agent, status: session.status === 'WORKING' ? 'WORKING' : 'IDLE' };
                }
                return { ...agent, status: 'OFFLINE' };
            });

            return updatedAgents;
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch agents.' });
        }
    });

    fastify.post('/generate', async (request, reply) => {
        try {
            const body = request.body as any;
            const prompt = body.prompt;

            if (!prompt) {
                return reply.status(400).send({ error: 'Prompt is required' });
            }

            const agentConfig = await generateAgentConfig(prompt);
            return reply.send(agentConfig);
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to generate agent configuration.' });
        }
    });
};

export default agentRoutes;
