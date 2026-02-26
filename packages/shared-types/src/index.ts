import { z } from 'zod';

export const DeliverableSchema = z.object({
    id: z.string(),
    taskId: z.string().optional(),
    title: z.string(),
    file_path: z.string().optional(),
    status: z.enum(['PENDING', 'COMPLETED']).default('PENDING')
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

export const RecurringScheduleTypeEnum = z.enum(['HOURLY', 'DAILY', 'WEEKLY', 'CUSTOM']);
export type RecurringScheduleType = z.infer<typeof RecurringScheduleTypeEnum>;

export const RecurringTaskSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    schedule_type: RecurringScheduleTypeEnum,
    schedule_value: z.string().optional(),
    /** ID of the OpenClaw agent that should automatically receive tasks spawned from this template. */
    assigned_agent_id: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).default('ACTIVE'),
    last_triggered_at: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});
export type RecurringTask = z.infer<typeof RecurringTaskSchema>;

export const TaskStatusEnum = z.enum(['BACKLOG', 'TODO', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE', 'STUCK']);
export type TaskStatus = z.infer<typeof TaskStatusEnum>;

export const TaskPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type TaskPriority = z.infer<typeof TaskPriorityEnum>;

export const TaskSchema = z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: TaskStatusEnum.default('TODO'),
    priority: TaskPriorityEnum.optional(),
    tags: z.array(z.string()).optional(),
    assignee_id: z.string().optional(),
    /** ID of the OpenClaw agent currently assigned to this task. */
    agentId: z.string().optional(),
    deliverables: z.array(DeliverableSchema).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    status: TaskStatusEnum.optional(),
    priority: TaskPriorityEnum.optional(),
    tags: z.array(z.string()).optional(),
    assignee_id: z.string().optional()
});
export type CreateTaskPayload = z.infer<typeof CreateTaskSchema>;

export const UpdateTaskSchema = TaskSchema.partial().extend({
    agentId: z.string().optional()
});
export type UpdateTaskPayload = z.infer<typeof UpdateTaskSchema>;

export const AgentSchema = z.object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['WORKING', 'IDLE', 'OFFLINE']),
    // Fields sourced from ~/.openclaw/openclaw.json
    role: z.string().optional(),
    model: z.string().optional(),
    fallback: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    lastSeen: z.string().optional()
});
export type Agent = z.infer<typeof AgentSchema>;

export const ActivityLogSchema = z.object({
    id: z.string(),
    taskId: z.string(),
    agentId: z.string().optional(),
    message: z.string(),
    timestamp: z.string(),
});
export type ActivityLog = z.infer<typeof ActivityLogSchema>;

export const ChatMessageSchema = z.object({
    id: z.string(),
    agentId: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    timestamp: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export interface ServerToClientEvents {
    task_created: (payload: { id: string; title?: string }) => void;
    task_updated: (task: Task) => void;
    task_deleted: (payload: { id: string }) => void;
    task_reviewed: (payload: { id: string; action: 'approve' | 'reject' }) => void;
    activity_added: (activity: ActivityLog) => void;
    agent_status_changed: (agent: Agent) => void;
    chat_message: (message: ChatMessage) => void;
    chat_cleared: () => void;
    /** Emitted when an async /send-to-agent CLI call fails. */
    agent_error: (payload: { agentId: string; error: string }) => void;
    /** Emitted when an async /agents/generate CLI call completes. */
    agent_config_generated: (payload: { requestId: string; config: unknown }) => void;
    /** Emitted when an async /agents/generate CLI call fails. */
    agent_config_error: (payload: { requestId: string; error: string }) => void;
    /** Emitted when the OpenClaw gateway comes online or goes offline. */
    gateway_status: (payload: { online: boolean; pairingRequired?: boolean; deviceId?: string }) => void;
}

export interface ClientToServerEvents {
    // Empty for now, add as needed
}

export const AppConfigSchema = z.object({
    gatewayUrl: z.string(),
    apiPort: z.number(),
    autoRestart: z.boolean(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;

export const CreateRecurringPayloadSchema = z.object({
    title: z.string(),
    description: z.string().optional(),
    schedule_type: RecurringScheduleTypeEnum,
    schedule_value: z.string().optional(),
    assigned_agent_id: z.string().optional(),
});
export type CreateRecurringPayload = z.infer<typeof CreateRecurringPayloadSchema>;

// ---------------------------------------------------------------------------
// Pagination helpers
// ---------------------------------------------------------------------------

/** Query schema for cursor-based pagination (Chat, Activities — newest first). */
export const CursorPageQuerySchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type CursorPageQuery = z.infer<typeof CursorPageQuerySchema>;

/** Response envelope for cursor-based pages. */
export interface CursorPageResponse<T> {
    data: T[];
    /** ID of the last record in this page; pass as `cursor` in the next request. `null` means end of data. */
    nextCursor: string | null;
}

/** Query schema for offset-based pagination (Tasks — full Kanban snapshot). */
export const OffsetPageQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(200),
    offset: z.coerce.number().int().min(0).default(0),
});
export type OffsetPageQuery = z.infer<typeof OffsetPageQuerySchema>;

/** Response envelope for offset-based pages. */
export interface OffsetPageResponse<T> {
    data: T[];
    total: number;
}

// ---------------------------------------------------------------------------
// Sync endpoints
// ---------------------------------------------------------------------------

export const SyncQuerySchema = z.object({
    since: z.string()
});
export type SyncQuery = z.infer<typeof SyncQuerySchema>;

export const SyncResponseSchema = z.object({
    tasks: z.array(TaskSchema),
    activities: z.array(ActivityLogSchema),
    chatHistory: z.array(ChatMessageSchema),
    recurringTasks: z.array(RecurringTaskSchema),
    activeTaskIds: z.array(z.string())
});
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
