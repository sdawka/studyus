# Event Catalog & Expected Orderings

**Status (2026-08-28)**: canonical reference produced by an event-storming pass over the
whole codebase. The **domain stream** sections describe what is implemented today
(file:line cited). The **behavioral stream** section is recorded design — approved
vocabulary and orderings, not yet implemented. `events-and-mastery.md` stays the theory
doc (KLI, the fold); this doc is the operational catalog: every event, who emits it,
what it carries, and what order things are expected to arrive in.

## The two streams

studyus has (and must keep) two separate event streams:

1. **Domain stream** — the `events` table (`migrations/0000_whole_randall.sql:110`),
   vocabulary `EVENT_TYPES` (`src/lib/schemas/events.ts:8`), single sanctioned writer
   `src/lib/services/events.ts`, folded into mastery by `src/lib/services/mastery.ts`.
   This is learner-model evidence.
2. **Behavioral stream** — product usage telemetry. Today it exists only as the
   anonymous trial funnel (`demo_funnel_events`); the full layer is designed below.

**Boundary rule**: an event belongs in the **domain stream** iff it is instructional or
assessment evidence about a KC — i.e. it can legitimately move mastery or freshness. It
belongs in the **behavioral stream** iff it is about product usage. UI telemetry must
never be written into the `events` table. (Two existing types violate this rule —
see Defect D7.)

---

## Domain stream: catalog

Sources: `manual | session | tutor | seed` (`src/lib/schemas/events.ts:84`). Role flags
(IE = instructional, AE = assessment) are derived exclusively from type via
`EVENT_ROLE_FLAGS` (`src/lib/schemas/events.ts:52`).

The fold reads **only** these payload keys (`src/lib/services/mastery.ts:70-77`):
`correct` (bool), `correctness` (0–1), `score` (0–100), `self_rating` (1–5); any AE
event carrying none of them folds at the neutral `DEFAULT_AE_SUCCESS = 0.7`.

### Emitted today

| Event | IE/AE | Emitters | Trigger / actor | Payload written | Fold reads |
|---|---|---|---|---|---|
| `lecture_attended` / `lecture_missed` | IE/– | `LogEventModal.svelte`, `QuickEventForm.svelte:34` → `POST /api/v1/events` | Student self-logs attendance | `note?` | — (IE bump) |
| `video_watched`, `reading_done`, `taught_someone` | IE/– | Manual modal; session completion via `intended_event_type` (`sessions.ts:120-130`) | Self-log or session complete | `note?` / `{session_id}` | — (IE bump) |
| `quiz_taken` | –/AE | `assessments.ts:169-177` (grade fan-out per linked KC); manual modal | Grade entered on quiz assessment | `{score?, assessment_id}` | `score` |
| `assignment_graded` | –/AE | `assessments.ts` (assignment/lab); manual modal | Grade entered | `{score?, assessment_id}` | `score` |
| `exam_graded` | –/AE | `assessments.ts` (midterm/final); manual modal | Grade entered | `{score?, assessment_id}` | `score` |
| `self_assessment` | –/AE | `StudyFlow.svelte:281-290` (per rated KC after session); manual modal | Student rates understanding 1–5 | `{self_rating}` | `self_rating` |
| `practice_done` | IE/AE | `sessions.ts:124-130` (completion fallback type, one per touched KC) | `PATCH /sessions/:id/complete` | `{session_id}` — **no outcome** | nothing → 0.7 |
| `retrieval_practice` | IE/AE | `quick_quiz.ts:317-327`, `exercise_attempt.ts:70-79`, `exercise.ts:218` (all source `'tutor'`); manual; sessions | Quiz/exercise graded; self-log | `{correct, session_id?/exercise_id?, channel}` | `correct` |
| `placement_probe` / `diagnostic_probe` | –/AE | `domain/pedagogy/exercise.ts:218-235` `recordExerciseEvidence` only (caller-supplied `event_id` dedupe) | Agentic channel records probe outcome | `{correct, exercise_id, misconception_id, purpose, channel}` | `correct` |
| `tutor_session` | IE/AE | `events.ts:102-167` `createRuntimeTutorSessionEvent` (ledger-idempotent); legacy `tutor/conversations.ts:309-317` | Tutor conversation ends | `{conversation_id, mode, final_rating?}` | **nothing → 0.7** (Defect D1) |
| `correction_accepted` | context | `corrections.ts:96-104` (source `'tutor'`) | Student accepts a correction | `{correction_id, misconception_id}` | excluded |
| `recommendation_followed` / `recommendation_ignored` | context | `NextMoveCard.svelte:41-63`, fire-and-forget keepalive fetch | Follow / "show another" on next-move card | `{recommendation_id, action_id, kind, method, available_minutes, rank}` | excluded |
| `course_added` | context | `onboarding.ts:320-323` — raw `db.insert`, bypasses `createEvent` (Defect D4) | Onboarding course commit | `{source:'demo_import', draft_id}` | excluded |

### In the vocabulary but never emitted (verified repo-wide, 2026-08-28)

`task_completed`, `task_dismissed`, `correction_dismissed`, `course_archived`,
`plan_committed`, `session_scheduled`, `session_rescheduled`, `settings_changed`,
`coach_session`, `reflection_captured`, `digest_sent` — 11 types with no emitter
anywhere. The enum promises an activity stream the code doesn't produce; this is
todo.md "Other active priorities" #2. The biggest blind spots: the task lifecycle (the
task-centric dashboard leaves no event trail), scheduling/rescheduling (planning
behavior is unreconstructable), and course archival.

### Adjacent stores analysis must know about

- **`demo_funnel_events`** — anonymous public-trial funnel, 11 allow-listed names
  (`src/lib/schemas/onboarding.ts:121-133`), written by
  `POST /api/public/demo-events` (7-day window, ≤100/session, idempotent by event id).
  Completely separate table; pollution-safe by construction. Ends at
  `onboarding_completed` — nothing behavioral is recorded for authenticated users.
- **`class_sessions`** — attendance is **status rows, not events** (deliberate, v1.3,
  `classSessions.ts:1-11`). Initial status seeds once from same-day
  `lecture_attended/missed` events; thereafter PATCH-only, and marking attendance does
  NOT append an event. Attendance analysis must join both representations, and the
  primary UI path (AttendanceCard) feeds only this table, never the mastery fold.
- **`studySessions` quick-quiz sentinel** — quick quizzes are session rows with a
  sentinel `intendedEventType` and quiz JSON in `reflection`
  (`quick_quiz.ts:260-268`). Session-level analytics must filter the sentinel.
- **Tutor Durable Object SQLite** — conversations/turns/alarms live in the DO
  (`learnerAgent.ts:19-51,283-326`) and surface into D1 only as the single terminal
  `tutor_session` event. Abandoned (never-ended) conversations leave no D1 trace.
- **`scripts/seed.ts`** writes real `events` rows with `source:'seed'` — every
  analysis must filter `source != 'seed'` (and exclude the developer's own user id).

---

## Domain stream: lifecycles & expected orderings

**Manual log**: modal → `POST /events` → 201 `{event, mastery_deltas}`. One step.

**Study session** (`StudyFlow.svelte`, `sessions.ts`):
1. `POST /sessions {intended_event_type, planned_minutes, …}` — no event at scheduling.
2. Optional `PATCH /sessions/:id` reschedule — rejected once completed (`sessions.ts:145`).
3. `PATCH /sessions/:id/complete {kc_ids_touched}` → one event of the intended type per
   touched KC (payload `{session_id}` only).
4. Client then posts one `self_assessment` per rated KC — ratings ride separate events
   *after* completion (`StudyFlow.svelte:278-293`). If these fire-and-forget POSTs
   fail, ratings are silently lost and only the neutral practice event remains (D6).
   Discard path: complete with empty `kc_ids_touched` → zero events.

**Quick quiz** (`quick_quiz.ts`): generate → sentinel session row → grade exactly once
(`graded` flag) → `endedAt` + one `retrieval_practice{correct}` per KC. Never goes
through `completeSession`.

**Exercise / agentic evidence** (`exercise.ts:202-254`): `recordExerciseEvidence`
(at-least-once delivery, `event_id` dedupe) → probe/practice event → if incorrect
diagnostic AND event `wasCreated`: misconception advances `suspected → confirmed`.
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
acts → `recommendation_followed` (CTA) or `recommendation_ignored` (per rotation click;
one fetch can yield N ignores + 1 follow). Fire-and-forget by design: no retry, no
dedupe, nothing enforces fetch-before-track.

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
- Context events (both role flags false) are filtered before folding
  (`mastery.ts:87-91`) — they can never move mastery or freshness.
- Idempotency exists only where a ledger enforces it: tutor sessions (conversation
  ledger), agentic evidence (caller `event_id`; same id with different type/kc → 409),
  class-session sweep (UNIQUE), demo funnel (event id). **All browser POSTs (manual
  logs, self-assessments, recommendation telemetry) have no idempotency key** —
  double-submit means double mastery evidence (D5).
- Edit policy: PATCH only `source='manual'` rows; role flags re-derived from type on
  every edit; DELETE allowed for any source.
- Instructional events without `kc_id` skip the fold entirely (`events.ts:87-88`) —
  course-scoped quick logs are context only.

---

## Known defects & gaps (the implementation backlog from this storm)

Ordered by severity. D1–D3 are bugs; the rest are instrumentation debt.

- **D1 — Tutor ratings never reach mastery.** `createRuntimeTutorSessionEvent` writes
  `payload.final_rating` (`events.ts:120`) but the fold reads `self_rating`
  (`mastery.ts:75`). Every tutor session folds at the neutral 0.7 regardless of the
  learner's 1–5 rating. Fix: rename the key or teach the fold `final_rating`.
- **D2 — `correctness` is a phantom key**: read by the fold (`mastery.ts:73`), written
  by no emitter. Decide: reserved (document it) or dead (remove it).
- **D3 — Session-completion events default to `source:'manual'`**
  (`sessions.ts:125`), making system-appended rows user-editable via PATCH;
  quiz/exercise flows correctly pass `'tutor'`. Also `'seed'` is declared but unused
  by the API path.
- **D4 — Single-writer violation**: `onboarding.ts:320` raw-inserts `course_added`,
  bypassing `createEvent` (harmless today — no kc_id — but it is the one break in the
  invariant and it mislabels `source:'manual'`).
- **D5 — No idempotency key on browser event POSTs** (manual logs, self-assessments,
  recommendation telemetry): retries and double-taps duplicate evidence.
- **D6 — `practice_done` carries no outcome** and post-session `self_assessment`
  POSTs are fire-and-forget: failed rating posts silently pull KCs toward the 0.7
  neutral. Consider carrying ratings in the completion request itself.
- **D7 — Boundary violations**: `recommendation_followed/ignored` live in the domain
  stream but carry no KC evidence — under the boundary rule they migrate to the
  behavioral stream (open question B1 below). And there is **no impression event**, so
  follow-rate has no denominator.
- **D8 — 11 unwired vocabulary entries** (list above): task lifecycle, scheduling,
  settings, archival, coach family produce no events.
- **D9 — Attendance undercount**: the primary attendance path records no event; only
  the secondary manual-modal path feeds the fold.
- **D10 — Calendar sync leaves no trace**: sync outcomes and schedule disruptions
  produce no domain event — the exact trigger signal the roadmap's Replanning loop
  needs.
- **D11 — Post-signup funnel is invisible**: between `signup` and `course_added`
  nothing is recorded; onboarding drop-off cannot be measured (behavioral layer fixes
  this).

---

## Behavioral stream: recorded design (not yet implemented)

### Architecture decision (recorded; ratify before implementing)

**PostHog, deliberate capture only** — no autocapture, no session replay.
`posthog-js` for UI-only events; server-side capture via plain HTTP `/capture` with
`ctx.waitUntil` for server-truth events (the Node SDK's batching doesn't fit the
Workers lifecycle). `demo_funnel_events` D1 stays as-is (mirror-forward to PostHog,
no backfill). Rejected: a D1 `behavioral_events` table (recreates the analysis layer
from scratch, unbounded hot table beside learner reads) and Workers Analytics Engine
(sampling, ~90-day retention, no joins — wrong for semester-long per-user sequences).

**Privacy / join keys**: `distinct_id` = local `users.id` (the opaque id from the
Clerk bridge, `migrations/0002`); never Clerk id, email, or name. Pre-auth uses the
anonymous device id; `identify(users.id)` on signup with `trial_session_id` attached
as a property so trial D1 rows stay joinable offline. Property values restricted to
ids, enums, counts, durations — no free text (tutor messages, notes, quiz answers),
enforced by a shared Zod property schema per event, mirroring the `EVENT_TYPES`
discipline. Honor a `settings.analytics_opt_out` flag before every capture; exclude
the developer's own user id server-side.

### Canonical behavioral events (~30; snake_case past-tense, matching domain style)

Base properties on every event: `user_id` (post-auth), `session_id` (client app
session), `surface` (route pattern), `ts`. One parameterized `page_viewed`, never
per-page events.

**Acquisition** (pre-auth; the 11 existing `DEMO_FUNNEL_EVENTS` keep their names):

| event | properties | fired when | must follow |
|---|---|---|---|
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
| `recommendation_followed` / `recommendation_ignored` | `recommendation_id`, `rank` | migrates here from domain stream (B1) | `next_move_viewed` same id |
| `task_checked` | `task_type`, `source_surface`, `overdue` | task toggle | — |
| `record_event_opened` / `record_event_submitted` | `event_type?` on submit | Record Event modal | opened → submitted |
| `notification_opened` | `notification_type` | bell item clicked | — |
| `resource_opened` | `resource_id`, `origin: feed\|course\|shared` | resource card opened | — |
| `resource_saved` | `resource_id`, `course_id` | saved to course | `resource_opened` |

**Learning-surface usage** (context only; mastery truth stays in the domain stream):

| event | properties | fired when | must follow |
|---|---|---|---|
| `practice_started` | `course_id`, `intended_event_type`, `ritual_id?` | StudyFlow begins | — |
| `practice_abandoned` | `elapsed_ms`, `stage` | left before completion | `practice_started` |
| `quiz_started` / `quiz_abandoned` | `kc_ids`, `question_count` / `answered_count` | QuickQuiz lifecycle | started → abandoned |
| `tutor_opened` | `conversation_id`, `mode`, `kc_id`, `entry` | conversation created/reopened | — |
| `tutor_message_sent` | `conversation_id`, `turn_index` | each learner message | `tutor_opened` |
| `tutor_abandoned` | `conversation_id`, `turn_count`, `elapsed_ms` | ≥30 min inactivity without end (server sweep — home TBD, B3) | `tutor_message_sent` |
| `absorb_stage_reached` | `kc_id`, `stage: 1..4` | each stage entry in `/learn/[kcId]` | monotonic per visit |
| `prereq_gate_decided` | `kc_id`, `choice: verify\|continue_anyway`, `weak_count` | stage-1 decision | `absorb_stage_reached(1)` |
| `misconception_card_shown` | `misconception_id`, `conversation_id` | inline card renders | `tutor_opened` |
| `misconception_accepted` / `misconception_dismissed` | `misconception_id` | card action (accept also → corrections ledger, unchanged) | `misconception_card_shown` |
| `attendance_toggled` | `course_id`, `status`, `sessions_behind` | AttendanceCard toggle | — |

**Retention signals**:

| event | properties | fired when | must follow |
|---|---|---|---|
| `calendar_connect_started` / `calendar_connected` / `calendar_connect_failed` | `provider` | OAuth flow | started → terminal |
| `settings_changed` | `keys` (names only, never values) | settings save | — |
| `correction_internalized` | `correction_id`, `days_since_accepted` | ledger action | — |

Deliberately excluded: keystroke/scroll telemetry, tutor message content, quiz answer
content, any free text.

### Canonical funnels (drop-off = sequence stops; anomaly = out-of-order beyond 60s skew)

**A. Trial → activation** (anonymous → identified; join via `trial_session_id`):
```
page_viewed(/) → landing_try_clicked → [setup_step_completed | setup_step_skipped]×3
→ demo_entered → (scenario_started → scenario_completed)×0..9 → signup_clicked
→ signup_completed → import_offered → (import_accepted | import_declined)
→ onboarding_path_chosen → onboarding_map_reviewed → onboarding_completed_auth
```
Invariants: `import_offered` only with `trial_session_id`; exactly one
`onboarding_path_chosen` per completion.

**B. Daily study loop** (the retention heartbeat):
```
app_session_started → page_viewed(/dashboard) → next_move_viewed
→ ( recommendation_followed → practice_started → (domain append | practice_abandoned)
  | recommendation_ignored → next_move_viewed(rank+1) … )
```
Invariant: every followed/ignored has a same-`recommendation_id` impression earlier in
the session — this makes the currently-uncomputable follow rate computable.

**C. Tutor loop**:
```
tutor_opened → tutor_message_sent×n
→ ( end → domain tutor_session event (existing) | tutor_abandoned )
optionally interleaved: misconception_card_shown → (accepted | dismissed)
```
Invariant: exactly one terminal per `conversation_id`.

**D. Absorb loop**:
```
page_viewed(/learn/[kcId]) → absorb_stage_reached(1) → prereq_gate_decided
→ [quiz_started → …]? → absorb_stage_reached(3) → absorb_stage_reached(4)
→ tutor_opened(mode: absorb)
```
Invariant: stage monotonic within a visit; stage 4 without 2–3 legal only when
`weak_count = 0`.

### Open questions (decide before implementing)

- **B1** — Migrating `recommendation_followed/ignored` out of `EVENT_TYPES` narrows
  `POST /api/v1/events`: acceptable v1 change (they were never mastery-bearing) or
  additivity violation per `docs/api.md`? Disposition of existing rows needed.
- **B2** — `app_session_started` idle threshold: 30 min is the default; the
  15/25/50-minute budget concept suggests shorter — revisit after two weeks of
  `page_viewed` data.
- **B3** — `tutor_abandoned` sweep home: the existing 5-min cron or a DO alarm.
- **B4** — Mobile shell: no mobile-specific events; `surface` + a viewport property.

## TODO

- Implement the behavioral layer (PostHog decision above) once ratified.
- Fix D1–D6 in the domain stream; wire the 11 dead vocabulary entries (D8) or prune
  them.
- After implementation, add the analysis conventions here (source filters, seed/dev
  exclusion, funnel queries).
