import { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { randomUUID } from 'crypto';

const notifiedStuckTasks = new Set<string>();

export function startStuckTaskMonitor(fastify: FastifyInstance) {
    // Check every minute
    setInterval(async () => {
        try {
            const now = new Date();
            const stuckThreshold = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

            let databaseModified = false;

            for (const task of db.data.tasks) {
                if (task.status === 'IN_PROGRESS' && task.updatedAt) {
                    const updatedAt = new Date(task.updatedAt);
                    const timeDiff = now.getTime() - updatedAt.getTime();

                    if (timeDiff > stuckThreshold && !notifiedStuckTasks.has(task.id)) {
                        fastify.log.warn(`Task ${task.id} has been IN_PROGRESS for over 24 hours.`);

                        // Send system chat message
                        const systemMessage = {
                            id: randomUUID(),
                            message: `System Alert: Task "${task.title || task.id}" has been stuck IN_PROGRESS for over 24 hours.`,
                            sender: 'system',
                            timestamp: new Date().toISOString()
                        };

                        db.data.chat.push(systemMessage);
                        databaseModified = true;

                        if (fastify.io) {
                            fastify.io.emit('chat_message', systemMessage);
                        }

                        // Mark as notified so we don't spam
                        notifiedStuckTasks.add(task.id);
                    }
                }
            }

            if (databaseModified) {
                await db.write();
            }

        } catch (error: any) {
            fastify.log.error(`Error in stuck task monitor loop: ${error.message}`);
        }
    }, 60000); // 1 minute
}
