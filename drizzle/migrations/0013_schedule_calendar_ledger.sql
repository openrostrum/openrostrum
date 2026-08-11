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
	`outbox_id` text,
	`invalid` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outbox_id`) REFERENCES `email_outbox`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_invite_revisions_submission_sequence_uq` ON `calendar_invite_revisions` (`submission_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_invite_revisions_submission_state_uq` ON `calendar_invite_revisions` (`submission_id`,`state_hash`);
--> statement-breakpoint
CREATE INDEX `calendar_invite_revisions_submission_idx` ON `calendar_invite_revisions` (`submission_id`);
--> statement-breakpoint
CREATE INDEX `calendar_invite_revisions_outbox_idx` ON `calendar_invite_revisions` (`outbox_id`);
--> statement-breakpoint
CREATE TABLE `calendar_invite_ledger_cursors` (
	`event_id` text PRIMARY KEY NOT NULL,
	`last_outbox_rowid` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
