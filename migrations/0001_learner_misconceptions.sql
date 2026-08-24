CREATE TABLE `user_misconceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`misconception_id` text NOT NULL,
	`status` text NOT NULL,
	`evidence_event_ids` text DEFAULT '[]' NOT NULL,
	`suspected_at` integer,
	`confirmed_at` integer,
	`correcting_at` integer,
	`internalized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`misconception_id`) REFERENCES `misconceptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_misconceptions_user_misconception_unique` ON `user_misconceptions` (`user_id`,`misconception_id`);
--> statement-breakpoint
CREATE INDEX `user_misconceptions_user_status_idx` ON `user_misconceptions` (`user_id`,`status`);
