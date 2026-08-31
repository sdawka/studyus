-- Course slugs were globally unique, so the second learner to add CS 101 got
-- /courses/cs-101-2 and the third got cs-101-3: the suffix counted how many
-- other accounts held that course code, and a learner's own URL depended on
-- strangers' data. Scope the constraint per user, matching the pattern already
-- used by kcs_course_slug_unique and capabilities_user_slug_unique.
--
-- Existing rows cannot violate the new index: a globally unique value is
-- necessarily unique within one user. Already-suffixed slugs keep their names
-- rather than being rewritten, so no existing course URL changes.
DROP INDEX `courses_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `courses_user_slug_unique` ON `courses` (`user_id`,`slug`);
