DROP INDEX `task_assignments_task_contact_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `task_assignments_contact_scope_uq` ON `task_assignments` (`task_id`,`contact_id`) WHERE submission_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `task_assignments_submission_scope_uq` ON `task_assignments` (`task_id`,`contact_id`,`submission_id`) WHERE submission_id IS NOT NULL;