CREATE TABLE `stream_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`chunk` text NOT NULL,
	`timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stream_logs_task_id` ON `stream_logs` (`task_id`);