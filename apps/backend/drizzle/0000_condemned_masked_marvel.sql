CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text,
	`agentId` text,
	`message` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_activities_timestamp` ON `activities` (`timestamp`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`agentId` text,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_timestamp` ON `chat_messages` (`timestamp`);--> statement-breakpoint
CREATE TABLE `recurring_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`schedule_type` text NOT NULL,
	`schedule_value` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`description` text,
	`status` text DEFAULT 'TODO' NOT NULL,
	`priority` text DEFAULT 'MEDIUM',
	`tags` text,
	`assignee_id` text,
	`agentId` text,
	`deliverables` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
