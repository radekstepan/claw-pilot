import { FastifyPluginAsync } from 'fastify';
import { getAgents, getLiveSessions, generateAgentConfig } from '../openclaw/cli.js';
import { Agent } from '@claw-pilot/shared-types';
import { z } from 'zod';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env.js';
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
        try {
            const workspacesRoot = path.join(env.OPENCLAW_HOME, 'workspaces');
            const workspacePath = path.resolve(workspacesRoot, id);

            // Guard against path traversal (e.g. id = '../../etc/passwd')
            if (!workspacePath.startsWith(workspacesRoot + path.sep) && workspacePath !== workspacesRoot) {
                return reply.status(400).send({ error: 'Invalid agent id.' });
            }

            let soul = '';
            let tools = '';
            let agentsMd = '';

            try { soul = await fs.readFile(path.join(workspacePath, 'SOUL.md'), 'utf-8'); } catch (e) { }
            try { tools = await fs.readFile(path.join(workspacePath, 'TOOLS.md'), 'utf-8'); } catch (e) { }
            try { agentsMd = await fs.readFile(path.join(workspacePath, 'AGENTS.md'), 'utf-8'); } catch (e) { }

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
            const workspacesRoot = path.join(env.OPENCLAW_HOME, 'workspaces');
            const workspacePath = path.resolve(workspacesRoot, id);

            // Guard against path traversal
            if (!workspacePath.startsWith(workspacesRoot + path.sep) && workspacePath !== workspacesRoot) {
                return reply.status(400).send({ error: 'Invalid agent id.' });
            }

            await fs.mkdir(workspacePath, { recursive: true });

            if (body.soul !== undefined) {
                await fs.writeFile(path.join(workspacePath, 'SOUL.md'), body.soul, 'utf-8');
            }
            if (body.tools !== undefined) {
                await fs.writeFile(path.join(workspacePath, 'TOOLS.md'), body.tools, 'utf-8');
            }
            if (body.agentsMd !== undefined) {
                await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), body.agentsMd, 'utf-8');
            }

            return reply.send({ success: true });
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to update agent files.' });
        }
    });
};

export default agentRoutes;
