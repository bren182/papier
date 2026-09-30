CREATE TABLE `db_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `db_properties_database_order` ON `db_properties` (`database_id`,`order_key`);--> statement-breakpoint
CREATE TABLE `db_views` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `db_views_database_order` ON `db_views` (`database_id`,`order_key`);--> statement-breakpoint
CREATE TABLE `page_props` (
	`page_id` text NOT NULL,
	`prop_id` text NOT NULL,
	`value` text NOT NULL,
	`sort_text` text,
	`sort_num` real,
	PRIMARY KEY(`page_id`, `prop_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prop_id`) REFERENCES `db_properties`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `page_props_prop_text` ON `page_props` (`prop_id`,`sort_text`);--> statement-breakpoint
CREATE INDEX `page_props_prop_num` ON `page_props` (`prop_id`,`sort_num`);--> statement-breakpoint
ALTER TABLE `pages` ADD `kind` text DEFAULT 'page' NOT NULL;