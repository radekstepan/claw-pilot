import { db, chatMessages as chatTable, encodeCursor, decodeCursor } from '../db/index.js';
import { randomUUID } from 'crypto';
import { routeChatToAgent } from '../openclaw/cli.js';
import { z } from 'zod';
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { CursorPageQuerySchema, ChatMessage } from '@claw-pilot/shared-types';
import { desc, or, lt, and, eq } from 'drizzle-orm';
import { enqueueAiJob, AI_PRIORITY_HIGH } from '../services/aiQueue.js';

type ChatRow = typeof chatTable.$inferSelect;

function rowToMessage(row: ChatRow): ChatMessage {
    return {
        id: row.id,
        agentId: row.agentId ?? undefined,
        role: row.role as ChatMessage['role'],
        content: row.content,
        timestamp: row.timestamp,
    };
}

const chatRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
    // GET /api/chat?cursor=<token>&limit=50  (newest first, cursor-based)
    fastify.get('/', { schema: { querystring: CursorPageQuerySchema } }, async (request, reply) => {
        const q = request.query as { cursor?: string; limit: number };
        const { cursor, limit } = q;

        let rows: ChatRow[];

        if (cursor) {
            const { timestamp: cursorTs, id: cursorId } = decodeCursor(cursor);
            rows = db
                .select()
                .from(chatTable)
                .where(
                    or(
                        lt(chatTable.timestamp, cursorTs),
                        and(eq(chatTable.timestamp, cursorTs), lt(chatTable.id, cursorId))
                    )
                )
                .orderBy(desc(chatTable.timestamp), desc(chatTable.id))
                .limit(limit)
                .all();
        } else {
            rows = db
                .select()
                .from(chatTable)
                .orderBy(desc(chatTable.timestamp), desc(chatTable.id))
                .limit(limit)
                .all();
        }

        const data = rows.map(rowToMessage);
        const lastRow = rows[rows.length - 1];
        const nextCursor = rows.length === limit && lastRow
            ? encodeCursor(lastRow.timestamp, lastRow.id)
            : null;

        return { data, nextCursor };
    });

    const SendToAgentSchema = z.object({
        message: z.string(),
        agentId: z.string().optional()
    });

    fastify.post('/send-to-agent', { schema: { body: SendToAgentSchema }, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
        const body = request.body as z.infer<typeof SendToAgentSchema>;
        const userMessage = body.message;
        const agentId = body.agentId || 'main';

        const now = new Date().toISOString();
        const newUserMessage: ChatMessage = {
            id: randomUUID(),
            role: 'user',
            content: userMessage,
            agentId: agentId !== 'main' ? agentId : undefined,
            timestamp: now,
        };

        db.insert(chatTable).values({
            id: newUserMessage.id,
            agentId: newUserMessage.agentId ?? null,
            role: newUserMessage.role,
            content: newUserMessage.content,
            timestamp: now,
        }).run();

        if (fastify.io) {
            fastify.io.emit('chat_message', newUserMessage);
        }

        reply.status(202).send({ id: newUserMessage.id, status: 'pending' });

        enqueueAiJob('chat', AI_PRIORITY_HIGH, async () => {
            const aiResponseRaw = await routeChatToAgent(agentId, userMessage);
            const aiText: string =
                typeof aiResponseRaw === 'string'
                    ? aiResponseRaw
                    : aiResponseRaw !== null &&
                        typeof aiResponseRaw === 'object' &&
                        'message' in aiResponseRaw &&
                        typeof (aiResponseRaw as Record<string, unknown>).message === 'string'
                      ? ((aiResponseRaw as Record<string, unknown>).message as string)
                      : JSON.stringify(aiResponseRaw);

            const aiTs = new Date().toISOString();
            const newAiMessage: ChatMessage = {
                id: randomUUID(),
                role: 'assistant',
                content: aiText,
                agentId,
                timestamp: aiTs,
            };

            db.insert(chatTable).values({
                id: newAiMessage.id,
                agentId: newAiMessage.agentId ?? null,
                role: newAiMessage.role,
                content: newAiMessage.content,
                timestamp: aiTs,
            }).run();

            if (fastify.io) {
                fastify.io.emit('chat_message', newAiMessage);
            }
        }, fastify);
    });

    const SaveChatSchema = z.object({
        agentId: z.string().optional(),
        content: z.string()
    });

    fastify.post('/', { schema: { body: SaveChatSchema } }, async (request, reply) => {
        const body = request.body as z.infer<typeof SaveChatSchema>;
        const now = new Date().toISOString();
        const newMsg: ChatMessage = {
            id: randomUUID(),
            role: body.agentId ? 'assistant' : 'user',
            content: body.content,
            agentId: body.agentId,
            timestamp: now,
        };

        db.insert(chatTable).values({
            id: newMsg.id,
            agentId: newMsg.agentId ?? null,
            role: newMsg.role,
            content: newMsg.content,
            timestamp: now,
        }).run();

        if (fastify.io) {
            fastify.io.emit('chat_message', newMsg);
        }
        return reply.status(201).send(newMsg);
    });

    fastify.delete('/', async (_request, reply) => {
        db.delete(chatTable).run();
        if (fastify.io) {
            fastify.io.emit('chat_cleared');
        }
        return reply.status(204).send();
    });
};

export default chatRoutes;
