<script lang="ts">
  import TaskItem from './TaskItem.svelte';
  import type { TaskItemTask } from './TaskItem.svelte';

  interface Course {
    id: string;
    code: string;
    title: string;
    color?: string | number | null;
    color_hue?: number | null;
  }

  type Task = TaskItemTask;

  interface Props {
    initialTasks: Task[];
    courses: Course[];
  }

  let { initialTasks, courses } = $props();
  let tasks = $state<Task[]>(initialTasks);

  let courseHues = $derived.by(() => {
    const map: Record<string, number> = {};
    for (const c of courses as Course[]) {
      const hue = c.color_hue ?? (c.color !== null && c.color !== undefined ? Number(c.color) : null);
      if (hue !== null && !Number.isNaN(hue)) map[c.id] = hue;
    }
    return map;
  });
  let newTaskTitle = $state('');
  let newTaskDueDate = $state('');
  let newTaskCourseIds = $state<string[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  let categorized = $derived(categorizeTasks());

  function categorizeTasks() {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const overdue: Task[] = [];
    const today: Task[] = [];
    const upcoming: Task[] = [];
    const done: Task[] = [];

    for (const task of tasks) {
      if (task.completed) {
        done.push(task);
      } else if (!task.due_date) {
        upcoming.push(task);
      } else {
        const dueDate = new Date(task.due_date);
        dueDate.setHours(0, 0, 0, 0);

        if (dueDate < now) {
          overdue.push(task);
        } else if (dueDate.getTime() === now.getTime()) {
          today.push(task);
        } else {
          upcoming.push(task);
        }
      }
    }

    return { overdue, today, upcoming, done };
  }

  async function addTask() {
    if (!newTaskTitle.trim()) {
      error = 'Task title is required';
      return;
    }

    loading = true;
    error = null;

    try {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTaskTitle,
          due_date: newTaskDueDate || null,
          course_ids: newTaskCourseIds,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        error = json?.error?.message ?? 'Failed to create task';
        return;
      }

      const json = await res.json();
      tasks = [json.data, ...tasks];
      newTaskTitle = '';
      newTaskDueDate = '';
      newTaskCourseIds = [];
    } catch (err) {
      error = 'Network error, please try again.';
    } finally {
      loading = false;
    }
  }

  function handleToggle(updated: Task) {
    tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
  }

  function handleDelete(taskId: string) {
    tasks = tasks.filter((t) => t.id !== taskId);
  }

  function toggleCourse(courseId: string) {
    newTaskCourseIds = newTaskCourseIds.includes(courseId)
      ? newTaskCourseIds.filter((id) => id !== courseId)
      : [...newTaskCourseIds, courseId];
  }
</script>

<div class="tasks-container">
  <div class="add-task-form">
    <div class="form-group">
      <input
        type="text"
        placeholder="Add a new task..."
        bind:value={newTaskTitle}
        class="task-title-input"
      />
      <input
        type="date"
        bind:value={newTaskDueDate}
        class="task-date-input"
      />
    </div>

    {#if courses.length > 0}
      <div class="form-group">
        <label class="course-selector-label">Link to courses (optional):</label>
        <div class="course-selector">
          {#each courses as course}
            <label class="course-checkbox">
              <input
                type="checkbox"
                checked={newTaskCourseIds.includes(course.id)}
                onchange={() => toggleCourse(course.id)}
              />
              <span>{course.code}</span>
            </label>
          {/each}
        </div>
      </div>
    {/if}

    <div class="form-actions">
      <button
        class="btn-primary"
        onclick={addTask}
        disabled={loading || !newTaskTitle.trim()}
      >
        {loading ? 'Adding…' : 'Add task'}
      </button>
    </div>

    {#if error}
      <p class="error-message">{error}</p>
    {/if}
  </div>

  {#if tasks.length === 0}
    <div class="zero-state">
      <p>No tasks yet. Create one to get started!</p>
    </div>
  {/if}

  {#if tasks.length > 0}
    {#if categorized.overdue.length > 0}
      <section class="task-section">
        <h2 class="section-title overdue">Overdue ({categorized.overdue.length})</h2>
        <div class="task-list">
          {#each categorized.overdue as task (task.id)}
            <TaskItem {task} {courseHues} ontoggle={handleToggle} ondelete={handleDelete} />
          {/each}
        </div>
      </section>
    {/if}

    {#if categorized.today.length > 0}
      <section class="task-section">
        <h2 class="section-title today">Today ({categorized.today.length})</h2>
        <div class="task-list">
          {#each categorized.today as task (task.id)}
            <TaskItem {task} {courseHues} ontoggle={handleToggle} ondelete={handleDelete} />
          {/each}
        </div>
      </section>
    {/if}

    {#if categorized.upcoming.length > 0}
      <section class="task-section">
        <h2 class="section-title upcoming">Upcoming ({categorized.upcoming.length})</h2>
        <div class="task-list">
          {#each categorized.upcoming as task (task.id)}
            <TaskItem {task} {courseHues} ontoggle={handleToggle} ondelete={handleDelete} />
          {/each}
        </div>
      </section>
    {/if}

    {#if categorized.done.length > 0}
      <section class="task-section">
        <h2 class="section-title done">Done ({categorized.done.length})</h2>
        <div class="task-list">
          {#each categorized.done as task (task.id)}
            <TaskItem {task} {courseHues} ontoggle={handleToggle} ondelete={handleDelete} />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .tasks-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    margin-top: 1.5rem;
  }

  .add-task-form {
    background: white;
    padding: 1.5rem;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .form-group {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
    align-items: flex-start;
  }

  .form-group:last-of-type {
    margin-bottom: 0;
  }

  .task-title-input,
  .task-date-input {
    padding: 0.65rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.95rem;
  }

  .task-title-input {
    flex: 1;
    min-width: 0;
  }

  .task-title-input:focus,
  .task-date-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(63, 111, 216, 0.1);
  }

  .course-selector-label {
    display: block;
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
    color: #374151;
    font-weight: 500;
  }

  .course-selector {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .course-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    cursor: pointer;
  }

  .course-checkbox input {
    cursor: pointer;
  }

  .form-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0.65rem 1rem;
    font-size: 0.95rem;
    cursor: pointer;
    font-weight: 500;
  }

  .btn-primary:hover:not(:disabled) {
    background: #3460c5;
  }

  .btn-primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .error-message {
    color: #991b1b;
    font-size: 0.9rem;
    margin-top: 0.75rem;
    padding: 0.75rem 1rem;
    background: #fee2e2;
    border-radius: 6px;
  }

  .zero-state {
    text-align: center;
    padding: 3rem 2rem;
    color: var(--muted);
  }

  .task-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--border);
  }

  .section-title.overdue {
    border-bottom-color: #dc2626;
    color: #991b1b;
  }

  .section-title.today {
    border-bottom-color: #059669;
    color: #065f46;
  }

  .section-title.upcoming {
    border-bottom-color: #3b82f6;
    color: #1e40af;
  }

  .section-title.done {
    border-bottom-color: #9ca3af;
    color: var(--muted);
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

</style>
