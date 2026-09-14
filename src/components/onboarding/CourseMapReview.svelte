<script lang="ts">
  import type { CourseDraftV2 } from '../../lib/schemas/courseDraft';

  let { draft, onchange, allowStructural = true } = $props<{ draft: CourseDraftV2; onchange: (draft: CourseDraftV2) => void; allowStructural?: boolean }>();
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
    draft.examples.push({ id: id('example'), kc_ids: [kcId], content: { schema_version: 1, kind: 'text', body: 'Example: ' } });
    draft.experiences.push({ id: experienceId, kind: 'exercise', target_kc_ids: [kcId], intended_processes: ['understanding_sensemaking'], evidence: { response_type: 'constructed_response', target_kc_ids: [kcId], diagnostic_misconception_ids: [] }, content: { schema_version: 1, kind: 'worked', prompt: 'Explain this idea in your own words.', solution: 'A strong answer shows the idea with a concrete case.' } });
    draft.outcomes[0].kc_ids.push(kcId);
    emit();
  }
  function addExample() {
    draft.examples.push({ id: id('example'), kc_ids: [draft.kcs[0].id], content: { schema_version: 1, kind: 'text', body: 'Example: ' } });
    emit();
  }
  function addExperience() {
    const kcId = draft.kcs[0].id;
    const outcome = draft.outcomes[0]?.title ?? 'this outcome';
    draft.experiences.push({ id: id('experience'), kind: 'exercise', target_kc_ids: [kcId], intended_processes: ['understanding_sensemaking'], evidence: { response_type: 'constructed_response', target_kc_ids: [kcId], diagnostic_misconception_ids: [] }, content: { schema_version: 1, kind: 'worked', prompt: `Use ${outcome} on a new case.`, solution: 'A strong answer applies the idea, not just names it.' } });
    emit();
  }
</script>

<div class="editor">
  <section>
    <div class="section-heading">
      <div><h3>Outcomes</h3><p>What you will be able to do by the end.</p></div>
      {#if allowStructural}<button type="button" onclick={addOutcome}>Add another outcome</button>{/if}
    </div>
    {#each draft.outcomes as outcome (outcome.id)}
      <div class="field">
        <label for={`outcome-title-${outcome.id}`}>Learning outcome</label>
        <input id={`outcome-title-${outcome.id}`} value={outcome.title} oninput={(event) => { outcome.title = event.currentTarget.value; emit(); }} />
      </div>
    {/each}
  </section>
  <details>
    <summary>Ideas and skills</summary>
    <p>The pieces you need to learn to reach the outcome. studyus tracks each one separately.</p>
    {#each draft.kcs as kc (kc.id)}
      <div class="grid">
        <div class="field">
          <label for={`kc-name-${kc.id}`}>Idea or skill</label>
          <input id={`kc-name-${kc.id}`} value={kc.name} oninput={(event) => { kc.name = event.currentTarget.value; emit(); }} />
        </div>

        <div class="field">
          <label for={`kc-form-${kc.id}`}>What kind of thing is it?</label>
          <select id={`kc-form-${kc.id}`} value={kc.kc_form} onchange={(event) => { kc.kc_form = event.currentTarget.value as typeof kc.kc_form; emit(); }}>
            <option value="constant_constant">A fact or relationship</option>
            <option value="variable_constant">A concept or method</option>
            <option value="variable_variable">A general principle</option>
          </select>
        </div>

        <div class="field">
          <label for={`kc-evidence-${kc.id}`}>Times you must show it before it counts</label>
          <input id={`kc-evidence-${kc.id}`} type="number" min="1" value={kc.mastery_rule.minimum_evidence ?? 1} aria-describedby={`kc-evidence-helper-${kc.id}`} oninput={(event) => { kc.mastery_rule.minimum_evidence = Number(event.currentTarget.value); emit(); }} />
          <p id={`kc-evidence-helper-${kc.id}`} class="field-helper">A whole number, at least 1.</p>
        </div>

        <div class="field">
          <label for={`kc-threshold-${kc.id}`}>Success rate that counts as learned</label>
          <input id={`kc-threshold-${kc.id}`} type="number" min="0" max="1" step="0.05" value={kc.mastery_rule.threshold ?? 0.8} aria-describedby={`kc-threshold-helper-${kc.id}`} oninput={(event) => { kc.mastery_rule.threshold = Number(event.currentTarget.value); emit(); }} />
          <p id={`kc-threshold-helper-${kc.id}`} class="field-helper">Between 0 and 1. 0.8 means 8 out of 10.</p>
        </div>
      </div>
    {/each}
    {#if allowStructural}<button type="button" onclick={addKnowledgeComponent}>Add idea or skill</button>{/if}
  </details>
  <details>
    <summary>Examples</summary>
    <p>Concrete cases that show the idea in action.</p>
    {#each draft.examples as example (example.id)}
      {#if example.content.kind === 'text'}
        <div class="field">
          <label for={`example-${example.id}`}>Example</label>
          <textarea id={`example-${example.id}`} rows="2" value={example.content.body} oninput={(event) => { example.content.body = event.currentTarget.value; emit(); }}></textarea>
        </div>
      {/if}
    {/each}
    {#if allowStructural}<button type="button" onclick={addExample}>Add example</button>{/if}
  </details>
  <details>
    <summary>Practice</summary>
    <p>What you will actually do to learn each idea, and what counts as showing you have.</p>
    {#each draft.experiences as experience (experience.id)}
      <div class="grid">
        <div class="field">
          <label for={`experience-process-${experience.id}`}>Kind of practice</label>
          <select id={`experience-process-${experience.id}`} value={experience.intended_processes[0]} onchange={(event) => { experience.intended_processes = [event.currentTarget.value as typeof experience.intended_processes[number]]; emit(); }}>
            <option value="memory_fluency">Build memory fluency</option>
            <option value="induction_refinement">Compare and refine</option>
            <option value="understanding_sensemaking">Make sense and explain</option>
          </select>
        </div>
        {#if experience.content.kind === 'worked'}
          <div class="field">
            <label for={`experience-prompt-${experience.id}`}>Practice prompt</label>
            <input id={`experience-prompt-${experience.id}`} value={experience.content.prompt} oninput={(event) => { experience.content.prompt = event.currentTarget.value; emit(); }} />
          </div>
        {/if}
      </div>
    {/each}
    {#if allowStructural}<button type="button" onclick={addExperience}>Add practice</button>{/if}
  </details>
</div>

<style>
  .editor { display: grid; gap: 12px; }
  .editor section, .editor details { border-top: 1px solid oklch(52% 0.06 305 / 0.14); padding: 18px 0; }
  .section-heading { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
  h3 { font: 800 21px var(--rd-display); margin: 0; }
  p { color: var(--rd-ink-soft); font-size: 13px; margin: 4px 0 12px; overflow-wrap: anywhere; }
  summary {
    cursor: pointer;
    font-weight: 900;
    color: var(--rd-ink);
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before {
    content: '';
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--rd-grape);
    border-bottom: 2px solid var(--rd-grape);
    transform: rotate(-45deg);
    transition: transform 0.14s var(--rd-ease);
  }
  details[open] summary::before { transform: rotate(45deg); }
  label { display: block; font-size: 12px; font-weight: 900; color: var(--rd-ink-soft); margin: 0 0 6px; }
  .field-helper { font-size: 12px; color: oklch(57% 0.04 305); margin: 4px 0 0; } /* --rd-ink-faint is 4.00:1, below AA at 12px */
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
  .field { min-width: 0; margin-top: 10px; }
  input, select, textarea {
    width: 100%;
    padding: 10px;
    border: 1px solid oklch(52% 0.06 305 / 0.14);
    border-radius: var(--rd-r-sm);
    background: #fff;
    font: inherit;
    box-sizing: border-box;
    min-height: 44px;
  }
  textarea { min-height: 60px; }
  button {
    border: 1px solid oklch(52% 0.06 305 / 0.14);
    border-radius: var(--rd-r-pill);
    background: #fff;
    color: var(--rd-ink);
    padding: 11px 18px;
    min-height: 44px;
    font-weight: 900;
    cursor: pointer;
  }
  button:hover { border-color: var(--rd-grape); }
  button:active { transform: translateY(1px); }
  button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible {
    outline: 3px solid var(--rd-grape);
    outline-offset: 2px;
    border-radius: var(--rd-r-sm);
  }
  @media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
    .section-heading { display: grid; }
  }
</style>
