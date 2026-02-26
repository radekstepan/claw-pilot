import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// tasks
// Column names match the Zod TaskSchema field names exactly so no mapping
// is needed when reading rows back as Task objects.
// ---------------------------------------------------------------------------
export const tasks = sqliteTable('tasks', {
    id:           text('id').primaryKey(),
    title:        text('title'),
    description:  text('description'),
    status:       text('status').notNull().default('TODO'),
    priority:     text('priority').default('MEDIUM'),
    /** JSON-encoded string[] */
    tags:         text('tags'),
    assignee_id:  text('assignee_id'),
    agentId:      text('agentId'),
    /** JSON-encoded Deliverable[] */
    deliverables: text('deliverables'),
    createdAt:    text('createdAt').notNull(),
    updatedAt:    text('updatedAt').notNull(),
});

// ---------------------------------------------------------------------------
// activities
// ---------------------------------------------------------------------------
export const activities = sqliteTable('activities', {
    id:        text('id').primaryKey(),
    taskId:    text('taskId'),
    agentId:   text('agentId'),
    message:   text('message').notNull(),
    timestamp: text('timestamp').notNull(),
}, (t) => [
    index('idx_activities_timestamp').on(t.timestamp),
]);

// ---------------------------------------------------------------------------
// chat_messages
// ---------------------------------------------------------------------------
export const chatMessages = sqliteTable('chat_messages', {
    id:        text('id').primaryKey(),
    agentId:   text('agentId'),
    role:      text('role').notNull(),
    content:   text('content').notNull(),
    timestamp: text('timestamp').notNull(),
}, (t) => [
    index('idx_chat_messages_timestamp').on(t.timestamp),
]);

// ---------------------------------------------------------------------------
// recurring_tasks
// Column names match RecurringTaskSchema field names (snake_case for
// schedule_type / schedule_value as defined in shared-types).
// ---------------------------------------------------------------------------
export const recurringTasks = sqliteTable('recurring_tasks', {
    id:                 text('id').primaryKey(),
    title:              text('title').notNull(),
    description:        text('description'),
    schedule_type:      text('schedule_type').notNull(),
    schedule_value:     text('schedule_value'),
    /** ID of the OpenClaw agent auto-assigned when this template triggers. */
    assigned_agent_id:  text('assigned_agent_id'),
    status:             text('status').notNull().default('ACTIVE'),
    last_triggered_at:  text('last_triggered_at'),
    createdAt:          text('createdAt').notNull(),
    updatedAt:          text('updatedAt').notNull(),
});
