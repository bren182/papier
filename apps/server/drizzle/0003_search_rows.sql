CREATE TABLE `search_rows` (
	`id` integer PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`block_id` text,
	`text` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`block_id`) REFERENCES `blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_rows_block_id_unique` ON `search_rows` (`block_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `search_rows_title` ON `search_rows` (`page_id`) WHERE "search_rows"."block_id" is null;