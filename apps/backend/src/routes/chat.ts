import { FastifyPluginAsync } from 'fastify';
import { db } from '../db.js';
import { randomUUID } from 'crypto';
import { routeChatToAgent } from '../openclaw/cli.js';
import { z } from 'zod';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CursorPageQuerySchema } from '@claw-pilot/shared-types';

const chatRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    // GET /api/chat?cursor=<id>&limit=50  (newest first)
    fastify.get('/', { schema: { querystring: CursorPageQuerySchema } }, async (request, reply) => {
        const q = request.query as { cursor?: string; limit: number };
        const { cursor, limit } = q;
        const sorted = [...db.data.chat].sort(
            (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const startIndex = cursor ? sorted.findIndex((m) => m.id === cursor) + 1 : 0;
        const data = sorted.slice(startIndex, startIndex + limit);
        const nextCursor = data.length === limit ? data[data.length - 1]!.id : null;
        return { data, nextCursor };
    });

    const SendToAgentSchema = z.object({
        message: z.string(),
        agentId: z.string().optional()
    });

    fastify.post('/send-to-agent', { schema: { body: SendToAgentSchema }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
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
            // Normalise the CLI response to a plain string regardless of its shape.
            const aiText: string =
                typeof aiResponseRaw === 'string'
                    ? aiResponseRaw
                    : aiResponseRaw !== null &&
                        typeof aiResponseRaw === 'object' &&
                        'message' in aiResponseRaw &&
                        typeof (aiResponseRaw as Record<string, unknown>).message === 'string'
                      ? ((aiResponseRaw as Record<string, unknown>).message as string)
                      : JSON.stringify(aiResponseRaw);

            // 3. Save AI response
            const newAiMessage = {
                id: randomUUID(),
                role: 'assistant' as const,
                content: aiText,
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

    // DELETE /api/chat — permanently wipe all chat history from the database
    fastify.delete('/', async (_request, reply) => {
        db.data.chat = [];
        await db.write();
        if (fastify.io) {
            fastify.io.emit('chat_cleared');
        }
        return reply.status(204).send();
    });
};

export default chatRoutes;
