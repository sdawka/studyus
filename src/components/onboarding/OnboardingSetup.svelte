<script lang="ts">
  import { onMount } from 'svelte';
  import type { CourseDraftV2 } from '../../lib/schemas/courseDraft';
  import CourseMapReview from './CourseMapReview.svelte';

  const MODULES = ['How do you know you’ve learned something?', 'How do you access what you’ve learned?', 'What does learning feel like?', 'What helps you learn best?', 'How can you keep getting better at learning?'];
  let step = $state(1);
  let draftId = $state('00000000-0000-4000-8000-000000000000');
  let topic = $state(''); let level = $state(''); let outcome = $state('');
  let courseDraft = $state<CourseDraftV2 | null>(null);
  let saving = $state(false); let error = $state<string | null>(null);
  let institution = $state(''); let program = $state(''); let termName = $state('');
  let startsOn = $state(''); let endsOn = $state(''); let timezone = $state('UTC');

  onMount(() => { draftId = crypto.randomUUID(); timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; });
  const localId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

  function makeDraft(): CourseDraftV2 | null {
    if (!topic.trim() || !level.trim() || !outcome.trim()) return null;
    const outcomeId = localId('outcome'); const kcId = localId('kc'); const experienceId = localId('experience');
    return {
      schema_version: 2, spec: { title: topic.trim(), topic: topic.trim(), level: level.trim(), constraints: [] },
      outcomes: [{ id: outcomeId, title: outcome.trim(), kc_ids: [kcId] }],
      kcs: [{ id: kcId, name: outcome.trim(), kc_form: 'variable_constant', rationale_level: 2, mastery_rule: { threshold: 0.8, minimum_evidence: 2 }, prerequisite_kc_ids: [] }],
      examples: [{ id: localId('example'), kc_ids: [kcId], content: { schema_version: 1, kind: 'text', body: `A concrete example of ${topic.trim()}.` } }],
      misconceptions: [],
      experiences: [{ id: experienceId, kind: 'exercise', target_kc_ids: [kcId], intended_processes: ['understanding_sensemaking'], evidence: { response_type: 'constructed_response', target_kc_ids: [kcId], diagnostic_misconception_ids: [] }, content: { schema_version: 1, kind: 'worked', prompt: `Explain or demonstrate: ${outcome.trim()}`, solution: 'Describe the features of a successful response.' } }],
      references: [], modules: [{ id: localId('module'), title: outcome.trim(), outcome_ids: [outcomeId], kc_ids: [kcId], experience_ids: [experienceId], sort_order: 0 }],
    };
  }
  function shapeCourse() {
    const built = makeDraft();
    if (!built) { error = 'Add a topic, level, and one learning outcome first.'; return; }
    courseDraft = built; error = null; step = 2;
  }
  function context() {
    if (![institution, program, termName, startsOn, endsOn].some((value) => value.trim())) return undefined;
    if (!institution.trim() || !termName.trim() || !startsOn || !endsOn) throw new Error('Complete the institution, term, and date fields, or leave academic context blank.');
    if (endsOn < startsOn) throw new Error('Term end must be on or after its start.');
    return { institution_name: institution.trim(), ...(program.trim() ? { program_name: program.trim() } : {}), term_label: termName.trim(), starts_on: startsOn, ends_on: endsOn, timezone };
  }
  async function commit(course?: CourseDraftV2) {
    saving = true; error = null;
    try {
      const academic = context();
      const response = await fetch('/api/v1/onboarding/import-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema_version: 1, draft_id: draftId, preferences: { weekly_hours: 7, guidance: 'balanced', depth: 'understand' }, courses: [], ...(academic ? { context: academic } : {}), ...(course ? { course } : {}), review_metrics: { renamed: 0, reordered: 0, excluded: 0 } }) });
      const payload = await response.json() as { data?: { course_slug: string | null }; error?: { message: string } };
      if (!response.ok || !payload.data?.course_slug) throw new Error(payload.error?.message ?? 'Could not finish setup.');
      window.location.href = `/courses/${payload.data.course_slug}`;
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not finish setup.'; }
    finally { saving = false; }
  }
</script>

<main class="page">
  <header><a href="/" class="wordmark">studyus<span>.</span></a><button type="button" class="skip" disabled={saving} onclick={() => commit()}>Skip to my course</button></header>
  <section class="shell">
    <nav aria-label="Onboarding progress"><span class:active={step === 1}>1. Start</span><span class:active={step === 2}>2. Shape</span><span class:active={step === 3}>3. Review</span></nav>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if step === 1}
      <p class="kicker">Your first course is ready</p><h1>Learning How to Learn</h1><p class="lede">Start there now, or shape another course around anything you want to learn.</p>
      <ol class="module-preview">{#each MODULES as module}<li>{module}</li>{/each}</ol>
      <div class="authoring-start"><h2>Create another course <span>optional</span></h2><div class="fields"><label>Topic<input bind:value={topic} placeholder="Documentary filmmaking" /></label><label>Level<input bind:value={level} placeholder="First project" /></label><label class="wide">Learning outcome<input bind:value={outcome} placeholder="Plan and shoot a coherent short documentary" /></label></div><button type="button" class="primary" onclick={shapeCourse}>Shape course</button></div>
    {:else if step === 2 && courseDraft}
      <p class="kicker">Make the learning concrete</p><h1>{courseDraft.spec.title}</h1><p class="lede">The starter structure is editable. Open only the detail you need.</p>
      <CourseMapReview draft={courseDraft} onchange={(next) => { courseDraft = next; }} />
      <div class="actions"><button type="button" class="secondary" onclick={() => { step = 1; }}>Back</button><button type="button" class="primary" onclick={() => { step = 3; }}>Review</button></div>
    {:else if step === 3 && courseDraft}
      <p class="kicker">Ready when you are</p><h1>{courseDraft.spec.title}</h1><dl><div><dt>Topic</dt><dd>{courseDraft.spec.topic}</dd></div><div><dt>Level</dt><dd>{courseDraft.spec.level}</dd></div><div><dt>Outcomes</dt><dd>{courseDraft.outcomes.length}</dd></div><div><dt>Ideas and skills</dt><dd>{courseDraft.kcs.length}</dd></div></dl>
      <div class="actions"><button type="button" class="secondary" onclick={() => { step = 2; }}>Back</button><button type="button" class="primary" disabled={saving} onclick={() => commit(courseDraft)}>{saving ? 'Saving…' : 'Finish and open course'}</button></div>
    {/if}
    <details class="academic"><summary>Add academic context <span>optional</span></summary><p>Use this only when a formal term or schedule matters.</p><div class="fields"><label>Institution<input bind:value={institution} /></label><label>Program<input bind:value={program} /></label><label>Term name<input bind:value={termName} /></label><label>Time zone<input bind:value={timezone} /></label><label>Starts<input type="date" bind:value={startsOn} /></label><label>Ends<input type="date" bind:value={endsOn} /></label></div></details>
  </section>
</main>

<style>
  :global(body){font-family:'Nunito Variable',system-ui,sans-serif;background:#faf8fd;color:#2d2734}.page{min-height:100dvh;padding:22px clamp(16px,4vw,48px) 70px}.page>header{max-width:920px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:20px}.wordmark{font:800 24px 'Fraunces Variable',serif;text-decoration:none;color:#2d2734}.wordmark span{color:#ee456d}.skip{border:0;background:none;color:#7135a6;text-decoration:underline;font-weight:900;padding:9px;cursor:pointer}.shell{max-width:920px;margin:clamp(34px,6vh,64px) auto 0;border:1px solid #e2dce6;border-radius:24px;background:#fff;padding:clamp(24px,5vw,52px)}nav{display:flex;gap:24px;border-bottom:1px solid #eee9f0;padding-bottom:12px;margin-bottom:30px;color:#8a7f91;font-size:13px}nav span.active{color:#7135a6;font-weight:900}.kicker{color:#7135a6;font-size:13px;font-weight:900;margin:0 0 7px}h1,h2{font-family:'Fraunces Variable',serif}h1{font-size:clamp(36px,6vw,60px);line-height:1.02;margin:0;letter-spacing:-.025em}.lede{max-width:660px;color:#716777;font-size:18px}.module-preview{margin:28px 0;padding:0;list-style:none;border-top:1px solid #e2dce6}.module-preview li{padding:11px 0;border-bottom:1px solid #e2dce6;font:700 clamp(17px,2.2vw,22px) 'Fraunces Variable',serif}.authoring-start{margin-top:32px;padding-top:24px}.authoring-start h2{margin:0 0 16px}.authoring-start h2 span,.academic summary span{font:700 12px 'Nunito Variable',sans-serif;color:#8a7f91}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.wide{grid-column:1/-1}label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:900;color:#6e6475}input{width:100%;padding:11px;border:1px solid #d9d2de;border-radius:11px;background:#fff;font:inherit;box-sizing:border-box}.primary,.secondary{border-radius:999px;padding:11px 18px;font-weight:900;cursor:pointer}.primary{border:1px solid #ee456d;background:#ee456d;color:#fff;margin-top:16px}.secondary{border:1px solid #d9d1de;background:#fff;color:#55485e}.actions{display:flex;justify-content:space-between;gap:12px;margin-top:24px}.academic{border-top:1px solid #e2dce6;margin-top:32px;padding-top:18px}.academic summary{cursor:pointer;font-weight:900}.academic>p{color:#746979}.error{background:#ffe7ec;color:#982542;padding:11px;border-radius:11px}dl{margin:28px 0}dl div{display:grid;grid-template-columns:150px 1fr;padding:10px;border-bottom:1px solid #e2dce6}dt{font-weight:900}dd{margin:0}.skip:focus-visible,.primary:focus-visible,.secondary:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #d7b5f1;outline-offset:2px}@media(max-width:680px){.shell{border-radius:18px}.fields{grid-template-columns:1fr}.wide{grid-column:auto}nav{gap:12px}.actions{flex-wrap:wrap}}
</style>
