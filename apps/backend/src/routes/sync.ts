import { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  db,
  tasks,
  activities,
  chatMessages,
  recurringTasks,
  notArchived,
} from "../db/index.js";
import { eq, gte, and } from "drizzle-orm";
import {
  SyncQuerySchema,
  SyncResponse,
  ActivityLog,
  ChatMessage,
  Task,
  RecurringTask,
} from "@claw-pilot/shared-types";

const syncRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/",
    { schema: { querystring: SyncQuerySchema } },
    async (request, reply) => {
      const { since } = request.query;

      const updatedTasksData = db
        .select()
        .from(tasks)
        .where(and(gte(tasks.updatedAt, since), notArchived))
        .all();
      const updatedActivitiesData = db
        .select()
        .from(activities)
        .where(gte(activities.timestamp, since))
        .all();
      const updatedChatMessagesData = db
        .select()
        .from(chatMessages)
        .where(gte(chatMessages.timestamp, since))
        .all();
      const updatedRecurringData = db
        .select()
        .from(recurringTasks)
        .where(gte(recurringTasks.updatedAt, since))
        .all();

      const activeTaskIdsRow = db
        .select({ id: tasks.id })
        .from(tasks)
        .where(notArchived)
        .all();
      const activeTaskIds = activeTaskIdsRow.map((r) => r.id);

      const response: SyncResponse = {
        tasks: updatedTasksData.map(
          (row): Task => ({
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
          }),
        ),
        activities: updatedActivitiesData.map(
          (r): ActivityLog => ({
            id: r.id,
            taskId: r.taskId ?? "",
            agentId: r.agentId ?? undefined,
            message: r.message,
            timestamp: r.timestamp,
          }),
        ),
        chatHistory: updatedChatMessagesData.map(
          (r): ChatMessage => ({
            id: r.id,
            agentId: r.agentId ?? undefined,
            role: r.role as ChatMessage["role"],
            content: r.content,
            timestamp: r.timestamp,
          }),
        ),
        recurringTasks: updatedRecurringData.map(
          (r): RecurringTask => ({
            id: r.id,
            title: r.title,
            description: r.description ?? undefined,
            schedule_type: r.schedule_type as RecurringTask["schedule_type"],
            schedule_value: r.schedule_value ?? undefined,
            assigned_agent_id: r.assigned_agent_id ?? undefined,
            status: r.status as RecurringTask["status"],
            last_triggered_at: r.last_triggered_at ?? undefined,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }),
        ),
        activeTaskIds,
      };

      return reply.send(response);
    },
  );
};

export default syncRoutes;
