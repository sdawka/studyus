// Svelte action: move `node` to <body> on mount, remove it on destroy.
// Needed by any fixed-position overlay that would otherwise be trapped by
// an ancestor containing block — the sticky header's backdrop-filter is
// the original case (LogEventModal), and a sheet's own backdrop-filter (if
// any) would create the same trap for header-triggered sheets, so Sheet.svelte
// reuses this rather than duplicating it.
export function portalToBody(node: HTMLElement) {
  document.body.appendChild(node);
  return { destroy: () => node.remove() };
}
