ALTER TABLE `courses` ADD `template_id` text;
--> statement-breakpoint
CREATE INDEX `courses_user_template_idx` ON `courses` (`user_id`,`template_id`);
