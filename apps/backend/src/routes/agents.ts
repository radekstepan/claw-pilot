import { FastifyPluginAsync } from 'fastify';
import { getAgents, getLiveSessions, generateAgentConfig } from '../openclaw/cli.js';
import { Agent } from '@claw-pilot/shared-types';
import { z } from 'zod';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

    fastify.post('/generate', { schema: { body: GenerateAgentSchema } }, async (request, reply) => {
        try {
            const body = request.body as z.infer<typeof GenerateAgentSchema>;
            const prompt = body.prompt;

            const agentConfig = await generateAgentConfig(prompt);
            return reply.send(agentConfig);
        } catch (error) {
            fastify.log.error(error);
            return reply.status(500).send({ error: 'Failed to generate agent configuration.' });
        }
    });

    fastify.get('/:id/files', async (request, reply) => {
        const { id } = request.params as { id: string };
        try {
            const workspacePath = path.join(os.homedir(), '.openclaw', 'workspaces', id);

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
            const workspacePath = path.join(os.homedir(), '.openclaw', 'workspaces', id);

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
