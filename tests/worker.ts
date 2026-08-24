// The production entry imports Astro's build-time virtual module. Durable
// Object tests use this minimal entry so Miniflare can load the same DO class
// without an Astro build step.
export { LearnerAgent } from '../src/lib/runtime/learnerAgent';

export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
