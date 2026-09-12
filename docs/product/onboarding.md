# Public Trial and New Learner Onboarding

**Status:** General, skippable onboarding and manual `CourseDraftV2` authoring
are implemented. The reviewed-template and local-extraction paths remain on the
legacy proposal contract while they migrate to the same V2 boundary.

## Product contract

The landing page leads with **Try it in two minutes**. A visitor can enter a
learning goal, tune planning preferences, or use a general sample, then explore
realistic study situations without an account. Academic context and reviewed
university courses remain optional examples. The trial is a shadow workspace:
it demonstrates product behavior but never writes simulated mastery, grades,
tasks, or events into a learner account.

On first authenticated resolution, studyus atomically creates the local learner
and a learner-owned, detached copy of the current **Learning How to Learn**
template. The copy has fresh aggregate IDs and passive source/version
provenance; learner edits and later template revisions never synchronize.

Onboarding then offers optional personalization:

- institution, program, term dates, and timezone, only when relevant;
- weekly capacity, desired guidance, and goal depth;
- or a complete manual course described by topic, level, outcomes, KCs,
  examples, experiences, evidence targets, and mastery rules.

Skip stamps setup complete and opens the provisioned default course. Finish
validates any supplied academic context and atomically creates the additional
course before opening it.

The server-side completion invariant is:

> A newly provisioned learner owns one usable default course before the user
> row becomes observable. `onboarded_at` records completion of personalization;
> archiving every course later does not reopen onboarding.

Existing learner rows are not backfilled. Their legacy usable-course checks
remain compatibility behavior rather than a requirement that a new learner
must create an academic course.

## Implemented journey

### Public trial

- `/try` opens skippable context, planning-preference, and learning-goal steps.
- Every section can be skipped; **Skip setup and explore** creates an explicitly
  simulated CHEE 314 workspace.
- The reviewed McGill Chemical Engineering catalog currently supplies nine
  searchable course templates. Other institutions use free entry and manual or
  document-assisted course setup.
- PDF, DOCX, text, and Markdown can be parsed locally in the browser. Files are
  capped at 10 MB, at most 30 PDF pages are read, and the raw bytes are neither
  uploaded nor saved to local storage. Deterministic text heuristics propose a
  starter KC list; no model or API key is required.
- `/try/app/*` presents nine interactive situations: overload, missed lecture,
  post-class capture, false fluency, prerequisite gap, recurring misconception,
  imminent exam, new grade, and a disrupted week.
- Trial state uses `studyus:demo:v1` in local storage, is validated with Zod,
  expires after seven days, and is capped at 500 KB. Corrupt or outdated data is
  discarded. A visible control clears it immediately.

### Authentication handoff

- Trial calls to action use `/sign-up?from=demo`.
- Clerk force/fallback redirects preserve the intended handoff to
  `/onboarding?import=demo`.
- Authenticated onboarding shows exactly what can be imported and states that
  demo evidence will be discarded. A handoff opens the same review step used by
  fresh setup; import and start-fresh are explicit choices.
- Import is idempotent per learner and browser draft. Retries return the
  existing course rather than duplicating courses, branches, KCs, or events.

### Authenticated setup and gate

- Unfinished learners requesting authenticated product pages are redirected to
  `/onboarding`. Auth, account, settings, onboarding APIs, and public pages stay
  reachable.
- The first screen announces the ready default course. A persistent native
  button lets the learner Skip from every step.
- Manual creation starts from topic, level, and one outcome. The learner may
  review and edit the resulting V2 aggregate before Finish.
- Academic context is behind an optional disclosure. Partial context is
  discarded on Skip and rejected on Finish; it never gates entry.
- Reviewed templates can be renamed, reordered, and selectively included.
  Required prerequisites cannot be removed while a selected dependent needs
  them. Every official assessment needs either a confirmed in-term date or an
  explicit unknown-date choice; a batch unknown action is available.
- A single D1 batch updates supplied context/preferences, persists the complete
  V2 aggregate, records the draft idempotency key, and stamps onboarding.
- The learner lands on the authored course, or on Learning How to Learn after
  Skip.

## Data model

Implemented general-learning additions:

- `users.institution_name`, `users.program_name`;
- `academic_terms` with label, date boundaries, timezone, and current marker;
- `courses.term_id`, `courses.template_id`, and `courses.setup_state`
  (`draft | active`);
- `courses.topic`, `level`, `project`, `constraints`, `domain_version`,
  `source_template_key`, `source_template_version`, and `bootstrap_key`;
- relational outcomes, examples, experiences, modules, references, and their
  owner-consistent link tables; `kcs.kc_form`, `rationale_level`, and
  `mastery_rule`; `events.experience_id`;
- `onboarding_imports` as the unique learner/draft idempotency ledger;
- `demo_funnel_events`, containing only allow-listed event names and structural
  dimensions—never university, program, course, filename, or document text.

`CourseDraftV2` is the strict authoring boundary for current manual creation,
the bundled first-party course, and future adapters. One validator enforces
links, acyclic prerequisites, valid optional mastery-rule fields, and
teachable/evidence-producing KCs; one statement builder deep-copies the
aggregate with fresh IDs.
`CourseSetupProposal` remains the compatibility contract for reviewed templates
and local extraction until those adapters emit V2.

## Routes and services

- `GET /api/v1/onboarding` returns completion, usable-course status, learner
  context/preferences, and current term.
- `GET /api/v1/onboarding/templates` lists reviewed templates and
  `GET /api/v1/onboarding/templates/:id` returns a browser-safe editable map.
  Authored exercise answers, scaffold bodies, and misconception corrections are
  never sent to the browser.
- `POST /api/v1/onboarding/import-demo` accepts an optional V2 `course`, optional
  complete context, preferences, and an empty legacy `courses` array for Skip.
  It validates and atomically commits the safe subset. After a newly successful manual course commit, it
  queues the ordered behavioral sequence `onboarding_path_chosen` →
  `onboarding_map_reviewed` → `onboarding_completed_auth`; an idempotent replay
  never recaptures it. Course/KC counts are derived from committed rows and
  duration begins at the first authenticated onboarding render via an opaque,
  HttpOnly, SameSite cookie.
- `POST /api/public/demo-events` accepts a strict batch of allow-listed funnel
  events, rejects arbitrary payload fields, ignores events outside the seven-day
  window, deduplicates event ids, and caps each session at 100 accepted events.
  Analytics-aware clients add anonymous/app-session correlation UUIDs; only
  newly inserted D1 rows are mirror-forwarded to PostHog, without backfill.
- `hasUsableCourse`, `getOnboardingState`, and `importDemoSetup` are the shared
  server boundaries for the gate and commit behavior.

## Privacy and trust boundary

Local storage is convenience, not authority. Every imported value is validated
again on the server. Simulated proposals are filtered at the import boundary,
and no demo mastery, standing, scenario result, grade, task, or event crosses
into canonical learner state.

The current document helper is local-only. It does not retain the source file
after the page closes and therefore cannot support reprocessing or source-span
provenance. Copy explicitly says this instead of implying an upload was saved.

## Remaining implementation

These are intentional follow-ups, not current behavior:

1. **Durable course-material ingestion.** Add R2-backed material roles
   (`syllabus`, `lesson_plan`, `schedule`, `assignment_sheet`, `other`), MIME
   validation, retained extracted text, proposal provenance, retry states, and
   a Queue/Workflow path. Treat document text as untrusted input.
2. **Rich content authoring.** Map maintenance now covers branch/KC structure,
   KLI type, descriptions, practice notes, and prerequisites. Full learner
   authoring for scaffolds, misconceptions, exercises, resources, and source
   spans remains deferred.
3. **Extraction quality.** Add optional schema-constrained model structuring,
   confidence/provenance, prompt-injection tests, and OCR for scanned PDFs.
   Deterministic extraction and manual entry must remain available without AI.
4. **First-use orientation.** Add contextual guidance on the new course, an
   optional placement check, resume/recovery UX for server-owned drafts, and
   class-session/task generation from reviewed schedules.
5. **Catalog expansion.** Add normalized institutions/programs and more
   university-reviewed course templates only when coverage warrants it.

## Acceptance checks

Implemented and covered by automated checks:

- simulated courses are excluded from account import;
- malformed/expired local state is discarded;
- first identity resolution creates one learner plus one complete detached
  default course, and concurrent retries return the same aggregate;
- a deletion fence that arrives before bootstrap commit prevents both learner
  and course creation;
- a repeated import is idempotent;
- Skip opens the default course without academic context;
- a valid manual V2 draft creates a non-academic course; partial academic
  context fails Finish;
- a reviewed template import clones its authored learning content atomically;
- unresolved/out-of-term assessment dates and excluded prerequisites fail
  before any course is written;
- the browser-safe template detail contains no authored answers or teaching
  bodies;
- the route gate reopens legacy stamped learners who have no usable course;
- manual onboarding works without OpenRouter or an uploaded file.

## Post-onboarding course-map maintenance

The course Concepts page now has an explicit edit mode. A learner can add,
rename, move, reorder, archive, and restore branches and KCs; edit KLI type,
description, and practice notes; and choose prerequisites from any active KC
they own. Save is one atomic snapshot guarded by `courses.map_revision`, so a
stale browser receives a conflict instead of overwriting newer work.

Archiving is reversible and preserves events, mastery, notes, assessment links,
and other history. Active study, exercise, misconception, course, and ZPD reads
exclude archived/retired content. The service rejects graph cycles, foreign
prerequisites, archiving a prerequisite with an active dependent, and removing
the learner's final meaningful active KC.

Reviewed courses store a content hash and baseline. Course access performs a
best-effort revision check: untouched template fields, prerequisite edges, and
rich authored content refresh automatically, while learner overrides are kept.
New or removed structural nodes appear in a review inbox with include/dismiss
or archive/keep decisions; nothing structural is imposed automatically.

## Learning How to Learn course

The bundled V2 course is the automatic first enrollment. Its five question-
titled modules teach evidence versus confidence, retrieval and cues, productive
difficulty, examples and feedback, and adapting a learning plan. Every KC has
examples, an evidence-producing experience, references, and a meaningful
deterministic mastery rule. It is normal learner-owned course content, not a
compulsory tutorial and not a synchronized system object.
