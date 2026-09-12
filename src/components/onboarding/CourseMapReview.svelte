<script lang="ts">
  import type { CourseDraftV2 } from '../../lib/schemas/courseDraft';

  let { draft, onchange } = $props<{ draft: CourseDraftV2; onchange: (draft: CourseDraftV2) => void }>();
  const id = (kind: string) => `${kind}-${crypto.randomUUID()}`;
  // `$state.snapshot` unwraps Svelte's deep proxy before crossing the child ->
  // parent boundary. `structuredClone(draft)` throws DataCloneError on proxies.
  const emit = () => onchange($state.snapshot(draft));

  function addOutcome() {
    draft.outcomes.push({ id: id('outcome'), title: 'Another learning outcome', kc_ids: [draft.kcs[0].id] });
    emit();
  }
  function addKnowledgeComponent() {
    const kcId = id('kc');
    const experienceId = id('experience');
    draft.kcs.push({ id: kcId, name: 'New idea or skill', kc_form: 'variable_constant', rationale_level: 2, mastery_rule: { minimum_evidence: 2 }, prerequisite_kc_ids: [] });
    draft.examples.push({ id: id('example'), kc_ids: [kcId], content: { schema_version: 1, kind: 'text', body: 'Add a concrete example.' } });
    draft.experiences.push({ id: experienceId, kind: 'exercise', target_kc_ids: [kcId], intended_processes: ['understanding_sensemaking'], evidence: { response_type: 'constructed_response', target_kc_ids: [kcId], diagnostic_misconception_ids: [] }, content: { schema_version: 1, kind: 'worked', prompt: 'Show what you understand.', solution: 'Describe what a strong response should include.' } });
    draft.outcomes[0].kc_ids.push(kcId);
    emit();
  }
  function addExample() {
    draft.examples.push({ id: id('example'), kc_ids: [draft.kcs[0].id], content: { schema_version: 1, kind: 'text', body: 'Add a concrete example.' } });
    emit();
  }
  function addExperience() {
    const kcId = draft.kcs[0].id;
    draft.experiences.push({ id: id('experience'), kind: 'exercise', target_kc_ids: [kcId], intended_processes: ['understanding_sensemaking'], evidence: { response_type: 'constructed_response', target_kc_ids: [kcId], diagnostic_misconception_ids: [] }, content: { schema_version: 1, kind: 'worked', prompt: 'Try applying this idea.', solution: 'Describe the features of a successful response.' } });
    emit();
  }
</script>

<div class="editor">
  <section>
    <div class="section-heading"><div><h3>Outcomes</h3><p>What will you be able to do?</p></div><button type="button" onclick={addOutcome}>Add outcome</button></div>
    {#each draft.outcomes as outcome (outcome.id)}
      <label>Learning outcome<input value={outcome.title} oninput={(event) => { outcome.title = event.currentTarget.value; emit(); }} /></label>
    {/each}
  </section>
  <details>
    <summary>Knowledge components</summary><p>Break the outcome into the ideas or skills you need.</p>
    {#each draft.kcs as kc (kc.id)}
      <div class="grid">
        <label>Idea or skill<input value={kc.name} oninput={(event) => { kc.name = event.currentTarget.value; emit(); }} /></label>
        <label>Knowledge form<select value={kc.kc_form} onchange={(event) => { kc.kc_form = event.currentTarget.value as typeof kc.kc_form; emit(); }}><option value="constant_constant">Relationship</option><option value="variable_constant">Concept or method</option><option value="variable_variable">Principle</option></select></label>
        <label>Evidence needed<input type="number" min="1" value={kc.mastery_rule.minimum_evidence ?? 1} oninput={(event) => { kc.mastery_rule.minimum_evidence = Number(event.currentTarget.value); emit(); }} /></label>
        <label>Mastery threshold<input type="number" min="0" max="1" step="0.05" value={kc.mastery_rule.threshold ?? 0.8} oninput={(event) => { kc.mastery_rule.threshold = Number(event.currentTarget.value); emit(); }} /></label>
      </div>
    {/each}
    <button type="button" onclick={addKnowledgeComponent}>Add idea or skill</button>
  </details>
  <details>
    <summary>Examples</summary><p>Use cases, contrasts, or concrete instances that make the knowledge visible.</p>
    {#each draft.examples as example (example.id)}
      {#if example.content.kind === 'text'}<label>Example<textarea rows="2" value={example.content.body} oninput={(event) => { example.content.body = event.currentTarget.value; emit(); }}></textarea></label>{/if}
    {/each}
    <button type="button" onclick={addExample}>Add example</button>
  </details>
  <details>
    <summary>Learning experiences</summary><p>Choose the mental work the learner should do and what counts as evidence.</p>
    {#each draft.experiences as experience (experience.id)}
      <div class="grid">
        <label>Intended process<select value={experience.intended_processes[0]} onchange={(event) => { experience.intended_processes = [event.currentTarget.value as typeof experience.intended_processes[number]]; emit(); }}><option value="memory_fluency">Build memory fluency</option><option value="induction_refinement">Compare and refine</option><option value="understanding_sensemaking">Make sense and explain</option></select></label>
        {#if experience.content.kind === 'worked'}<label>Experience prompt<input value={experience.content.prompt} oninput={(event) => { experience.content.prompt = event.currentTarget.value; emit(); }} /></label>{/if}
      </div>
    {/each}
    <button type="button" onclick={addExperience}>Add experience</button>
  </details>
</div>

<style>
  .editor{display:grid;gap:12px}.editor section,.editor details{border-top:1px solid #e2dce6;padding:18px 0}.section-heading{display:flex;justify-content:space-between;gap:16px;align-items:start}h3{font:800 21px 'Fraunces Variable',serif;margin:0}p{color:#746979;font-size:13px;margin:4px 0 12px}summary{cursor:pointer;font-weight:900;color:#55485e}label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:900;color:#6e6475;margin:10px 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}input,select,textarea{width:100%;padding:10px;border:1px solid #d9d2de;border-radius:10px;background:#fff;font:inherit;box-sizing:border-box}button{border:1px solid #d9d1de;border-radius:999px;background:#fff;color:#55485e;padding:8px 12px;font-weight:900;cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #d7b5f1;outline-offset:2px}@media(max-width:680px){.grid{grid-template-columns:1fr}.section-heading{display:grid}}
</style>
