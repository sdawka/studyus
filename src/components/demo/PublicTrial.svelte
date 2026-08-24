<script lang="ts">
  import { onMount } from 'svelte';
  import {
    clearDemoDraft,
    completeScenario,
    demoDraft,
    initializeDemoStore,
    patchDemoDraft,
  } from '../../lib/demo/store';
  import {
    DEMO_CATALOG_META,
    MCGILL_TERMS,
    demoCourseCatalog,
    manualProposal,
    proposalFromExtractedText,
    proposalFromTemplate,
  } from '../../lib/demo/catalog';
  import type { DemoScenarioId } from '../../lib/schemas/onboarding';

  interface Props { initialMode?: 'setup' | 'demo' }
  const { initialMode = 'setup' }: Props = $props();

  const SCENARIOS: Array<{
    id: DemoScenarioId;
    eyebrow: string;
    title: string;
    description: string;
    action: string;
    payoff: string;
    mastery: number;
    standing?: number;
  }> = [
    { id: 'overloaded', eyebrow: 'Too much at once', title: 'Five deadlines. Forty-five minutes.', description: 'studyus weighs urgency, course standing, and weak concepts instead of handing you a longer list.', action: 'Choose the one next move', payoff: 'CHEE 314 · Bernoulli equation moved to the top: 25 focused minutes before Friday’s quiz.', mastery: 3 },
    { id: 'missed_lecture', eyebrow: 'Life happened', title: 'I missed a lecture.', description: 'The missed class becomes a quiet catch-up path, not an accumulating red badge.', action: 'Build a catch-up path', payoff: 'Three steps: skim the recap, verify dimensional analysis, then continue with Bernoulli.', mastery: 2 },
    { id: 'after_class', eyebrow: 'Before it fades', title: 'Class just ended.', description: 'Capture the useful part now and schedule retrieval after some forgetting has begun.', action: 'Capture and schedule', payoff: 'Recap saved. A 12-minute retrieval review is waiting tomorrow afternoon.', mastery: 4 },
    { id: 'false_fluency', eyebrow: 'Recognition is not recall', title: 'I reread it, but cannot solve it.', description: 'A tiny retrieval check replaces the comforting feeling of familiar notes with evidence.', action: 'Run a quick check', payoff: 'One hidden step surfaced. The plan now teaches the missing setup before another problem.', mastery: 6 },
    { id: 'prerequisite_gap', eyebrow: 'Find the blocker', title: 'This topic makes no sense.', description: 'The knowledge map looks backward before asking you to push harder on the target.', action: 'Trace the prerequisite', payoff: 'The blocker is the control-volume energy balance. studyus opens a worked example there first.', mastery: 5 },
    { id: 'recurring_mistake', eyebrow: 'Fix the model', title: 'I keep making the same mistake.', description: 'Repeated errors become a specific misconception to correct and revisit.', action: 'Correct the misconception', payoff: 'Correction saved: pressure is not automatically constant along a streamline.', mastery: 5 },
    { id: 'exam_close', eyebrow: 'Exam mode', title: 'My exam is close.', description: 'Practice narrows to assessed KCs with weak or stale evidence, then spreads them across the time left.', action: 'Assemble exam practice', payoff: 'Four short sessions replace one vague “study fluids” block. Lowest-confidence KCs come first.', mastery: 7 },
    { id: 'grade_landed', eyebrow: 'Use the signal', title: 'A grade just landed.', description: 'The grade updates standing and the KCs that assessment actually measured.', action: 'Record and replan', payoff: 'Standing is now 76%. Momentum balance needs attention; dimensional analysis does not.', mastery: 4, standing: 4 },
    { id: 'week_disrupted', eyebrow: 'Plans should bend', title: 'My week blew up.', description: 'Reduce capacity and preserve the highest-value work without guilt mechanics.', action: 'Replan this week', payoff: 'Two sessions moved, one low-value task dropped, and the exam-critical review stayed protected.', mastery: 1 },
  ];

  let mode = $state<'setup' | 'demo'>(initialMode);
  let step = $state(0);
  let draft = $derived($demoDraft);
  let university = $state('McGill University');
  let otherUniversity = $state('');
  let program = $state('Chemical Engineering');
  let termIndex = $state(0);
  let customTermLabel = $state('Fall 2026');
  let customStartsOn = $state('2026-08-31');
  let customEndsOn = $state('2026-12-22');
  let weeklyHours = $state(7);
  let guidance = $state<'self_directed' | 'balanced' | 'tell_me_next'>('balanced');
  let depth = $state<'keep_up' | 'understand' | 'master'>('understand');
  let courseQuery = $state('');
  let manualCode = $state('');
  let manualTitle = $state('');
  let manualTopics = $state('');
  let selectedScenario = $state<DemoScenarioId>('overloaded');
  let storageError = $state<string | null>(null);
  let parsing = $state(false);
  let parseMessage = $state<string | null>(null);

  const filteredCourses = $derived(
    demoCourseCatalog.filter((course) => `${course.code} ${course.title}`.toLowerCase().includes(courseQuery.toLowerCase())).slice(0, 6),
  );
  const activeScenario = $derived(SCENARIOS.find((scenario) => scenario.id === selectedScenario) ?? SCENARIOS[0]);
  const activeCourse = $derived(draft.courses[0]);
  const realCourseCount = $derived(draft.courses.filter((course) => course.source.kind !== 'simulated').length);

  onMount(() => {
    const loaded = initializeDemoStore();
    weeklyHours = loaded.preferences.weekly_hours;
    guidance = loaded.preferences.guidance;
    depth = loaded.preferences.depth;
    if (initialMode === 'setup') void track('landing_try_clicked');
    if (initialMode === 'demo' && loaded.courses.length === 0) simulateAll();
    else if (initialMode === 'demo') void track('demo_entered');
  });

  async function track(
    name: 'landing_try_clicked' | 'setup_step_completed' | 'setup_step_skipped' | 'demo_entered' | 'scenario_started' | 'scenario_completed' | 'signup_clicked',
    extra: { step?: 'context' | 'preferences' | 'course'; scenario_id?: DemoScenarioId } = {},
  ) {
    const current = demoDraft.get();
    try {
      await fetch('/api/public/demo-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [{ session_id: current.draft_id, event_id: crypto.randomUUID(), name, occurred_at: Date.now(), ...extra }] }),
        keepalive: true,
      });
    } catch {
      // Telemetry is deliberately best-effort; it never blocks the demo.
    }
  }

  function persist(patch: Parameters<typeof patchDemoDraft>[0]) {
    if (!patchDemoDraft(patch)) storageError = 'Your browser could not save this trial. You can keep exploring, but refresh may reset it.';
  }

  function saveContext(skipped = false) {
    const term = MCGILL_TERMS[termIndex];
    const customTerm = university === 'Other';
    if (customTerm && customEndsOn < customStartsOn) {
      storageError = 'Semester end must be on or after its start.';
      return;
    }
    persist({
      context: {
        institution_name: university === 'Other' ? (otherUniversity.trim() || 'Other institution') : DEMO_CATALOG_META.institution,
        ...(program.trim() ? { program_name: program.trim() } : {}),
        term_label: customTerm ? (customTermLabel.trim() || 'Current semester') : term.label,
        starts_on: customTerm ? customStartsOn : term.starts_on,
        ends_on: customTerm ? customEndsOn : term.ends_on,
        timezone: term.timezone,
      },
    });
    void track(skipped ? 'setup_step_skipped' : 'setup_step_completed', { step: 'context' });
    step = 2;
  }

  function savePreferences(skipped = false) {
    persist({ preferences: { weekly_hours: weeklyHours, guidance, depth } });
    void track(skipped ? 'setup_step_skipped' : 'setup_step_completed', { step: 'preferences' });
    step = 3;
  }

  function selectTemplate(slug: string, simulated = false) {
    const proposal = proposalFromTemplate(slug, simulated);
    if (proposal) persist({ courses: [proposal], simulated });
  }

  function useManualCourse() {
    const topics = manualTopics.split(/[\n,;]+/).map((topic) => topic.trim()).filter(Boolean);
    if (!manualCode.trim() || !manualTitle.trim() || topics.length === 0) {
      parseMessage = 'Add a course code, title, and at least one topic.';
      return;
    }
    persist({ courses: [manualProposal(manualCode, manualTitle, topics)], simulated: false });
    parseMessage = `${topics.length} knowledge components ready to review.`;
  }

  async function extractFile(file: File) {
    parsing = true;
    parseMessage = null;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Keep trial files under 10 MB.');
      const extension = file.name.split('.').pop()?.toLowerCase();
      let text = '';
      if (extension === 'txt' || extension === 'md') {
        text = await file.text();
      } else if (extension === 'docx') {
        const mammoth = await import('mammoth/mammoth.browser');
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        text = result.value;
      } else if (extension === 'pdf') {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 30); pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }
        text = pages.join('\n');
      } else {
        throw new Error('Use a PDF, DOCX, text, or Markdown file.');
      }
      const proposal = proposalFromExtractedText(file.name, text);
      persist({ courses: [proposal], simulated: false });
      parseMessage = `Found ${proposal.branches[0].kcs.length} suggested knowledge components. Raw file data stays in this tab only.`;
    } catch (error) {
      parseMessage = error instanceof Error ? error.message : 'Could not read this file. Try manual entry instead.';
    } finally {
      parsing = false;
    }
  }

  function enterDemo(skipped = false) {
    if (demoDraft.get().courses.length === 0) selectTemplate('chee-314-fluid-mechanics', true);
    void track(skipped ? 'setup_step_skipped' : 'setup_step_completed', { step: 'course' });
    void track('demo_entered');
    mode = 'demo';
    history.pushState({}, '', '/try/app/today');
  }

  function simulateAll() {
    const term = MCGILL_TERMS[0];
    const proposal = proposalFromTemplate('chee-314-fluid-mechanics', true);
    persist({
      context: {
        institution_name: DEMO_CATALOG_META.institution,
        program_name: DEMO_CATALOG_META.program,
        term_label: term.label,
        starts_on: term.starts_on,
        ends_on: term.ends_on,
        timezone: term.timezone,
      },
      preferences: { weekly_hours: 7, guidance: 'tell_me_next', depth: 'understand' },
      courses: proposal ? [proposal] : [],
      simulated: true,
    });
    void track('setup_step_skipped', { step: 'context' });
    void track('setup_step_skipped', { step: 'preferences' });
    enterDemo(true);
  }

  function runScenario() {
    void track('scenario_started', { scenario_id: activeScenario.id });
    completeScenario(activeScenario.id, activeScenario.mastery, activeScenario.standing ?? 0);
    void track('scenario_completed', { scenario_id: activeScenario.id });
  }

  function resetTrial() {
    clearDemoDraft();
    step = 0;
    mode = 'setup';
    history.pushState({}, '', '/try');
  }
</script>

<svelte:head><meta name="theme-color" content="#f8f5ff" /></svelte:head>

{#if mode === 'setup'}
  <main class="trial-canvas">
    <header class="trial-header">
      <a href="/" class="wordmark">studyus<span>.</span></a>
      <button class="text-button" type="button" onclick={simulateAll}>Skip setup and explore</button>
    </header>

    <section class="setup-wrap" aria-labelledby="setup-title">
      <div class="setup-progress" aria-label="Setup progress">
        {#each ['Start', 'Context', 'Preferences', 'Course'] as label, index}
          <span class:active={step === index} class:done={step > index}>{index + 1}<small>{label}</small></span>
        {/each}
      </div>

      {#if storageError}<p class="notice error" role="alert">{storageError}</p>{/if}

      {#if step === 0}
        <div class="setup-card hero-card">
          <p class="eyebrow">No account · about two minutes</p>
          <h1 id="setup-title">Try your semester before you sign up.</h1>
          <p>Answer three quick sections, or skip any of them. Then explore how studyus reacts when university life gets messy.</p>
          <div class="actions">
            <button class="primary" type="button" onclick={() => step = 1}>Make it mine</button>
            <button class="secondary" type="button" onclick={simulateAll}>Skip and show me</button>
          </div>
          <p class="privacy">Your setup stays in this browser. Nothing becomes account data without a later import confirmation.</p>
        </div>
      {:else if step === 1}
        <div class="setup-card">
          <p class="eyebrow">Your academic context</p>
          <h1 id="setup-title">Where are you studying?</h1>
          <div class="field-grid">
            <label>University<select bind:value={university}><option>McGill University</option><option>Other</option></select></label>
            {#if university === 'Other'}<label>University name<input bind:value={otherUniversity} placeholder="Your institution" /></label>{/if}
            <label>Program<select bind:value={program} disabled={university === 'Other'}><option>Chemical Engineering</option></select></label>
            {#if university === 'Other'}<label>Program<input bind:value={program} placeholder="Your program" /></label>{/if}
            {#if university === 'Other'}
              <label>Semester name<input bind:value={customTermLabel} /></label>
              <label>Starts<input type="date" bind:value={customStartsOn} /></label>
              <label>Ends<input type="date" bind:value={customEndsOn} /></label>
            {:else}
              <label>Semester<select bind:value={termIndex}>{#each MCGILL_TERMS as term, index}<option value={index}>{term.label}</option>{/each}</select></label>
            {/if}
          </div>
          <p class="source-note">McGill coverage is intentionally limited to the reviewed Chemical Engineering catalog for now.</p>
          <div class="actions split"><button class="secondary" type="button" onclick={() => saveContext(true)}>Skip and simulate</button><button class="primary" type="button" onclick={() => saveContext(false)}>Continue</button></div>
        </div>
      {:else if step === 2}
        <div class="setup-card">
          <p class="eyebrow">How studyus should help</p>
          <h1 id="setup-title">Tune the plan—not your personality.</h1>
          <label class="slider">Weekly study capacity <strong>{weeklyHours} hours</strong><input type="range" min="2" max="15" step="1" bind:value={weeklyHours} /></label>
          <fieldset><legend>Guidance</legend><div class="segments">{#each [['self_directed','Let me explore'],['balanced','Balanced'],['tell_me_next','Tell me next']] as option}<button type="button" class:chosen={guidance === option[0]} onclick={() => guidance = option[0] as typeof guidance}>{option[1]}</button>{/each}</div></fieldset>
          <fieldset><legend>Goal depth</legend><div class="segments">{#each [['keep_up','Keep up'],['understand','Understand'],['master','Master deeply']] as option}<button type="button" class:chosen={depth === option[0]} onclick={() => depth = option[0] as typeof depth}>{option[1]}</button>{/each}</div></fieldset>
          <div class="actions split"><button class="secondary" type="button" onclick={() => savePreferences(true)}>Use balanced defaults</button><button class="primary" type="button" onclick={() => savePreferences(false)}>Continue</button></div>
        </div>
      {:else}
        <div class="setup-card wide">
          <p class="eyebrow">Your first course</p>
          <h1 id="setup-title">Give studyus something real to organize.</h1>
          <div class="course-columns">
            <section>
              <h2>Search reviewed courses</h2>
              <input class="search" bind:value={courseQuery} placeholder="Search code or title" />
              <div class="course-results">
                {#each filteredCourses as course}
                  <button type="button" class:selected={activeCourse?.template_id === course.slug} onclick={() => selectTemplate(course.slug)}>
                    <strong>{course.code}</strong><span>{course.title}</span><small>{course.kc_count} suggested KCs</small>
                  </button>
                {/each}
              </div>
            </section>
            <section>
              <h2>Enter or upload</h2>
              <div class="mini-grid"><input bind:value={manualCode} placeholder="Course code" /><input bind:value={manualTitle} placeholder="Course title" /></div>
              <textarea bind:value={manualTopics} rows="3" placeholder="Topics, one per line: Bernoulli equation&#10;Control-volume balance"></textarea>
              <button class="small-button" type="button" onclick={useManualCourse}>Use this course map</button>
              <label class="upload">{parsing ? 'Reading file…' : 'Upload syllabus or lesson plan'}<input type="file" accept=".pdf,.docx,.txt,.md" disabled={parsing} onchange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void extractFile(file); }} /></label>
              {#if parseMessage}<p class="source-note" role="status">{parseMessage}</p>{/if}
            </section>
          </div>
          {#if activeCourse}
            <div class="proposal-summary"><strong>{activeCourse.course.code} · {activeCourse.course.title}</strong><span>{activeCourse.branches.reduce((sum, branch) => sum + branch.kcs.length, 0)} KCs across {activeCourse.branches.length} modules</span><small>{activeCourse.source.kind === 'upload' ? `Structured locally from ${activeCourse.source.filename}` : activeCourse.source.kind}</small></div>
          {/if}
          <div class="actions split"><button class="secondary" type="button" onclick={() => enterDemo(true)}>Skip and simulate</button><button class="primary" type="button" disabled={!activeCourse} onclick={() => enterDemo(false)}>Open my preview</button></div>
        </div>
      {/if}
    </section>
  </main>
{:else}
  <div class="demo-shell">
    <header class="demo-header">
      <a href="/" class="wordmark">studyus<span>.</span></a>
      <span class="demo-pill">Public preview · local data</span>
      <a class="primary compact" href="/sign-up?from=demo" onclick={() => void track('signup_clicked')}>Save my setup</a>
    </header>
    <aside class="demo-sidebar">
      <div><p class="eyebrow">Shadow workspace</p><strong>{draft.context?.term_label ?? 'Demo semester'}</strong><small>{activeCourse?.course.code ?? 'CHEE 314'} · {draft.preferences.weekly_hours} h/week</small></div>
      <nav aria-label="Demo situations">
        {#each SCENARIOS as scenario, index}
          <button type="button" class:active={selectedScenario === scenario.id} onclick={() => selectedScenario = scenario.id}>
            <span>{draft.completed_scenarios.includes(scenario.id) ? '✓' : index + 1}</span>{scenario.title}
          </button>
        {/each}
      </nav>
      <button type="button" class="reset" onclick={resetTrial}>Clear trial data</button>
    </aside>
    <main class="demo-main">
      <div class="demo-intro"><div><p class="eyebrow">Today · {draft.context?.institution_name ?? 'McGill University'}</p><h1>One clear next move.</h1></div><div class="metrics"><span><strong>{draft.demo_mastery}%</strong> concept mastery</span><span><strong>{draft.demo_standing}%</strong> course standing</span></div></div>
      <div class="demo-grid">
        <section class="situation-card">
          <p class="eyebrow">{activeScenario.eyebrow}</p>
          <h2>{activeScenario.title}</h2>
          <p>{activeScenario.description}</p>
          {#if draft.completed_scenarios.includes(activeScenario.id)}
            <div class="payoff" role="status"><span>Plan updated</span><strong>{activeScenario.payoff}</strong></div>
          {:else}
            <button class="primary" type="button" onclick={runScenario}>{activeScenario.action}</button>
          {/if}
        </section>
        <section class="next-card">
          <p class="eyebrow">Recommended next</p>
          <div class="rank">1</div>
          <small>{activeCourse?.course.code ?? 'CHEE 314'}</small>
          <h2>{draft.completed_scenarios.includes('prerequisite_gap') ? 'Control-volume energy balance' : 'Bernoulli equation'}</h2>
          <p>{draft.completed_scenarios.length ? `${draft.completed_scenarios.length} situation${draft.completed_scenarios.length === 1 ? '' : 's'} changed this plan.` : 'Weak evidence · quiz approaching · 25 minutes'}</p>
          <div class="mastery-bar"><span style={`width:${draft.demo_mastery}%`}></span></div>
        </section>
        <section class="week-card"><p class="eyebrow">This week</p><div class="week-days">{#each ['Mon','Tue','Wed','Thu','Fri'] as day, index}<span class:busy={index === 1 || index === 3}><small>{day}</small><i></i></span>{/each}</div><p>{draft.preferences.guidance === 'tell_me_next' ? 'Three focused sessions placed for you.' : 'A flexible plan with room to choose.'}</p></section>
        <section class="proof-card"><p class="eyebrow">What this preview keeps</p><h2>{realCourseCount ? `${realCourseCount} real course draft ready` : 'Sample evidence stays sample'}</h2><p>Signup can import your context, preferences, and reviewed course map. These demo scores and actions are discarded.</p><a href="/sign-up?from=demo" onclick={() => void track('signup_clicked')}>Create account and review import →</a></section>
      </div>
    </main>
  </div>
{/if}

<style>
  :global(body) { font-family: 'Nunito Variable', system-ui, sans-serif; }
  button, a { -webkit-tap-highlight-color: transparent; }
  .trial-canvas { min-height: 100dvh; padding: 22px clamp(18px,4vw,52px) 64px; background: radial-gradient(circle at 15% 10%,#f2dfff 0,transparent 32%),radial-gradient(circle at 88% 18%,#dff8e9 0,transparent 30%),#fbf9ff; }
  .trial-header,.demo-header { display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:1180px;margin:auto; }
  .wordmark { font-family:'Fraunces Variable',serif;font-size:24px;font-weight:700;text-decoration:none;color:#281f35; }.wordmark span{color:#ee456d}
  .text-button,.reset { border:0;background:none;text-decoration:underline;color:#685f72;cursor:pointer; }
  .setup-wrap { max-width:920px;margin:clamp(42px,8vh,90px) auto 0; }
  .setup-progress { display:flex;justify-content:center;gap:12px;margin-bottom:22px; }.setup-progress span{display:flex;align-items:center;gap:6px;color:#81778d;font-weight:800;font-size:12px}.setup-progress span::before{content:'';width:22px;height:2px;background:#d8cfdf}.setup-progress span:first-child::before{display:none}.setup-progress small{font-weight:700}.setup-progress .active{color:#8b3fd0}.setup-progress .done{color:#2a8b67}
  .setup-card { background:rgba(255,255,255,.9);border:1px solid rgba(86,57,108,.13);border-radius:28px;padding:clamp(26px,5vw,54px);box-shadow:0 28px 80px rgba(73,47,91,.13);max-width:720px;margin:auto; }.setup-card.wide{max-width:920px}.hero-card{text-align:center}.hero-card p{margin-inline:auto}
  h1,h2 { font-family:'Fraunces Variable',serif;letter-spacing:-.025em;margin:0;color:#281f35}h1{font-size:clamp(38px,6vw,66px);line-height:1.02;max-width:14ch} .hero-card h1{margin:auto} h2{font-size:24px}.setup-card>p:not(.eyebrow){max-width:58ch;color:#645b6c;font-size:17px;line-height:1.6}
  .eyebrow{text-transform:uppercase;letter-spacing:.13em;font-size:11px!important;font-weight:900;color:#8b3fd0!important;margin:0 0 12px!important}.privacy,.source-note{font-size:13px!important;color:#7c7384!important}.privacy{margin-top:26px!important}
  .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px}.hero-card .actions{justify-content:center}.actions.split{justify-content:space-between}.primary,.secondary,.small-button{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:13px 21px;border:1px solid transparent;font-weight:900;text-decoration:none;cursor:pointer}.primary{background:#ee456d;color:white;box-shadow:0 10px 28px rgba(238,69,109,.28)}.primary:disabled{opacity:.45;cursor:not-allowed}.secondary,.small-button{background:white;color:#503d61;border-color:#d8cfdf}.compact{padding:9px 16px;font-size:13px}
  .field-grid,.mini-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:24px}label{display:flex;flex-direction:column;gap:7px;font-size:13px;font-weight:900;color:#645b6c}input,select,textarea{width:100%;border:1px solid #d8cfdf;border-radius:13px;background:#fff;padding:12px 13px;color:#281f35}input:focus,select:focus,textarea:focus{outline:3px solid rgba(139,63,208,.16);border-color:#8b3fd0}.slider{margin:26px 0}.slider strong{color:#281f35}.slider input{padding:0;accent-color:#8b3fd0}
  fieldset{border:0;padding:0;margin:22px 0}legend{font-weight:900;color:#645b6c;margin-bottom:8px}.segments{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.segments button{border:1px solid #d8cfdf;background:white;border-radius:13px;padding:12px;color:#5d5267;cursor:pointer}.segments button.chosen{background:#f0e5ff;border-color:#8b3fd0;color:#63309a;font-weight:900}
  .course-columns{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:26px}.course-columns h2{font-size:19px;margin-bottom:12px}.course-results{display:flex;flex-direction:column;gap:7px;margin-top:10px;max-height:290px;overflow:auto}.course-results button{display:grid;grid-template-columns:auto 1fr auto;gap:9px;text-align:left;align-items:baseline;padding:11px;border:1px solid #e0d9e5;background:white;border-radius:12px;cursor:pointer}.course-results button.selected{border-color:#8b3fd0;background:#f7f0ff}.course-results small{color:#81778d}.course-columns textarea{margin:9px 0}.upload{position:relative;margin-top:12px;border:1px dashed #a78bbd;border-radius:13px;padding:12px;text-align:center;cursor:pointer}.upload input{position:absolute;inset:0;opacity:0;cursor:pointer}.proposal-summary{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:24px;padding:16px;border-radius:16px;background:#f5effa}.proposal-summary span,.proposal-summary small{color:#6f6478}
  .notice{padding:12px;border-radius:12px}.error{background:#ffe8ed;color:#9d2643}
  .demo-shell{min-height:100dvh;display:grid;grid-template-columns:260px 1fr;grid-template-rows:68px 1fr;background:#f7f7fb;color:#292433}.demo-header{grid-column:1/-1;max-width:none;width:100%;padding:0 24px;background:white;border-bottom:1px solid #e8e3eb}.demo-pill{font-size:12px;color:#776d7e;background:#f1edf3;border-radius:999px;padding:7px 11px;margin-left:auto}.demo-sidebar{padding:28px 16px;border-right:1px solid #e4dee8;background:#fff;display:flex;flex-direction:column;gap:24px}.demo-sidebar>div{display:flex;flex-direction:column;gap:4px}.demo-sidebar small{color:#81778d}.demo-sidebar nav{display:flex;flex-direction:column;gap:4px}.demo-sidebar nav button{display:flex;align-items:center;gap:9px;text-align:left;border:0;background:none;border-radius:10px;padding:9px;color:#665d6e;cursor:pointer;font-size:12px}.demo-sidebar nav button span{display:grid;place-items:center;width:22px;height:22px;border-radius:7px;background:#eee9f1;font-weight:900}.demo-sidebar nav button.active{background:#f3e9ff;color:#69349b;font-weight:900}.demo-sidebar .reset{margin-top:auto;text-align:left}.demo-main{padding:clamp(24px,5vw,60px);max-width:1200px;width:100%}.demo-intro{display:flex;justify-content:space-between;gap:24px;align-items:end;margin-bottom:26px}.demo-intro h1{font-size:clamp(38px,5vw,62px)}.metrics{display:flex;gap:10px}.metrics span{display:flex;flex-direction:column;background:white;border:1px solid #e4dee8;border-radius:15px;padding:12px 16px;font-size:11px;color:#807687}.metrics strong{font-size:21px;color:#322a39}.demo-grid{display:grid;grid-template-columns:1.3fr .7fr;gap:16px}.demo-grid>section{background:white;border:1px solid #e4dee8;border-radius:22px;padding:24px;box-shadow:0 12px 38px rgba(54,39,65,.06)}.situation-card{min-height:310px;display:flex;flex-direction:column}.situation-card h2{font-size:clamp(28px,4vw,44px);max-width:14ch}.situation-card>p:not(.eyebrow){color:#6c6372;line-height:1.6;max-width:55ch}.situation-card>.primary{margin-top:auto;align-self:flex-start}.payoff{margin-top:auto;padding:18px;border-radius:16px;background:#e9f8f1;display:flex;flex-direction:column;gap:6px}.payoff span{font-size:11px;text-transform:uppercase;font-weight:900;color:#27805e}.next-card{position:relative}.rank{position:absolute;right:20px;top:20px;width:38px;height:38px;border-radius:12px;background:#ee456d;color:white;display:grid;place-items:center;font-weight:900}.next-card small{color:#8b3fd0;font-weight:900}.next-card h2{margin-top:10px}.next-card p,.week-card p,.proof-card p{color:#746a7b}.mastery-bar{height:8px;background:#eee9f1;border-radius:999px;margin-top:28px;overflow:hidden}.mastery-bar span{display:block;height:100%;background:linear-gradient(90deg,#8b3fd0,#ee456d);border-radius:inherit}.week-days{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.week-days span{display:flex;flex-direction:column;align-items:center;gap:8px}.week-days i{height:54px;width:100%;border-radius:10px;background:#f0edf2}.week-days .busy i{background:linear-gradient(#dceee7 0 45%,#f5dfe7 45% 70%,#eee9f1 70%)}.proof-card a{font-weight:900;color:#8b3fd0}
  @media(max-width:800px){.setup-progress small{display:none}.field-grid,.course-columns,.demo-grid{grid-template-columns:1fr}.demo-shell{display:block}.demo-sidebar{border:0;border-bottom:1px solid #e4dee8;padding:12px;overflow:auto}.demo-sidebar>div,.demo-sidebar .reset{display:none}.demo-sidebar nav{flex-direction:row;width:max-content}.demo-sidebar nav button{max-width:180px}.demo-main{padding:24px 16px}.demo-intro{align-items:start;flex-direction:column}.metrics{width:100%}.metrics span{flex:1}.demo-header{height:64px;position:sticky;top:0;z-index:5}.demo-pill{display:none}}
  @media(max-width:560px){.field-grid,.mini-grid{grid-template-columns:1fr}.segments{grid-template-columns:1fr}.actions.split{flex-direction:column-reverse}.actions.split button{width:100%}.course-results button{grid-template-columns:auto 1fr}.course-results small{grid-column:2}.setup-card{border-radius:20px;padding:24px 18px}.demo-header .compact{font-size:0}.demo-header .compact::after{content:'Save';font-size:13px}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style>
