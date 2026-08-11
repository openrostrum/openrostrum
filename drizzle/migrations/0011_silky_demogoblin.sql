CREATE TABLE `contact_field_values` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`field_id` text NOT NULL,
	`value` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `contact_field_values_contact_idx` ON `contact_field_values` (`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_field_values_contact_field_uq` ON `contact_field_values` (`contact_id`,`field_id`);--> statement-breakpoint
CREATE TABLE `contact_identity_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_user_id` text NOT NULL,
	`survivor_user_id` text,
	`survivor_email` text NOT NULL,
	`merge_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`survivor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`merge_id`) REFERENCES `contact_merges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_identity_aliases_survivor_idx` ON `contact_identity_aliases` (`organization_id`,`survivor_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_identity_aliases_org_user_uq` ON `contact_identity_aliases` (`organization_id`,`source_user_id`);--> statement-breakpoint
CREATE TABLE `contact_merges` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source_email` text NOT NULL,
	`survivor_email` text NOT NULL,
	`actor_id` text,
	`actor_name` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`summary` text NOT NULL,
	`retired_contacts` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_merges_survivor_idx` ON `contact_merges` (`organization_id`,`survivor_email`);--> statement-breakpoint
CREATE UNIQUE INDEX `contact_merges_org_key_uq` ON `contact_merges` (`organization_id`,`idempotency_key`);