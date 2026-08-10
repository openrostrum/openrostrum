CREATE TABLE `ai_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`score` real NOT NULL,
	`rationale` text NOT NULL,
	`model` text NOT NULL,
	`override_score` real,
	`override_by_id` text,
	`override_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`override_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_reviews_submission_uq` ON `ai_reviews` (`submission_id`);