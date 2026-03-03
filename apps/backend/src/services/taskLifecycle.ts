import { db, tasks as tasksTable, activities as activitiesTable, chatMessages as chatTable } from "../db/index.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import { ClientToServerEvents, ServerToClientEvents, ActivityLog, Task, ChatMessage } from "@claw-pilot/shared-types";

type IoServer = Server<ClientToServerEvents, ServerToClientEvents> | undefined;

export function validateTransition(from: string, to: string): boolean {
    if (from === to) return true;
    switch (from) {
        case "BACKLOG":
            return to === "TODO";
        case "TODO":
            return to === "ASSIGNED" || to === "IN_PROGRESS" || to === "BACKLOG";
        case "ASSIGNED":
            return to === "IN_PROGRESS" || to === "TODO";
        case "IN_PROGRESS":
            return to === "REVIEW" || to === "STUCK";
        case "REVIEW":
            return to === "DONE" || to === "IN_PROGRESS";
        case "STUCK":
            return to === "TODO" || to === "ASSIGNED";
        case "DONE":
            return to === "TODO" || to === "REVIEW";
        default:
            return false;
    }
}

export function markTaskStuck(
    taskId: string,
    agentId: string | null | undefined,
    reason: string,
    io?: IoServer
): void {
    const stuckNow = new Date().toISOString();
    const errorActivityId = randomUUID();

    const systemMessage: ChatMessage = {
        id: randomUUID(),
        role: "system",
        content: `System Alert: Task "${taskId}" is stuck (${reason}).`,
        timestamp: stuckNow,
    };

    const updatedRow = db.transaction(() => {
        const row = db
            .update(tasksTable)
            .set({ status: "STUCK", updatedAt: stuckNow })
            .where(eq(tasksTable.id, taskId))
            .returning()
            .get();

        if (!row) return null;

        db.insert(activitiesTable)
            .values({
                id: errorActivityId,
                taskId: taskId,
                agentId: agentId || null,
                message: `error: Task stuck — ${reason}`,
                timestamp: stuckNow,
            })
            .run();

        db.insert(chatTable)
            .values({
                id: systemMessage.id,
                agentId: null,
                role: systemMessage.role,
                content: systemMessage.content,
                timestamp: systemMessage.timestamp,
            })
            .run();

        return row;
    });

    if (updatedRow && io) {
        const taskPayload: Task = {
            id: updatedRow.id,
            title: updatedRow.title ?? undefined,
            description: updatedRow.description ?? undefined,
            status: updatedRow.status as Task["status"],
            priority: (updatedRow.priority as Task["priority"]) ?? undefined,
            tags: updatedRow.tags ?? undefined,
            assignee_id: updatedRow.assignee_id ?? undefined,
            agentId: updatedRow.agentId ?? undefined,
            deliverables: updatedRow.deliverables ?? undefined,
            createdAt: updatedRow.createdAt,
            updatedAt: updatedRow.updatedAt,
        };

        io.emit("task_updated", taskPayload);
        io.emit("activity_added", {
            id: errorActivityId,
            taskId: taskId,
            agentId: agentId ?? undefined,
            message: `error: Task stuck — ${reason}`,
            timestamp: stuckNow,
            taskStatus: "STUCK",
        });
        io.emit("chat_message", systemMessage);
    }
}
