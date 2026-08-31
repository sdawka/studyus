# McGill onboarding catalog

`mcgill-catalog.json` is the compact onboarding index for the 2026–2027
McGill undergraduate and graduate course catalog. It contains course facts,
official source links, and lightweight knowledge-component (KC) outlines. The
nine courses with hand-reviewed `content.json` files remain the richer source
of truth and replace their generated entries.

## Provenance

- Current authority: [McGill Course Catalogue](https://coursecatalogue.mcgill.ca/)
- Current official publications: [2026–2027 calendars](https://www.mcgill.ca/students/courses/calendars/current)
- Machine-readable source: [`mcgill-courses/mcgill.courses`](https://github.com/mcgill-courses/mcgill.courses),
  `seed/courses-2026-2027.json`, published under CC0 1.0
- Generated locally with `scripts/build-mcgill-catalog.mjs`

## Where the data lives at runtime

`mcgill-catalog.json` is the source of truth in the repo, but worker code does
not import it. Vite inlined the ~10,000 rows as a JavaScript object literal,
producing a 5 MB chunk that V8 parsed as source at every isolate start — a cost
the course-map path paid as much as onboarding. The rows are loaded into D1
instead (`catalog_courses` plus the FTS5 index `catalog_courses_fts`, added by
`migrations/0013_catalog_courses_in_d1.sql`):

```
npm run db:migrate:local && npm run db:seed:catalog:local
npm run db:migrate:remote && npm run db:seed:catalog:remote
```

The seed replaces the catalogue wholesale, so re-running it after rebuilding
`mcgill-catalog.json` is safe. Regenerate the test fixture at the same time with
`npx tsx scripts/seed-catalog.ts --fixture`.

McGill notes that catalogued courses are not necessarily offered every year.
Learners should verify current availability in Minerva before registration.

## KC policy

Generated KCs are grounded only in the catalogue description, capped at eight
per course, typed with the existing KLI taxonomy, and clearly identified as a
catalogue outline during onboarding. They are an editable starting point, not
a substitute for a syllabus. Rich scaffolds and exercises remain limited to
the hand-reviewed templates.
