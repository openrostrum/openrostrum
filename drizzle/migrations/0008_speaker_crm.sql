CREATE TABLE `person_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `person_notes_org_email_idx` ON `person_notes` (`organization_id`,`email`);--> statement-breakpoint
CREATE TABLE `crm_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`filters` text NOT NULL,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `crm_segments_org_name_uq` ON `crm_segments` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `crm_pipeline_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`company_name` text,
	`stage` text DEFAULT 'researching' NOT NULL,
	`score` integer,
	`rationale` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crm_pipeline_cards_org_stage_idx` ON `crm_pipeline_cards` (`organization_id`,`stage`);--> statement-breakpoint
CREATE UNIQUE INDEX `crm_pipeline_cards_org_email_uq` ON `crm_pipeline_cards` (`organization_id`,`email`);--> statement-breakpoint
CREATE TABLE `crm_stage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`from_stage` text,
	`to_stage` text NOT NULL,
	`changed_by_id` text,
	`changed_by_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `crm_pipeline_cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `crm_stage_history_card_idx` ON `crm_stage_history` (`card_id`);