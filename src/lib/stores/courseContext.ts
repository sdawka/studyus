// Cross-island "which course am I looking at" signal. CourseLayout.astro
// mounts a tiny CourseContextSetter island on every course subpage, which
// writes here on mount and clears on destroy. Header popovers (Scratchpad,
// TodoDropdown quick-add, LogEventModal) read this to pre-populate a course
// default — always just a default, the user can still pick something else.
// SSR-safe: default is null, and nothing here touches the DOM.
import { atom } from 'nanostores';

export interface CourseContext {
  id: string;
  slug: string;
  code: string;
  title: string;
}

export const courseContext = atom<CourseContext | null>(null);
