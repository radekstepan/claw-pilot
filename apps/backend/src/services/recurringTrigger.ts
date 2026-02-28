import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import type { Task, TaskStatus } from "@claw-pilot/shared-types";
import {
  db,
  recurringTasks as recurringTable,
  tasks as tasksTable,
  activities as activitiesTable,
} from "../db/index.js";
import { spawnTaskSession } from "../openclaw/cli.js";
import { env } from "../config/env.js";
import { enqueueAiJob, AI_PRIORITY_NORMAL } from "./aiQueue.js";

type RecurringRow = typeof recurringTable.$inferSelect;

export interface TriggerRecurringResult {
  task: Task;
  dispatchAccepted: boolean;
}

export async function triggerRecurringTemplate(
  fastify: FastifyInstance,
  recurringTask: RecurringRow,
): Promise<TriggerRecurringResult> {
  const now = new Date().toISOString();
  const assignedAgentId = recurringTask.assigned_agent_id ?? null;
  const routeActivityId = randomUUID();
  const newTask: Task = {
    id: randomUUID(),
    title: recurringTask.title,
    description:
      recurringTask.description ??
      `Auto-generated from recurring template: ${recurringTask.title}`,
    status: assignedAgentId ? "ASSIGNED" : "TODO",
    priority: "MEDIUM",
    agentId: assignedAgentId ?? undefined,
    createdAt: now,
    updatedAt: now,
  };

  db.transaction(() => {
    db.insert(tasksTable)
      .values({
        id: newTask.id,
        title: newTask.title ?? null,
        description: newTask.description ?? null,
        status: newTask.status,
        priority: newTask.priority ?? null,
        tags: null,
        assignee_id: null,
        agentId: assignedAgentId,
        deliverables: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.update(recurringTable)
      .set({ last_triggered_at: now, updatedAt: now })
      .where(eq(recurringTable.id, recurringTask.id))
      .run();

    if (assignedAgentId) {
      db.insert(activitiesTable)
        .values({
          id: routeActivityId,
          taskId: newTask.id,
          agentId: "system",
          message: `Task auto-routed to agent '${assignedAgentId}' from recurring template '${recurringTask.title}' — dispatching…`,
          timestamp: now,
        })
        .run();
    }
  });

  fastify.io?.emit("task_created", { id: newTask.id, title: newTask.title });
  fastify.io?.emit("task_updated", newTask);

  if (!assignedAgentId) {
    return { task: newTask, dispatchAccepted: false };
  }

  fastify.io?.emit("activity_added", {
    id: routeActivityId,
    taskId: newTask.id,
    agentId: "system",
    message: `Task auto-routed to agent '${assignedAgentId}' from recurring template '${recurringTask.title}' — dispatching…`,
    timestamp: now,
  });

  dispatchRecurringTaskToAgent(fastify, newTask, assignedAgentId);
  return { task: newTask, dispatchAccepted: true };
}

function dispatchRecurringTaskToAgent(
  fastify: FastifyInstance,
  newTask: Task,
  assignedAgentId: string,
): void {
  const taskId = newTask.id;
  const baseUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT}`;
  const callbackUrl = `${baseUrl}/api/tasks/${taskId}/activity`;
  const taskContext = [
    [newTask.title, newTask.description].filter(Boolean).join("\n\n"),
    `---`,
    `TASK METADATA (do not include in your work output):`,
    `taskId: ${taskId}`,
    `When you have finished, POST your result to:`,
    `  POST ${callbackUrl}`,
    `  Authorization: Bearer ${env.API_KEY}`,
    `  Content-Type: application/json`,
    `  Body: { "agent_id": "${assignedAgentId}", "message": "completed: <FULL OUTPUT HERE>" }`,
    `IMPORTANT: The "message" field must contain your COMPLETE work output. Do NOT abbreviate.`,
    `Start the message with "completed: " followed by the full output.`,
    `On error use: { "agent_id": "${assignedAgentId}", "message": "error: <description>" }`,
  ].join("\n");

  enqueueAiJob(
    "recurring-spawn",
    AI_PRIORITY_NORMAL,
    "recurring-spawn",
    {
      taskId,
      agentId: assignedAgentId,
      prompt: taskContext,
    },
    assignedAgentId,
  );
}
