-- The ~10,000-course McGill catalogue used to be imported as JSON by
-- src/lib/content/templateCatalog.ts. Vite inlined it as a JavaScript object
-- literal, producing a 5 MB worker chunk that V8 had to parse as source at
-- every isolate start — a cost paid by the course-map path too, not just
-- onboarding. Move the generated catalogue into D1 and keep only the nine
-- authored templates (courses/*/content.json) in the bundle.
--
-- Rows are seeded by scripts/seed-catalog.ts from courses/mcgill-catalog.json,
-- which stays in the repo as the source of truth. No triggers: the catalogue is
-- a static, wholesale-replaced dataset, so the seed script writes both tables.
CREATE TABLE `catalog_courses` (
	`id` integer PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`code` text NOT NULL,
	`title` text NOT NULL,
	`credits` real,
	`department` text NOT NULL,
	`faculty` text NOT NULL,
	-- 'u' undergraduate, 'g' graduate, 'b' both.
	`audience` text NOT NULL,
	-- JSON array of [name, type] pairs; type is one of f/a/c/r/p.
	`kcs` text NOT NULL,
	-- Denormalized so search results never have to ship the kcs blob.
	`kc_count` integer NOT NULL,
	-- Precomputed collation/ranking keys so search never normalizes at query
	-- time. sort_key zero-pads digit runs, keeping "COMP 2" before "COMP 10"
	-- under a plain string compare.
	`normalized_code` text NOT NULL,
	`compact_code` text NOT NULL,
	`normalized_title` text NOT NULL,
	`sort_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_courses_slug_unique` ON `catalog_courses` (`slug`);
--> statement-breakpoint
CREATE INDEX `catalog_courses_audience_sort_idx` ON `catalog_courses` (`audience`,`sort_key`);
--> statement-breakpoint
-- Full-text index over code, title, subject, department, faculty, level words
-- and knowledge-component names. Concept search is the reason the catalogue
-- carries KC outlines at all, so the KC names are part of the indexed text.
-- rowid is kept equal to catalog_courses.id so the join costs nothing.
CREATE VIRTUAL TABLE `catalog_courses_fts` USING fts5(`search_text`, tokenize = 'unicode61 remove_diacritics 2');
