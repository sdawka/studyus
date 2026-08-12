CREATE TABLE `class_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`course_id` text NOT NULL,
	`date` integer NOT NULL,
	`status` text,
	`note` text,
	`source` text DEFAULT 'schedule' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_sessions_course_date_unique` ON `class_sessions` (`course_id`,`date`);--> statement-breakpoint
ALTER TABLE `courses` ADD `meeting_days` text;