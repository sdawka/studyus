// Native Cloudflare Workers tracing — zero dependencies, local-dev only by
// construction (see docs/architecture/observability.md). D1/R2/outbound
// fetch spans are captured automatically by workerd; this helper is only
// for a handful of app-semantic spans (mastery fold, event writes) that
// wouldn't otherwise show up as anything but "the request handler ran".
//
// Lazy-imports `cloudflare:workers` and no-ops (just runs `fn`) if the
// module or its `tracing` export isn't available — e.g. if observability
// isn't enabled in wrangler.jsonc, or in a runtime that doesn't provide it.
// This keeps services import-safe without depending on tracing being wired
// up everywhere they're used (including tests).
type SpanAttrs = Record<string, string | number | boolean | undefined>;

// Typed loosely on purpose: `Tracing`/`Span` are ambient global types from
// @cloudflare/workers-types, not exports of the module, so we cast rather
// than fight the type resolution for what's ultimately a best-effort helper.
type SpanLike = { setAttribute(key: string, value: string | number | boolean): unknown };
type TracingLike = { enterSpan<T>(name: string, cb: (span: SpanLike) => Promise<T>): Promise<T> };

export async function withSpan<T>(name: string, attrs: SpanAttrs, fn: () => Promise<T>): Promise<T> {
  try {
    const workersModule = (await import('cloudflare:workers')) as unknown as { tracing?: TracingLike };
    const tracing = workersModule.tracing;
    if (!tracing) return fn();

    return await tracing.enterSpan(name, async (span) => {
      for (const [key, value] of Object.entries(attrs)) {
        if (value !== undefined) span.setAttribute(key, value);
      }
      return fn();
    });
  } catch {
    // No `cloudflare:workers` module, no `tracing` export, or the span API
    // threw (e.g. observability disabled) — tracing is strictly best-effort.
    return fn();
  }
}
