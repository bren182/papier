CREATE TABLE `property_links` (
	`page_id` text NOT NULL,
	`prop_id` text NOT NULL,
	`target_id` text NOT NULL,
	`order_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`page_id`, `prop_id`, `target_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prop_id`) REFERENCES `db_properties`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `property_links_target` ON `property_links` (`prop_id`,`target_id`);--> statement-breakpoint
DROP INDEX `search_rows_title`;--> statement-breakpoint
ALTER TABLE `search_rows` ADD `prop_id` text REFERENCES db_properties(id) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `search_rows_prop` ON `search_rows` (`page_id`,`prop_id`) WHERE "search_rows"."prop_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `search_rows_title` ON `search_rows` (`page_id`) WHERE "search_rows"."block_id" is null and "search_rows"."prop_id" is null;