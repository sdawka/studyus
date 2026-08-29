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
  import { trackDemoFunnelEvent, trackDemoFunnelEvents, type DemoFunnelEventInput } from '../../lib/analytics/demo';

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
    nextTitle: string;
    nextReason: string;
    duration: string;
    sessionSteps: [string, string, string];
  }> = [
    { id: 'overloaded', eyebrow: 'Too much at once', title: 'Five deadlines. Forty-five minutes.', description: 'studyus weighs urgency, course standing, and weak concepts instead of handing you a longer list.', action: 'Choose my one priority', payoff: 'Bernoulli equation moved to the top: 25 focused minutes before Friday’s quiz.', mastery: 3, nextTitle: 'Bernoulli equation', nextReason: 'It is weak, the quiz is Friday, and this unlocks two later fluid-mechanics topics.', duration: '25 min', sessionSteps: ['Recall the assumptions', 'Work one guided example', 'Finish with a no-notes check'] },
    { id: 'missed_lecture', eyebrow: 'Life happened', title: 'I missed a lecture.', description: 'The missed class becomes a quiet catch-up path, not an accumulating red badge.', action: 'Build my catch-up path', payoff: 'A short catch-up path now comes before the current lecture material.', mastery: 2, nextTitle: 'Dimensional analysis recap', nextReason: 'This is the smallest prerequisite that reconnects you to the lecture you missed.', duration: '18 min', sessionSteps: ['Skim the missed-lecture recap', 'Check the core units', 'Solve one bridge question'] },
    { id: 'after_class', eyebrow: 'Before it fades', title: 'Class just ended.', description: 'Capture the useful part now and schedule retrieval after some forgetting has begun.', action: 'Capture and schedule it', payoff: 'Recap saved. A retrieval review is now waiting tomorrow afternoon.', mastery: 4, nextTitle: 'Momentum balance recall', nextReason: 'A brief retrieval tomorrow will preserve today’s lecture better than rereading it now.', duration: '12 min tomorrow', sessionSteps: ['Recall the governing equation', 'Name each term from memory', 'Schedule the next check'] },
    { id: 'false_fluency', eyebrow: 'Recognition is not recall', title: 'I reread it, but cannot solve it.', description: 'A tiny retrieval check replaces the comforting feeling of familiar notes with evidence.', action: 'Find the missing step', payoff: 'One hidden step surfaced. The plan now teaches the setup before another full problem.', mastery: 6, nextTitle: 'Choose a control volume', nextReason: 'Your algebra is fine; selecting and labeling the system is the step blocking the solution.', duration: '15 min', sessionSteps: ['Draw the system boundary', 'Label every flow', 'Set up one problem without notes'] },
    { id: 'prerequisite_gap', eyebrow: 'Find the blocker', title: 'This topic makes no sense.', description: 'The knowledge map looks backward before asking you to push harder on the target.', action: 'Trace the prerequisite', payoff: 'The blocker is the control-volume energy balance, so studyus moved there first.', mastery: 5, nextTitle: 'Control-volume energy balance', nextReason: 'This prerequisite is blocking Bernoulli applications; fixing it makes the target learnable.', duration: '20 min', sessionSteps: ['Review energy terms', 'Map terms to a diagram', 'Return to one Bernoulli case'] },
    { id: 'recurring_mistake', eyebrow: 'Fix the model', title: 'I keep making the same mistake.', description: 'Repeated errors become a specific misconception to correct and revisit.', action: 'Correct the misconception', payoff: 'Correction saved: pressure is not automatically constant along a streamline.', mastery: 5, nextTitle: 'Pressure along a streamline', nextReason: 'The same assumption caused two errors, so correcting the mental model has the highest payoff.', duration: '14 min', sessionSteps: ['Predict before calculating', 'Contrast two streamlines', 'Write the corrected rule'] },
    { id: 'exam_close', eyebrow: 'Exam mode', title: 'My exam is close.', description: 'Practice narrows to assessed concepts with weak or stale evidence, then spreads them across the time left.', action: 'Build my exam plan', payoff: 'Four short sessions replace one vague “study fluids” block. Lowest-confidence concepts come first.', mastery: 7, nextTitle: 'Mixed fluid-mechanics retrieval', nextReason: 'The exam is close, so mixed recall now reveals more than another chapter reread.', duration: '30 min', sessionSteps: ['Answer five mixed prompts', 'Review only missed steps', 'Queue the weakest concept again'] },
    { id: 'grade_landed', eyebrow: 'Use the signal', title: 'A grade just landed.', description: 'The grade updates standing and the concepts that assessment actually measured.', action: 'Use the grade to replan', payoff: 'Standing is now 76%. Momentum balance needs attention; dimensional analysis does not.', mastery: 4, standing: 4, nextTitle: 'Momentum balance correction', nextReason: 'The new grade points to this assessed skill—not the parts of the course you already know.', duration: '22 min', sessionSteps: ['Inspect the marked attempt', 'Correct the first wrong step', 'Retry a parallel problem'] },
    { id: 'week_disrupted', eyebrow: 'Plans should bend', title: 'My week blew up.', description: 'Reduce capacity and preserve the highest-value work without guilt mechanics.', action: 'Replan around my week', payoff: 'Two sessions moved, one low-value task dropped, and the exam-critical review stayed protected.', mastery: 1, nextTitle: 'Bernoulli quick check', nextReason: 'It preserves the exam-critical thread and fits the first real opening left this week.', duration: '15 min Friday', sessionSteps: ['Run a three-question check', 'Review only one weak step', 'Confirm the next available block'] },
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
  let previewedScenario = $state<DemoScenarioId | null>(null);
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
    if (initialMode === 'demo' && loaded.courses.length === 0) simulateAll();
    else if (initialMode === 'demo') void track('demo_entered');
  });

  async function track(
    name: 'setup_step_completed' | 'setup_step_skipped' | 'demo_entered' | 'scenario_started' | 'scenario_completed' | 'signup_clicked',
    extra: { step?: 'context' | 'preferences' | 'course'; scenario_id?: DemoScenarioId } = {},
  ) {
    const current = demoDraft.get();
    await trackDemoFunnelEvent({ name, trial_session_id: current.draft_id, ...extra }, '/try');
  }

  async function trackTransition(events: Array<Omit<DemoFunnelEventInput, 'trial_session_id'>>) {
    const current = demoDraft.get();
    await trackDemoFunnelEvents(
      events.map((event) => ({ ...event, trial_session_id: current.draft_id }) as DemoFunnelEventInput),
      '/try',
    );
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
    parseMessage = `${topics.length} concepts ready to review.`;
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
      parseMessage = `Found ${proposal.branches[0].kcs.length} suggested concepts. Raw file data stays in this tab only.`;
    } catch (error) {
      parseMessage = error instanceof Error ? error.message : 'Could not read this file. Try manual entry instead.';
    } finally {
      parsing = false;
    }
  }

  function enterDemo(skipped = false) {
    if (demoDraft.get().courses.length === 0) selectTemplate('chee-314-fluid-mechanics', true);
    void trackTransition([
      { name: skipped ? 'setup_step_skipped' : 'setup_step_completed', step: 'course' },
      { name: 'demo_entered' },
    ]);
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
    // The public trial should lead with the payoff, not another empty state.
    // Seed the first decision so students immediately see what Studyus chose
    // and why; the remaining situations stay interactive.
    completeScenario('overloaded', 3, 0);
    void trackTransition([
      { name: 'setup_step_skipped', step: 'context' },
      { name: 'setup_step_skipped', step: 'preferences' },
      { name: 'setup_step_skipped', step: 'course' },
      { name: 'demo_entered' },
      { name: 'scenario_started', scenario_id: 'overloaded' },
      { name: 'scenario_completed', scenario_id: 'overloaded' },
    ]);
    mode = 'demo';
    history.pushState({}, '', '/try/app/today');
  }

  function runScenario() {
    completeScenario(activeScenario.id, activeScenario.mastery, activeScenario.standing ?? 0);
    previewedScenario = null;
    void trackTransition([
      { name: 'scenario_started', scenario_id: activeScenario.id },
      { name: 'scenario_completed', scenario_id: activeScenario.id },
    ]);
  }

  function chooseScenario(id: DemoScenarioId) {
    selectedScenario = id;
    previewedScenario = null;
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
      <button class="text-button" type="button" onclick={simulateAll}>See a sample decision</button>
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
          <p class="eyebrow">No account · instant preview</p>
          <h1 id="setup-title">See Studyus make one decision.</h1>
          <p>Start with a sample student week and see exactly what Studyus puts first—and why. Personalize it afterward if it feels useful.</p>
          <div class="actions">
            <button class="primary" type="button" onclick={simulateAll}>Show my next move</button>
            <button class="secondary" type="button" onclick={() => step = 1}>Use my courses</button>
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
                    <strong>{course.code}</strong><span>{course.title}</span><small>{course.kc_count} suggested concepts</small>
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
            <div class="proposal-summary"><strong>{activeCourse.course.code} · {activeCourse.course.title}</strong><span>{activeCourse.branches.reduce((sum, branch) => sum + branch.kcs.length, 0)} concepts across {activeCourse.branches.length} modules</span><small>{activeCourse.source.kind === 'upload' ? `Structured locally from ${activeCourse.source.filename}` : activeCourse.source.kind}</small></div>
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
      <a class="primary compact" href="/sign-up?from=demo" onclick={() => void track('signup_clicked')}>Create free account</a>
    </header>
    <aside class="demo-sidebar">
      <div><p class="eyebrow">Try a situation</p><strong>{draft.context?.term_label ?? 'Demo semester'}</strong><small>{activeCourse?.course.code ?? 'CHEE 314'} · {draft.preferences.weekly_hours} h/week</small></div>
      <nav aria-label="Demo situations">
        {#each SCENARIOS as scenario, index}
          <button type="button" class:active={selectedScenario === scenario.id} onclick={() => chooseScenario(scenario.id)} aria-pressed={selectedScenario === scenario.id}>
            <span>{draft.completed_scenarios.includes(scenario.id) ? '✓' : index + 1}</span>{scenario.title}
          </button>
        {/each}
      </nav>
      <button type="button" class="reset" onclick={resetTrial}>Clear trial data</button>
    </aside>
    <main class="demo-main">
      <div class="demo-intro"><div><p class="eyebrow">Interactive preview · {draft.context?.institution_name ?? 'McGill University'}</p><h1>Watch the plan make a decision.</h1><p class="intro-copy">Pick what happened. Studyus will explain what changed, then give you one study session you can actually start.</p></div><div class="metrics"><span><strong>{draft.demo_mastery}%</strong> concept mastery</span><span><strong>{draft.demo_standing}%</strong> course standing</span></div></div>
      <ol class="demo-steps" aria-label="How to use this preview">
        <li class="active"><b>1</b><span><strong>Pick a situation</strong><small>Tell us what changed</small></span></li>
        <li class:active={draft.completed_scenarios.includes(activeScenario.id)}><b>2</b><span><strong>Update the plan</strong><small>See the decision</small></span></li>
        <li class:active={previewedScenario === activeScenario.id}><b>3</b><span><strong>Open the session</strong><small>Know exactly what to do</small></span></li>
      </ol>
      <div class="demo-grid">
        <section class="situation-card">
          <p class="eyebrow">Step 1 · {activeScenario.eyebrow}</p>
          <h2>{activeScenario.title}</h2>
          <p>{activeScenario.description}</p>
          {#if draft.completed_scenarios.includes(activeScenario.id)}
            <div class="payoff" role="status"><span>✓ Plan updated</span><strong>{activeScenario.payoff}</strong><small>Your recommended session is ready →</small></div>
          {:else}
            <div class="scenario-action"><span>See what studyus would change</span><button class="primary" type="button" onclick={runScenario}>{activeScenario.action} <b aria-hidden="true">→</b></button></div>
          {/if}
        </section>
        <section class:ready={draft.completed_scenarios.includes(activeScenario.id)} class="next-card" aria-live="polite">
          {#if draft.completed_scenarios.includes(activeScenario.id)}
            <p class="eyebrow">Step 2 · Your next study session</p>
            <span class="duration">{activeScenario.duration}</span>
            <small class="course-code">{activeCourse?.course.code ?? 'CHEE 314'}</small>
            <h2>{activeScenario.nextTitle}</h2>
            <div class="why-next"><span>Why this is next</span><p>{activeScenario.nextReason}</p></div>
            {#if previewedScenario === activeScenario.id}
              <div class="session-preview">
                <strong>Here’s the session</strong>
                <ol>{#each activeScenario.sessionSteps as item}<li>{item}</li>{/each}</ol>
                <a class="primary" href="/sign-up?from=demo" onclick={() => void track('signup_clicked')}>Use this with my courses →</a>
              </div>
            {:else}
              <button class="primary next-action" type="button" onclick={() => previewedScenario = activeScenario.id}>Open this {activeScenario.duration} session <b aria-hidden="true">→</b></button>
            {/if}
          {:else}
            <div class="next-placeholder">
              <span class="placeholder-number">2</span>
              <p class="eyebrow">Then · Your next study session</p>
              <h2>Your recommendation appears here.</h2>
              <p>Update the plan first. You’ll see the exact topic, why it outranks everything else, and what to do during the session.</p>
            </div>
          {/if}
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
  .demo-shell { min-height:100dvh;display:grid;grid-template-columns:244px minmax(0,1fr);grid-template-rows:68px 1fr;background:#f7f7fb;color:#292433; }
  .demo-header { grid-column:1/-1;max-width:none;width:100%;padding:0 24px;background:white;border-bottom:1px solid #e8e3eb; }
  .demo-pill { font-size:12px;color:#776d7e;background:#f1edf3;border-radius:999px;padding:7px 11px;margin-left:auto; }
  .demo-sidebar { padding:28px 14px;border-right:1px solid #e4dee8;background:#fff;display:flex;flex-direction:column;gap:24px;min-width:0; }
  .demo-sidebar>div { display:flex;flex-direction:column;gap:4px;padding-inline:6px; }
  .demo-sidebar small { color:#81778d; }
  .demo-sidebar nav { display:flex;flex-direction:column;gap:4px; }
  .demo-sidebar nav button { display:flex;align-items:center;gap:9px;text-align:left;border:0;background:none;border-radius:10px;padding:9px;color:#665d6e;cursor:pointer;font-size:12px; }
  .demo-sidebar nav button span { display:grid;place-items:center;flex:0 0 22px;width:22px;height:22px;border-radius:7px;background:#eee9f1;font-weight:900; }
  .demo-sidebar nav button.active { background:#f3e9ff;color:#69349b;font-weight:900;box-shadow:inset 3px 0 #8b3fd0; }
  .demo-sidebar .reset { margin-top:auto;text-align:left;padding-inline:6px; }
  .demo-main { padding:clamp(28px,4vw,52px);max-width:1240px;width:100%;margin:0 auto; }
  .demo-intro { display:flex;justify-content:space-between;gap:28px;align-items:end;margin-bottom:22px; }
  .demo-intro>div:first-child { min-width:0; }
  .demo-intro h1 { font-size:clamp(36px,4.5vw,58px);max-width:16ch; }
  .intro-copy { max-width:62ch;margin:14px 0 0;color:#6c6372;line-height:1.55; }
  .metrics { display:flex;gap:10px;flex:0 0 auto; }
  .metrics span { display:flex;flex-direction:column;background:white;border:1px solid #e4dee8;border-radius:15px;padding:12px 16px;font-size:11px;color:#807687;min-width:128px; }
  .metrics strong { font-size:21px;color:#322a39; }
  .demo-steps { list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:0 0 16px;padding:0; }
  .demo-steps li { display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e4dee8;border-radius:14px;background:#eeecf1;color:#8a818f; }
  .demo-steps li.active { background:white;color:#3d3445;border-color:#d9c9e6; }
  .demo-steps b { display:grid;place-items:center;flex:0 0 25px;height:25px;border-radius:50%;background:#ded9e2;font-size:12px; }
  .demo-steps .active b { background:#8b3fd0;color:white; }
  .demo-steps span { display:flex;flex-direction:column;line-height:1.2; }
  .demo-steps strong { font-size:12px; }
  .demo-steps small { margin-top:3px;font-size:10px;color:#81778d; }
  .demo-grid { display:grid;grid-template-columns:minmax(0,1.05fr) minmax(320px,.95fr);gap:16px;align-items:start; }
  .demo-grid>section { min-width:0;background:white;border:1px solid #e4dee8;border-radius:22px;padding:24px;box-shadow:0 12px 38px rgba(54,39,65,.06); }
  .situation-card { min-height:370px;display:flex;flex-direction:column; }
  .situation-card h2 { font-size:clamp(28px,3.6vw,42px);max-width:14ch; }
  .situation-card>p:not(.eyebrow) { color:#6c6372;line-height:1.6;max-width:55ch; }
  .scenario-action { margin-top:auto;display:flex;flex-direction:column;align-items:flex-start;gap:8px; }
  .scenario-action>span { font-size:11px;font-weight:800;color:#81778d; }
  .scenario-action .primary,.next-action { min-height:48px; }
  .primary b { font-size:18px;margin-left:5px; }
  .payoff { margin-top:auto;padding:18px;border-radius:16px;background:#e9f8f1;border:1px solid #c7eadb;display:flex;flex-direction:column;gap:6px; }
  .payoff span { font-size:11px;text-transform:uppercase;font-weight:900;color:#27805e; }
  .payoff small { margin-top:5px;color:#496e60;font-weight:800; }
  .next-card { position:relative;min-height:370px;background:#f1eff4!important;border-style:dashed!important;display:flex;flex-direction:column; }
  .next-card.ready { background:white!important;border:2px solid #8b3fd0!important;border-style:solid!important;box-shadow:0 16px 46px rgba(107,52,155,.14)!important; }
  .duration { position:absolute;right:20px;top:20px;padding:7px 10px;border-radius:999px;background:#f1e7fb;color:#69349b;font-size:11px;font-weight:900; }
  .course-code { color:#8b3fd0;font-weight:900;letter-spacing:.08em;text-transform:uppercase; }
  .next-card h2 { margin-top:9px;font-size:clamp(25px,3vw,34px);max-width:14ch; }
  .why-next { margin-top:18px;padding:14px;border-radius:14px;background:#f6f1fa; }
  .why-next span { font-size:10px;text-transform:uppercase;letter-spacing:.1em;font-weight:900;color:#8b3fd0; }
  .why-next p { margin:5px 0 0;line-height:1.45;color:#5f5567; }
  .next-action { align-self:flex-start;margin-top:auto; }
  .next-placeholder { margin:auto;max-width:36ch;text-align:center; }
  .next-placeholder .eyebrow { margin-top:15px!important; }
  .next-placeholder h2 { margin-inline:auto; }
  .next-placeholder p:not(.eyebrow) { color:#7b7282;line-height:1.5; }
  .placeholder-number { display:grid;place-items:center;width:46px;height:46px;margin:auto;border-radius:50%;background:#e2dde6;color:#746b7b;font-family:'Fraunces Variable',serif;font-size:22px;font-weight:800; }
  .session-preview { margin-top:16px;padding-top:15px;border-top:1px solid #e5deea; }
  .session-preview>strong { font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#69349b; }
  .session-preview ol { margin:10px 0 16px;padding-left:23px;color:#5f5567;font-size:13px;line-height:1.7; }
  .session-preview .primary { width:100%;padding-inline:14px; }
  .week-card p,.proof-card p { color:#746a7b; }
  .week-days { display:grid;grid-template-columns:repeat(5,1fr);gap:8px; }
  .week-days span { display:flex;flex-direction:column;align-items:center;gap:8px; }
  .week-days i { height:54px;width:100%;border-radius:10px;background:#f0edf2; }
  .week-days .busy i { background:linear-gradient(#dceee7 0 45%,#f5dfe7 45% 70%,#eee9f1 70%); }
  .proof-card a { font-weight:900;color:#8b3fd0; }
  @media(max-width:1080px){
    .setup-progress small{display:none}
    .demo-shell{display:block}
    .demo-header{height:64px;position:sticky;top:0;z-index:5}
    .demo-sidebar{border:0;border-bottom:1px solid #e4dee8;padding:10px 16px;overflow:auto;position:sticky;top:64px;z-index:4}
    .demo-sidebar>div,.demo-sidebar .reset{display:none}
    .demo-sidebar nav{flex-direction:row;width:max-content}
    .demo-sidebar nav button{max-width:190px;padding:9px 12px;background:#f7f5f8;border:1px solid #ece7ef}
    .demo-sidebar nav button.active{box-shadow:inset 0 -3px #8b3fd0}
    .demo-main{padding:28px clamp(20px,4vw,40px)}
    .demo-grid{grid-template-columns:1fr 1fr}
  }
  @media(max-width:840px){
    .field-grid,.course-columns,.demo-grid{grid-template-columns:1fr}
    .demo-intro{align-items:start;flex-direction:column}
    .metrics{width:100%}
    .metrics span{flex:1;min-width:0}
    .demo-steps small{display:none}
    .situation-card,.next-card{min-height:330px}
  }
  @media(max-width:560px){.field-grid,.mini-grid{grid-template-columns:1fr}.segments{grid-template-columns:1fr}.actions.split{flex-direction:column-reverse}.actions.split button{width:100%}.course-results button{grid-template-columns:auto 1fr}.course-results small{grid-column:2}.setup-card{border-radius:20px;padding:24px 18px}.demo-header .compact{font-size:0}.demo-header .compact::after{content:'Sign up';font-size:13px}.demo-pill{display:none}.demo-main{padding:24px 16px}.demo-steps li{padding:9px 7px;gap:6px}.demo-steps b{width:22px;height:22px;flex-basis:22px}.demo-steps strong{font-size:10px}}
  @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style>
