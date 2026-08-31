<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import CourseMapReview from './CourseMapReview.svelte';
  import { clearDemoDraft, demoDraft, initializeDemoStore, patchDemoDraft, realDemoImport } from '../../lib/demo/store';
  import { DEMO_CATALOG_META, MCGILL_TERMS, demoCourseCatalog, manualProposal, proposalFromExtractedText } from '../../lib/demo/catalog';
  import type { CourseSetupProposal } from '../../lib/schemas/onboarding';
  import { trackDemoFunnelEvent } from '../../lib/analytics/demo';
  import { summarizeOnboardingReview } from '../../lib/analytics/onboarding';
  import { createCourseSearchIndex, searchCourseCatalog, type CourseSearchCourse } from '../../lib/courseSearch';

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
  let reviewBaseline = $state<CourseSetupProposal | null>(null);
  let manualCode = $state('');
  let manualTitle = $state('');
  let manualTopics = $state('');
  let parsing = $state(false);
  let loadingTemplate = $state(false);
  let acceptedHandoff = $state(false);
  let templateOptions = $state<CourseSearchCourse[]>(demoCourseCatalog);
  let searchingCatalog = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchRequest = 0;
  let searchController: AbortController | null = null;

  const importableCourses = $derived(draft.courses.filter((course) => course.source.kind !== 'simulated'));
  const courseSearchIndex = $derived(createCourseSearchIndex(templateOptions));
  const courseSearch = $derived(searchCourseCatalog(courseSearchIndex, query, 50));
  const filteredCourses = $derived(courseSearch.results);
  const termStart = $derived(university === 'Other' ? customStartsOn : MCGILL_TERMS[termIndex]?.starts_on ?? '');
  const termEnd = $derived(university === 'Other' ? customEndsOn : MCGILL_TERMS[termIndex]?.ends_on ?? '');

  function reviewReady() {
    if (!selectedCourse) return false;
    const includedBranches = selectedCourse.branches.filter((branch) => branch.included);
    const includedKcs = includedBranches.flatMap((branch) => branch.kcs.filter((kc) => kc.included));
    const validNames = includedBranches.every((branch) => branch.name.trim().length >= 2) && includedKcs.every((kc) => kc.name.trim().length >= 2);
    return includedKcs.length > 0 && validNames && selectedCourse.assessments.filter((assessment) => assessment.kind === 'official').every((assessment) => assessment.date_status !== 'unset');
  }

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

  onDestroy(() => {
    if (searchTimer) clearTimeout(searchTimer);
    searchController?.abort();
  });

  async function loadTemplateOptions(search = '') {
    const request = ++searchRequest;
    searchController?.abort();
    searchController = new AbortController();
    searchingCatalog = true;
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('q', search);
      const response = await fetch(`/api/v1/onboarding/templates?${params}`, { signal: searchController.signal });
      const payload = await response.json() as { data?: Array<Omit<CourseSearchCourse, 'slug'> & { template_id: string; credits: number | null; kc_count: number }> };
      if (request === searchRequest && response.ok && payload.data) {
        templateOptions = payload.data.map((course) => ({ ...course, slug: course.template_id, credits: course.credits ?? undefined }));
      }
    } catch (cause) {
      // The bundled lightweight catalog remains a resilient fallback.
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (request === searchRequest) templateOptions = demoCourseCatalog;
    } finally {
      if (request === searchRequest) searchingCatalog = false;
    }
  }

  function scheduleTemplateSearch(value: string) {
    if (searchTimer) clearTimeout(searchTimer);
    if (value.trim().length < 2) {
      searchRequest += 1;
      searchController?.abort();
      templateOptions = demoCourseCatalog;
      searchingCatalog = false;
      return;
    }
    searchingCatalog = true;
    searchTimer = setTimeout(() => void loadTemplateOptions(value), 250);
  }

  async function track(name: 'import_offered' | 'import_accepted' | 'import_declined' | 'onboarding_completed') {
    const current = demoDraft.get();
    await trackDemoFunnelEvent({ name, trial_session_id: current.draft_id }, '/onboarding');
  }

  async function sendImport(acceptedHandoff = false) {
    phase = 'saving';
    error = null;
    if (acceptedHandoff) void track('import_accepted');
    try {
      const response = await fetch('/api/v1/onboarding/import-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...realDemoImport(),
          review_metrics: summarizeOnboardingReview(reviewBaseline, selectedCourse),
        }),
      });
      const payload = await response.json() as { data?: { complete: boolean; course_slug: string | null }; error?: { message: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Could not import this setup.');
      if (!payload.data.complete || !payload.data.course_slug) {
        phase = 'setup';
        error = 'Your profile was imported, but one real course with at least one concept is still required.';
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
    reviewBaseline = null;
    acceptedHandoff = false;
    phase = 'setup';
  }

  async function loadTemplate(slug: string): Promise<CourseSetupProposal> {
    const response = await fetch(`/api/v1/onboarding/templates/${encodeURIComponent(slug)}`);
    const payload = await response.json() as { data?: CourseSetupProposal; error?: { message: string } };
    if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Could not load this reviewed course.');
    return payload.data;
  }

  async function chooseTemplate(slug: string) {
    loadingTemplate = true;
    status = 'Loading the reviewed course map…';
    try {
      selectedCourse = await loadTemplate(slug);
      reviewBaseline = structuredClone(selectedCourse);
      status = `${selectedCourse.branches.reduce((sum, branch) => sum + branch.kcs.length, 0)} concepts ready to review.`;
    } catch (cause) {
      selectedCourse = null;
      reviewBaseline = null;
      status = cause instanceof Error ? cause.message : 'Could not load this reviewed course.';
    } finally {
      loadingTemplate = false;
    }
  }

  async function beginImportReview() {
    error = null;
    acceptedHandoff = true;
    const context = draft.context;
    if (context) {
      university = context.institution_name === DEMO_CATALOG_META.institution ? 'McGill University' : 'Other';
      otherUniversity = university === 'Other' ? context.institution_name : '';
      program = context.program_name ?? '';
      const matchingTerm = MCGILL_TERMS.findIndex((term) => term.label === context.term_label && term.starts_on === context.starts_on);
      if (matchingTerm >= 0) termIndex = matchingTerm;
      else {
        university = 'Other';
        customTermLabel = context.term_label;
        customStartsOn = context.starts_on;
        customEndsOn = context.ends_on;
      }
    }
    const course = importableCourses[0];
    if (course?.template_id) await chooseTemplate(course.template_id);
    else selectedCourse = course ? structuredClone(course) : null;
    reviewBaseline = selectedCourse ? structuredClone(selectedCourse) : null;
    phase = 'setup';
  }

  function useManual() {
    const topics = manualTopics.split(/[\n,;]+/).map((topic) => topic.trim()).filter(Boolean);
    if (!manualCode.trim() || !manualTitle.trim() || topics.length === 0) {
      status = 'Enter a code, title, and at least one meaningful topic.';
      return;
    }
    selectedCourse = manualProposal(manualCode, manualTitle, topics);
    reviewBaseline = structuredClone(selectedCourse);
    status = `${topics.length} concepts ready to review.`;
  }

  function subjectLabel(course: CourseSearchCourse): string | null {
    return course.subject ?? course.department ?? course.subjects?.join(', ') ?? course.faculty ?? null;
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
      reviewBaseline = structuredClone(selectedCourse);
      status = `Suggested ${selectedCourse.branches[0].kcs.length} concepts from ${file.name}. Raw file data was not retained.`;
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
    await sendImport(acceptedHandoff);
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
        <div><dt>Courses</dt><dd>{importableCourses.length ? importableCourses.map((course) => `${course.course.code} (${course.branches.reduce((sum, branch) => sum + branch.kcs.length, 0)} concepts)`).join(', ') : 'No real course yet'}</dd></div>
      </dl>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="actions"><button class="primary" type="button" onclick={beginImportReview}>Review and import</button><button class="secondary" type="button" onclick={startFresh}>Start fresh</button><a href="/try/app/today">Back to demo</a></div>
    </section>
  {:else if phase === 'saving'}
    <section class="card import-card" aria-live="polite"><p class="eyebrow">Building your workspace</p><h1>Creating your course and knowledge map…</h1><p>This usually takes only a moment.</p></section>
  {:else}
    <section class="card">
      <p class="eyebrow">Build a useful workspace</p><h1>Start with one real course.</h1>
      <p>Your account opens only after that course has at least one reviewed concept.</p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="section"><b>1</b><div><h2>University and semester</h2><p>This keeps weeks, exams, and plans honest.</p></div><div class="fields"><label>University<select bind:value={university}><option>McGill University</option><option>Other</option></select></label>{#if university === 'Other'}<label>University name<input bind:value={otherUniversity} /></label>{/if}<label>Program<input bind:value={program} disabled={university === 'McGill University'} /></label>{#if university === 'Other'}<label>Semester name<input bind:value={customTermLabel} /></label><label>Starts<input type="date" bind:value={customStartsOn} /></label><label>Ends<input type="date" bind:value={customEndsOn} /></label>{:else}<label>Semester<select bind:value={termIndex}>{#each MCGILL_TERMS as term, index}<option value={index}>{term.label}</option>{/each}</select></label>{/if}</div></div>
      <div class="section"><b>2</b><div><h2>Capacity and guidance</h2><p>Constraints the planner can use—no learning-style labels.</p></div><div class="fields prefs"><label>Weekly capacity <strong>{weeklyHours} hours</strong><input type="range" min="2" max="15" bind:value={weeklyHours} /></label><label>Guidance<select bind:value={guidance}><option value="self_directed">Let me explore</option><option value="balanced">Balanced</option><option value="tell_me_next">Tell me what is next</option></select></label><label>Goal<select bind:value={depth}><option value="keep_up">Keep up</option><option value="understand">Understand</option><option value="master">Master deeply</option></select></label></div></div>
      <div class="section"><b>3</b><div><h2>Course and knowledge map</h2><p>Search McGill’s undergraduate and graduate catalog, enter topics, or extract suggestions locally.</p></div><div class="course-grid"><div>
        <label class="search-label" for="course-search">Search McGill courses</label>
        <input id="course-search" type="search" bind:value={query} placeholder="Code, title, subject, or concept" autocomplete="off" spellcheck="false" aria-controls="course-results" aria-describedby="course-search-count" oninput={(event) => scheduleTemplateSearch(event.currentTarget.value)} onkeydown={(event) => { if (event.key === 'Escape') { query = ''; scheduleTemplateSearch(''); } }} />
        <p id="course-search-count" class="search-count" aria-live="polite">{#if searchingCatalog}Searching McGill’s catalog…{:else if courseSearch.total === 0}No McGill courses match{courseSearch.query ? ` “${courseSearch.query}”` : ''}. Try a code, title, subject, or concept.{:else}{courseSearch.total}{courseSearch.total === 100 ? '+' : ''} matching {courseSearch.total === 1 ? 'course' : 'courses'}{#if courseSearch.truncated} · Showing the first {filteredCourses.length}{/if}{/if}</p>
        {#if courseSearch.total > 0}
          <ul id="course-results" class="results" aria-label="McGill courses" aria-busy={loadingTemplate || searchingCatalog}>
            {#each filteredCourses as course, index (course.slug)}
              <li>
                <button class:selected={selectedCourse?.template_id === course.slug} aria-pressed={selectedCourse?.template_id === course.slug} aria-posinset={index + 1} aria-setsize={courseSearch.total} disabled={loadingTemplate} type="button" onclick={() => chooseTemplate(course.slug)}>
                  <strong>{course.code}</strong><span>{course.title}{#if subjectLabel(course)}<small class="subject">{subjectLabel(course)}</small>{/if}</span><small>{course.kc_count} KCs</small>
                </button>
              </li>
            {/each}
          </ul>
        {:else if !loadingTemplate}
          <p class="empty-results" role="status">No course found. You can enter a course map manually or upload a syllabus.</p>
        {/if}
      </div><div><div class="manual"><input bind:value={manualCode} placeholder="Course code" /><input bind:value={manualTitle} placeholder="Course title" /></div><textarea bind:value={manualTopics} rows="4" placeholder="Topics, one per line"></textarea><button class="small" type="button" onclick={useManual}>Use manual map</button><label class="upload">{parsing ? 'Reading…' : 'Upload syllabus / lesson plan'}<input type="file" accept=".pdf,.docx,.txt,.md" onchange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void extractFile(file); }} /></label></div></div>{#if status}<p class="status" role="status">{status}</p>{/if}{#if selectedCourse}<CourseMapReview proposal={selectedCourse} {termStart} {termEnd} onchange={(proposal) => { selectedCourse = proposal; }} />{/if}</div>
      <div class="finish"><button class="primary" type="button" disabled={!reviewReady() || phase === 'saving' || loadingTemplate} onclick={finishFresh}>{phase === 'saving' ? 'Creating your workspace…' : 'Create course and enter studyus'}</button></div>
    </section>
  {/if}
</main>

<style>
  :global(body){font-family:'Nunito Variable',system-ui,sans-serif;background:radial-gradient(circle at 10% 10%,#f0ddff,transparent 30%),radial-gradient(circle at 90% 20%,#ddf7e8,transparent 27%),#faf8fd;color:#2d2734}.page{min-height:100dvh;padding:22px clamp(16px,4vw,48px) 70px}.page>header{max-width:1060px;margin:auto;display:flex;justify-content:space-between}.page>header p{font-size:12px;color:#756b7d}.wordmark{font:800 24px 'Fraunces Variable',serif;text-decoration:none;color:#2d2734}.wordmark span{color:#ee456d}.card{max-width:1060px;margin:clamp(42px,7vh,78px) auto 0;background:#fffffff0;border:1px solid #e2dce6;border-radius:28px;padding:clamp(24px,5vw,54px);box-shadow:0 28px 80px #3f2c4c1f}.import-card{max-width:700px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;font-weight:900;color:#833cc5}h1,h2{font-family:'Fraunces Variable',serif;margin:0;letter-spacing:-.025em}h1{font-size:clamp(38px,5vw,62px);line-height:1.04}.card>p,.section p{color:#716777}.import-card dl{display:grid;gap:7px;margin:25px 0}.import-card dl div{display:grid;grid-template-columns:120px 1fr;padding:11px;border-bottom:1px solid #ebe6ed}.import-card dt{font-size:12px;font-weight:900}.import-card dd{margin:0}.actions{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.actions a{color:#7c3cb6;font-weight:800}.primary,.secondary,.small{border-radius:999px;padding:12px 19px;border:1px solid transparent;font-weight:900;cursor:pointer}.primary{background:#ee456d;color:#fff}.primary:disabled{opacity:.45}.secondary,.small{background:#fff;border-color:#d9d1de;color:#55485e}.section{display:grid;grid-template-columns:38px 1fr;gap:8px 14px;padding:27px 0;border-top:1px solid #e9e4ec}.section>b{width:34px;height:34px;border-radius:11px;background:#f0e5fb;color:#7d38ba;display:grid;place-items:center}.section h2{font-size:25px}.section p{margin:5px 0 17px}.fields,.course-grid{grid-column:2;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.prefs{grid-template-columns:1.3fr 1fr 1fr}label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:900;color:#6e6475}.search-label{margin-bottom:-4px}input,select,textarea{width:100%;padding:11px;border:1px solid #d9d2de;border-radius:12px;background:#fff;font:inherit;box-sizing:border-box}input[type=range]{padding:0;accent-color:#8a42c8}.search-count{font-size:12px;margin:8px 0;color:#716777}.results{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;max-height:340px;overflow:auto;contain:content}.results li{margin:0}.results button{width:100%;display:grid;grid-template-columns:auto 1fr auto;gap:8px;text-align:left;border:1px solid #e1dbe5;background:#fff;border-radius:11px;padding:10px;cursor:pointer}.results button:disabled{cursor:wait}.results button.selected{border-color:#8a42c8;background:#f7f0fd}.results button span{min-width:0}.results button .subject{display:block;color:#716777;font-size:11px;font-weight:600;margin-top:2px}.empty-results{font-size:13px;color:#716777;border:1px dashed #c8b8d0;border-radius:11px;padding:12px;margin:8px 0}.manual{display:grid;grid-template-columns:1fr 1.5fr;gap:8px}.course-grid textarea{margin:8px 0}.upload{position:relative;text-align:center;padding:11px;border:1px dashed #a88cbd;border-radius:12px;margin-top:9px}.upload input{position:absolute;inset:0;opacity:0}.status,.error{grid-column:2;padding:11px;border-radius:11px;font-size:13px}.status{background:#ecf8f2;color:#246f55}.error{background:#ffe7ec;color:#982542}.review{grid-column:2;padding:15px;border-radius:14px;background:#f7f3f9}.review ul{columns:2}.finish{display:flex;justify-content:flex-end;margin-top:18px}@media(max-width:760px){.fields,.course-grid,.prefs{grid-template-columns:1fr}.review ul{columns:1}.card{border-radius:20px}.finish .primary{width:100%}}
</style>
