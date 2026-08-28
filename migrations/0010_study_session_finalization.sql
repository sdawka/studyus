CREATE TABLE `study_session_finalizations` (
	`study_session_id` text PRIMARY KEY NOT NULL,
	`disposition` text NOT NULL,
	`finalized_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`study_session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `study_session_finalizations` (`study_session_id`, `disposition`, `finalized_at`, `created_at`)
SELECT
	`id`,
	CASE WHEN `reflection` = 'Discarded — not counted.' THEN 'discarded' ELSE 'completed' END,
	`ended_at`,
	`ended_at`
FROM `study_sessions`
WHERE `ended_at` IS NOT NULL;
--> statement-breakpoint
UPDATE `events`
SET `session_id` = json_extract(`payload`, '$.session_id')
WHERE `session_id` IS NULL
	AND json_valid(`payload`)
	AND typeof(json_extract(`payload`, '$.session_id')) = 'text'
	AND EXISTS (
		SELECT 1 FROM `study_sessions`
		WHERE `study_sessions`.`id` = json_extract(`events`.`payload`, '$.session_id')
	);
--> statement-breakpoint
CREATE INDEX `events_session_id_idx` ON `events` (`session_id`);
--> statement-breakpoint
DELETE FROM `session_kcs`
WHERE rowid NOT IN (
	SELECT MIN(rowid)
	FROM `session_kcs`
	GROUP BY `study_session_id`, `kc_id`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_kcs_session_kc_unique` ON `session_kcs` (`study_session_id`,`kc_id`);
