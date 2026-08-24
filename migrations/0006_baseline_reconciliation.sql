-- Production was initialized from the original 0000_whole_randall migration
-- before these additive v1 tables were folded into the regenerated baseline.
-- IF NOT EXISTS keeps this migration safe for databases created from the
-- current baseline while bringing that original production schema forward.
CREATE TABLE IF NOT EXISTS `capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`source` text DEFAULT 'seed' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `capabilities_user_slug_unique` ON `capabilities` (`user_id`,`slug`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_kcs` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_id` text NOT NULL,
	`kc_id` text NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`capability_id`) REFERENCES `capabilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `capability_kcs_capability_kc_unique` ON `capability_kcs` (`capability_id`,`kc_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `capability_kcs_kc_id_idx` ON `capability_kcs` (`kc_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`kc_id` text NOT NULL,
	`slug` text NOT NULL,
	`kind` text NOT NULL,
	`difficulty` integer DEFAULT 2 NOT NULL,
	`prompt` text NOT NULL,
	`details` text DEFAULT '{}' NOT NULL,
	`source` text NOT NULL,
	`origin` text DEFAULT 'seed' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`kc_id`) REFERENCES `kcs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `exercises_kc_slug_unique` ON `exercises` (`kc_id`,`slug`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `exercises_kc_id_idx` ON `exercises` (`kc_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rituals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text NOT NULL,
	`cadence` text,
	`by_weekday` text,
	`course_id` text,
	`steps` text,
	`group_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rituals_user_id_idx` ON `rituals` (`user_id`);
