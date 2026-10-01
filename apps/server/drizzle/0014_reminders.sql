CREATE TABLE `reminders` (
  `id` text PRIMARY KEY NOT NULL,
  `page_id` text NOT NULL,
  `block_id` text NOT NULL REFERENCES `blocks`(`id`) ON DELETE CASCADE,
  `date` text NOT NULL,
  `note` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX `reminders_date` ON `reminders` (`date`);
--> statement-breakpoint
CREATE INDEX `reminders_block` ON `reminders` (`block_id`);
