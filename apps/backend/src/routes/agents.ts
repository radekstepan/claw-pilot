import { FastifyPluginAsync } from 'fastify';
import { getAgents, getLiveSessions, generateAgentConfig, createAgent, deleteAgent, updateAgentMeta, setAgentFiles, gatewayCall, GatewayOfflineError } from '../openclaw/cli.js';
import { Agent } from '@claw-pilot/shared-types';
import { z } from 'zod';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'crypto';

const agentRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        try {
            const [agents, sessions] = await Promise.all([getAgents(), getLiveSessions()]);

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
            if (error instanceof GatewayOfflineError) {
                fastify.log.warn(`[agents] ${error.message}`);
                return reply.status(503).send({ error: 'OpenClaw gateway is unreachable. Agents are unavailable.' });
            }
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to fetch agents.' });
        }
    });

    const GenerateAgentSchema = z.object({
        prompt: z.string(),
        model: z.string().optional(),
    });

    fastify.post('/generate', { schema: { body: GenerateAgentSchema }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = request.body as z.infer<typeof GenerateAgentSchema>;
        const { prompt, model } = body;
        const requestId = randomUUID();

        // Respond immediately — the generated config will arrive via Socket.io.
        reply.status(202).send({ requestId, status: 'pending' });

        void (async () => {
            try {
                const config = await generateAgentConfig(prompt, model);
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

    const DeployAgentSchema = z.object({
        name: z.string().min(1),
        capabilities: z.array(z.string()).optional(),
        model: z.string().optional(),
        workspace: z.string().min(1),
        // Behavioral files content
        soul: z.string().optional(),
        tools: z.string().optional(),
    });

    // POST /api/agents — deploys (creates) a new agent on the OpenClaw gateway.
    // Returns 202 immediately; emits agent_deployed or agent_deploy_error via Socket.io.
    fastify.post('/', { schema: { body: DeployAgentSchema }, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
        const { name, workspace, model, capabilities, soul, tools } = request.body as z.infer<typeof DeployAgentSchema>;
        const requestId = randomUUID();

        reply.status(202).send({ requestId, status: 'pending' });

        void (async () => {
            try {
                // 1. Create the base agent entry
                await createAgent(name, workspace, model);

                // 2. Set capabilities in config (createAgent doesn't handle them)
                if (capabilities) {
                    await updateAgentMeta(name, { capabilities });
                }

                // 3. Set SOUL/TOOLS/AGENTS files if provided
                if (soul !== undefined || tools !== undefined) {
                    await setAgentFiles(name, { soul, tools });
                }

                if (fastify.io) {
                    fastify.io.emit('agent_deployed', { requestId, agentId: name });
                }
            } catch (error) {
                fastify.log.error(error, 'createAgent failed');
                if (fastify.io) {
                    fastify.io.emit('agent_deploy_error', {
                        requestId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        })();
    });

    // PATCH /api/agents/:id — updates an agent's display name, model, capabilities, or files.
    // Synchronous (fast gateway RPC — no AI), returns 200 with updated agent list entry.
    const PatchAgentSchema = z.object({
        name: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        capabilities: z.array(z.string()).optional(),
        soul: z.string().optional(),
        tools: z.string().optional(),
    }).refine((b) => b.name !== undefined || b.model !== undefined || b.capabilities !== undefined || b.soul !== undefined || b.tools !== undefined, {
        message: 'At least one field must be provided for update.',
    });

    fastify.patch('/:id', { schema: { body: PatchAgentSchema } }, async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as z.infer<typeof PatchAgentSchema>;
        try {
            const { soul, tools, ...meta } = body;

            // 1. Update metadata (name, model, capabilities)
            if (Object.keys(meta).length > 0) {
                await updateAgentMeta(id, meta);
            }

            // 2. Update behavioral files
            if (soul !== undefined || tools !== undefined) {
                await setAgentFiles(id, { soul, tools });
            }

            // Re-fetch so the response reflects the updated state from the gateway.
            const [agents, sessions] = await Promise.all([getAgents(), getLiveSessions()]);
            const activeSessions = sessions.filter(s => s.status === 'WORKING' || s.status === 'IDLE');
            const updated = agents.find(a => a.id === id) ?? agents.find(a => a.name === body.name);
            if (!updated) return reply.send({ success: true });
            const session = activeSessions.find(s => s.agent === updated.id || s.agentId === updated.id);
            const agentWithStatus: Agent = session
                ? { ...updated, status: session.status === 'WORKING' ? 'WORKING' : 'IDLE' }
                : { ...updated, status: 'OFFLINE' };
            return reply.send(agentWithStatus);
        } catch (error) {
            if (error instanceof GatewayOfflineError) {
                return reply.status(503).send({ error: 'OpenClaw gateway is unreachable.' });
            }
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to update agent.' });
        }
    });

    // DELETE /api/agents/:id — removes an agent from the gateway.
    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
            await deleteAgent(id);
            return reply.send({ success: true });
        } catch (error) {
            if (error instanceof GatewayOfflineError) {
                return reply.status(503).send({ error: 'OpenClaw gateway is unreachable.' });
            }
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to delete agent.' });
        }
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
