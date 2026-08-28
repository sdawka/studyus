CREATE TABLE `event_idempotency_keys` (
	`user_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`event_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `idempotency_key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_idempotency_keys_event_id_unique` ON `event_idempotency_keys` (`event_id`);
