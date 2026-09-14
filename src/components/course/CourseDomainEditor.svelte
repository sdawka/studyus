<script lang="ts">
  import type { CourseDraftV2 } from '../../lib/schemas/courseDraft';
  import { apiFetch } from '../../lib/apiClient';
  import CourseMapReview from '../onboarding/CourseMapReview.svelte';
  let { courseId, initialDraft, initialRevision } = $props<{ courseId: string; initialDraft: CourseDraftV2; initialRevision: number }>();
  let draft = $state(structuredClone(initialDraft)); let saving = $state(false); let error = $state('');
  async function save() {
    saving = true; error = '';
    const result = await apiFetch<{ slug: string }>(`/api/v1/courses/${courseId}/domain`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course: draft, expected_revision: initialRevision }) }, 'Could not save this course');
    saving = false;
    if (result.ok) window.location.href = `/courses/${result.data.slug}/concepts`; else error = result.error;
  }
</script>
<CourseMapReview {draft} allowStructural={false} onchange={(next) => { draft = next; }} />
{#if error}<p role="alert">{error}</p>{/if}
<button class="save" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save course'}</button>
<p class="note">Saving preserves this course’s learning history.</p>
<style>.save{margin-top:16px;padding:10px 16px;border:0;border-radius:999px;background:var(--accent);color:var(--surface);font-weight:750}.note{color:var(--muted);font-size:13px}</style>
