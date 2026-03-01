import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  db,
  tasks as tasksTable,
  activities as activitiesTable,
} from "../db/index.js";
import { eq, count, desc } from "drizzle-orm";
import { Server } from "socket.io";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  CreateTaskSchema,
  UpdateTaskSchema,
  CreateTaskPayload,
  UpdateTaskPayload,
  OffsetPageQuerySchema,
  Task,
  Deliverable,
  ActivityLog,
} from "@claw-pilot/shared-types";
import { randomUUID } from "crypto";
import { env } from "../config/env.js";
import { z } from "zod";
import { enqueueAiJob, AI_PRIORITY_NORMAL } from "../services/aiQueue.js";

declare module "fastify" {
  interface FastifyInstance {
    io: Server<ClientToServerEvents, ServerToClientEvents>;
    reconcileRecurring?: () => void;
  }
}

// ---------------------------------------------------------------------------
// Row ↔ domain-object mappers
// ---------------------------------------------------------------------------

type TaskRow = typeof tasksTable.$inferSelect;

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    status: row.status as Task["status"],
    priority: (row.priority as Task["priority"]) ?? undefined,
    tags: row.tags ?? undefined,
    assignee_id: row.assignee_id ?? undefined,
    agentId: row.agentId ?? undefined,
    deliverables: row.deliverables ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function activityRowToLog(row: {
  id: string;
  taskId: string | null;
  agentId: string | null;
  message: string;
  timestamp: string;
  taskStatus?: string;
}): ActivityLog {
  return {
    id: row.id,
    taskId: row.taskId ?? "",
    agentId: row.agentId ?? undefined,
    message: row.message,
    timestamp: row.timestamp,
    taskStatus: row.taskStatus as ActivityLog["taskStatus"],
  };
}

const taskRoutes: FastifyPluginAsyncZod = async (fastify, opts) => {
  // GET /api/tasks?limit=200&offset=0
  fastify.get(
    "/",
    { schema: { querystring: OffsetPageQuerySchema } },
    async (request, reply) => {
      const q = request.query as { limit: number; offset: number };
      const { limit, offset } = q;

      const [{ total }] = db.select({ total: count() }).from(tasksTable).all();
      const rows = db
        .select()
        .from(tasksTable)
        .limit(limit)
        .offset(offset)
        .all();

      return { data: rows.map(rowToTask), total };
    },
  );

  fastify.post(
    "/",
    { schema: { body: CreateTaskSchema } },
    async (request, reply) => {
      const body = request.body as CreateTaskPayload;
      const now = new Date().toISOString();
      const newTask: Task = {
        id: randomUUID(),
        title: body.title ?? "New Task",
        description: body.description ?? "",
        status: body.status ?? "TODO",
        priority: body.priority ?? "MEDIUM",
        assignee_id: body.assignee_id,
        createdAt: now,
        updatedAt: now,
      };

      db.insert(tasksTable)
        .values({
          id: newTask.id,
          title: newTask.title ?? null,
          description: newTask.description ?? null,
          status: newTask.status,
          priority: newTask.priority ?? null,
          tags: newTask.tags ?? null,
          assignee_id: newTask.assignee_id ?? null,
          agentId: null,
          deliverables: null,
          createdAt: newTask.createdAt!,
          updatedAt: newTask.updatedAt!,
        })
        .run();

      if (fastify.io) {
        fastify.io.emit("task_created", {
          id: newTask.id,
          title: newTask.title,
        });
        fastify.io.emit("task_updated", newTask);
      }
      return reply.status(201).send(newTask);
    },
  );

  fastify.patch(
    "/:id",
    { schema: { body: UpdateTaskSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as UpdateTaskPayload;

      if (body.agentId && body.status === "DONE") {
        return reply.status(403).send({
          error:
            "AI agents are not allowed to mark tasks as DONE. They must be put in REVIEW.",
        });
      }

      const existing = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .get();
      if (!existing) {
        return reply.status(404).send({ error: "Task not found" });
      }

      const updatedRow = db
        .update(tasksTable)
        .set({
          title: body.title ?? existing.title,
          description: body.description ?? existing.description,
          status: body.status ?? existing.status,
          priority: body.priority ?? existing.priority,
          tags: body.tags !== undefined ? (body.tags ?? null) : existing.tags,
          assignee_id: body.assignee_id ?? existing.assignee_id,
          agentId: body.agentId ?? existing.agentId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tasksTable.id, id))
        .returning()
        .get();

      if (!updatedRow)
        return reply.status(404).send({ error: "Task not found" });

      const updatedTask = rowToTask(updatedRow);
      if (fastify.io) {
        fastify.io.emit("task_updated", updatedTask);
      }
      return reply.send(updatedTask);
    },
  );

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const existing = db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .get();
    if (!existing) {
      return reply.status(404).send({ error: "Task not found" });
    }

    db.delete(tasksTable).where(eq(tasksTable.id, id)).run();

    if (fastify.io) {
      fastify.io.emit("task_deleted", { id });
    }
    return reply.status(204).send();
  });

  const ActivityPayloadSchema = z.object({
    agentId: z.string().optional(),
    message: z.string(),
  });

  fastify.post(
    "/:id/activity",
    { schema: { body: ActivityPayloadSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof ActivityPayloadSchema>;

      const taskRow = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .get();
      if (!taskRow) {
        return reply.status(404).send({ error: "Task not found" });
      }

      let newStatus: string | undefined;

      if (taskRow.status === "ASSIGNED") {
        newStatus = "IN_PROGRESS";
      }

      const isCompleted = /^\s*(\*\*)?(completed|done):?\s*(\*\*)?/i.test(
        body.message || "",
      );
      if (isCompleted) {
        newStatus = "REVIEW";
        enqueueAiJob(
          "activity-route",
          AI_PRIORITY_NORMAL,
          "activity-route",
          { message: `Task ${id} ready for review` },
          "__gateway__",
        );
      }

      const now = new Date().toISOString();
      const finalStatus = newStatus ?? taskRow.status;

      const newActivityRow = {
        id: randomUUID(),
        taskId: id,
        agentId: body.agentId ?? null,
        message: body.message,
        timestamp: now,
        taskStatus: finalStatus,
      };

      const updatedTaskRow = db.transaction(() => {
        if (newStatus) {
          db.update(tasksTable)
            .set({ status: newStatus, updatedAt: now })
            .where(eq(tasksTable.id, id))
            .run();
        }
        db.insert(activitiesTable).values(newActivityRow).run();
        return db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
      });

      const newActivity = activityRowToLog(newActivityRow);

      if (fastify.io) {
        fastify.io.emit("activity_added", newActivity);
        if (newStatus && updatedTaskRow) {
          fastify.io.emit("task_updated", rowToTask(updatedTaskRow));
        }
      }

      return reply.status(201).send(newActivity);
    },
  );

  // GET /api/tasks/:id/activities — all activity logs for a task, newest first
  fastify.get("/:id/activities", async (request, reply) => {
    const { id } = request.params as { id: string };
    const taskRow = db
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.id, id))
      .get();
    if (!taskRow) return reply.status(404).send({ error: "Task not found" });

    const rows = db
      .select()
      .from(activitiesTable)
      .where(eq(activitiesTable.taskId, id))
      .orderBy(desc(activitiesTable.timestamp))
      .all();

    const activities: ActivityLog[] = rows.map((r) => ({
      id: r.id,
      taskId: r.taskId ?? id,
      agentId: r.agentId ?? undefined,
      message: r.message,
      timestamp: r.timestamp,
      taskStatus: r.taskStatus as ActivityLog["taskStatus"],
    }));

    return reply.send(activities);
  });

  // POST /api/tasks/:id/route — dispatch a task to an AI agent via spawnTaskSession
  const RouteTaskSchema = z.object({
    agentId: z.string(),
    prompt: z.string().optional(),
  });

  fastify.post(
    "/:id/route",
    { schema: { body: RouteTaskSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof RouteTaskSchema>;

      const taskRow = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .get();
      if (!taskRow) {
        return reply.status(404).send({ error: "Task not found" });
      }

      if (
        taskRow.status === "IN_PROGRESS" ||
        taskRow.status === "REVIEW" ||
        taskRow.status === "DONE"
      ) {
        return reply.status(409).send({
          error: `Task is already in '${taskRow.status}' state and cannot be re-routed.`,
        });
      }

      const now = new Date().toISOString();

      // Persist agentId + ASSIGNED status synchronously before returning
      const updatedRow = db
        .update(tasksTable)
        .set({
          agentId: body.agentId,
          status: "ASSIGNED",
          updatedAt: now,
        })
        .where(eq(tasksTable.id, id))
        .returning()
        .get();

      if (!updatedRow)
        return reply.status(404).send({ error: "Task not found" });

      const updatedTask = rowToTask(updatedRow);

      // Persist the routing activity log
      const routeActivityId = randomUUID();
      db.insert(activitiesTable)
        .values({
          id: routeActivityId,
          taskId: id,
          agentId: null,
          message: `Task routed to agent '${body.agentId}' — dispatching…`,
          timestamp: now,
        })
        .run();

      if (fastify.io) {
        fastify.io.emit("task_updated", updatedTask);
        fastify.io.emit("activity_added", {
          id: routeActivityId,
          taskId: id,
          agentId: undefined,
          message: `Task routed to agent '${body.agentId}' — dispatching…`,
          timestamp: now,
          taskStatus: updatedTask.status,
        });
      }

      // Return 202 immediately — the heavy AI work runs detached
      reply.status(202).send({ id, status: "pending" });

      const baseUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT}`;
      const callbackUrl = `${baseUrl}/api/tasks/${id}/activity`;
      const taskContext = [
        body.prompt ??
          [taskRow.title, taskRow.description].filter(Boolean).join("\n\n"),
        `---`,
        `TASK METADATA (do not include in your work output):`,
        `taskId: ${id}`,
        `When you have finished, POST your result to:`,
        `  POST ${callbackUrl}`,
        `  Authorization: Bearer ${env.API_KEY}`,
        `  Content-Type: application/json`,
        `  Body: { "agent_id": "${body.agentId}", "message": "completed: <FULL OUTPUT HERE>" }`,
        `IMPORTANT: The "message" field must contain your COMPLETE work output — the full text,`,
        `answer, or result. Do NOT abbreviate or summarize. A human reviewer reads it directly`,
        `from the activity log. Start the message with "completed: " followed by the full output.`,
        `On error use: { "agent_id": "${body.agentId}", "message": "error: <description>" }`,
      ].join("\n");
      const prompt = taskContext;

      enqueueAiJob(
        "task-route",
        AI_PRIORITY_NORMAL,
        "task-route",
        {
          taskId: id,
          agentId: body.agentId,
          prompt,
        },
        body.agentId,
      );
    },
  );

  const CreateDeliverableSchema = z.object({
    title: z.string(),
    file_path: z.string().optional(),
  });

  fastify.post(
    "/:id/deliverables",
    { schema: { body: CreateDeliverableSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof CreateDeliverableSchema>;

      const taskRow = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .get();
      if (!taskRow) {
        return reply.status(404).send({ error: "Task not found" });
      }

      const existingDeliverables = taskRow.deliverables ?? [];
      const newDeliverable: Deliverable = {
        id: randomUUID(),
        taskId: id,
        title: body.title,
        file_path: body.file_path,
        status: "PENDING",
      };

      existingDeliverables.push(newDeliverable);
      const now = new Date().toISOString();

      const updatedRow = db
        .update(tasksTable)
        .set({
          deliverables: existingDeliverables,
          updatedAt: now,
        })
        .where(eq(tasksTable.id, id))
        .returning()
        .get();

      if (fastify.io && updatedRow) {
        fastify.io.emit("task_updated", rowToTask(updatedRow));
      }

      return reply.status(201).send(newDeliverable);
    },
  );

  const ReviewTaskSchema = z.object({
    action: z.enum(["approve", "reject"]),
    feedback: z.string().optional(),
  });

  fastify.post(
    "/:id/review",
    { schema: { body: ReviewTaskSchema } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as z.infer<typeof ReviewTaskSchema>;

      const taskRow = db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, id))
        .get();
      if (!taskRow) {
        return reply.status(404).send({ error: "Task not found" });
      }

      const newStatus = body.action === "approve" ? "DONE" : "IN_PROGRESS";
      const now = new Date().toISOString();
      const rejectActivityId = randomUUID();

      const updatedRow = db.transaction(() => {
        db.update(tasksTable)
          .set({ status: newStatus, updatedAt: now })
          .where(eq(tasksTable.id, id))
          .run();

        if (body.action === "reject") {
          db.insert(activitiesTable)
            .values({
              id: rejectActivityId,
              taskId: id,
              agentId: null,
              message: body.feedback
                ? `Review rejected with feedback: ${body.feedback}`
                : `Review rejected — task returned to In Progress.`,
              timestamp: now,
            })
            .run();
        }

        return db.select().from(tasksTable).where(eq(tasksTable.id, id)).get();
      });

      const updatedTask = updatedRow
        ? rowToTask(updatedRow)
        : rowToTask({ ...taskRow, status: newStatus, updatedAt: now });

      if (fastify.io) {
        fastify.io.emit("task_reviewed", { id, action: body.action });
        fastify.io.emit("task_updated", updatedTask);
        if (body.action === "reject") {
          fastify.io.emit("activity_added", {
            id: rejectActivityId,
            taskId: id,
            agentId: undefined,
            message: body.feedback
              ? `Review rejected with feedback: ${body.feedback}`
              : `Review rejected — task returned to In Progress.`,
            timestamp: now,
            taskStatus: updatedTask.status,
          } satisfies ActivityLog);
        }
      }

      // For reject: re-dispatch to the agent's task session with feedback prepended.
      // Runs detached — status is already IN_PROGRESS in the DB.
      if (body.action === "reject") {
        const assignedAgentId = taskRow.agentId ?? "main";
        const baseUrl = env.PUBLIC_URL ?? `http://localhost:${env.PORT}`;
        const callbackUrl = `${baseUrl}/api/tasks/${id}/activity`;

        // Fetch the prior activity log (chronological order) so the agent
        // knows what it did in the previous attempt.
        const priorActivities = db
          .select()
          .from(activitiesTable)
          .where(eq(activitiesTable.taskId, id))
          .orderBy(activitiesTable.timestamp)
          .all();

        const priorWorkSection =
          priorActivities.length > 0
            ? [
                ``,
                `Prior work log (your previous attempt):`,
                ...priorActivities.map(
                  (a) =>
                    `[${a.timestamp}] ${a.agentId ?? "system"}: ${a.message}`,
                ),
              ].join("\n")
            : "";

        const retryPrompt = [
          body.feedback
            ? `A human reviewer rejected your previous attempt with this feedback:\n${body.feedback}\n\nPlease redo the task taking this feedback into account.`
            : `A human reviewer rejected your previous attempt. Please redo the task.`,
          priorWorkSection,
          ``,
          `Original task:`,
          [taskRow.title, taskRow.description].filter(Boolean).join("\n"),
          `---`,
          `TASK METADATA (do not include in your work output):`,
          `taskId: ${id}`,
          `When you have finished, POST your result to:`,
          `  POST ${callbackUrl}`,
          `  Authorization: Bearer ${env.API_KEY}`,
          `  Content-Type: application/json`,
          `  Body: { "agent_id": "${assignedAgentId}", "message": "completed: <FULL OUTPUT HERE>" }`,
          `IMPORTANT: The "message" field must contain your COMPLETE work output — the full text,`,
          `answer, or result. Do NOT abbreviate or summarize. A human reviewer reads it directly`,
          `from the activity log. Start the message with "completed: " followed by the full output.`,
          `On error use: { "agent_id": "${assignedAgentId}", "message": "error: <description>" }`,
        ].join("\n");

        enqueueAiJob(
          "review-reject",
          AI_PRIORITY_NORMAL,
          "review-reject",
          {
            taskId: id,
            agentId: assignedAgentId,
            prompt: retryPrompt,
          },
          assignedAgentId,
        );

        return reply.status(202).send(updatedTask);
      }

      return reply.send(updatedTask);
    },
  );
};

export default taskRoutes;
