CREATE TABLE `airtable_links` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`airtable_id` text NOT NULL,
	`base_snapshot` text,
	`synced_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_links_airtable_id_unique` ON `airtable_links` (`airtable_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `airtable_links_table_record_uq` ON `airtable_links` (`table_name`,`record_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_tokens_token_hash_unique` ON `api_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`salutation` text,
	`honorific` text,
	`pronouns` text,
	`gender` text,
	`job_title` text,
	`company_name` text,
	`mobile_phone` text,
	`home_phone` text,
	`zip` text,
	`bio` text,
	`headshot_key` text,
	`linkedin_url` text,
	`twitter_url` text,
	`facebook_url` text,
	`website_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`logistics_notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contacts_event_idx` ON `contacts` (`event_id`);--> statement-breakpoint
CREATE INDEX `contacts_user_idx` ON `contacts` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_event_email_uq` ON `contacts` (`event_id`,`email`);--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`template_id` text,
	`dedupe_key` text,
	`to` text NOT NULL,
	`reply_to` text,
	`subject` text NOT NULL,
	`html` text NOT NULL,
	`ics_attachment` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`error` text,
	`provider_id` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`template_id`) REFERENCES `email_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_outbox_dedupe_key_unique` ON `email_outbox` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `email_outbox_event_idx` ON `email_outbox` (`event_id`);--> statement-breakpoint
CREATE INDEX `email_outbox_status_idx` ON `email_outbox` (`status`);--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_suppressions_email_unique` ON `email_suppressions` (`email`);--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body_html` text DEFAULT '' NOT NULL,
	`reply_to` text,
	`category` text DEFAULT 'lifecycle' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_templates_event_idx` ON `email_templates` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_event_key_uq` ON `email_templates` (`event_id`,`key`);--> statement-breakpoint
CREATE TABLE `embeds` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`public_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `embeds_public_id_unique` ON `embeds` (`public_id`);--> statement-breakpoint
CREATE INDEX `embeds_event_idx` ON `embeds` (`event_id`);--> statement-breakpoint
CREATE TABLE `evaluation_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_id` text NOT NULL,
	`question_id` text NOT NULL,
	`value_number` real,
	`value_text` text,
	FOREIGN KEY (`evaluation_id`) REFERENCES `evaluations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `round_questions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `evaluation_answers_evaluation_idx` ON `evaluation_answers` (`evaluation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_answers_uq` ON `evaluation_answers` (`evaluation_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `evaluation_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluation_plans_event_idx` ON `evaluation_plans` (`event_id`);--> statement-breakpoint
CREATE TABLE `evaluation_rounds` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	`anonymized` integer DEFAULT false NOT NULL,
	`show_other_scores` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `evaluation_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluation_rounds_plan_idx` ON `evaluation_rounds` (`plan_id`);--> statement-breakpoint
CREATE TABLE `evaluations` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`evaluator_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`abstain_reason` text,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `evaluation_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evaluator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluations_evaluator_status_idx` ON `evaluations` (`evaluator_id`,`status`);--> statement-breakpoint
CREATE INDEX `evaluations_submission_idx` ON `evaluations` (`submission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `evaluations_round_submission_evaluator_uq` ON `evaluations` (`round_id`,`submission_id`,`evaluator_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
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
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_slug_unique` ON `events` (`slug`);--> statement-breakpoint
CREATE TABLE `fields` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`name` text NOT NULL,
	`type` text DEFAULT 'text' NOT NULL,
	`description` text,
	`max_length` integer,
	`options` text,
	`scope` text DEFAULT 'event' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fields_event_idx` ON `fields` (`event_id`);--> statement-breakpoint
CREATE TABLE `file_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`author_id` text,
	`author_name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `file_comments_file_idx` ON `file_comments` (`file_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`submission_id` text,
	`contact_id` text,
	`task_assignment_id` text,
	`r2_key` text NOT NULL,
	`file_name` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`content_type` text,
	`size_bytes` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`review_status` text DEFAULT 'none' NOT NULL,
	`review_note` text,
	`shared_to_portal` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_assignment_id`) REFERENCES `task_assignments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `files_submission_idx` ON `files` (`submission_id`);--> statement-breakpoint
CREATE INDEX `files_contact_idx` ON `files` (`contact_id`);--> statement-breakpoint
CREATE INDEX `files_shared_idx` ON `files` (`event_id`,`shared_to_portal`);--> statement-breakpoint
CREATE TABLE `form_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`form_id` text NOT NULL,
	`field_id` text,
	`builtin_ref` text,
	`section` text DEFAULT 'session' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`locked` integer DEFAULT false NOT NULL,
	`question_rule` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `form_fields_form_idx` ON `form_fields` (`form_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `form_fields_form_field_uq` ON `form_fields` (`form_id`,`field_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `form_fields_form_builtin_uq` ON `form_fields` (`form_id`,`builtin_ref`);--> statement-breakpoint
CREATE TABLE `formats` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`default_duration_mins` integer DEFAULT 30 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `formats_event_idx` ON `formats` (`event_id`);--> statement-breakpoint
CREATE TABLE `forms` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`public_id` text NOT NULL,
	`type` text DEFAULT 'session' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`internal_name` text NOT NULL,
	`external_title` text DEFAULT '' NOT NULL,
	`page_heading` text DEFAULT '' NOT NULL,
	`welcome_html` text,
	`show_welcome` integer DEFAULT true NOT NULL,
	`participants_step` integer DEFAULT true NOT NULL,
	`session_section_title` text,
	`session_section_html` text,
	`participant_section_title` text,
	`participant_section_html` text,
	`role_speaker_min` integer DEFAULT 1 NOT NULL,
	`role_speaker_max` integer,
	`allow_chairperson` integer DEFAULT false NOT NULL,
	`role_chairperson_min` integer DEFAULT 0 NOT NULL,
	`role_chairperson_max` integer,
	`allow_moderator` integer DEFAULT false NOT NULL,
	`role_moderator_min` integer DEFAULT 0 NOT NULL,
	`role_moderator_max` integer,
	`close_at` integer,
	`send_reminders` integer DEFAULT false NOT NULL,
	`submission_limit` integer,
	`allow_multiple_drafts` integer DEFAULT false NOT NULL,
	`auto_redirect` integer DEFAULT true NOT NULL,
	`success_html` text,
	`send_confirmation_email` integer DEFAULT true NOT NULL,
	`config` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `forms_public_id_unique` ON `forms` (`public_id`);--> statement-breakpoint
CREATE INDEX `forms_event_idx` ON `forms` (`event_id`);--> statement-breakpoint
CREATE TABLE `languages` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `languages_event_idx` ON `languages` (`event_id`);--> statement-breakpoint
CREATE TABLE `levels` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `levels_event_idx` ON `levels` (`event_id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`role` text DEFAULT 'speaker' NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`acceptance_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_submission_idx` ON `participants` (`submission_id`);--> statement-breakpoint
CREATE INDEX `participants_contact_idx` ON `participants` (`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_submission_contact_uq` ON `participants` (`submission_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_token_unique` ON `password_resets` (`token`);--> statement-breakpoint
CREATE TABLE `portal_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`target_type` text DEFAULT 'contact' NOT NULL,
	`schema` text,
	`send_confirmation_email` integer DEFAULT false NOT NULL,
	`confirmation_html` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `portal_forms_event_idx` ON `portal_forms` (`event_id`);--> statement-breakpoint
CREATE TABLE `portals` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`public_id` text NOT NULL,
	`name` text DEFAULT 'Speaker Portal' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portals_public_id_unique` ON `portals` (`public_id`);--> statement-breakpoint
CREATE INDEX `portals_event_idx` ON `portals` (`event_id`);--> statement-breakpoint
CREATE TABLE `reviewer_tracks` (
	`user_id` text NOT NULL,
	`track_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `track_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviewer_tracks_track_idx` ON `reviewer_tracks` (`track_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`decision` text NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reviews_submission_idx` ON `reviews` (`submission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_submission_reviewer_uq` ON `reviews` (`submission_id`,`reviewer_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`capacity` integer,
	`display_order` integer DEFAULT 0 NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `rooms_event_idx` ON `rooms` (`event_id`);--> statement-breakpoint
CREATE TABLE `round_evaluators` (
	`round_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`round_id`, `user_id`),
	FOREIGN KEY (`round_id`) REFERENCES `evaluation_rounds`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `round_evaluators_user_idx` ON `round_evaluators` (`user_id`);--> statement-breakpoint
CREATE TABLE `round_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`round_id` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`config` text,
	`weight` real DEFAULT 1 NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`round_id`) REFERENCES `evaluation_rounds`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `round_questions_round_idx` ON `round_questions` (`round_id`);--> statement-breakpoint
CREATE TABLE `submission_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`field_id` text NOT NULL,
	`value` text,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `submission_answers_submission_idx` ON `submission_answers` (`submission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_answers_uq` ON `submission_answers` (`submission_id`,`field_id`);--> statement-breakpoint
CREATE TABLE `submission_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`edited_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`edited_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `submission_revisions_submission_idx` ON `submission_revisions` (`submission_id`);--> statement-breakpoint
CREATE TABLE `submission_tags` (
	`submission_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`submission_id`, `tag_id`),
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submission_tags_tag_idx` ON `submission_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `submission_tracks` (
	`submission_id` text NOT NULL,
	`track_id` text NOT NULL,
	PRIMARY KEY(`submission_id`, `track_id`),
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submission_tracks_track_idx` ON `submission_tracks` (`track_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`form_id` text,
	`type` text DEFAULT 'session' NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`content_status` text DEFAULT 'draft' NOT NULL,
	`submitter_id` text,
	`format_id` text,
	`level_id` text,
	`language` text DEFAULT 'English' NOT NULL,
	`capacity` integer,
	`ceu_credits` real,
	`client_session_id` text,
	`location` text,
	`starts_at` integer,
	`ends_at` integer,
	`room_id` text,
	`notified_at` integer,
	`status_changed_at` integer,
	`withdrawn_at` integer,
	`withdrawn_by_id` text,
	`withdrawn_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_id`) REFERENCES `forms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submitter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`format_id`) REFERENCES `formats`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`level_id`) REFERENCES `levels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`withdrawn_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `submissions_event_status_idx` ON `submissions` (`event_id`,`status`);--> statement-breakpoint
CREATE INDEX `submissions_created_idx` ON `submissions` (`created_at`);--> statement-breakpoint
CREATE INDEX `submissions_form_idx` ON `submissions` (`form_id`);--> statement-breakpoint
CREATE INDEX `submissions_room_idx` ON `submissions` (`room_id`);--> statement-breakpoint
CREATE INDEX `submissions_submitter_idx` ON `submissions` (`submitter_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#71717a' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tags_event_idx` ON `tags` (`event_id`);--> statement-breakpoint
CREATE TABLE `task_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`contact_id` text,
	`submission_id` text,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`response` text,
	`file_key` text,
	`due_at` integer,
	`completed_at` integer,
	`reminder_sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_assignments_task_idx` ON `task_assignments` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_assignments_contact_status_idx` ON `task_assignments` (`contact_id`,`status`);--> statement-breakpoint
CREATE INDEX `task_assignments_submission_idx` ON `task_assignments` (`submission_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'contact' NOT NULL,
	`description` text,
	`link_url` text,
	`portal_form_id` text,
	`is_file_request` integer DEFAULT false NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`due_in_days` integer,
	`is_onboarding_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`portal_form_id`) REFERENCES `portal_forms`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tasks_event_idx` ON `tasks` (`event_id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracks_event_idx` ON `tracks` (`event_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`role` text DEFAULT 'speaker' NOT NULL,
	`active_event_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`active_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);