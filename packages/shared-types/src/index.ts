import { z } from 'zod';

export const TaskSchema = z.object({
    id: z.string(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['BACKLOG', 'TODO', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE', 'STUCK']).default('TODO'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const AgentSchema = z.object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['WORKING', 'IDLE', 'OFFLINE']),
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

export interface ServerToClientEvents {
    task_updated: (task: Task) => void;
    activity_added: (activity: ActivityLog) => void;
    agent_status_changed: (agent: Agent) => void;
    chat_message: (message: any) => void;
}

export interface ClientToServerEvents {
    // Empty for now, add as needed
}
