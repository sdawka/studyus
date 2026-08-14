<script lang="ts">
  // Record-event modal. As of P2A this no longer renders its own trigger —
  // HeaderActions.svelte owns the "Record event" pill and controls
  // visibility via the bindable `open` prop (also toggled by the "e"
  // keyboard shortcut), so it can be one island among several popovers
  // instead of mounting its own always-present button.
  import { courseContext } from '../../lib/stores/courseContext';
  import { portalToBody } from '../../lib/actions/portal';

  interface Props {
    open?: boolean;
  }
  let { open = $bindable(false) }: Props = $props();

  type EventType =
    | 'lecture_attended'
    | 'lecture_missed'
    | 'video_watched'
    | 'reading_done'
    | 'taught_someone'
    | 'quiz_taken'
    | 'assignment_graded'
    | 'exam_graded'
    | 'self_assessment'
    | 'practice_done'
    | 'retrieval_practice';

  type EventGroup = { label: string; types: { value: EventType; label: string }[] };

  const GROUPS: EventGroup[] = [
    {
      label: 'Instruction',
      types: [
        { value: 'lecture_attended', label: 'Attended lecture' },
        { value: 'lecture_missed', label: 'Missed lecture' },
        { value: 'video_watched', label: 'Watched video' },
        { value: 'reading_done', label: 'Did reading' },
        { value: 'taught_someone', label: 'Taught someone' },
      ],
    },
    {
      label: 'Assessment',
      types: [
        { value: 'quiz_taken', label: 'Quiz taken' },
        { value: 'assignment_graded', label: 'Assignment graded' },
        { value: 'exam_graded', label: 'Exam graded' },
        { value: 'self_assessment', label: 'Self-assessment' },
      ],
    },
    {
      label: 'Practice',
      types: [
        { value: 'practice_done', label: 'Practice done' },
        { value: 'retrieval_practice', label: 'Retrieval practice' },
      ],
    },
  ];

  const ALL_TYPES = new Map(GROUPS.flatMap((g) => g.types).map((t) => [t.value, t.label]));
  // Types that carry a score/self-rating in their payload per the mastery fold.
  const SCORE_TYPES = new Set<EventType>([
    'quiz_taken',
    'assignment_graded',
    'exam_graded',
    'self_assessment',
    'practice_done',
    'retrieval_practice',
  ]);
  const SELF_RATING_TYPES = new Set<EventType>(['self_assessment', 'practice_done', 'retrieval_practice']);

  type Course = { id: string; slug: string; code: string; title: string };
  type Kc = { id: string; name: string };

  let selectedType = $state<EventType | null>(null);
  let courses = $state<Course[]>([]);
  let coursesLoaded = $state(false);
  let selectedCourseId = $state('');
  let kcs = $state<Kc[]>([]);
  let selectedKcId = $state('');
  let when = $state(nowLocal());
  let scoreValue = $state('');
  let note = $state('');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let confirmation = $state<string | null>(null);

  function nowLocal(): string {
    const d = new Date();
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  async function loadCourses() {
    if (coursesLoaded) return;
    try {
      const res = await fetch('/api/v1/courses');
      const json = await res.json();
      if (res.ok) courses = json.data;
    } finally {
      coursesLoaded = true;
    }
  }

  async function loadKcs(courseId: string) {
    kcs = [];
    selectedKcId = '';
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;
    const res = await fetch(`/api/v1/courses/${course.slug}`);
    const json = await res.json();
    if (res.ok) {
      kcs = (json.data.branches ?? []).flatMap((b: { kcs: Kc[] }) => b.kcs);
    }
  }

  // Fires whenever a parent (HeaderActions) flips `open` to true — replaces
  // the old click-triggered openModal() now that there's no in-component button.
  $effect(() => {
    if (open) {
      confirmation = null;
      submitError = null;
      // Default the course select to whatever course we're viewing — just a
      // default, the picker below is always free to change it.
      if ($courseContext) {
        selectedCourseId = $courseContext.id;
        void loadCourses().then(() => onCourseChange());
      } else {
        void loadCourses();
      }
    }
  });

  function closeModal() {
    open = false;
    resetForm();
  }

  // Escape-to-close (bug found in the mobile composite flow: FAB → open →
  // Escape → click bell — with no Escape handler here, the modal stayed
  // open and its full-viewport `.overlay` [z-index:100, above the header's
  // z-index:30] silently ate the next click meant for the header). This
  // modal isn't a Sheet, so it doesn't join the __plannerBlockEscape/
  // __tasksBlockEscape protocol — nothing nests inside it that needs to
  // claim Escape first.
  $effect(() => {
    if (!open) return;
    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });

  function resetForm() {
    selectedType = null;
    selectedCourseId = $courseContext?.id ?? '';
    kcs = [];
    selectedKcId = '';
    when = nowLocal();
    scoreValue = '';
    note = '';
    submitError = null;
  }

  function pickType(type: EventType) {
    selectedType = type;
  }

  function backToTypes() {
    selectedType = null;
  }

  async function onCourseChange() {
    if (selectedCourseId) await loadKcs(selectedCourseId);
    else {
      kcs = [];
      selectedKcId = '';
    }
  }

  async function submit() {
    if (!selectedType) return;
    submitting = true;
    submitError = null;
    try {
      const payload: Record<string, unknown> = {};
      if (note.trim()) payload.note = note.trim();
      if (scoreValue.trim() !== '') {
        if (SELF_RATING_TYPES.has(selectedType)) payload.self_rating = Number(scoreValue);
        else payload.score = Number(scoreValue);
      }

      const body: Record<string, unknown> = {
        type: selectedType,
        ts: new Date(when).toISOString(),
        payload,
      };
      if (selectedCourseId) body.course_id = selectedCourseId;
      if (selectedKcId) body.kc_id = selectedKcId;

      const res = await fetch('/api/v1/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        submitError = json?.error?.message ?? 'Failed to log event';
        return;
      }

      const courseLabel = courses.find((c) => c.id === selectedCourseId)?.code;
      const typeLabel = ALL_TYPES.get(selectedType) ?? selectedType;
      confirmation = courseLabel ? `Logged: ${typeLabel} — ${courseLabel}` : `Logged: ${typeLabel}`;
      resetForm();
    } catch {
      submitError = 'Network error, please try again.';
    } finally {
      submitting = false;
    }
  }
</script>

<!-- The sticky header's backdrop-filter creates a containing block that traps
     position:fixed descendants, so the overlay must escape to <body>. -->
{#if open}
  <div class="overlay" role="presentation" onclick={closeModal} use:portalToBody>
    <div class="modal" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2>Record event</h2>
        <button type="button" class="icon-btn" onclick={closeModal} aria-label="Close">×</button>
      </div>

      {#if confirmation}
        <p class="confirmation">{confirmation}</p>
        <button type="button" class="primary" onclick={() => (confirmation = null)}>Log another</button>
      {:else if !selectedType}
        <div class="groups">
          {#each GROUPS as group (group.label)}
            <div class="group">
              <h3>{group.label}</h3>
              <div class="type-grid">
                {#each group.types as t (t.value)}
                  <button type="button" class="type-btn" onclick={() => pickType(t.value)}>{t.label}</button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <form onsubmit={(e) => { e.preventDefault(); submit(); }}>
          <p class="selected-type">
            <button type="button" class="link" onclick={backToTypes}>← Change type</button>
            <strong>{ALL_TYPES.get(selectedType)}</strong>
          </p>

          <label>
            Course
            <select bind:value={selectedCourseId} onchange={onCourseChange}>
              <option value="">No course</option>
              {#each courses as c (c.id)}
                <option value={c.id}>{c.code} — {c.title}</option>
              {/each}
            </select>
          </label>

          {#if selectedCourseId && kcs.length > 0}
            <label>
              Knowledge component (optional)
              <select bind:value={selectedKcId}>
                <option value="">No specific KC</option>
                {#each kcs as kc (kc.id)}
                  <option value={kc.id}>{kc.name}</option>
                {/each}
              </select>
            </label>
          {/if}

          <label>
            Date &amp; time
            <input type="datetime-local" bind:value={when} required />
          </label>

          {#if SCORE_TYPES.has(selectedType)}
            <label>
              {SELF_RATING_TYPES.has(selectedType) ? 'Self-rating (1-5)' : 'Score (%)'}
              <input
                type="number"
                bind:value={scoreValue}
                min="0"
                max={SELF_RATING_TYPES.has(selectedType) ? 5 : 100}
              />
            </label>
          {/if}

          <label>
            Note (optional)
            <textarea bind:value={note} rows="2"></textarea>
          </label>

          {#if submitError}
            <p class="error">{submitError}</p>
          {/if}

          <button type="submit" class="primary" disabled={submitting}>
            {submitting ? 'Logging…' : 'Log event'}
          </button>
        </form>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in oklch, var(--text) 40%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--surface);
    border-radius: 12px;
    padding: 1.5rem;
    width: 420px;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
  }
  .modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
  .modal-header h2 { margin: 0; font-size: 1.1rem; }
  .icon-btn { background: none; border: none; font-size: 1.3rem; cursor: pointer; color: var(--muted); line-height: 1; }
  .groups { display: flex; flex-direction: column; gap: 1.1rem; }
  .group h3 {
    margin: 0 0 0.5rem 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .type-grid { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .type-btn {
    background: var(--hover);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .type-btn:hover { background: var(--hover); border-color: var(--accent); }
  form { display: flex; flex-direction: column; gap: 0.85rem; }
  .selected-type { display: flex; align-items: center; gap: 0.7rem; margin: 0; font-size: 0.95rem; }
  label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.88rem; color: var(--text); }
  input, select, textarea {
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.9rem;
    font-family: inherit;
  }
  .link { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; font-size: 0.85rem; }
  .primary {
    background: var(--accent);
    color: var(--surface);
    border: none;
    border-radius: 8px;
    padding: 0.6rem;
    font-size: 0.92rem;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .confirmation {
    background: var(--accent-soft);
    color: var(--accent-ink);
    border-radius: 8px;
    padding: 0.75rem 0.9rem;
    font-size: 0.9rem;
  }
  .error { color: var(--danger); font-size: 0.85rem; margin: 0; }

  /* Mobile restyle (CSS only): bottom-anchored full-width sheet-like modal
     instead of a centered card — matches Sheet.svelte's visual language
     without depending on the component (this stays a plain modal). */
  @media (max-width: 767px) {
    .overlay { align-items: flex-end; }
    .modal {
      width: 100%;
      max-width: 100%;
      max-height: 90vh;
      max-height: 90dvh;
      border-radius: 12px 12px 0 0;
      padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
    }
  }
</style>
