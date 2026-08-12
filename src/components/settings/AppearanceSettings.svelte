<script lang="ts">
  interface Settings {
    theme: 'compass' | 'focus' | 'campus';
    scheme: 'light' | 'dark' | 'system';
    sidebar_collapsed: boolean;
  }
  let { settings }: { settings: Settings } = $props();

  let theme = $state(settings.theme);
  let scheme = $state(settings.scheme);
  let saving = $state(false);

  const THEMES: { id: Settings['theme']; label: string; bg: string; surface: string; accent: string; font: string }[] = [
    { id: 'compass', label: 'Compass', bg: '#f7f8f9', surface: '#ffffff', accent: '#1f9b78', font: "'Figtree Variable', 'Avenir Next', 'Söhne', -apple-system, BlinkMacSystemFont, system-ui, sans-serif" },
    { id: 'focus', label: 'Focus', bg: '#f6f6f7', surface: '#ffffff', accent: '#5b5bd6', font: "'Space Grotesk Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
    { id: 'campus', label: 'Campus', bg: '#faf5ec', surface: '#fffdf9', accent: '#c96f2e', font: "'Fraunces Variable', Georgia, 'Times New Roman', serif" },
  ];

  function stampHtml() {
    const html = document.documentElement;
    if (theme === 'compass') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', theme);
    if (scheme === 'system') html.removeAttribute('data-scheme');
    else html.setAttribute('data-scheme', scheme);
    localStorage.setItem('sb:theme', theme);
    localStorage.setItem('sb:scheme', scheme);
  }

  async function persist() {
    saving = true;
    try {
      await fetch('/api/v1/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { theme, scheme } }),
      });
    } finally {
      saving = false;
    }
  }

  function selectTheme(id: Settings['theme']) {
    theme = id;
    stampHtml();
    persist();
  }

  function selectScheme(id: Settings['scheme']) {
    scheme = id;
    stampHtml();
    persist();
  }
</script>

<div class="swatches">
  {#each THEMES as t}
    <button
      type="button"
      class="swatch"
      class:active={theme === t.id}
      onclick={() => selectTheme(t.id)}
      aria-pressed={theme === t.id}
    >
      <span class="preview" style={`background:${t.bg}`}>
        <span class="preview-surface" style={`background:${t.surface}`}></span>
        <span class="preview-glyph" style={`font-family:${t.font}; color:${t.accent}`}>Aa</span>
        <span class="preview-accent" style={`background:${t.accent}`}></span>
      </span>
      <span class="name">{t.label}</span>
    </button>
  {/each}
</div>

<div class="seg" role="group" aria-label="Color scheme">
  {#each [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']] as [id, label]}
    <button
      type="button"
      aria-selected={scheme === id}
      onclick={() => selectScheme(id as Settings['scheme'])}
    >{label}</button>
  {/each}
</div>

{#if saving}<p class="saving">Saving…</p>{/if}

<style>
  .swatches { display: flex; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .swatch.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }
  .preview {
    width: 96px;
    height: 60px;
    border-radius: var(--radius-sm);
    position: relative;
    overflow: hidden;
    border: 1px solid var(--border);
  }
  .preview-surface {
    position: absolute;
    left: 8px;
    top: 8px;
    right: 8px;
    bottom: 20px;
    border-radius: 4px;
  }
  .preview-accent {
    position: absolute;
    left: 8px;
    bottom: 8px;
    width: 22px;
    height: 8px;
    border-radius: 3px;
  }
  .preview-glyph {
    position: absolute;
    right: 10px;
    top: 6px;
    font-size: 18px;
    font-weight: 600;
    line-height: 1;
  }
  .name { font-size: 12.5px; font-weight: 550; }

  .seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    background: var(--hairline);
    border-radius: 999px;
  }
  .seg button {
    padding: 5px 13px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 550;
    color: var(--muted);
  }
  .seg button[aria-selected='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-card);
  }

  .saving { font-size: 12px; color: var(--muted); margin-top: 8px; }
</style>
