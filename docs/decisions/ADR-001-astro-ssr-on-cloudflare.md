# ADR-001: Astro SSR on Cloudflare Workers

**Status**: Accepted

**Decision**: Use Astro 7.2 with `output: 'server'` deployed to Cloudflare Workers (not Pages) via `@astrojs/cloudflare` 14.2.

## Context

StudyBuddy requires:
- Server-side rendering (SSR) for session auth middleware and data-driven pages.
- Real-time integration with D1 database and R2 storage.
- Frozen API contract for native client (iPad app).
- Fast local development feedback loop.

Alternatives considered:
- **Astro Static + Cloudflare Pages**: Can't do session middleware or API routes on Pages.
- **Next.js on Vercel**: Locked into Vercel; less direct Cloudflare D1/R2 integration.
- **Remix on Cloudflare**: More prescriptive; Astro has stronger component story (Svelte islands).

## Decision

**Astro 7.2 SSR on Workers** via @astrojs/cloudflare 14.2:
- Pages rendered server-side; middleware gates auth.
- Svelte 5 islands for interactivity (CalendarView, GradeTable, TutorChat, etc.).
- Bindings (`env.DB`, `env.UPLOADS`) injected from wrangler.jsonc.
- `astro dev` runs on real workerd; local D1/R2 under `.wrangler/state/`.

## Consequences

**Positive:**
- Full control over auth & session lifecycle (hand-rolled vs. library).
- Direct access to Cloudflare primitives (D1 atomicity via `db.batch`, R2 streaming).
- Frozen API contract (`/api/v1` endpoints) separates webapp from native clients.
- Svelte islands strike a balance between static rendering and interactivity.

**Negative:**
- Adapter-specific gotchas (v14 breaks from older tutorials; no `platformProxy`).
- Smaller ecosystem than Next.js; fewer third-party integrations.
- Requires familiarity with Cloudflare Workers model (isolate execution, no file system).

## Notes

- **wrangler.jsonc** is the source of truth for bindings; no Astro config pollution.
- **Middleware gates** everything; `/login` is the only public route.
- **Local dev** is reliable because we use real D1 (not mocks).

See `docs/architecture/cloudflare.md` for adapter specifics.
