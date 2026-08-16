// TEMPORARY — docs annotation overlay build wiring. See docs/product/annotations.md.
//
// Gates the overlay on Astro's `command` rather than only on an env var, so it
// is structurally impossible to ship: `astro build` never injects the mount, so
// the module graph never reaches DocsOverlay.svelte / annotations.ts and no
// chunk is emitted. An env guard alone did NOT achieve this — Astro registers
// `client:*` islands at build-analysis time regardless of whether the guarded
// branch can execute, which left a 55.5K chunk of internal annotation prose in
// dist/client/_astro/ as a publicly fetchable asset.
//
// Escape hatches:
//   PUBLIC_DOCS_OVERLAY=false  in the shell env  -> off even in dev
//   PUBLIC_DOCS_OVERLAY=true   in the shell env  -> on for a build/preview
//                                                   smoke test (opt-in only;
//                                                   .env files do not trigger
//                                                   this, only a real export)
export function docsOverlayIntegration() {
  return {
    name: 'docs-overlay',
    hooks: {
      'astro:config:setup': ({ command, injectScript, logger }) => {
        const explicit = process.env.PUBLIC_DOCS_OVERLAY;
        if (explicit === 'false') return;
        if (command !== 'dev' && explicit !== 'true') return;

        injectScript('page', `import ${JSON.stringify('/src/lib/docs-overlay/mount.ts')};`);

        if (command !== 'dev') {
          logger.warn(
            'docs annotation overlay is ENABLED in a non-dev build (PUBLIC_DOCS_OVERLAY=true). ' +
              'This is dev instrumentation and must not reach production.',
          );
        }
      },
    },
  };
}
