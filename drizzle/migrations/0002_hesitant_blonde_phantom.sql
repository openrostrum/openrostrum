CREATE TABLE `organization_members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `organization_members_user_idx` ON `organization_members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_members_org_user_uq` ON `organization_members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `event_id` text REFERENCES events(id);--> statement-breakpoint
CREATE INDEX `api_tokens_org_idx` ON `api_tokens` (`organization_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
ALTER TABLE `fields` ADD `organization_id` text REFERENCES organizations(id);--> statement-breakpoint
CREATE INDEX `fields_org_idx` ON `fields` (`organization_id`);--> statement-breakpoint
INSERT INTO `organizations` (`id`, `name`, `created_at`)
SELECT 'org_demo', 'Demo', unixepoch() WHERE EXISTS (SELECT 1 FROM `events`);--> statement-breakpoint
INSERT INTO `organization_members` (`id`, `organization_id`, `user_id`, `created_at`)
SELECT 'om_' || `id`, 'org_demo', `id`, unixepoch() FROM `users`
WHERE `role` = 'admin' AND EXISTS (SELECT 1 FROM `organizations` WHERE `id` = 'org_demo');--> statement-breakpoint
UPDATE `events` SET `organization_id` = 'org_demo';--> statement-breakpoint
UPDATE `api_tokens` SET `organization_id` = 'org_demo';--> statement-breakpoint
UPDATE `fields` SET `organization_id` = 'org_demo', `event_id` = NULL WHERE `scope` = 'global';
