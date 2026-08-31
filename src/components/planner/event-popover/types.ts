// The course shape EventPopover and its parts take. Deliberately a subset of
// the planner's course row rather than a re-export of it: the popover only
// ever needs enough to render a chip and pick a hue.
export interface CourseOption {
  id: string;
  slug: string;
  code: string;
  title: string;
  color: number | null;
}
