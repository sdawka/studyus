<script lang="ts">
  import { onMount } from 'svelte';
  import { clearDemoDraft, demoDraft, initializeDemoStore, patchDemoDraft, realDemoImport } from '../../lib/demo/store';
  import { DEMO_CATALOG_META, MCGILL_TERMS, demoCourseCatalog, manualProposal, proposalFromExtractedText, proposalFromTemplate } from '../../lib/demo/catalog';
  import type { CourseSetupProposal } from '../../lib/schemas/onboarding';

  let ready = $state(false);
  let phase = $state<'offer' | 'setup' | 'saving'>('setup');
  let error = $state<string | null>(null);
  let status = $state<string | null>(null);
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
  let query = $state('');
  let selectedCourse = $state<CourseSetupProposal | null>(null);
  let manualCode = $state('');
  let manualTitle = $state('');
  let manualTopics = $state('');
  let parsing = $state(false);

  const importableCourses = $derived(draft.courses.filter((course) => course.source.kind !== 'simulated'));
  const filteredCourses = $derived(demoCourseCatalog.filter((course) => `${course.code} ${course.title}`.toLowerCase().includes(query.toLowerCase())).slice(0, 7));

  onMount(() => {
    const loaded = initializeDemoStore();
    weeklyHours = loaded.preferences.weekly_hours;
    guidance = loaded.preferences.guidance;
    depth = loaded.preferences.depth;
    const requestedImport = new URLSearchParams(location.search).get('import') === 'demo';
    phase = requestedImport && Boolean(loaded.context || loaded.courses.some((course) => course.source.kind !== 'simulated')) ? 'offer' : 'setup';
    if (phase === 'offer') void track('import_offered');
    ready = true;
  });

  async function track(name: 'import_offered' | 'import_accepted' | 'import_declined' | 'onboarding_completed') {
    const current = demoDraft.get();
    try {
      await fetch('/api/public/demo-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [{ session_id: current.draft_id, event_id: crypto.randomUUID(), name, occurred_at: Date.now() }] }),
        keepalive: true,
      });
    } catch {
      // Onboarding never waits on telemetry.
    }
  }

  async function sendImport(acceptedHandoff = false) {
    phase = 'saving';
    error = null;
    if (acceptedHandoff) void track('import_accepted');
    try {
      const response = await fetch('/api/v1/onboarding/import-demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(realDemoImport()) });
      const payload = await response.json() as { data?: { complete: boolean; course_slug: string | null }; error?: { message: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Could not import this setup.');
      if (!payload.data.complete || !payload.data.course_slug) {
        phase = 'setup';
        error = 'Your profile was imported, but one real course with at least one knowledge component is still required.';
        return;
      }
      void track('onboarding_completed');
      clearDemoDraft();
      window.location.href = `/courses/${payload.data.course_slug}`;
    } catch (cause) {
      phase = 'setup';
      error = cause instanceof Error ? cause.message : 'Could not finish onboarding.';
    }
  }

  function startFresh() {
    void track('import_declined');
    clearDemoDraft();
    selectedCourse = null;
    phase = 'setup';
  }

  function chooseTemplate(slug: string) {
    selectedCourse = proposalFromTemplate(slug, false);
    status = selectedCourse ? `${selectedCourse.branches.reduce((sum, branch) => sum + branch.kcs.length, 0)} KCs ready to review.` : null;
  }

  function useManual() {
    const topics = manualTopics.split(/[\n,;]+/).map((topic) => topic.trim()).filter(Boolean);
    if (!manualCode.trim() || !manualTitle.trim() || topics.length === 0) {
      status = 'Enter a code, title, and at least one meaningful topic.';
      return;
    }
    selectedCourse = manualProposal(manualCode, manualTitle, topics);
    status = `${topics.length} KCs ready to review.`;
  }

  async function extractFile(file: File) {
    parsing = true;
    status = null;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Keep onboarding files under 10 MB.');
      const extension = file.name.split('.').pop()?.toLowerCase();
      let text = '';
      if (extension === 'txt' || extension === 'md') text = await file.text();
      else if (extension === 'docx') text = (await (await import('mammoth/mammoth.browser')).extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
      else if (extension === 'pdf') {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 30); pageNumber += 1) {
          const content = await (await pdf.getPage(pageNumber)).getTextContent();
          pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }
        text = pages.join('\n');
      } else throw new Error('Use PDF, DOCX, text, or Markdown.');
      selectedCourse = proposalFromExtractedText(file.name, text);
      status = `Suggested ${selectedCourse.branches[0].kcs.length} KCs from ${file.name}. Raw file data was not retained.`;
    } catch (cause) {
      status = cause instanceof Error ? cause.message : 'Could not extract this file. Use manual entry instead.';
    } finally { parsing = false; }
  }

  async function finishFresh() {
    if (!selectedCourse) { error = 'Choose, enter, or upload one course first.'; return; }
    const term = MCGILL_TERMS[termIndex];
    const customTerm = university === 'Other';
    if (customTerm && customEndsOn < customStartsOn) { error = 'Semester end must be on or after its start.'; return; }
    const saved = patchDemoDraft({
      context: {
        institution_name: university === 'Other' ? (otherUniversity.trim() || 'Other institution') : DEMO_CATALOG_META.institution,
        ...(program.trim() ? { program_name: program.trim() } : {}),
        term_label: customTerm ? (customTermLabel.trim() || 'Current semester') : term.label,
        starts_on: customTerm ? customStartsOn : term.starts_on,
        ends_on: customTerm ? customEndsOn : term.ends_on,
        timezone: term.timezone,
      },
      preferences: { weekly_hours: weeklyHours, guidance, depth },
      courses: [selectedCourse], simulated: false,
    });
    if (!saved) { error = 'Your browser could not save the setup draft.'; return; }
    await sendImport();
  }
</script>

<main class="page">
  <header><a href="/" class="wordmark">studyus<span>.</span></a><p>Real onboarding · private account</p></header>
  {#if !ready}
    <section class="card"><p>Loading your setup…</p></section>
  {:else if phase === 'offer'}
    <section class="card import-card">
      <p class="eyebrow">Your preview is still here</p><h1>Bring this setup with you?</h1>
      <p>Only genuine setup is imported. Demo mastery, grades, scenarios, and tasks are discarded.</p>
      <dl>
        <div><dt>Institution</dt><dd>{draft.context?.institution_name ?? 'Not provided'}</dd></div>
        <div><dt>Semester</dt><dd>{draft.context?.term_label ?? 'Not provided'}</dd></div>
        <div><dt>Preferences</dt><dd>{draft.preferences.weekly_hours} h/week · {draft.preferences.guidance.replaceAll('_', ' ')}</dd></div>
        <div><dt>Courses</dt><dd>{importableCourses.length ? importableCourses.map((course) => `${course.course.code} (${course.branches.reduce((sum, branch) => sum + branch.kcs.length, 0)} KCs)`).join(', ') : 'No real course yet'}</dd></div>
      </dl>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions"><button class="primary" type="button" onclick={() => sendImport(true)}>Import this setup</button><button class="secondary" type="button" onclick={startFresh}>Start fresh</button><a href="/try/app/today">Back to demo</a></div>
    </section>
  {:else if phase === 'saving'}
    <section class="card import-card" aria-live="polite"><p class="eyebrow">Building your workspace</p><h1>Creating your course and knowledge map…</h1><p>This usually takes only a moment.</p></section>
  {:else}
    <section class="card">
      <p class="eyebrow">Build a useful workspace</p><h1>Start with one real course.</h1>
      <p>Your account opens only after that course has at least one reviewed knowledge component.</p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="section"><b>1</b><div><h2>University and semester</h2><p>This keeps weeks, exams, and plans honest.</p></div><div class="fields"><label>University<select bind:value={university}><option>McGill University</option><option>Other</option></select></label>{#if university === 'Other'}<label>University name<input bind:value={otherUniversity} /></label>{/if}<label>Program<input bind:value={program} disabled={university === 'McGill University'} /></label>{#if university === 'Other'}<label>Semester name<input bind:value={customTermLabel} /></label><label>Starts<input type="date" bind:value={customStartsOn} /></label><label>Ends<input type="date" bind:value={customEndsOn} /></label>{:else}<label>Semester<select bind:value={termIndex}>{#each MCGILL_TERMS as term, index}<option value={index}>{term.label}</option>{/each}</select></label>{/if}</div></div>
      <div class="section"><b>2</b><div><h2>Capacity and guidance</h2><p>Constraints the planner can use—no learning-style labels.</p></div><div class="fields prefs"><label>Weekly capacity <strong>{weeklyHours} hours</strong><input type="range" min="2" max="15" bind:value={weeklyHours} /></label><label>Guidance<select bind:value={guidance}><option value="self_directed">Let me explore</option><option value="balanced">Balanced</option><option value="tell_me_next">Tell me what is next</option></select></label><label>Goal<select bind:value={depth}><option value="keep_up">Keep up</option><option value="understand">Understand</option><option value="master">Master deeply</option></select></label></div></div>
      <div class="section"><b>3</b><div><h2>Course and knowledge map</h2><p>Choose a reviewed template, enter topics, or extract suggestions locally.</p></div><div class="course-grid"><div><input bind:value={query} placeholder="Search McGill course" /><div class="results">{#each filteredCourses as course}<button class:selected={selectedCourse?.template_id === course.slug} type="button" onclick={() => chooseTemplate(course.slug)}><strong>{course.code}</strong><span>{course.title}</span><small>{course.kc_count} KCs</small></button>{/each}</div></div><div><div class="manual"><input bind:value={manualCode} placeholder="Course code" /><input bind:value={manualTitle} placeholder="Course title" /></div><textarea bind:value={manualTopics} rows="4" placeholder="Topics, one per line"></textarea><button class="small" type="button" onclick={useManual}>Use manual map</button><label class="upload">{parsing ? 'Reading…' : 'Upload syllabus / lesson plan'}<input type="file" accept=".pdf,.docx,.txt,.md" onchange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void extractFile(file); }} /></label></div></div>{#if status}<p class="status" role="status">{status}</p>{/if}{#if selectedCourse}<div class="review"><strong>{selectedCourse.course.code} · {selectedCourse.course.title}</strong>{#each selectedCourse.branches as branch}<div><span>{branch.name}</span><ul>{#each branch.kcs.slice(0, 8) as kc}<li>{kc.name}</li>{/each}</ul></div>{/each}</div>{/if}</div>
      <div class="finish"><button class="primary" type="button" disabled={!selectedCourse || phase === 'saving'} onclick={finishFresh}>{phase === 'saving' ? 'Creating your workspace…' : 'Create course and enter studyus'}</button></div>
    </section>
  {/if}
</main>

<style>
  :global(body){font-family:'Nunito Variable',system-ui,sans-serif;background:radial-gradient(circle at 10% 10%,#f0ddff,transparent 30%),radial-gradient(circle at 90% 20%,#ddf7e8,transparent 27%),#faf8fd;color:#2d2734}.page{min-height:100dvh;padding:22px clamp(16px,4vw,48px) 70px}.page>header{max-width:1060px;margin:auto;display:flex;justify-content:space-between}.page>header p{font-size:12px;color:#756b7d}.wordmark{font:800 24px 'Fraunces Variable',serif;text-decoration:none;color:#2d2734}.wordmark span{color:#ee456d}.card{max-width:1060px;margin:clamp(42px,7vh,78px) auto 0;background:#fffffff0;border:1px solid #e2dce6;border-radius:28px;padding:clamp(24px,5vw,54px);box-shadow:0 28px 80px #3f2c4c1f}.import-card{max-width:700px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:900;color:#833cc5}h1,h2{font-family:'Fraunces Variable',serif;margin:0;letter-spacing:-.025em}h1{font-size:clamp(38px,5vw,62px);line-height:1.04}.card>p,.section p{color:#716777}.import-card dl{display:grid;gap:7px;margin:25px 0}.import-card dl div{display:grid;grid-template-columns:120px 1fr;padding:11px;border-bottom:1px solid #ebe6ed}.import-card dt{font-size:12px;font-weight:900}.import-card dd{margin:0}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.actions a{color:#7c3cb6;font-weight:800}.primary,.secondary,.small{border-radius:999px;padding:12px 19px;border:1px solid transparent;font-weight:900;cursor:pointer}.primary{background:#ee456d;color:#fff}.primary:disabled{opacity:.45}.secondary,.small{background:#fff;border-color:#d9d1de;color:#55485e}.section{display:grid;grid-template-columns:38px 1fr;gap:8px 14px;padding:27px 0;border-top:1px solid #e9e4ec}.section>b{width:34px;height:34px;border-radius:11px;background:#f0e5fb;color:#7d38ba;display:grid;place-items:center}.section h2{font-size:25px}.section p{margin:5px 0 17px}.fields,.course-grid{grid-column:2;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.prefs{grid-template-columns:1.3fr 1fr 1fr}label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:900;color:#6e6475}input,select,textarea{width:100%;padding:11px;border:1px solid #d9d2de;border-radius:12px;background:#fff;font:inherit;box-sizing:border-box}input[type=range]{padding:0;accent-color:#8a42c8}.results{display:flex;flex-direction:column;gap:6px;margin-top:8px;max-height:280px;overflow:auto}.results button{display:grid;grid-template-columns:auto 1fr auto;gap:8px;text-align:left;border:1px solid #e1dbe5;background:#fff;border-radius:11px;padding:10px}.results button.selected{border-color:#8a42c8;background:#f7f0fd}.manual{display:grid;grid-template-columns:1fr 1.5fr;gap:8px}.course-grid textarea{margin:8px 0}.upload{position:relative;text-align:center;padding:11px;border:1px dashed #a88cbd;border-radius:12px;margin-top:9px}.upload input{position:absolute;inset:0;opacity:0}.status,.error{grid-column:2;padding:11px;border-radius:11px;font-size:13px}.status{background:#ecf8f2;color:#246f55}.error{background:#ffe7ec;color:#982542}.review{grid-column:2;padding:15px;border-radius:14px;background:#f7f3f9}.review ul{columns:2}.finish{display:flex;justify-content:flex-end;margin-top:18px}@media(max-width:760px){.fields,.course-grid,.prefs{grid-template-columns:1fr}.review ul{columns:1}.card{border-radius:20px}.finish .primary{width:100%}}
</style>
