# Event Catalog & Expected Orderings

**Status (2026-08-28)**: canonical reference produced by an event-storming pass over the
whole codebase. B1's vocabulary narrowing is implemented: recommendation interactions
and 11 dead placeholders are no longer accepted by the domain API. The **domain
stream** sections describe what is implemented today (file:line cited). The
**behavioral stream** has its privacy, schema, session, transport, and product
instrumentation implemented for 45 of 46 approved names. `resource_saved` is the sole
reserved implement-or-prune decision. “Live” below means an emitter path is
implemented and reachable; checked-in `ANALYTICS_ENABLED` remains `false`, so no
environment begins delivery without an explicit operational gate and project-token
decision. `events-and-mastery.md` stays the theory doc (KLI, the fold); this doc is the
operational catalog: every event, who emits it, what it carries, and what order things
are expected to arrive in.

## The two streams

studyus has (and must keep) two separate event streams:

1. **Domain stream** — the `events` table (`migrations/0000_whole_randall.sql:110`),
   vocabulary `EVENT_TYPES` (`src/lib/schemas/events.ts:8`), single sanctioned writer
   `src/lib/services/events.ts`, folded into mastery by `src/lib/services/mastery.ts`.
   This contains durable learner-domain facts; role flags identify the evidence subset.
2. **Behavioral stream** — product usage telemetry. The anonymous trial funnel remains
   in `demo_funnel_events` and is mirror-forwarded to PostHog; deliberate capture spans
   acquisition, activation, engagement, learning, and retention. The full vocabulary
   and its one reserved decision are below.

**Boundary rule**: durable facts that define the learner model or a canonical business
transition belong in the **domain stream**; observational product usage belongs in the
**behavioral stream**. Only role-flagged domain evidence can legitimately move mastery
or freshness. UI telemetry must never be written into the `events` table.

---

## Domain stream: catalog

Sources: `manual | session | tutor | seed | system` (`src/lib/schemas/events.ts:55`;
`system` = server emissions inside atomic batches, e.g. onboarding's `course_added`).
Role flags
(IE = instructional, AE = assessment) are derived exclusively from type via
`EVENT_ROLE_FLAGS` (`src/lib/schemas/events.ts:36`).

The fold reads **only** these payload keys (`src/lib/services/mastery.ts` `eventSuccess`):
`correct` (bool), `correctness` (0–1, reserved — no emitter yet), `score` (0–100),
`self_rating` (1–5), `final_rating` (1–5, tutor sessions); any AE event carrying none
of them folds at the neutral `MASTERY_CONSTANTS.DEFAULT_AE_SUCCESS` (0.7, `mastery.ts:37`).

### Emitted today

| Event | IE/AE | Emitters | Trigger / actor | Payload written | Fold reads |
|---|---|---|---|---|---|
| `lecture_attended` / `lecture_missed` | IE/– | `LogEventModal.svelte`, `QuickEventForm.svelte:34` → `POST /api/v1/events` | Student self-logs attendance | `note?` | — (IE bump) |
| `video_watched`, `reading_done`, `taught_someone` | IE/– | Manual modal; session completion via `intended_event_type` (`sessions.ts:120-130`) | Self-log or session complete | `note?` / `{session_id}` | — (IE bump) |
| `quiz_taken` | –/AE | `assessments.ts:169-177` (grade fan-out per linked KC); manual modal | Grade entered on quiz assessment | `{score?, assessment_id}` | `score` |
| `assignment_graded` | –/AE | `assessments.ts` (assignment/lab); manual modal | Grade entered | `{score?, assessment_id}` | `score` |
| `exam_graded` | –/AE | `assessments.ts` (midterm/final); manual modal | Grade entered | `{score?, assessment_id}` | `score` |
| `self_assessment` | –/AE | Atomic session finalization for rated IE-only sessions; manual modal | Student rates understanding 1–5 | `{session_id?, self_rating}` | `self_rating` |
| `practice_done` | IE/AE | Atomic session finalization, one per touched KC | `PATCH /sessions/:id/complete` | `{session_id, self_rating?}` | `self_rating` when supplied; otherwise 0.7 |
| `retrieval_practice` | IE/AE | `quick_quiz.ts:317-327`, `exercise_attempt.ts:70-79`, `exercise.ts:218` (all source `'tutor'`); manual; sessions | Quiz/exercise graded; self-log | `{correct, session_id?/exercise_id?, channel}` | `correct` |
| `placement_probe` / `diagnostic_probe` | –/AE | `domain/pedagogy/exercise.ts:218-235` `recordExerciseEvidence` only (caller-supplied `event_id` dedupe) | Agentic channel records probe outcome | `{correct, exercise_id, misconception_id, purpose, channel}` | `correct` |
| `tutor_session` | IE/AE | `events.ts:102-167` `createRuntimeTutorSessionEvent` (ledger-idempotent); legacy `tutor/conversations.ts:309-317` | Tutor conversation ends | `{conversation_id, mode, final_rating?}` | `final_rating` |
| `correction_accepted` | context | `corrections.ts:96-104` (source `'tutor'`) | Student accepts a correction | `{correction_id, misconception_id}` | excluded |
| `course_added` | context | `onboarding.ts` — sanctioned inline insert (`source:'system'`): must join the atomic clone batch creating the course it references | Onboarding course commit | `{source:'demo_import', draft_id}` | excluded |

### Retired from the domain vocabulary (B1, 2026-08-28)

`task_completed`, `task_dismissed`, `correction_dismissed`, `course_archived`,
`plan_committed`, `session_scheduled`, `session_rescheduled`, `settings_changed`,
`coach_session`, `reflection_captured`, `digest_sent` had no emitter anywhere and were
removed rather than promising an activity stream the code did not produce.
`recommendation_followed` and `recommendation_ignored` were also removed from
`EVENT_TYPES`; they describe UI behavior and remain reserved in the behavioral
taxonomy below. The required production D1 pre-check found zero rows across all 13
names, so no data migration or backfill was needed.

### Adjacent stores analysis must know about

- **`demo_funnel_events`** — anonymous public-trial funnel, 11 allow-listed names
  (`src/lib/schemas/onboarding.ts:121-133`), written by
  `POST /api/public/demo-events` (7-day window, ≤100/session, idempotent by event id).
  Completely separate table; pollution-safe by construction. Its legacy sequence ends
  at `onboarding_completed`; newly inserted rows are also mirror-forwarded to PostHog,
  while authenticated activation has its own three-event server-truth sequence.
- **`class_sessions`** — attendance is **status rows, not events** (deliberate, v1.3,
  `classSessions.ts:1-11`). Initial status seeds once from same-day
  `lecture_attended/missed` events; thereafter PATCH-only, and marking attendance does
  NOT append an event. Attendance analysis must join both representations, and the
  primary UI path (AttendanceCard) feeds only this table, never the mastery fold.
- **`studySessions` quick-quiz sentinel** — quick quizzes are session rows with a
  sentinel `intendedEventType` and quiz JSON in `reflection`
  (`quick_quiz.ts:260-268`). Session-level analytics must filter the sentinel.
- **Tutor Durable Object SQLite** — conversations, turns, and multiplexed alarms live
  in the DO. Only an ended conversation surfaces into D1 as the terminal
  `tutor_session` domain event. A separate 30-minute inactivity alarm can emit the
  nonterminal `tutor_abandoned` behavioral signal; it does not end the conversation,
  and a later learner turn may schedule another inactivity episode.
- **`scripts/seed.ts`** writes real `events` rows with `source:'seed'` — every
  analysis must filter `source != 'seed'` (and exclude the developer's own user id).

---

## Domain stream: lifecycles & expected orderings

**Manual log**: modal assigns one UUID idempotency key to the serialized submission
→ `POST /events` → 201 `{event, mastery_deltas}`. An unchanged ambiguous retry keeps
that key and receives the bound event with 200/empty deltas; editing the submission
mints a new key.

**Study session** (`StudyFlow.svelte`, `sessions.ts`):
1. `POST /sessions {intended_event_type, planned_minutes, …}` — no event at scheduling.
2. Optional `PATCH /sessions/:id` reschedule — rejected once completed (`sessions.ts:145`).
3. `PATCH /sessions/:id/complete {kc_outcomes:[{kc_id,self_rating?}]}` commits the
   terminal ledger, session row, KC links, all events, and one mastery update per KC
   in one D1 batch. Assessment-capable intended events carry `self_rating` directly;
   rated IE-only sessions add an atomic `self_assessment` beside the intended event.
   Legacy `kc_ids_touched` remains accepted; explicit empty arrays mean zero events,
   while omission alone falls back to stored links.
4. `PATCH /sessions/:id/discard` records an explicit `discarded` terminal state and
   never appends evidence, including for a session with stored KC links. The
   `study_session_finalizations` primary key makes both terminal commands retry-safe;
   the first disposition wins and the opposite command conflicts.

**Quick quiz** (`quick_quiz.ts`): generate → sentinel session row → grade exactly once
(`graded` flag) → `endedAt` + one `retrieval_practice{correct}` per KC. Never goes
through `completeSession`.

**Exercise / agentic evidence** (`exercise.ts:202-254`): `recordExerciseEvidence`
(at-least-once delivery, `event_id` dedupe) → probe/practice event → when the
response is incorrect, a misconception is attached, and the event `wasCreated`: the
first such probe marks the misconception `suspected`, a repeat advances it to
`confirmed` (`exercise.ts:241-251`).
Status ladder `suspected → confirmed → correcting → internalized` is monotone
(`misconceptionLifecycle.ts:10-15`); `evidence_event_ids` accumulate.

**Tutor runtime** (strictest ordering contract in the system, `tutorRuntime.ts`):
1. Create conversation → DO row `active`.
2. N streamed turns; failed/cancelled streams append no event.
3. Exactly one terminal: auto-end at message cap, finalize-on-stream-end, or explicit
   end with `final_rating`.
4. **Invariant**: the DO commits the final message and `ended` state *before* the D1
   event is written — the event is never observable before the transcript's end state.
5. Exactly-once via `runtime_tutor_session_events` ledger PK `(conversation_id,
   user_id)` (`migrations/0004`); a lost race returns the winner's event.

**Grade arrival**: assessment PATCH with grade → parallel per-KC event fan-out →
mastery deltas → notification, all within one request; events precede notification.

**Recommendation loop**: `GET /profile/next-move?available_minutes=15|25|50` → learner
acts or rotates to another option. This produces no domain event. The approved
behavioral ordering (`next_move_viewed` before followed/ignored) is specified below
and is captured deliberately by `NextMoveCard` through the PostHog wrapper.

**Onboarding funnel** (`docs/product/onboarding.md`): `/try` shadow state → trial
situations (demo funnel stream, out-of-band) → `/sign-up?from=demo` → import review
(trial evidence explicitly discarded) → course commit (emits `course_added`) →
completion invariant (`onboarded_at` valid only with ≥1 real course + ≥1 real KC,
middleware-enforced). Trial data never crosses into learner `events`.

### Ordering & idempotency guarantees

- The mastery fold is **order-insensitive**: a pure function of the full per-KC event
  set, recomputed atomically with each append in one `db.batch`
  (`events.ts:84-86`) — cache and log are never observably divergent. Recency comes
  from `ts` (caller-suppliable; backdated manual events are first-class), not insertion
  order. Edit/delete = re-fold over what remains.
- Durable context facts (both role flags false) are filtered before folding
  (`mastery.ts:89-93`) — they can never move mastery or freshness.
- Idempotency exists only where a ledger enforces it: tutor sessions (conversation
  ledger), study-session completion/discard (session-finalization ledger), keyed
  browser event POSTs (`event_idempotency_keys`, tenant-scoped), agentic evidence
  (caller `event_id`; all supplied evidence fields must match), class-session sweep
  (UNIQUE), and demo funnel (event id). Unkeyed legacy `POST /events` remains
  accepted but has no retry guarantee.
- Edit policy: PATCH only `source='manual'` rows; role flags re-derived from type on
  every edit; DELETE allowed for any source.
- Instructional events without `kc_id` skip the fold entirely (`events.ts:87-88`) —
  course-scoped quick logs are context only.

---

## Known defects & gaps (the implementation backlog from this storm)

Ordered by severity. D1–D4 and D7–D8 were fixed on 2026-08-28 (branch
`event-catalog`); kept here as history because existing rows may predate some fixes.

- **D1 — FIXED. Tutor ratings never reached mastery.** The writer emitted
  `payload.final_rating` but the fold only read `self_rating`, so every tutor session
  folded at the neutral 0.7. Fix: the fold now reads `final_rating` (1–5, ÷5) — which
  also retroactively corrects historical rows on their KC's next re-fold.
- **D2 — RESOLVED as reserved.** `correctness` is read by the fold but written by no
  emitter; kept and documented in `eventSuccess` as reserved for graders producing a
  continuous [0,1].
- **D3 — FIXED.** Session-completion events defaulted to `source:'manual'`, making
  system-appended rows user-editable via PATCH; `completeSession` now passes
  `'session'`. Rows created before the fix remain `'manual'`. `'seed'` remains
  declared but unused by the API path (only `scripts/seed.ts`).
- **D4 — RESOLVED as sanctioned exception.** Onboarding's `course_added` must be
  inserted inline (it joins the atomic clone batch that creates the course it
  references, so `createEvent`'s own batch can't be used); it now stamps
  `source:'system'` (added to `EVENT_SOURCES`) instead of masquerading as `'manual'`,
  and the call site documents the exception.
- **D5 — FIXED.** Maintained manual browser event POSTs carry a stable UUID key for
  an unchanged submission. A tenant-scoped ledger is committed atomically with the
  event/mastery update; exact retries return the current event without refolding,
  changed requests conflict, and deletion leaves a tombstone. Unkeyed v1 clients
  remain compatible without the guarantee.
- **D6 — FIXED.** Completion now accepts per-KC ratings and commits them atomically
  with the session, intended events, and mastery caches. StudyFlow no longer posts
  follow-up `self_assessment` requests.
- **D7 — FIXED. Boundary violations**: `recommendation_followed/ignored` were removed
  from the domain API and Next Move no longer writes UI telemetry to D1. Their
  behavioral events now include the `next_move_viewed` impression denominator and
  enforce an impression-before-follow/ignore ordering for each recommendation id.
- **D8 — FIXED. 11 unwired vocabulary entries** (list above). Round-2 storm verdict
  was to **prune all 11** — applied consistently, the two-stream boundary rule dissolves the
  widened taxonomy (it predates the rule). `task_completed/dismissed`,
  `course_archived`, `settings_changed`, `correction_dismissed` are superseded by
  behavioral events (taxonomy below); `plan_committed`, `reflection_captured`,
  `digest_sent`, `session_scheduled` model state or nonexistent features, not
  evidence; `session_rescheduled` history is real but belongs in a D1
  schedule-change log owned by the Replanning loop; `coach_session` returns as a real
  domain event when the coach ships (ledger-idempotent, like `tutor_session`).
  Executed as one vocabulary-narrowing change bundled with B1 after a clean production
  D1 pre-check; the v1 contract narrowing is recorded in `docs/api.md`.
- **D9 — Domain attendance undercount remains by design.** Attendance status does not
  feed mastery unless separately logged as a domain event. Behavioral
  `attendance_toggled` is live on both maintained controls for product analysis.
- **D10 — Replanning history remains absent from the domain model.** Behavioral
  calendar connection start/outcome events are live, but schedule disruptions still
  need the roadmap's durable D1 schedule-change log.
- **D11 — FIXED in the behavioral stream.** A new local signup plus the ordered
  onboarding path/review/completion sequence makes post-signup drop-off measurable.
- **D12 — FIXED.** Discard is an explicit server-side terminal command backed by the
  finalization ledger and always yields zero evidence. Completion distinguishes
  explicit empty KC arrays from omission.

---

## Behavioral stream: implementation catalog

### Architecture decision (45 of 46 approved emitter paths implemented)

**PostHog, deliberate capture only** — no autocapture, no session replay.
`posthog-js` for UI-only events; server-side capture via plain HTTP `/i/v0/e/`
(single) and `/batch/` with `Astro.locals.cfContext.waitUntil()` for request-path
server-truth events (the Node SDK's batching doesn't fit the Workers lifecycle). The
tutor DO alarm awaits its bounded delivery so Cloudflare can retry failures with the
same stable insert id. `demo_funnel_events` D1 stays as-is and newly inserted rows are
mirror-forwarded once through `/batch/`; replays and historical rows are not
forwarded. Rejected: a D1 `behavioral_events` table (recreates the analysis layer
from scratch, unbounded hot table beside learner reads) and Workers Analytics Engine
(sampling, ~90-day retention, no joins — wrong for semester-long per-user sequences).

**Privacy / join keys**: `distinct_id` = local `users.id` (the opaque id from the
Clerk bridge, `migrations/0002`); never Clerk id, email, or name. Pre-auth uses the
anonymous device id; `identify(users.id)` on signup with `trial_session_id` attached
as a property so trial D1 rows stay joinable offline. Property values restricted to
ids, enums, counts, durations — no free text (tutor messages, notes, quiz answers),
enforced by a shared Zod property schema per event, mirroring the `EVENT_TYPES`
discipline. Honor a `settings.analytics_opt_out` flag before every capture; exclude
the developer's own user id server-side. Browser capture and request-path server
capture also honor DNT; the public demo client suppresses the D1 request itself.
Disabled or missing configuration is always a no-op. The DO alarm has no originating
request/DNT header, so it re-reads the learner's current analytics opt-out before
delivery.

**Operational state:** checked-in production and staging vars both set
`ANALYTICS_ENABLED=false`, and no token is committed. These emitters therefore do not
start production capture by merging code; enabling an environment requires the
deliberate gate plus secret-provisioning decision described in `cloudflare.md`.

**Acquisition/activation implementation (2026-08-28):** public demo clients
reuse the foundation's device/app-session state and do not call D1 under DNT.
The Clerk bridge exposes creation truth, so `signup_completed` fires only for a
new local row with a coarse method. Browser identify starts from that same
anonymous device identity and permits only the validated `trial_session_id`
person property. A successful, non-replayed onboarding course commit queues the
three activation events together in canonical order. Counts/path/duration are
structural; filenames, course/KC names, Clerk identifiers, and provider values
never enter the behavioral stream.

### Canonical behavioral events (46; snake_case past-tense, matching domain style)

Base properties on every event: `user_id` (post-auth), `session_id` (client app
session), `surface` (route pattern), `ts`. One parameterized `page_viewed`, never
per-page events.

Coverage is enforced exhaustively by `src/lib/analytics/coverage.ts`: 45 names are
classified live (`product_ui`, `api_only`, or `system`) with named emitter ownership;
`resource_saved` alone is reserved. The registry is a catalog/classification boundary,
not proof of runtime reachability, so focused emitter tests remain required.

**Acquisition / trial-handoff funnel** (the 11 existing `DEMO_FUNNEL_EVENTS` keep
their names; the final four occur on authenticated onboarding while retaining the
opaque `trial_session_id`):

| event | properties | fired when | must follow |
|---|---|---|---|
| `landing_try_clicked` | `trial_session_id` | an actual `/try` CTA is activated on a marketing route | `page_viewed` on that marketing route |
| `setup_step_completed` / `setup_step_skipped` | `trial_session_id`, `step: context\|preferences\|course` | each public-trial setup step completes or is skipped/simulated | — |
| `demo_entered` | `trial_session_id` | the interactive trial surface is entered | setup transitions when setup was shown |
| `scenario_started` / `scenario_completed` | `trial_session_id`, `scenario_id` | a trial scenario transition runs | `demo_entered`; started → completed |
| `signup_clicked` | `trial_session_id` | the public trial's signup CTA is activated | `demo_entered` |
| `import_offered` | `trial_session_id` | authenticated onboarding presents a usable trial handoff | `signup_completed` for that handoff |
| `import_accepted` / `import_declined` | `trial_session_id` | the learner chooses how to handle the offered trial draft | `import_offered` |
| `onboarding_completed` | `trial_session_id` | authenticated onboarding succeeds (legacy funnel close) | accepted/declined import when offered |
| `page_viewed` | `route` (pattern), `referrer_route` | any route render | — |
| `signup_completed` | `method`, `trial_session_id?` | Clerk sign-up bridged to local user | `signup_clicked` when from trial |

**Activation** (authenticated onboarding — closes D11):

| event | properties | fired when | must follow |
|---|---|---|---|
| `onboarding_path_chosen` | `path: template\|manual\|document`, `import_from_trial` | creation path committed | `signup_completed` |
| `onboarding_map_reviewed` | edit counts `{renamed, reordered, excluded}`, `template_id?` | review submitted | `onboarding_path_chosen` |
| `onboarding_completed_auth` | `course_count`, `kc_count`, `duration_ms` | completion invariant passes | `onboarding_map_reviewed` |

**Engagement / session loop**:

| event | properties | fired when | must follow |
|---|---|---|---|
| `app_session_started` | `entry_route`, `days_since_last_session` | first page view after ≥30 min idle (threshold to revisit with data) | — |
| `next_move_viewed` | `recommendation_id`, `rank`, `kind`, `available_minutes` | NextMove card renders (**the missing impression**) | `app_session_started` |
| `recommendation_followed` / `recommendation_ignored` | `recommendation_id`, `rank` | Next Move primary action / “Show another”; moved out of the domain vocabulary by B1 | `next_move_viewed` same id |
| `task_checked` | `task_type`, `source_surface`, `overdue` | task toggle | — |
| `task_dismissed` | `task_type`, `source_surface` | system-task dismissal (`deleteTask` soft delete) | — |
| `record_event_opened` / `record_event_submitted` | `event_type` on submit | maintained Record Event controls | opened → submitted |
| `notification_opened` | `notification_type` | bell item clicked | — |
| `resource_opened` | `resource_id`, `origin: feed\|course\|shared` | resource card opened | — |
| `resource_saved` | `resource_id`, `course_id` | **RESERVED**: no maintained save-to-course action; implement that transition or prune the name | `resource_opened` |

**Learning-surface usage** (context only; mastery truth stays in the domain stream):

| event | properties | fired when | must follow |
|---|---|---|---|
| `practice_started` | `course_id`, `intended_event_type`, `ritual_id?` | StudyFlow creates or validly resumes a session | — |
| `practice_abandoned` | `elapsed_ms`, `stage` | page exit or explicit discard before completion, including resumed visits | `practice_started` in-session; a resumed setup discard may stand alone |
| `quiz_started` / `quiz_abandoned` | `kc_ids`, `question_count` / `answered_count` | QuickQuiz lifecycle | started → abandoned |
| `tutor_opened` | `conversation_id`, `mode`, `kc_id`, `entry` | conversation created/reopened | — |
| `tutor_message_sent` | `conversation_id`, `turn_index` | each learner message | `tutor_opened` |
| `tutor_abandoned` | `conversation_id`, `turn_count`, `elapsed_ms` | ≥30 min inactivity while still active (learner DO alarm; resumable and nonterminal) | `tutor_message_sent` |
| `absorb_stage_reached` | `kc_id`, `stage: 1..4` | each stage entry in `/learn/[kcId]` | monotonic per visit |
| `prereq_gate_decided` | `kc_id`, `choice: verify\|continue_anyway`, `weak_count` | stage-1 decision | `absorb_stage_reached(1)` |
| `misconception_card_shown` | `misconception_id`, `conversation_id` | inline card renders | `tutor_opened` |
| `misconception_accepted` / `misconception_dismissed` | `misconception_id` | card action (accept also → corrections ledger, unchanged) | `misconception_card_shown` |
| `attendance_toggled` | `course_id`, `status`, `sessions_behind` | successful AttendanceCard or planner EventPopover toggle | — |

**Retention signals**:

| event | properties | fired when | must follow |
|---|---|---|---|
| `calendar_connect_started` / `calendar_connected` / `calendar_connect_failed` | `provider` | one ordered server batch per attempt; start time is captured before the provider call and outcome time afterward | started → exactly one outcome |
| `settings_changed` | `keys` (names only, never values) | settings save | — |
| `course_archived` | `course_id`, `weeks_since_added` | successful false→true course PATCH; **API-only**, with no maintained archive UI | — |
| `correction_internalized` | `correction_id`, `days_since_accepted` | ledger action | — |

Deliberately excluded: keystroke/scroll telemetry, tutor message content, quiz answer
content, any free text.

### Canonical funnels (drop-off = sequence stops; anomaly = out-of-order beyond 60s skew)

**A. Entry → activation** (anonymous → identified; trial branch joins via
`trial_session_id`):
```
trial:  page_viewed(marketing route) → landing_try_clicked (actual /try CTA only)
        → [setup_step_completed | setup_step_skipped]×3 → demo_entered
        → (scenario_started → scenario_completed)×0..9 → signup_clicked
        → signup_completed → import_offered → (import_accepted | import_declined)
direct: page_viewed(/sign-up) → signup_completed

either authenticated branch:
onboarding_path_chosen → onboarding_map_reviewed → onboarding_completed_auth
→ onboarding_completed (legacy demo-funnel close, best-effort browser request)
```
Invariants: only a newly created local user emits `signup_completed`; the three
authenticated activation events are one ordered server capture after a newly
successful course commit, and replayed imports do not recapture them.

**B. Daily study loop** (the retention heartbeat):
```
app_session_started → page_viewed(/dashboard) → next_move_viewed
→ ( recommendation_followed
      → (quiz_started | page_viewed(/learn/[kcId]) → absorb_stage_reached(1))
  | recommendation_ignored → next_move_viewed(rank+1) … )
```
Invariant: every followed/ignored has a same-`recommendation_id` impression earlier in
the session — this makes the currently-uncomputable follow rate computable.

**C. Tutor loop**:
```
tutor_opened → tutor_message_sent×n
→ ( explicit/cap end → domain tutor_session event
  | 30 min inactive → tutor_abandoned → [later tutor_message_sent …] )
optionally interleaved: misconception_card_shown → (accepted | dismissed)
```
Invariant: the domain end is the only terminal. `tutor_abandoned` is a resumable
inactivity episode, can recur after later learner turns, and carries no transcript or
provider-error content.

**D. Absorb loop**:
```
page_viewed(/learn/[kcId]) → absorb_stage_reached(1)
→ ( prereq_gate_decided(verify, weak_count>0) → absorb_stage_reached(2)
      → quiz_started → [quiz result | quiz_abandoned] → back to stage 1
  | prereq_gate_decided(continue_anyway, weak_count≥0) → absorb_stage_reached(3)
      → absorb_stage_reached(4) → tutor_opened(mode: absorb) )
```
Invariant: stage telemetry is monotonic within a mounted visit. The proceed path emits
`continue_anyway` even when `weak_count = 0`; stage 2 occurs only on the verify branch.

### Decisions and remaining questions

- **B1 — DECIDED and implemented.** `recommendation_followed/ignored` moved to the
  behavioral vocabulary and the 11 dead types were pruned from `POST /api/v1/events`
  in one ratified v1 narrowing. Production had zero rows for all 13 names, so there
  were no historical recommendation rows to backfill or retain.
- **B2** — `app_session_started` idle threshold: 30 min is the default; the
  15/25/50-minute budget concept suggests shorter — revisit after two weeks of
  `page_viewed` data.
- **B3 — DECIDED and implemented.** `tutor_abandoned` is owned by the learner DO's
  native alarm. The same alarm multiplexes tutor-inactivity and generic scheduled
  deadlines; awaited bounded delivery plus a stable insert id provides retry safety.
- **B4 — DECIDED and implemented.** There are no mobile-specific event names;
  `surface` plus the optional coarse `viewport` property carries the distinction.

## TODO

- Decide `resource_saved`: implement a real save-an-existing-resource-to-course action
  and emitter, or prune it from the approved taxonomy. Creating a new resource is not
  that transition.
- Add the analysis conventions here (source filters, seed/dev exclusion, funnel
  queries).
