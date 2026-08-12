<script lang="ts">
  interface Kc {
    id: string;
    name: string;
  }

  interface CourseWithKcs {
    id: string;
    code: string;
    title: string;
    kcs: Kc[];
  }

  interface Props {
    coursesWithKcs: CourseWithKcs[];
    onAdd: (courseId?: string, kcId?: string) => void;
  }

  let { coursesWithKcs, onAdd } = $props();
  let expandedCourse = $state<string | null>(null);

  function toggleCourse(courseId: string) {
    expandedCourse = expandedCourse === courseId ? null : courseId;
  }

  function addCourseLink(courseId: string) {
    onAdd(courseId);
  }

  function addKcLink(kcId: string) {
    onAdd(undefined, kcId);
  }
</script>

<div class="link-picker">
  {#each coursesWithKcs as course}
    <div class="course-item">
      <button
        class="course-header"
        onclick={() => toggleCourse(course.id)}
      >
        <span class="course-code">{course.code}</span>
        <span class="course-title">{course.title}</span>
        <span class="toggle">{expandedCourse === course.id ? '−' : '+'}</span>
      </button>

      {#if expandedCourse === course.id}
        <button
          class="course-link-btn"
          onclick={() => addCourseLink(course.id)}
          title="Link entire course"
        >
          Link course
        </button>
        {#if course.kcs.length > 0}
          <div class="kcs-list">
            {#each course.kcs as kc}
              <button
                class="kc-link-btn"
                onclick={() => addKcLink(kc.id)}
                title="Link this KC"
              >
                {kc.name}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/each}
</div>

<style>
  .link-picker {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-top: 0.75rem;
  }

  .course-item {
    border: 1px solid var(--border);
    border-top: none;
  }

  .course-item:first-child {
    border-top: 1px solid var(--border);
    border-radius: 4px 4px 0 0;
  }

  .course-item:last-child {
    border-radius: 0 0 4px 4px;
  }

  .course-header {
    display: flex;
    width: 100%;
    padding: 0.5rem;
    border: none;
    background: var(--surface);
    cursor: pointer;
    font-size: 0.85rem;
    align-items: center;
    gap: 0.5rem;
    text-align: left;
  }

  .course-header:hover {
    background: var(--surface-2);
  }

  .course-code {
    font-weight: 600;
    color: var(--accent);
    min-width: 60px;
  }

  .course-title {
    flex: 1;
    color: var(--text);
    font-size: 0.8rem;
  }

  .toggle {
    color: var(--muted);
    font-weight: bold;
  }

  .course-link-btn {
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: none;
    background: var(--surface-2);
    color: var(--text);
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }

  .course-link-btn:hover {
    background: var(--border);
  }

  .kcs-list {
    display: flex;
    flex-direction: column;
  }

  .kc-link-btn {
    width: 100%;
    padding: 0.35rem 0.5rem 0.35rem 1.5rem;
    border: none;
    background: var(--surface);
    color: var(--text);
    font-size: 0.8rem;
    cursor: pointer;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }

  .kc-link-btn:hover {
    background: var(--surface-2);
    color: var(--accent);
  }

  .kc-link-btn:last-of-type {
    border-bottom: none;
  }
</style>
