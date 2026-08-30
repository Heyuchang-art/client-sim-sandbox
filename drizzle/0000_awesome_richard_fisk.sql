CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `simulation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text,
	`seed` integer NOT NULL,
	`customer_count` integer NOT NULL,
	`time_steps` integer NOT NULL,
	`recommended_strategy` text NOT NULL,
	`summary_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`created_at` integer NOT NULL
);
