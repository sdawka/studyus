CREATE TABLE `runtime_tutor_session_events` (
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`event_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	PRIMARY KEY(`conversation_id`, `user_id`)
);
--> statement-breakpoint
CREATE INDEX `runtime_tutor_session_events_user_id_idx` ON `runtime_tutor_session_events` (`user_id`);
