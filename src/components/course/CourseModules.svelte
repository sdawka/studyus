<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import type { getCourseDomain } from '../../lib/services/courseDraft';
  type LearnerDraft = Pick<Awaited<ReturnType<typeof getCourseDomain>>, 'modules' | 'examples' | 'experiences'>;
  type Experience = LearnerDraft['experiences'][number];
  type ExperiencePlacement = { moduleId: string; experience: Experience; id: string };
  let { draft, recommendedExperienceId = null } = $props<{ courseId: string; draft: LearnerDraft; recommendedExperienceId?: string | null }>();
  let busyExperienceId = $state<string | null>(null);
  let responses = $state<Record<string, string>>({});
  let requestRecords = $state<Record<string, { key: string; body: string }>>({});
  let statusByExperience = $state<Record<string, string>>({});
  let submitted = $state<Record<string, boolean>>({});
  let openModules = $state<Record<string, boolean>>({});
  const experiencesById = $derived(new Map(draft.experiences.map((experience) => [experience.id, experience])));
  const experienceById = (id: string) => experiencesById.get(id);
  const examplesFor = (kcIds: string[]) => draft.examples.filter((row) => row.kc_ids.some((id) => kcIds.includes(id)));
  const orderedPlacements = $derived.by((): ExperiencePlacement[] => {
    const seenExperienceIds = new Set<string>();
    return draft.modules.flatMap((module) => module.experience_ids.flatMap((experienceId) => {
      const experience = experienceById(experienceId);
      if (!experience) return [];
      const id = seenExperienceIds.has(experience.id) ? `module-${module.id}-experience-${experience.id}` : `experience-${experience.id}`;
      seenExperienceIds.add(experience.id);
      return [{ moduleId: module.id, experience, id }];
    }));
  });
  const placementFor = (moduleId: string, experienceId: string) => orderedPlacements.find((placement) => placement.moduleId === moduleId && placement.experience.id === experienceId) ?? null;
  const nextPlacement = (moduleId: string, placementId: string) => {
    const index = orderedPlacements.findIndex((placement) => placement.moduleId === moduleId && placement.id === placementId);
    return index >= 0 ? orderedPlacements[index + 1] ?? null : null;
  };
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
  const moduleIsOpen = (moduleId: string, index: number) => openModules[moduleId] ?? index === 0;
  function setModuleOpen(moduleId: string, open: boolean) {
    openModules = { ...openModules, [moduleId]: open };
  }
  function updateResponse(experienceId: string, response: string) {
    responses = { ...responses, [experienceId]: response };
    submitted = { ...submitted, [experienceId]: false };
    statusByExperience = { ...statusByExperience, [experienceId]: '' };
  }
  async function focusPlacement(placement: ExperiencePlacement) {
    setModuleOpen(placement.moduleId, true);
    await tick();
    const activity = document.getElementById(placement.id);
    activity?.scrollIntoView?.({ block: 'center' });
    activity?.focus({ preventScroll: true });
  }
  async function continueTo(placement: ExperiencePlacement) {
    window.location.hash = placement.id;
    await focusPlacement(placement);
  }
  async function focusModules() {
    await tick();
    const heading = document.getElementById('course-modules-heading');
    heading?.scrollIntoView?.({ block: 'center' });
    heading?.focus({ preventScroll: true });
  }
  function placementFromHash() {
    if (typeof window === 'undefined') return null;
    const id = window.location.hash.slice(1);
    return id ? orderedPlacements.find((placement) => placement.id === id) ?? null : null;
  }
  onMount(() => {
    const target = placementFromHash();
    if (target) void focusPlacement(target);
  });
  async function record(experience: Experience) {
    if (busyExperienceId) return;
    busyExperienceId = experience.id;
    statusByExperience = { ...statusByExperience, [experience.id]: '' };
    submitted = { ...submitted, [experience.id]: false };
    const response = responses[experience.id] ?? '';
    const body = JSON.stringify(
      experience.evidence?.response_type === 'selected_response' ? { selected_index: Number(response) }
        : { response: experience.evidence ? response : 'Explanation read' },
    );
    const previousRequest = requestRecords[experience.id];
    const request = previousRequest?.body === body ? previousRequest : { key: crypto.randomUUID(), body };
    requestRecords = { ...requestRecords, [experience.id]: request };
    const result = await apiFetch(`/api/v1/experiences/${experience.id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key }, body: request.body }, 'Could not save this learning step');
    busyExperienceId = null;
    if (result.ok) {
      const { [experience.id]: _savedRequest, ...remainingRequests } = requestRecords;
      requestRecords = remainingRequests;
      submitted = { ...submitted, [experience.id]: true };
      statusByExperience = { ...statusByExperience, [experience.id]: experience.evidence ? 'Response saved.' : 'Reading recorded.' };
    } else {
      statusByExperience = { ...statusByExperience, [experience.id]: result.error };
    }
  }
</script>

<section class="modules" aria-labelledby="course-modules-heading">
  <p class="eyebrow">Your learning path</p><h2 id="course-modules-heading" tabindex="-1">Course modules</h2>
  {#each draft.modules as module, index (module.id)}
    <details open={moduleIsOpen(module.id, index)} ontoggle={(event) => setModuleOpen(module.id, event.currentTarget.open)}>
      <summary>{module.title}</summary>
      {#each examplesFor(module.kc_ids) as example (example.id)}
        {@const exampleContent = contentRecord(example.content)}
        <div class="example">{exampleContent.kind === 'text' ? exampleContent.body : exampleContent.kind === 'contrast' ? `${exampleContent.positive} — ${exampleContent.explanation ?? exampleContent.negative}` : 'Interactive example'}</div>
      {/each}
      {#each module.experience_ids.map(experienceById).filter(Boolean) as experience (experience!.id)}
        {@const item = experience!}{@const copy = text(item.content)}
        {@const placement = placementFor(module.id, item.id)}
        {@const next = placement ? nextPlacement(module.id, placement.id) : null}
        {@const recommended = placement?.id === `experience-${recommendedExperienceId}`}
        <article id={placement?.id} tabindex="-1" class:recommended>
          {#if recommended}<span>Recommended next</span>{/if}
          <h3>{copy.title}</h3><p>{copy.body}</p>
          {#if item.evidence}
            {#if item.evidence.response_type === 'selected_response'}
              <label>Choose an answer<select disabled={busyExperienceId !== null} value={responses[item.id] ?? ''} onchange={(event) => updateResponse(item.id, event.currentTarget.value)}><option value="">Select…</option>{#each options(item.content) as option, optionIndex}<option value={optionIndex}>{option}</option>{/each}</select></label>
            {:else if contentRecord(item.content).kind === 'numeric'}<label>Your response<input disabled={busyExperienceId !== null} type="number" value={responses[item.id] ?? ''} oninput={(event) => updateResponse(item.id, event.currentTarget.value)} /></label>
            {:else}<label>Your response<textarea disabled={busyExperienceId !== null} value={responses[item.id] ?? ''} oninput={(event) => updateResponse(item.id, event.currentTarget.value)} rows="3"></textarea></label>{/if}
            <button disabled={busyExperienceId !== null || !responses[item.id]} onclick={() => record(item)}>Save response</button>
          {:else}<button disabled={busyExperienceId !== null} onclick={() => record(item)}>Mark explanation read</button>{/if}
          {#if statusByExperience[item.id]}<p class="activity-status" role="status">{statusByExperience[item.id]}</p>{/if}
          {#if submitted[item.id]}
            <div class="activity-actions">
              {#if next}<button onclick={() => continueTo(next)}>Continue to {text(next.experience.content).title}</button>
              {:else}<button onclick={focusModules}>Review course modules</button><a href="/dashboard">Return to dashboard</a>{/if}
            </div>
            {#if !next}<p class="activity-status" role="status">You’ve reached the last activity. Review the modules or return when you are ready to practise again.</p>{/if}
          {/if}
        </article>
      {/each}
    </details>
  {/each}
</section>

<style>
  .modules{display:grid;gap:12px;margin-bottom:24px}.modules>h2{margin:0}details,article,.example{padding:14px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)}summary{cursor:pointer;font-weight:750}article{margin-top:10px;min-width:0}article.recommended{border-color:var(--accent)}article span{color:var(--accent);font-size:12px;font-weight:700}article:focus-visible,.modules>h2:focus-visible{outline:2px solid var(--accent);outline-offset:3px}h3{margin:6px 0}p{color:var(--muted)}.example{margin-top:10px}label{display:grid;gap:6px;margin:8px 0}textarea,select,input{box-sizing:border-box;min-width:0;width:100%;max-width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text)}button,.activity-actions a{box-sizing:border-box;min-height:44px;padding:8px 12px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--text);cursor:pointer;white-space:normal;overflow-wrap:anywhere}.activity-status{margin:10px 0 0}.activity-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.activity-actions a{text-decoration:none;text-align:center}@media (max-width:480px){.activity-actions>*{flex:1 1 100%}}
</style>
