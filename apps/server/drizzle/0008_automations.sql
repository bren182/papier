CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger` text NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	`tz` text DEFAULT 'UTC' NOT NULL,
	`order_key` text NOT NULL,
	`next_run_at` integer,
	`last_run_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `automations_database_order` ON `automations` (`database_id`,`order_key`);--> statement-breakpoint
CREATE INDEX `automations_due` ON `automations` (`enabled`,`next_run_at`);