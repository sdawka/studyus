ALTER TABLE `courses` ADD `topic` text;
--> statement-breakpoint
ALTER TABLE `courses` ADD `level` text;
--> statement-breakpoint
ALTER TABLE `courses` ADD `project` text;
--> statement-breakpoint
ALTER TABLE `courses` ADD `constraints` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `courses` ADD `source_template_key` text;
--> statement-breakpoint
ALTER TABLE `courses` ADD `source_template_version` text;
--> statement-breakpoint
ALTER TABLE `courses` ADD `bootstrap_key` text;
--> statement-breakpoint
ALTER TABLE `courses` ADD `domain_version` integer;
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_user_bootstrap_key_unique` ON `courses` (`user_id`,`bootstrap_key`);
--> statement-breakpoint
ALTER TABLE `kcs` ADD `kc_form` text CHECK(`kc_form` IN ('constant_constant','variable_constant','variable_variable'));
--> statement-breakpoint
ALTER TABLE `kcs` ADD `rationale_level` integer CHECK(`rationale_level` BETWEEN 1 AND 3);
--> statement-breakpoint
ALTER TABLE `kcs` ADD `mastery_rule` text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `kcs_id_course_unique` ON `kcs` (`id`,`course_id`);
--> statement-breakpoint
CREATE TRIGGER `kc_edges_same_owner_insert` BEFORE INSERT ON `kc_edges`
WHEN NOT EXISTS (
	SELECT 1 FROM `kcs` AS `dependent_kc`
	JOIN `courses` AS `dependent_course` ON `dependent_course`.`id` = `dependent_kc`.`course_id`
	JOIN `kcs` AS `prerequisite_kc` ON `prerequisite_kc`.`id` = NEW.`prereq_kc_id`
	JOIN `courses` AS `prerequisite_course` ON `prerequisite_course`.`id` = `prerequisite_kc`.`course_id`
	WHERE `dependent_kc`.`id` = NEW.`kc_id`
	AND `dependent_course`.`user_id` = `prerequisite_course`.`user_id`
)
BEGIN SELECT RAISE(ABORT, 'kc edge owner mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `kc_edges_same_owner_update` BEFORE UPDATE OF `kc_id`,`prereq_kc_id` ON `kc_edges`
WHEN NOT EXISTS (
	SELECT 1 FROM `kcs` AS `dependent_kc`
	JOIN `courses` AS `dependent_course` ON `dependent_course`.`id` = `dependent_kc`.`course_id`
	JOIN `kcs` AS `prerequisite_kc` ON `prerequisite_kc`.`id` = NEW.`prereq_kc_id`
	JOIN `courses` AS `prerequisite_course` ON `prerequisite_course`.`id` = `prerequisite_kc`.`course_id`
	WHERE `dependent_kc`.`id` = NEW.`kc_id`
	AND `dependent_course`.`user_id` = `prerequisite_course`.`user_id`
)
BEGIN SELECT RAISE(ABORT, 'kc edge owner mismatch'); END;
--> statement-breakpoint
ALTER TABLE `misconceptions` ADD `course_id` text REFERENCES `courses`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX `misconceptions_id_course_unique` ON `misconceptions` (`id`,`course_id`);
--> statement-breakpoint
CREATE TRIGGER `misconceptions_course_kc_insert` BEFORE INSERT ON `misconceptions`
WHEN NEW.`course_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `kcs` WHERE `kcs`.`id` = NEW.`kc_id` AND `kcs`.`course_id` = NEW.`course_id`
)
BEGIN SELECT RAISE(ABORT, 'misconception course mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `misconceptions_course_kc_update` BEFORE UPDATE OF `kc_id`,`course_id` ON `misconceptions`
WHEN NEW.`course_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `kcs` WHERE `kcs`.`id` = NEW.`kc_id` AND `kcs`.`course_id` = NEW.`course_id`
)
BEGIN SELECT RAISE(ABORT, 'misconception course mismatch'); END;
--> statement-breakpoint
ALTER TABLE `scaffolds` ADD `experience_id` text REFERENCES `experiences`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX `scaffolds_experience_id_unique` ON `scaffolds` (`experience_id`);
--> statement-breakpoint
ALTER TABLE `exercises` ADD `experience_id` text REFERENCES `experiences`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_experience_id_unique` ON `exercises` (`experience_id`);
--> statement-breakpoint
ALTER TABLE `events` ADD `experience_id` text REFERENCES `experiences`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `events_experience_id_idx` ON `events` (`experience_id`);
--> statement-breakpoint
CREATE TRIGGER `scaffolds_experience_course_insert` BEFORE INSERT ON `scaffolds`
WHEN NEW.`experience_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `experiences` JOIN `kcs` ON `kcs`.`id` = NEW.`kc_id`
	WHERE `experiences`.`id` = NEW.`experience_id` AND `experiences`.`course_id` = `kcs`.`course_id`
)
BEGIN SELECT RAISE(ABORT, 'scaffold experience course mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `scaffolds_experience_course_update` BEFORE UPDATE OF `kc_id`,`experience_id` ON `scaffolds`
WHEN NEW.`experience_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `experiences` JOIN `kcs` ON `kcs`.`id` = NEW.`kc_id`
	WHERE `experiences`.`id` = NEW.`experience_id` AND `experiences`.`course_id` = `kcs`.`course_id`
)
BEGIN SELECT RAISE(ABORT, 'scaffold experience course mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `exercises_experience_course_insert` BEFORE INSERT ON `exercises`
WHEN NEW.`experience_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `experiences` JOIN `kcs` ON `kcs`.`id` = NEW.`kc_id`
	WHERE `experiences`.`id` = NEW.`experience_id` AND `experiences`.`course_id` = `kcs`.`course_id`
)
BEGIN SELECT RAISE(ABORT, 'exercise experience course mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `exercises_experience_course_update` BEFORE UPDATE OF `kc_id`,`experience_id` ON `exercises`
WHEN NEW.`experience_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `experiences` JOIN `kcs` ON `kcs`.`id` = NEW.`kc_id`
	WHERE `experiences`.`id` = NEW.`experience_id` AND `experiences`.`course_id` = `kcs`.`course_id`
)
BEGIN SELECT RAISE(ABORT, 'exercise experience course mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `events_experience_course_insert` BEFORE INSERT ON `events`
WHEN NEW.`experience_id` IS NOT NULL AND (
	NEW.`course_id` IS NULL OR NOT EXISTS (
		SELECT 1 FROM `experiences` WHERE `experiences`.`id` = NEW.`experience_id` AND `experiences`.`course_id` = NEW.`course_id`
	)
)
BEGIN SELECT RAISE(ABORT, 'event experience course mismatch'); END;
--> statement-breakpoint
CREATE TRIGGER `events_experience_course_update` BEFORE UPDATE OF `course_id`,`experience_id` ON `events`
WHEN NEW.`experience_id` IS NOT NULL AND (
	NEW.`course_id` IS NULL OR NOT EXISTS (
		SELECT 1 FROM `experiences` WHERE `experiences`.`id` = NEW.`experience_id` AND `experiences`.`course_id` = NEW.`course_id`
	)
)
BEGIN SELECT RAISE(ABORT, 'event experience course mismatch'); END;
--> statement-breakpoint
CREATE TABLE `course_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_outcomes_course_id_idx` ON `course_outcomes` (`course_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_outcomes_id_course_unique` ON `course_outcomes` (`id`,`course_id`);
--> statement-breakpoint
CREATE TABLE `outcome_kcs` (
	`outcome_id` text NOT NULL,
	`kc_id` text NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`outcome_id`,`kc_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outcome_id`,`course_id`) REFERENCES `course_outcomes`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`,`course_id`) REFERENCES `kcs`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `outcome_kcs_kc_id_idx` ON `outcome_kcs` (`kc_id`);
--> statement-breakpoint
CREATE TABLE `kc_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`content` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `kc_examples_course_id_idx` ON `kc_examples` (`course_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `kc_examples_id_course_unique` ON `kc_examples` (`id`,`course_id`);
--> statement-breakpoint
CREATE TABLE `example_kcs` (
	`example_id` text NOT NULL,
	`kc_id` text NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`example_id`,`kc_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`example_id`,`course_id`) REFERENCES `kc_examples`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`,`course_id`) REFERENCES `kcs`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `example_kcs_kc_id_idx` ON `example_kcs` (`kc_id`);
--> statement-breakpoint
CREATE TABLE `misconception_kcs` (
	`misconception_id` text NOT NULL,
	`kc_id` text NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`misconception_id`,`kc_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`misconception_id`,`course_id`) REFERENCES `misconceptions`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`,`course_id`) REFERENCES `kcs`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `misconception_kcs_kc_id_idx` ON `misconception_kcs` (`kc_id`);
--> statement-breakpoint
CREATE TABLE `experiences` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`kind` text NOT NULL CHECK(`kind` IN ('scaffold','exercise','project')),
	`intended_processes` text DEFAULT '[]' NOT NULL,
	`content` text NOT NULL,
	`evidence_response_type` text,
	`evidence_scoring_kind` text,
	`evidence_scoring_details` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `experiences_course_id_idx` ON `experiences` (`course_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiences_id_course_unique` ON `experiences` (`id`,`course_id`);
--> statement-breakpoint
CREATE TABLE `experience_kcs` (
	`experience_id` text NOT NULL,
	`kc_id` text NOT NULL,
	`course_id` text NOT NULL,
	`is_evidence_target` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`experience_id`,`kc_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`experience_id`,`course_id`) REFERENCES `experiences`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`,`course_id`) REFERENCES `kcs`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `experience_kcs_kc_id_idx` ON `experience_kcs` (`kc_id`);
--> statement-breakpoint
CREATE TABLE `experience_misconceptions` (
	`experience_id` text NOT NULL,
	`misconception_id` text NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY (`experience_id`,`misconception_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`experience_id`,`course_id`) REFERENCES `experiences`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`misconception_id`,`course_id`) REFERENCES `misconceptions`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `experience_misconceptions_misconception_id_idx` ON `experience_misconceptions` (`misconception_id`);
--> statement-breakpoint
CREATE TABLE `course_references` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`citation` text NOT NULL,
	`url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_references_course_id_idx` ON `course_references` (`course_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_references_id_course_unique` ON `course_references` (`id`,`course_id`);
--> statement-breakpoint
CREATE TABLE `reference_kcs` (
	`reference_id` text NOT NULL,
	`kc_id` text NOT NULL,
	`course_id` text NOT NULL,
	PRIMARY KEY (`reference_id`,`kc_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_id`,`course_id`) REFERENCES `course_references`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`,`course_id`) REFERENCES `kcs`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reference_kcs_kc_id_idx` ON `reference_kcs` (`kc_id`);
--> statement-breakpoint
CREATE TABLE `reference_examples` (
	`reference_id` text NOT NULL,
	`example_id` text NOT NULL,
	`course_id` text NOT NULL,
	PRIMARY KEY (`reference_id`,`example_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_id`,`course_id`) REFERENCES `course_references`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`example_id`,`course_id`) REFERENCES `kc_examples`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reference_examples_example_id_idx` ON `reference_examples` (`example_id`);
--> statement-breakpoint
CREATE TABLE `reference_experiences` (
	`reference_id` text NOT NULL,
	`experience_id` text NOT NULL,
	`course_id` text NOT NULL,
	PRIMARY KEY (`reference_id`,`experience_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_id`,`course_id`) REFERENCES `course_references`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`experience_id`,`course_id`) REFERENCES `experiences`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reference_experiences_experience_id_idx` ON `reference_experiences` (`experience_id`);
--> statement-breakpoint
CREATE TABLE `reference_misconceptions` (
	`reference_id` text NOT NULL,
	`misconception_id` text NOT NULL,
	`course_id` text NOT NULL,
	PRIMARY KEY (`reference_id`,`misconception_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_id`,`course_id`) REFERENCES `course_references`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`misconception_id`,`course_id`) REFERENCES `misconceptions`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reference_misconceptions_misconception_id_idx` ON `reference_misconceptions` (`misconception_id`);
--> statement-breakpoint
CREATE TABLE `course_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_modules_course_id_idx` ON `course_modules` (`course_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_modules_id_course_unique` ON `course_modules` (`id`,`course_id`);
--> statement-breakpoint
CREATE TABLE `module_outcomes` (
	`module_id` text NOT NULL,
	`outcome_id` text NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY (`module_id`,`outcome_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`,`course_id`) REFERENCES `course_modules`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`outcome_id`,`course_id`) REFERENCES `course_outcomes`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `module_kcs` (
	`module_id` text NOT NULL,
	`kc_id` text NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY (`module_id`,`kc_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`,`course_id`) REFERENCES `course_modules`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`kc_id`,`course_id`) REFERENCES `kcs`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `module_experiences` (
	`module_id` text NOT NULL,
	`experience_id` text NOT NULL,
	`course_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY (`module_id`,`experience_id`),
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_id`,`course_id`) REFERENCES `course_modules`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`experience_id`,`course_id`) REFERENCES `experiences`(`id`,`course_id`) ON UPDATE no action ON DELETE cascade
);
