// Header popover coordination: exactly one of scratchpad/todo/bell/avatar
// open at a time. Previously local $state inside HeaderActions.svelte;
// lives in a store so any island can read/drive it without prop-threading.
// Escape/outside-click dismissal is unrelated and still lives in
// popover.svelte.ts, bound per-popover by each consumer.
import { atom } from 'nanostores';

export type PopoverName = 'scratchpad' | 'todo' | 'bell' | 'avatar';

export const activePopover = atom<PopoverName | null>(null);

export function togglePopover(name: PopoverName) {
  activePopover.set(activePopover.get() === name ? null : name);
}

export function closePopover() {
  activePopover.set(null);
}
