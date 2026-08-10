CREATE TABLE `session_statuses` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#71717a' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_statuses_event_idx` ON `session_statuses` (`event_id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `public_visible` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `portals` ADD `welcome_message` text;--> statement-breakpoint
ALTER TABLE `portals` ADD `accent_color` text;--> statement-breakpoint
ALTER TABLE `portals` ADD `logo_key` text;--> statement-breakpoint
ALTER TABLE `portals` ADD `background_key` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `custom_status_id` text REFERENCES session_statuses(id);--> statement-breakpoint
ALTER TABLE `submissions` ADD `parent_id` text REFERENCES submissions(id);--> statement-breakpoint
CREATE INDEX `submissions_parent_idx` ON `submissions` (`parent_id`);