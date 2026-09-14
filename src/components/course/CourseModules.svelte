<script lang="ts">
  import { apiFetch } from '../../lib/apiClient';
  import type { getCourseDomain } from '../../lib/services/courseDraft';
  type LearnerDraft = Pick<Awaited<ReturnType<typeof getCourseDomain>>, 'modules' | 'examples' | 'experiences'>;
  type Experience = LearnerDraft['experiences'][number];
  let { draft, recommendedExperienceId = null } = $props<{ courseId: string; draft: LearnerDraft; recommendedExperienceId?: string | null }>();
  let message = $state('');
  let busy = $state(false);
  let responses = $state<Record<string, string>>({});
  let requestKeys = $state<Record<string, string>>({});
  const experienceById = (id: string) => draft.experiences.find((row) => row.id === id);
  const examplesFor = (kcIds: string[]) => draft.examples.filter((row) => row.kc_ids.some((id) => kcIds.includes(id)));
  const contentRecord = (content: unknown): Record<string, unknown> =>
    typeof content === 'object' && content !== null && !Array.isArray(content) ? content as Record<string, unknown> : {};
  const options = (content: unknown) => {
    const value = contentRecord(content).options;
    return Array.isArray(value) ? value.map(String) : [];
  };
  const text = (content: unknown) => {
    const value = contentRecord(content);
    if (value.kind === 'scaffold') return { title: String(value.title ?? 'Explanation'), body: String(value.body ?? '') };
    if (value.kind === 'project') return { title: String(value.title ?? 'Project'), body: String(value.brief ?? '') };
    return { title: String(value.prompt ?? 'Practice'), body: '' };
  };
  async function record(experience: Experience) {
    busy = true; message = '';
    const response = responses[experience.id] ?? '';
    const requestKey = requestKeys[experience.id] ??= crypto.randomUUID();
    const result = await apiFetch(`/api/v1/experiences/${experience.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey }, body: JSON.stringify(
      experience.evidence?.response_type === 'selected_response' ? { selected_index: Number(response) }
        : { response: experience.evidence ? response : 'Explanation read' },
    ) }, 'Could not save this learning step');
    busy = false;
    if (result.ok) delete requestKeys[experience.id];
    message = result.ok ? 'Progress saved.' : result.error;
  }
</script>

<section class="modules" aria-labelledby="course-modules-heading">
  <p class="eyebrow">Your learning path</p><h2 id="course-modules-heading">Course modules</h2>
  {#each draft.modules as module, index (module.id)}
    <details open={index === 0}>
      <summary>{module.title}</summary>
      {#each examplesFor(module.kc_ids) as example (example.id)}
        {@const exampleContent = contentRecord(example.content)}
        <div class="example">{exampleContent.kind === 'text' ? exampleContent.body : exampleContent.kind === 'contrast' ? `${exampleContent.positive} — ${exampleContent.explanation ?? exampleContent.negative}` : 'Interactive example'}</div>
      {/each}
      {#each module.experience_ids.map(experienceById).filter(Boolean) as experience (experience!.id)}
        {@const item = experience!}{@const copy = text(item.content)}
        <article class:recommended={item.id === recommendedExperienceId}>
          {#if item.id === recommendedExperienceId}<span>Recommended next</span>{/if}
          <h3>{copy.title}</h3><p>{copy.body}</p>
          {#if item.evidence}
            {#if item.evidence.response_type === 'selected_response'}
              <label>Choose an answer<select value={responses[item.id] ?? ''} onchange={(event) => { responses[item.id] = event.currentTarget.value; }}><option value="">Select…</option>{#each options(item.content) as option, optionIndex}<option value={optionIndex}>{option}</option>{/each}</select></label>
            {:else if contentRecord(item.content).kind === 'numeric'}<label>Your response<input type="number" value={responses[item.id] ?? ''} oninput={(event) => { responses[item.id] = event.currentTarget.value; }} /></label>
            {:else}<label>Your response<textarea bind:value={responses[item.id]} rows="3"></textarea></label>{/if}
            <button disabled={busy || !responses[item.id]} onclick={() => record(item)}>Save response</button>
          {:else}<button disabled={busy} onclick={() => record(item)}>Mark explanation read</button>{/if}
        </article>
      {/each}
    </details>
  {/each}
  {#if message}<p role="status">{message}</p>{/if}
</section>

<style>
  .modules{display:grid;gap:12px;margin-bottom:24px}.modules>h2{margin:0}details,article,.example{padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)}summary{cursor:pointer;font-weight:750}article{margin-top:10px}article.recommended{border-color:var(--accent)}article span{color:var(--accent);font-size:12px;font-weight:700}h3{margin:6px 0}p{color:var(--muted)}.example{margin-top:10px}label{display:grid;gap:6px;margin:8px 0}textarea,select,input{padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)}button{padding:8px 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text);cursor:pointer}
</style>
