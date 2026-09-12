<script lang="ts">
  import { apiFetch } from '../../lib/apiClient';
  import type { CourseDraftV2 } from '../../lib/schemas/courseDraft';
  let { courseId, draft, recommendedExperienceId = null } = $props<{ courseId: string; draft: CourseDraftV2; recommendedExperienceId?: string | null }>();
  let message = $state('');
  let busy = $state(false);
  const experienceById = (id: string) => draft.experiences.find((row) => row.id === id);
  const examplesFor = (kcIds: string[]) => draft.examples.filter((row) => row.kc_ids.some((id) => kcIds.includes(id)));
  const text = (content: CourseDraftV2['experiences'][number]['content']) => {
    if (content.kind === 'scaffold') return { title: content.title, body: content.body };
    if (content.kind === 'project') return { title: content.title, body: content.brief };
    return { title: content.kind === 'mcq' ? content.prompt : content.prompt, body: content.kind === 'mcq' ? content.explanation : content.solution };
  };
  async function record(experience: CourseDraftV2['experiences'][number], correct?: boolean) {
    busy = true; message = '';
    const evidenceKc = experience.evidence?.target_kc_ids[0];
    const result = await apiFetch('/api/v1/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      type: evidenceKc ? 'retrieval_practice' : 'reading_done', course_id: courseId, experience_id: experience.id,
      ...(evidenceKc ? { kc_id: evidenceKc, payload: { correct } } : {}),
    }) }, 'Could not save this learning step');
    busy = false;
    message = result.ok ? (correct === false ? 'Saved. Support will be prioritized next.' : 'Progress saved.') : result.error;
  }
</script>

<section class="modules" aria-labelledby="course-modules-heading">
  <p class="eyebrow">Your learning path</p><h2 id="course-modules-heading">Course modules</h2>
  {#each draft.modules as module, index (module.id)}
    <details open={index === 0}>
      <summary>{module.title}</summary>
      {#each examplesFor(module.kc_ids) as example (example.id)}
        <div class="example">{example.content.kind === 'text' ? example.content.body : example.content.kind === 'contrast' ? `${example.content.positive} — ${example.content.explanation ?? example.content.negative}` : 'Interactive example'}</div>
      {/each}
      {#each module.experience_ids.map(experienceById).filter(Boolean) as experience (experience!.id)}
        {@const item = experience!}{@const copy = text(item.content)}
        <article class:recommended={item.id === recommendedExperienceId}>
          {#if item.id === recommendedExperienceId}<span>Recommended next</span>{/if}
          <h3>{copy.title}</h3><p>{copy.body}</p>
          {#if item.evidence}
            <div class="actions"><button disabled={busy} onclick={() => record(item, true)}>I got it</button><button disabled={busy} onclick={() => record(item, false)}>I need support</button></div>
          {:else}<button disabled={busy} onclick={() => record(item)}>Mark explanation read</button>{/if}
        </article>
      {/each}
    </details>
  {/each}
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  .modules{display:grid;gap:12px;margin-bottom:24px}.modules>h2{margin:0}details,article,.example{padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)}summary{cursor:pointer;font-weight:750}article{margin-top:10px}article.recommended{border-color:var(--accent)}article span{color:var(--accent);font-size:12px;font-weight:700}h3{margin:6px 0}p{color:var(--muted)}.example{margin-top:10px}.actions{display:flex;gap:8px}button{padding:8px 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text);cursor:pointer}
</style>
