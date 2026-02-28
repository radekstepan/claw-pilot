import { sqliteTable, text, index, integer } from "drizzle-orm/sqlite-core";
import { Deliverable } from "@claw-pilot/shared-types";

// ---------------------------------------------------------------------------
// Job payload types for the persistent AI queue
// ---------------------------------------------------------------------------
export type JobPayload =
  | { type: "chat"; data: { agentId: string; message: string } }
  | {
      type: "task-route";
      data: { taskId: string; agentId: string; prompt: string };
    }
  | { type: "activity-route"; data: { message: string } }
  | {
      type: "review-reject";
      data: { taskId: string; agentId: string; prompt: string };
    }
  | {
      type: "generate-config";
      data: { requestId: string; prompt: string; model?: string };
    }
  | {
      type: "recurring-spawn";
      data: { taskId: string; agentId: string; prompt: string };
    };

export type AiJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "stuck";

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    jobType: text("job_type").notNull(),
    label: text("label").notNull(),
    agentId: text("agentId"),
    priority: integer("priority").notNull().default(0),
    status: text("status").notNull().default("queued"),
    payload: text("payload", { mode: "json" }).$type<JobPayload>(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextRetryAt: text("next_retry_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    lastHeartbeatAt: text("last_heartbeat_at"),
    createdAt: text("created_at").notNull(),
    error: text("error"),
  },
  (t) => [index("idx_ai_jobs_poll").on(t.status, t.nextRetryAt, t.priority)],
);

// ---------------------------------------------------------------------------
// tasks
// Column names match the Zod TaskSchema field names exactly so no mapping
// is needed when reading rows back as Task objects.
// ---------------------------------------------------------------------------
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title"),
  description: text("description"),
  status: text("status").notNull().default("TODO"),
  priority: text("priority").default("MEDIUM"),
  /** JSON-encoded string[] */
  tags: text("tags", { mode: "json" }).$type<string[]>(),
  assignee_id: text("assignee_id"),
  agentId: text("agentId"),
  /** JSON-encoded Deliverable[] */
  deliverables: text("deliverables", { mode: "json" }).$type<Deliverable[]>(),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

// ---------------------------------------------------------------------------
// activities
// ---------------------------------------------------------------------------
export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    taskId: text("taskId"),
    agentId: text("agentId"),
    message: text("message").notNull(),
    timestamp: text("timestamp").notNull(),
    taskStatus: text("taskStatus"),
  },
  (t) => [index("idx_activities_timestamp").on(t.timestamp)],
);

// ---------------------------------------------------------------------------
// chat_messages
// ---------------------------------------------------------------------------
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    agentId: text("agentId"),
    role: text("role").notNull(),
    content: text("content").notNull(),
    timestamp: text("timestamp").notNull(),
  },
  (t) => [index("idx_chat_messages_timestamp").on(t.timestamp)],
);

// ---------------------------------------------------------------------------
// recurring_tasks
// Column names match RecurringTaskSchema field names (snake_case for
// schedule_type / schedule_value as defined in shared-types).
// ---------------------------------------------------------------------------
export const recurringTasks = sqliteTable("recurring_tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  schedule_type: text("schedule_type").notNull(),
  schedule_value: text("schedule_value"),
  /** ID of the OpenClaw agent auto-assigned when this template triggers. */
  assigned_agent_id: text("assigned_agent_id"),
  status: text("status").notNull().default("ACTIVE"),
  last_triggered_at: text("last_triggered_at"),
  createdAt: text("createdAt").notNull(),
  updatedAt: text("updatedAt").notNull(),
});
