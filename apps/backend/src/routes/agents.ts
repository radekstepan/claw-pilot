import { FastifyPluginAsync } from 'fastify';
import { getAgents, getLiveSessions, generateAgentConfig, gatewayCall } from '../openclaw/cli.js';
import { Agent } from '@claw-pilot/shared-types';
import { z } from 'zod';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'crypto';

const agentRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
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

    const GenerateAgentSchema = z.object({
        prompt: z.string()
    });

    fastify.post('/generate', { schema: { body: GenerateAgentSchema }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = request.body as z.infer<typeof GenerateAgentSchema>;
        const prompt = body.prompt;
        const requestId = randomUUID();

        // Respond immediately — the generated config will arrive via Socket.io.
        reply.status(202).send({ requestId, status: 'pending' });

        void (async () => {
            try {
                const config = await generateAgentConfig(prompt);
                if (fastify.io) {
                    fastify.io.emit('agent_config_generated', { requestId, config });
                }
            } catch (error) {
                fastify.log.error(error, 'generateAgentConfig failed');
                if (fastify.io) {
                    fastify.io.emit('agent_config_error', {
                        requestId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        })();
    });

    fastify.get('/:id/files', async (request, reply) => {
        const { id } = request.params as { id: string };

        async function fetchFile(name: string): Promise<string> {
            try {
                const payload = await gatewayCall('agents.files.get', { agentId: id, name }) as Record<string, unknown> | null;
                return typeof payload?.content === 'string' ? payload.content : '';
            } catch {
                return ''; // file not found or gateway error — return empty
            }
        }

        try {
            const [soul, tools, agentsMd] = await Promise.all([
                fetchFile('SOUL.md'),
                fetchFile('TOOLS.md'),
                fetchFile('AGENTS.md'),
            ]);
            return reply.send({ soul, tools, agentsMd });
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to read agent files.' });
        }
    });

    const UpdateAgentFilesSchema = z.object({
        soul: z.string().optional(),
        tools: z.string().optional(),
        agentsMd: z.string().optional()
    });

    fastify.put('/:id/files', { schema: { body: UpdateAgentFilesSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof UpdateAgentFilesSchema>;
        try {
            const updates: Promise<unknown>[] = [];
            if (body.soul !== undefined) {
                updates.push(gatewayCall('agents.files.set', { agentId: id, name: 'SOUL.md', content: body.soul }));
            }
            if (body.tools !== undefined) {
                updates.push(gatewayCall('agents.files.set', { agentId: id, name: 'TOOLS.md', content: body.tools }));
            }
            if (body.agentsMd !== undefined) {
                updates.push(gatewayCall('agents.files.set', { agentId: id, name: 'AGENTS.md', content: body.agentsMd }));
            }
            await Promise.all(updates);
            return reply.send({ success: true });
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to update agent files.' });
        }
    });
};

export default agentRoutes;
