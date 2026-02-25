import { z } from 'zod';

export const DeliverableSchema = z.object({
    id: z.string(),
    taskId: z.string().optional(),
    title: z.string(),
    file_path: z.string().optional(),
    status: z.enum(['PENDING', 'COMPLETED']).default('PENDING')
});
export type Deliverable = z.infer<typeof DeliverableSchema>;

export const RecurringTaskSchema = z.object({
    id: z.string(),
    title: z.string(),
    schedule_type: z.string(),
    schedule_value: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).default('ACTIVE'),
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
}

export interface ClientToServerEvents {
    // Empty for now, add as needed
}
