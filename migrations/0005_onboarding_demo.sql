ALTER TABLE `users` ADD `institution_name` text;
--> statement-breakpoint
ALTER TABLE `users` ADD `program_name` text;
--> statement-breakpoint
CREATE TABLE `academic_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`starts_on` integer NOT NULL,
	`ends_on` integer NOT NULL,
	`timezone` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `academic_terms_user_current_idx` ON `academic_terms` (`user_id`,`is_current`);
--> statement-breakpoint
ALTER TABLE `courses` ADD `term_id` text REFERENCES academic_terms(id);
--> statement-breakpoint
ALTER TABLE `courses` ADD `setup_state` text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
CREATE TABLE `onboarding_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_draft_id` text NOT NULL,
	`course_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_imports_user_draft_unique` ON `onboarding_imports` (`user_id`,`source_draft_id`);
--> statement-breakpoint
CREATE TABLE `demo_funnel_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`step` text,
	`scenario_id` text,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `demo_funnel_events_session_idx` ON `demo_funnel_events` (`session_id`,`created_at`);
