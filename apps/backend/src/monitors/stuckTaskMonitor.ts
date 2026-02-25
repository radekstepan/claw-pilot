import { FastifyInstance } from 'fastify';
import { db, updateDb } from '../db.js';
import { randomUUID } from 'crypto';

const notifiedStuckTasks = new Set<string>();

export function startStuckTaskMonitor(fastify: FastifyInstance): NodeJS.Timeout {
    // Check every minute
    return setInterval(async () => {
        try {
            await updateDb(async (data) => {
                const now = new Date();
                const stuckThreshold = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

                for (const task of data.tasks) {
                    if (task.status === 'IN_PROGRESS' && task.updatedAt) {
                        const updatedAt = new Date(task.updatedAt);
                        const timeDiff = now.getTime() - updatedAt.getTime();

                        if (timeDiff > stuckThreshold && !notifiedStuckTasks.has(task.id)) {
                            fastify.log.warn(`Task ${task.id} has been IN_PROGRESS for over 24 hours.`);

                            // Send system chat message
                            const systemMessage = {
                                id: randomUUID(),
                                role: 'system' as const,
                                content: `System Alert: Task "${task.title ?? task.id}" has been stuck IN_PROGRESS for over 24 hours.`,
                                timestamp: new Date().toISOString()
                            };

                            data.chat.push(systemMessage);

                            if (fastify.io) {
                                fastify.io.emit('chat_message', systemMessage);
                            }

                            // Mark as notified so we don't spam
                            notifiedStuckTasks.add(task.id);
                        }
                    }
                }
            });
        } catch (error: unknown) {
            fastify.log.error(`Error in stuck task monitor loop: ${error instanceof Error ? error.message : String(error)}`);
        }
    }, 60000); // 1 minute
}
