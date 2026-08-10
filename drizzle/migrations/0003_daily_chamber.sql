PRAGMA defer_foreign_keys = true;--> statement-breakpoint
CREATE TABLE `__new_api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_api_tokens`("id", "organization_id", "event_id", "name", "token_hash", "created_at", "last_used_at") SELECT "id", "organization_id", "event_id", "name", "token_hash", "created_at", "last_used_at" FROM `api_tokens`;--> statement-breakpoint
DROP TABLE `api_tokens`;--> statement-breakpoint
ALTER TABLE `__new_api_tokens` RENAME TO `api_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_tokens_org_idx` ON `api_tokens` (`organization_id`);--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`type` text DEFAULT 'Conference' NOT NULL,
	`website_url` text,
	`location` text,
	`timezone` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`theme` text,
	`logo_key` text,
	`background_key` text,
	`starts_at` integer,
	`ends_at` integer,
	`submission_limit` integer,
	`agenda_day_start_min` integer DEFAULT 480 NOT NULL,
	`agenda_day_end_min` integer DEFAULT 1080 NOT NULL,
	`schedulable_statuses` text,
	`agenda_published_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "organization_id", "name", "slug", "type", "website_url", "location", "timezone", "theme", "logo_key", "background_key", "starts_at", "ends_at", "submission_limit", "agenda_day_start_min", "agenda_day_end_min", "schedulable_statuses", "agenda_published_at", "created_at") SELECT "id", "organization_id", "name", "slug", "type", "website_url", "location", "timezone", "theme", "logo_key", "background_key", "starts_at", "ends_at", "submission_limit", "agenda_day_start_min", "agenda_day_end_min", "schedulable_statuses", "agenda_published_at", "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_unique` ON `events` (`slug`);--> statement-breakpoint
ALTER TABLE `fields` DROP COLUMN `scope`;