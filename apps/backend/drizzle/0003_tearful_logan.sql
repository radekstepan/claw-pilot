CREATE TABLE `ai_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_type` text NOT NULL,
	`label` text NOT NULL,
	`agentId` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_retry_at` text,
	`started_at` text,
	`completed_at` text,
	`last_heartbeat_at` text,
	`created_at` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `idx_ai_jobs_poll` ON `ai_jobs` (`status`,`next_retry_at`,`priority`);