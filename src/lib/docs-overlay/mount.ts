// TEMPORARY — docs annotation overlay client entry. See docs/product/annotations.md.
//
// Why this exists instead of an `<DocsOverlay client:idle />` in AppShell:
// Astro collects `client:*` components at build-analysis time, NOT by runtime
// reachability. A `{FLAG && <DocsOverlay client:idle />}` guard folds to false
// correctly on the server (nothing renders), but the island chunk is still
// emitted — measured at 55.5K containing the full annotation text, publicly
// fetchable at its hashed URL in a production build. Injecting the mount from
// an integration that only runs for `astro dev` means the module graph never
// reaches this file in a build, so nothing is emitted at all.
import { mount } from 'svelte';
import DocsOverlay from '../../components/docs-overlay/DocsOverlay.svelte';

// Only pages built on AppShell have anything to annotate — /login renders its
// own bare document, so skip it rather than mounting a panel over the form.
if (document.querySelector('.shell')) {
  const host = document.createElement('div');
  host.id = 'docs-overlay-root';
  // Direct body child, deliberately: AppShell's <main> has
  // `container-type: inline-size` (=> `contain: layout`), which makes it the
  // containing block for any position:fixed descendant. See
  // docs/design/mobile-shell.md.
  document.body.appendChild(host);
  mount(DocsOverlay, { target: host });
}
