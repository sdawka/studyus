# Observability: Native Local Tracing

## What this is

Cloudflare's **native, zero-dependency** tracing, enabled for local dev only. No OTel SDK, no exporter, no collector — this is `wrangler`/workerd's built-in span recorder, viewable through a local-only Explorer UI. It's ephemeral: traces live in memory for the current `astro dev` process and are gone on restart. There is no persistence and nothing leaves your machine.

## Setup

`wrangler.jsonc`:
```jsonc
{
  "observability": {
    "traces": { "enabled": true }
  }
}
```
Requires wrangler >= 4.118 (this project pins `^4.83.0` in `package.json` but the installed version is 4.121, which satisfies it — `npx wrangler --version` to confirm on any machine that installs fresh).

## Viewing traces

With `npm run dev` running:
- Press `e` in the terminal running `astro dev` (it proxies to wrangler's dev process), **or**
- Open `http://localhost:4321/cdn-cgi/explorer` directly in a browser.

Each request shows a waterfall: the top-level request span, auto-captured D1 query spans, auto-captured R2/outbound-fetch spans, and any custom spans added via the `withSpan` helper (below).

**Gotcha**: workerd zeroes out CPU-timing measurements for spans in the local dev Explorer (a intentional isolate-security measure — CPU time is a side-channel). Pure-compute spans (like `mastery.fold`, which touches no I/O) will show as ~0ms even though they take real (if tiny) time. Only spans that include I/O (D1 queries, R2, fetch) show meaningful duration locally. This is a known limitation of the local tool, not a bug in the app — don't read "0ms" as "this is free."

## Custom spans: the `withSpan` helper

`src/lib/tracing.ts` exports:
```ts
withSpan<T>(name: string, attrs: Record<string, string|number|boolean|undefined>, fn: () => Promise<T>): Promise<T>
```

It lazy-imports `cloudflare:workers` and calls `tracing.enterSpan(name, ...)`, wrapping `fn` and setting `attrs` on the span. If the module or the `tracing` export isn't available for any reason (observability disabled, an unusual runtime), it silently falls back to just calling `fn()` — **spans are strictly best-effort and never change control flow or throw**. This is what lets `src/lib/services/*` import it unconditionally, including under `@cloudflare/vitest-pool-workers` in tests (verified: `npm test` passes with these spans wired in — see `tests/events.test.ts`).

Convention: call it around **app-semantic** operations that wouldn't otherwise be visible as anything but "the request handler ran a while" — not around every DB call (D1 queries already get their own auto-captured spans). Currently instrumented in `src/lib/services/events.ts`:
- `mastery.fold` — around the `foldMastery` call inside `foldedKcUpdate`, attrs `kc_id`, `event_count`.
- `events.append` — around the `db.batch([insertStmt, updateStmt])` (or bare insert for kc-less events) in `createEvent`, attrs `event_type`, `kc_id?`.

Add more spans the same way as new services grow logic worth seeing on its own line in the waterfall — don't wrap trivial one-query service functions.

## TODO

- **Persistent/exportable pipeline**: if a durable trace history (across restarts) or team-shared traces are ever wanted, the path is `@microlabs/otel-cf-workers` (OTel SDK shimmed for Workers) exporting OTLP to a local collector, viewed with something like `otel-tui`. Deliberately not done here — adds two dependencies and a running collector process for a local-only dev tool; native tracing covers the "is this working" loop this milestone needs. Revisit if remote/staging tracing is ever required (that would need this regardless, since native local tracing has no export path).
- Auto-capture verification across D1/R2/fetch was confirmed by observation (spans appear in Explorer for existing calls) rather than an automated test — there's no scriptable API for the Explorer to assert against in CI.
