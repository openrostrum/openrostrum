DROP INDEX `participants_submission_contact_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `participants_submission_contact_role_uq` ON `participants` (`submission_id`,`contact_id`,`role`);--> statement-breakpoint
ALTER TABLE `forms` ADD `notify_existing_contacts` integer DEFAULT true NOT NULL;