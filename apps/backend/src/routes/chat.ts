import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';
import { randomUUID } from 'crypto';
import { routeChatToAgent } from '../openclaw/cli.js';

const chatRoutes: FastifyPluginAsync = async (fastify, opts) => {
    fastify.get('/', async (request, reply) => {
        return db.data.chat;
    });

    fastify.post('/send-to-agent', async (request, reply) => {
        const body = request.body as any;
        const userMessage = body.message;
        const agentId = body.agentId || 'main'; // Default to main agent

        // 1. Save user message
        const newUserMessage = {
            id: randomUUID(),
            message: userMessage,
            sender: 'user',
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
                message: aiText,
                sender: 'agent',
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
};

export default chatRoutes;
