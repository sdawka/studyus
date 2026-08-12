# ADR-002: Svelte 5 Islands for Interactivity

**Status**: Accepted

**Decision**: Use Svelte 5.56 with Astro islands for client-side interactivity components.

## Context

studyus UI requires both:
- **Static, SEO-friendly pages** (dashboard, course index, profile).
- **Interactive islands** (calendar picker, grade entry, tutor chat, file upload, form state).

Alternatives:
- **React**: Heavier bundle; overkill for mostly-static pages.
- **Vue**: Good, but Astro + Svelte felt lighter.
- **Vanilla JS**: Harder to compose complex form state.
- **HTMX**: Not enough for real-time tutor chat (SSE).

## Decision

**Svelte 5 islands** via `@astrojs/svelte` 9:
- Astro pages are mostly static HTML.
- Specific components opt-in to Svelte (marked with `client:*` directives).
- Svelte handles form state, real-time streams (SSE for tutor), dropdowns, modals.

## Consequences

**Positive:**
- Minimal bundle size; only interactive components are JS.
- Svelte's reactivity is elegant for forms (two-way binding, computed states).
- Easy to test component logic in isolation.
- Hot-reload during dev.

**Negative:**
- Islands don't share state by default (must use Svelte stores + PubSub if needed).
- Smaller ecosystem than React (fewer third-party UI libraries).
- Team familiar with React may have a ramp-up.

## Component Scoping

- `src/components/admin/` — Dashboard, Calendar, GradeTable (interactive islands).
- `src/components/learning/` — CourseTabs, TutorChat, InteractiveModel (islands).
- `src/components/shared/` — RecordEventModal, Sidebar (islands + static parts).

See `docs/product/screens.md` for per-screen breakdown.

## Notes

- Svelte's `<form>` bindings pair well with Zod validation on the server.
- SSE (tutor chat, event log) is a good use case for Svelte's reactivity.
