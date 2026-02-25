import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';
import { randomUUID } from 'crypto';
import { routeChatToAgent } from '../openclaw/cli.js';
import { z } from 'zod';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const chatRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        return db.data.chat;
    });

    const SendToAgentSchema = z.object({
        message: z.string(),
        agentId: z.string().optional()
    });

    fastify.post('/send-to-agent', { schema: { body: SendToAgentSchema } }, async (request, reply) => {
        const body = request.body as z.infer<typeof SendToAgentSchema>;
        const userMessage = body.message;
        const agentId = body.agentId || 'main'; // Default to main agent

        // 1. Save user message
        const newUserMessage = {
            id: randomUUID(),
            role: 'user' as const,
            content: userMessage,
            agentId: agentId !== 'main' ? agentId : undefined,
            timestamp: new Date().toISOString()
        };
        db.data.chat.push(newUserMessage);
        await db.write();

        if (fastify.io) {
            fastify.io.emit('chat_message', newUserMessage);
        }

        // 2. Invoke openclaw CLI agent
        try {
            const aiResponseRaw = await routeChatToAgent(agentId, userMessage);
            const aiText = aiResponseRaw.message || typeof aiResponseRaw === 'string' ? aiResponseRaw : JSON.stringify(aiResponseRaw);

            // 3. Save AI response
            const newAiMessage = {
                id: randomUUID(),
                role: 'assistant' as const,
                content: typeof aiText === 'string' ? aiText : JSON.stringify(aiText),
                agentId,
                timestamp: new Date().toISOString()
            };
            db.data.chat.push(newAiMessage);
            await db.write();

            if (fastify.io) {
                fastify.io.emit('chat_message', newAiMessage);
            }

            return reply.status(201).send(newAiMessage);
        } catch (error) {
            console.error('Error invoking agent:', error);
            return reply.status(500).send({ error: 'Failed to communicate with agent' });
        }
    });

    const SaveChatSchema = z.object({
        agentId: z.string().optional(),
        content: z.string()
    });

    fastify.post('/', { schema: { body: SaveChatSchema } }, async (request, reply) => {
        const body = request.body as z.infer<typeof SaveChatSchema>;
        const newMsg = {
            id: randomUUID(),
            role: (body.agentId ? 'assistant' : 'user') as 'user' | 'assistant',
            content: body.content,
            agentId: body.agentId,
            timestamp: new Date().toISOString()
        };
        db.data.chat.push(newMsg);
        await db.write();

        if (fastify.io) {
            fastify.io.emit('chat_message', newMsg);
        }
        return reply.status(201).send(newMsg);
    });
};

export default chatRoutes;
