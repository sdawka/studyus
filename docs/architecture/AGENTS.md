# Orientation: the studyus event system (read me first)

Written for an agent (or human) arriving with zero session memory. studyus is a
KLI-grounded study platform (Astro + Svelte on Cloudflare Workers, D1 + Drizzle,
per-learner Durable Object tutor runtime). Its learner model is **event-sourced**:
everything below exists to keep that sound.

## The one rule that must never break

There are **two event streams**, and they must stay separate:

- **Domain stream** — the D1 `events` table. Learning evidence only: an event belongs
  here iff it is instructional or assessment evidence about a KC (it can move mastery
  or freshness). Vocabulary: `EVENT_TYPES` in `src/lib/schemas/events.ts` with
  IE/AE role flags derived only from type. Single sanctioned writer:
  `src/lib/services/events.ts` (`createEvent` — every append with a `kc_id` re-folds
  mastery in the same atomic `db.batch`). The fold: `src/lib/services/mastery.ts`,
  a pure order-insensitive function of the full per-KC event set.
- **Behavioral stream** — product usage telemetry (page views, impressions,
  abandonment). Never write this into the `events` table. As of 2026-08-28 it is
  **designed but not implemented** (PostHog, deliberate capture, `users.id` as
  distinct_id, no PII, no free text) — full design in `event-catalog.md`.

## Where the truth lives

- `event-catalog.md` (this folder) — **the operational catalog**: every emitted event
  with emitter/payload/fold-read keys, the unwired vocabulary, lifecycles and expected
  orderings, idempotency guarantees, defect list D1–D11, behavioral-layer design and
  its open questions B1–B4. Start there for any event work.
- `events-and-mastery.md` — the theory (KLI ontology, mastery fold semantics).
- `data-model.md` — all tables. Adjacent stores that are NOT domain events but hold
  event-like data: `demo_funnel_events` (anonymous trial funnel),
  `class_sessions` (attendance is status rows, not events), `studySessions`
  (quick quizzes hide behind a sentinel `intendedEventType`), the tutor DO's private
  SQLite (only the terminal `tutor_session` event reaches D1).
- `docs/todo.md` — active roadmap; "Complete activity-stream instrumentation" is the
  standing priority this system feeds.

## Invariants to preserve when touching event code

1. Only `services/events.ts` writes the `events` table. One sanctioned exception:
   onboarding's `course_added` (`source:'system'`) is inserted inline because it must
   join the atomic clone batch creating the course it references. Don't add more.
2. Role flags are always derived from type via `EVENT_ROLE_FLAGS`; never set by hand.
3. Context events (both flags false) are excluded from the fold — they can never move
   mastery.
4. Event append + mastery cache update are one atomic D1 batch; never let them diverge.
5. Tutor sessions are exactly-once per conversation via the
   `runtime_tutor_session_events` ledger, and the DO commits its `ended` state before
   the D1 event exists.
6. Analysis must filter `source = 'seed'` and the developer's own user id.

## Conventions

Event names are snake_case past-tense verbs in both streams. Payload keys the fold
reads: `correct`, `correctness`, `score`, `self_rating`, `final_rating` (see
mastery.ts `eventSuccess`); an AE event
carrying none folds at the neutral 0.7 — so an outcome-less assessment event is
usually a bug, not a feature. When adding a domain event type: add to `EVENT_TYPES` +
`EVENT_ROLE_FLAGS`, wire a real emitter in the same change (the catalog's D8 lists 11
types that were added without emitters — don't repeat that), and update
`event-catalog.md`.
