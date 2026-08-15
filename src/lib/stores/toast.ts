// Global toast queue. Convention of ui.ts/courseContext.ts/tasks.ts: tiny,
// framework-agnostic, SSR-safe — module-level code only creates atoms.
//
// Two ways a toast gets queued:
//  (a) a component calls pushToast(message, kind) directly for a one-off
//      (a settings save failing, onboarding save failing, etc.);
//  (b) Toast.svelte (mounted once in AppShell) watches known *Error atoms
//      from other stores (today: tasks.ts's tasksError) and turns a new
//      non-null value into an error toast itself — so a store's existing
//      "set the error atom, don't throw" convention gets a UI for free
//      without every consumer of that store having to remember to render it.
import { atom } from 'nanostores';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

export const toasts = atom<ToastItem[]>([]);

// Auto-expire — long enough to read a short message, short enough not to
// pile up if several mutations fail in a row.
const AUTO_DISMISS_MS = 5000;

let nextId = 0;

export function pushToast(message: string, kind: ToastKind = 'info'): string {
  const id = `toast-${++nextId}`;
  toasts.set([...toasts.get(), { id, message, kind }]);
  setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
  return id;
}

export function dismissToast(id: string): void {
  toasts.set(toasts.get().filter((t) => t.id !== id));
}
