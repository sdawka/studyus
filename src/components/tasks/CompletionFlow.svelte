<script lang="ts">
  // Typed-task completion dialog (Track D). TaskItem mounts this instead of
  // completing immediately whenever the user checks a task whose type is
  // not 'todo' — a todo's reward is the instant confetti moment, but a
  // typed task (attend_class, review/prep, practice/stale, grade_entry) gets
  // a chance to attach a recap/self-check and spin off follow-ups first.
  // This component OWNS the completion: it calls toggleTask (+ any
  // follow-up addTask calls) itself, then reports back via onCompleted.
  // Cancel (onClose) persists nothing — the caller's checkbox just stays
  // unchecked.
  //
  // Props are frozen (team contract) — do not add/rename/remove any of the
  // three below.
  import { addTask, toggleTask, type ApiTask } from '../../lib/stores/tasks';
  import { TASK_TYPE_META } from '../../lib/taskTypeMeta';
  import { isMobile } from '../../lib/stores/viewport';
  import { focusTrap } from '../../lib/actions/focusTrap';
  import { scrollLock } from '../../lib/actions/scrollLock';
  import { portalToBody } from '../../lib/actions/portal';
  import Sheet from '../shell/Sheet.svelte';

  interface Props {
    task: ApiTask;
    onClose: () => void;
    onCompleted: (opts?: { note?: string }) => void;
  }

  let { task, onClose, onCompleted }: Props = $props();

  const SELF_CHECK_OPTIONS: { value: string; label: string }[] = [
    { value: 'felt easy', label: 'Felt easy' },
    { value: 'ok', label: 'OK' },
    { value: 'shaky', label: 'Shaky' },
  ];

  let recap = $state('');
  let selfCheck = $state<string | null>(null);
  let followUps = $state<string[]>([]);
  let followUpDraft = $state('');
  let submitting = $state(false);
  let submitError = $state<string | null>(null);
  let primaryBtnEl = $state<HTMLButtonElement | null>(null);

  const type = $derived(task.type ?? 'todo');
  const meta = $derived(TASK_TYPE_META[type]);
  const courseCode = $derived(task.courses[0]?.code ?? 'this class');
  const showSelfCheck = $derived(type === 'practice_kc' || type === 'stale_kc');
  // grade_entry is a plain confirm — these normally auto-complete via grade
  // entry, so this dialog is just the fallback path when a student checks
  // it manually; no recap makes sense there.
  const showRecap = $derived(type !== 'grade_entry' && !showSelfCheck);

  const heading = $derived.by(() => {
    switch (type) {
      case 'attend_class':
        return `Attended ${courseCode}?`;
      case 'grade_entry':
        return 'Mark done?';
      default:
        return `Done with ${task.title}?`;
    }
  });

  const recapPlaceholder = $derived.by(() => {
    switch (type) {
      case 'attend_class':
        return 'One thing you took away?';
      default:
        return 'What did you cover?';
    }
  });

  const primaryLabel = $derived.by(() => {
    if (submitting) return 'Saving…';
    return type === 'attend_class' ? 'Attended ✓' : 'Done ✓';
  });

  // Matches TasksView's courseIdsOfTask convention: a task's course
  // membership can come from either the origin FK (system-generated tasks)
  // or a task_courses link row (user tasks).
  function courseIdsOfTask(t: ApiTask): string[] {
    const ids = new Set<string>();
    if (t.course_id) ids.add(t.course_id);
    for (const c of t.courses) ids.add(c.id);
    return [...ids];
  }

  function pickSelfCheck(value: string) {
    selfCheck = selfCheck === value ? null : value;
  }

  function addFollowUp() {
    const title = followUpDraft.trim();
    if (!title) return;
    followUps = [...followUps, title];
    followUpDraft = '';
  }

  function removeFollowUp(index: number) {
    followUps = followUps.filter((_, i) => i !== index);
  }

  // Enter here adds a row instead of submitting the dialog's form — the
  // form's default submit-on-Enter (single-line input) would otherwise
  // fire before a typed follow-up ever gets a chance to be added.
  function onFollowUpKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addFollowUp();
  }

  function buildNote(): string | undefined {
    const trimmed = recap.trim();
    if (showSelfCheck && selfCheck) {
      return trimmed ? `Self-check: ${selfCheck} — ${trimmed}` : `Self-check: ${selfCheck}`;
    }
    return trimmed || undefined;
  }

  async function complete() {
    if (submitting) return;
    submitting = true;
    submitError = null;
    try {
      const note = buildNote();
      await toggleTask(task.id, note !== undefined ? { completionNote: note } : {});
      const courseIds = courseIdsOfTask(task);
      for (const title of followUps) {
        try {
          await addTask({ title, course_ids: courseIds.length ? courseIds : undefined });
        } catch {
          // Best-effort — a follow-up that fails to save doesn't roll back
          // (or block) the completion that already succeeded.
        }
      }
      onCompleted(note !== undefined ? { note } : undefined);
    } catch (err) {
      submitError = err instanceof Error ? err.message : 'Could not complete this task.';
    } finally {
      submitting = false;
    }
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    void complete();
  }

  // One-tap rule: focus starts on the primary button (not wherever
  // focusTrap's default "first focusable element" lands, which would
  // otherwise be the recap textarea/close button) so a single Enter or
  // click completes the flow with nothing typed.
  $effect(() => {
    primaryBtnEl?.focus({ preventScroll: true });
  });

  // Escape-to-close, joining the same "block escape" convention Sheet.svelte
  // uses so the /tasks route-modal's own Escape handler doesn't also react
  // to the key this dialog just consumed.
  $effect(() => {
    (window as unknown as Record<string, boolean>).__tasksBlockEscape = true;
    (window as unknown as Record<string, boolean>).__plannerBlockEscape = true;

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeydown);

    return () => {
      (window as unknown as Record<string, boolean>).__tasksBlockEscape = false;
      (window as unknown as Record<string, boolean>).__plannerBlockEscape = false;
      window.removeEventListener('keydown', onKeydown);
    };
  });
</script>

{#snippet body()}
  <h2 class="flow-heading">{heading}</h2>

  {#if showSelfCheck}
    <div class="self-check-row" role="group" aria-label="Self-check">
      {#each SELF_CHECK_OPTIONS as opt (opt.value)}
        <button
          type="button"
          class="chip self-check-chip"
          aria-pressed={selfCheck === opt.value}
          onclick={() => pickSelfCheck(opt.value)}
        >{opt.label}</button>
      {/each}
    </div>
    <input type="text" class="flow-input" bind:value={recap} placeholder="Anything else? (optional)" />
    <p class="aside-muted">Tip: log a practice event from Record event (header) to feed this into mastery.</p>
  {:else if showRecap}
    <textarea class="flow-textarea" rows="2" bind:value={recap} placeholder={recapPlaceholder}></textarea>
  {/if}

  <div class="followups">
    <p class="followups-label">Add follow-up</p>
    {#each followUps as title, i (i)}
      <div class="followup-row">
        <span class="followup-title">{title}</span>
        <button type="button" class="followup-remove" onclick={() => removeFollowUp(i)} aria-label={`Remove follow-up: ${title}`}>×</button>
      </div>
    {/each}
    <input
      type="text"
      class="flow-input"
      bind:value={followUpDraft}
      placeholder="e.g. Re-read chapter 4"
      onkeydown={onFollowUpKeydown}
    />
  </div>

  {#if submitError}<p class="flow-error">{submitError}</p>{/if}

  <div class="flow-actions">
    <button type="button" class="btn btn-secondary" onclick={onClose} disabled={submitting}>Cancel</button>
    <button type="submit" class="btn btn-primary" bind:this={primaryBtnEl} disabled={submitting}>{primaryLabel}</button>
  </div>
{/snippet}

{#if $isMobile}
  <Sheet open={true} {onClose} title={meta.label}>
    <form onsubmit={handleSubmit}>
      {@render body()}
    </form>
  </Sheet>
{:else}
  <div class="flow-overlay" use:portalToBody use:scrollLock>
    <div class="flow-scrim" role="presentation" onclick={onClose}></div>
    <div class="flow-panel" role="dialog" aria-modal="true" aria-label={heading} use:focusTrap>
      <div class="flow-head">
        <span class="flow-kicker">{meta.label}</span>
        <button type="button" class="close-btn" onclick={onClose} aria-label="Close">×</button>
      </div>
      <form onsubmit={handleSubmit}>
        {@render body()}
      </form>
    </div>
  </div>
{/if}

<style>
  /* z-index 100 = the "modal" tier documented in tokens.css's z-inventory
     (LogEventModal/AddCourseModal's tier) — below the mobile Sheet's 240
     (this dialog never shows both at once) and the toast layer's 250, so a
     task-API-failure toast can still surface above it. */
  .flow-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .flow-scrim {
    position: absolute;
    inset: 0;
    background: color-mix(in oklch, var(--text) 20%, transparent);
  }

  .flow-panel {
    position: relative;
    z-index: 1;
    width: 400px;
    max-width: min(400px, calc(100vw - 32px));
    max-height: 85vh;
    overflow-y: auto;
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-pop);
    padding: var(--space-5);
  }

  .flow-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: var(--space-3);
  }

  .flow-kicker {
    font-family: var(--font-kicker, var(--font-body));
    font-style: var(--kicker-style, normal);
    font-size: 11px;
    font-weight: var(--weight-bold);
    letter-spacing: var(--tracking-caps);
    text-transform: uppercase;
    color: var(--muted);
  }

  .close-btn {
    font-size: 16px;
    color: var(--muted);
    line-height: 1;
    flex-shrink: 0;
  }
  .close-btn:hover {
    color: var(--text);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .flow-heading {
    font: 650 16px/1.3 var(--font-display, inherit);
    color: var(--text);
  }

  .self-check-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .flow-input,
  .flow-textarea {
    width: 100%;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
    resize: vertical;
  }

  .aside-muted {
    margin: 0;
  }

  .followups {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .followups-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
  }

  .followup-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 8px;
    background: var(--hover);
    border-radius: var(--radius-sm);
  }

  .followup-title {
    font-size: 13px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .followup-remove {
    flex-shrink: 0;
    color: var(--muted);
    font-size: 15px;
    line-height: 1;
    padding: 2px 4px;
  }
  .followup-remove:hover {
    color: var(--danger-ink, var(--danger));
  }

  .flow-error {
    color: var(--danger);
    font-size: 12.5px;
  }

  .flow-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  @media (max-width: 767px) {
    .flow-actions .btn {
      min-height: 44px;
    }
  }
</style>
