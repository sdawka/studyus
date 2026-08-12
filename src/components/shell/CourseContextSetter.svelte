<script lang="ts">
  // Invisible island mounted once per course subpage (from CourseLayout.astro)
  // that publishes the current course into the courseContext store so header
  // popovers can default to it. Clears the store on destroy so navigating
  // away from a course (or back to a non-course page) doesn't leave a stale
  // default behind.
  import { courseContext } from '../../lib/stores/courseContext';

  interface Props {
    id: string;
    slug: string;
    code: string;
    title: string;
  }

  let { id, slug, code, title }: Props = $props();

  $effect(() => {
    courseContext.set({ id, slug, code, title });
    return () => courseContext.set(null);
  });
</script>
