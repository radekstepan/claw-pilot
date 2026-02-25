import { FastifyInstance } from 'fastify';
import { db, tasks as tasksTable, chatMessages as chatTable } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ChatMessage } from '@claw-pilot/shared-types';

const notifiedStuckTasks = new Set<string>();

export function startStuckTaskMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    return setInterval(() => {
        try {
            const now = new Date();
            const stuckThreshold = 24 * 60 * 60 * 1000; // 24 hours in ms

            const inProgressTasks = db
                .select()
                .from(tasksTable)
                .where(eq(tasksTable.status, 'IN_PROGRESS'))
                .all();

            for (const task of inProgressTasks) {
                if (!task.updatedAt || notifiedStuckTasks.has(task.id)) continue;

                const timeDiff = now.getTime() - new Date(task.updatedAt).getTime();
                if (timeDiff <= stuckThreshold) continue;

                fastify.log.warn(`Task ${task.id} has been IN_PROGRESS for over 24 hours.`);

                const systemMessage: ChatMessage = {
                    id: randomUUID(),
                    role: 'system',
                    content: `System Alert: Task "${task.title ?? task.id}" has been stuck IN_PROGRESS for over 24 hours.`,
                    timestamp: new Date().toISOString(),
                };

                db.transaction(() => {
                    db.insert(chatTable).values({
                        id: systemMessage.id,
                        agentId: null,
                        role: systemMessage.role,
                        content: systemMessage.content,
                        timestamp: systemMessage.timestamp,
                    }).run();
                });

                if (fastify.io) {
                    fastify.io.emit('chat_message', systemMessage);
                }

                notifiedStuckTasks.add(task.id);
            }
        } catch (error: unknown) {
            fastify.log.error(`Error in stuck task monitor loop: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, 60_000);
}
