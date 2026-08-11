CREATE TABLE `contact_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`field_id` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_answers_org_email_idx` ON `contact_answers` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `contact_answers_field_idx` ON `contact_answers` (`field_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_answers_org_email_field_uq` ON `contact_answers` (`organization_id`,`email`,`field_id`);--> statement-breakpoint
ALTER TABLE `fields` ADD `record_type` text DEFAULT 'session' NOT NULL;--> statement-breakpoint
CREATE INDEX `fields_record_type_org_idx` ON `fields` (`record_type`,`organization_id`);