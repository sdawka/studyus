CREATE TABLE `kc_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`kc_id` text NOT NULL,
	`prereq_kc_id` text NOT NULL,
	`relation` text DEFAULT 'prerequisite' NOT NULL,
	`source` text DEFAULT 'seed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prereq_kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kc_edges_kc_prereq_unique` ON `kc_edges` (`kc_id`,`prereq_kc_id`);--> statement-breakpoint
CREATE INDEX `kc_edges_prereq_kc_id_idx` ON `kc_edges` (`prereq_kc_id`);--> statement-breakpoint
CREATE TABLE `misconceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`kc_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`root_cause` text NOT NULL,
	`diagnostic_probe` text NOT NULL,
	`correction` text NOT NULL,
	`source` text DEFAULT 'seed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `misconceptions_kc_slug_unique` ON `misconceptions` (`kc_id`,`slug`);--> statement-breakpoint
CREATE TABLE `scaffolds` (
	`id` text PRIMARY KEY NOT NULL,
	`kc_id` text NOT NULL,
	`kind` text NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'seed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scaffolds_kc_id_idx` ON `scaffolds` (`kc_id`);--> statement-breakpoint
CREATE TABLE `user_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kc_id` text,
	`misconception_id` text,
	`prior_belief` text,
	`correction` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`accepted_at` integer NOT NULL,
	`source_conversation_id` text,
	`last_reminded_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`misconception_id`) REFERENCES `misconceptions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `tutor_conversations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `user_corrections_user_status_idx` ON `user_corrections` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `kcs` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `kcs_course_slug_unique` ON `kcs` (`course_id`,`slug`);--> statement-breakpoint
ALTER TABLE `tutor_conversations` ADD `details` text DEFAULT '{}' NOT NULL;