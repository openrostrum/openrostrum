CREATE TABLE `calendar_invite_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`sequence` integer,
	`state_hash` text NOT NULL,
	`recipient` text NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`location` text,
	`title` text,
	`outbox_id` text NOT NULL,
	`invalid` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outbox_id`) REFERENCES `email_outbox`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_invite_revisions_outbox_submission_uq` ON `calendar_invite_revisions` (`outbox_id`,`submission_id`);
--> statement-breakpoint
CREATE INDEX `calendar_invite_revisions_submission_sequence_idx` ON `calendar_invite_revisions` (`submission_id`,`sequence`);
--> statement-breakpoint
CREATE TABLE `calendar_invite_processed_outbox` (
	`outbox_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`invalid` integer DEFAULT false NOT NULL,
	`processed_at` integer NOT NULL,
	FOREIGN KEY (`outbox_id`) REFERENCES `email_outbox`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `calendar_invite_sequence_frontiers` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`state_hash` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `email_outbox` ADD `send_claim_id` text;
--> statement-breakpoint
ALTER TABLE `email_outbox` ADD `send_claim_expires_at` integer;
