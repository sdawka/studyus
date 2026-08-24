# Public Trial and New Learner Onboarding

**Status:** Public trial and the first useful authenticated setup are implemented
as of 2026-08-24. The remaining ingestion and authoring work is listed below.

## Product contract

The landing page leads with **Try it in two minutes**. A visitor can set up a
semester, tune planning preferences, choose or enter a course, and explore nine
realistic study situations without an account. The trial is a shadow workspace:
it demonstrates product behavior but never writes simulated mastery, grades,
tasks, or events into a learner account.

After sign-up, studyus explicitly offers to import only genuine setup data:

- institution, program, semester dates, and timezone;
- weekly capacity, desired guidance, and goal depth;
- course identity plus learner-reviewed branches and KCs entered, selected, or
  extracted during the trial.

The learner can decline and start fresh. In either path, authenticated
onboarding ends on the newly created course rather than an empty dashboard.

The server-side completion invariant is:

> `onboarded_at` is valid only when the learner owns at least one active,
> non-archived academic course containing at least one non-placeholder KC.

`General`, `Course topic`, and `Course foundations` do not satisfy the
invariant. Middleware checks both `onboarded_at` and persisted course content;
the legacy `PATCH /user { onboarded: true }` path delegates to the same check.

The future first-party **Learning to Learn** course is opt-in after onboarding
and never satisfies this invariant in place of a real academic course.

## Implemented journey

### Public trial

- `/try` opens the three-part setup: academic context, planning preferences,
  and first course.
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
  demo evidence will be discarded. Import and start-fresh are explicit choices.
- Import is idempotent per learner and browser draft. Retries return the
  existing course rather than duplicating courses, branches, KCs, or events.

### Authenticated setup and gate

- Unfinished learners requesting authenticated product pages are redirected to
  `/onboarding`. Auth, account, settings, onboarding APIs, and public pages stay
  reachable.
- Learners provide institution/program, a dated academic term, preferences,
  and one course through a reviewed template, manual topic entry, or local
  document extraction.
- A single D1 batch updates context and preferences, creates the term, course,
  branches, and KCs, appends `course_added`, records the idempotency key, and
  stamps onboarding only when the invariant is satisfied.
- The learner lands on the created course overview.

## Data model

Implemented additions:

- `users.institution_name`, `users.program_name`;
- `academic_terms` with label, date boundaries, timezone, and current marker;
- `courses.term_id` and `courses.setup_state` (`draft | active`);
- `onboarding_imports` as the unique learner/draft idempotency ledger;
- `demo_funnel_events`, containing only allow-listed event names and structural
  dimensions—never university, program, course, filename, or document text.

`CourseSetupProposal` is a shared, strict, versioned Zod contract for template,
manual, and upload-derived proposals. Its branch and KC nodes use draft-local
UUIDs which are replaced with persisted ids during import.

## Routes and services

- `GET /api/v1/onboarding` returns completion, usable-course status, learner
  context/preferences, and current term.
- `POST /api/v1/onboarding/import-demo` validates and atomically imports the
  safe subset of a browser draft.
- `POST /api/public/demo-events` accepts a strict batch of allow-listed funnel
  events, rejects arbitrary payload fields, ignores events outside the seven-day
  window, deduplicates event ids, and caps each session at 100 accepted events.
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
2. **Richer review and maintenance.** Add reorder/add/remove UI, KLI type and
   description editing, prerequisite edges, assessments, source spans, and
   reusable branch/KC CRUD after onboarding. The present review covers names and
   included starter KCs, while template content itself is repository-reviewed.
3. **Template cloning breadth.** Clone prerequisite edges, scaffolds,
   misconceptions, exercises, assessments, and resources—not only the course,
   branches, and KCs used to establish the first workspace.
4. **Extraction quality.** Add optional schema-constrained model structuring,
   confidence/provenance, prompt-injection tests, and OCR for scanned PDFs.
   Deterministic extraction and manual entry must remain available without AI.
5. **First-use orientation.** Add contextual guidance on the new course, an
   optional placement check, resume/recovery UX for server-owned drafts, and
   class-session/task generation from reviewed schedules.
6. **Catalog expansion.** Add normalized institutions/programs and more
   university-reviewed course templates only when coverage warrants it.

## Acceptance checks

Implemented and covered by automated checks:

- simulated courses are excluded from account import;
- malformed/expired local state is discarded;
- a repeated import is idempotent;
- a valid manual/template proposal creates a course and meaningful KCs;
- simulated or placeholder-only content cannot complete onboarding;
- the route gate reopens legacy stamped learners who have no usable course;
- manual onboarding works without OpenRouter or an uploaded file.

## Learning to Learn course

Keep this as later, opt-in first-party content using normal studyus primitives:
retrieval practice, spacing/interleaving, self-explanation, calibration, error
analysis, planning, and reflection. Offer it only after the learner has created
one real academic course. See `docs/todo.md`.
