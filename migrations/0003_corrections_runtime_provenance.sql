PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_user_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kc_id` text,
	`misconception_id` text,
	`prior_belief` text,
	`correction` text NOT NULL,
	`status` text NOT NULL DEFAULT 'active',
	`accepted_at` integer NOT NULL,
	`source_conversation_id` text,
	`last_reminded_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`misconception_id`) REFERENCES `misconceptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_user_corrections` (`id`,`user_id`,`kc_id`,`misconception_id`,`prior_belief`,`correction`,`status`,`accepted_at`,`source_conversation_id`,`last_reminded_at`,`created_at`)
SELECT `id`,`user_id`,`kc_id`,`misconception_id`,`prior_belief`,`correction`,`status`,`accepted_at`,`source_conversation_id`,`last_reminded_at`,`created_at` FROM `user_corrections`;
--> statement-breakpoint
DROP TABLE `user_corrections`;
--> statement-breakpoint
ALTER TABLE `__new_user_corrections` RENAME TO `user_corrections`;
--> statement-breakpoint
CREATE INDEX `user_corrections_user_status_idx` ON `user_corrections` (`user_id`,`status`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
