// Shared not-found handling for `.astro` pages that call services directly
// with a route param (course slug, KC id, note id, ...). Services throw
// NotFoundError (see services/util.ts) on a missing/unowned row; API routes
// already translate that to a 404 via withServiceErrors, but `.astro` pages
// bypass that layer, so an uncaught NotFoundError would otherwise surface as
// an unhandled exception (500). Wrap the service call in a try/catch and,
// on NotFoundError, `return notFound(Astro)` from the page's frontmatter.
import type { AstroGlobal } from 'astro';

export { NotFoundError } from './services/util';

export function notFound(Astro: AstroGlobal) {
  Astro.response.status = 404;
  return Astro.rewrite('/404');
}
