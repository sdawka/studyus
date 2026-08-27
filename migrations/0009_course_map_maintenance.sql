ALTER TABLE `courses` ADD `map_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `courses` ADD `template_revision` text;
--> statement-breakpoint
ALTER TABLE `courses` ADD `template_synced_at` integer;
--> statement-breakpoint
ALTER TABLE `courses` ADD `template_baseline` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD `template_ref` text;
--> statement-breakpoint
ALTER TABLE `branches` ADD `archived_at` integer;
--> statement-breakpoint
ALTER TABLE `kcs` ADD `archived_at` integer;
--> statement-breakpoint
ALTER TABLE `misconceptions` ADD `retired_at` integer;
--> statement-breakpoint
ALTER TABLE `exercises` ADD `retired_at` integer;
--> statement-breakpoint
CREATE TABLE `course_template_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`item_kind` text NOT NULL,
	`template_ref` text NOT NULL,
	`decision` text NOT NULL,
	`template_revision` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_template_decisions_item_unique` ON `course_template_decisions` (`course_id`,`item_kind`,`template_ref`);
