-- NO SQL BACKFILL — deliberate, and the one exception to the forward-data-
-- migration rule in docs/rules/engineering.md.
--
-- Backfilling `calendar_invite_revisions` from the existing `email_outbox`
-- rows would need two things D1 cannot do:
--   1. `state_hash` is NOT NULL and must equal the sha-256 the app computes.
--      D1's SQLite build has no `sha256()` — verified:
--        wrangler d1 execute openrostrum --local --command "select sha256('x')"
--        => no such function: sha256 (SQLITE_ERROR)
--      A placeholder is worse than nothing: the frontier compares hashes, so a
--      hash that cannot match makes every session look revised and re-sends an
--      invite to every speaker on the event.
--   2. SEQUENCE/DTSTART/SUMMARY live inside RFC 5545 text that is line-folded
--      and escaped. Unfolding and unescaping that is not expressible in SQL.
--
-- The forward migration therefore runs in app code, and is complete rather
-- than tolerant: `normalizeCalendarInviteHistory` indexes pre-existing history
-- in bounded passes, and both send paths write their own ledger rows through
-- `recordSentCalendarInvites`, so no reader ever parses an un-indexed row.
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
