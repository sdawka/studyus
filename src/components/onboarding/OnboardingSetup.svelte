<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { CourseDraftV2 } from '../../lib/schemas/courseDraft';
  import { freshDemoDraft, loadDemoDraft } from '../../lib/demo/store';
  import CourseMapReview from './CourseMapReview.svelte';

  const MODULES = ['What proves you’ve actually learned it?', 'How do you get it back when you need it?', 'What is the struggle actually telling you?', 'What kind of help actually helps?', 'How do you fix what isn’t working?'];
  let step = $state(1);
  let draftId = $state('00000000-0000-4000-8000-000000000000');
  let topic = $state(''); let level = $state(''); let outcome = $state('');
  let courseDraft = $state<CourseDraftV2 | null>(null);
  let pending = $state<'skip' | 'finish' | null>(null);
  let redirecting = $state(false);
  let error = $state<string | null>(null);
  let commitError = $state<string | null>(null);
  let institution = $state(''); let program = $state(''); let termName = $state('');
  let startsOn = $state(''); let endsOn = $state(''); let timezone = $state('UTC');
  let termOpen = $state(false);
  let fromDemo = $state(false);
  let demoBannerDismissed = $state(false);
  let demoHasRealCourse = $state(false);
  let demoPreferences = $state<{ weekly_hours: number; guidance: string; depth: string } | null>(null);
  let headingEl = $state<HTMLHeadingElement | null>(null);

  const busy = $derived(pending !== null);

  const statusText = $derived(
    pending === 'skip'
      ? (redirecting ? 'Done. Opening Learning How to Learn…' : 'Marking setup done and opening Learning How to Learn. Anything typed here is not saved.')
      : pending === 'finish'
        ? (redirecting
            ? `Done. Opening ${courseDraft?.spec.title || 'your course'}…`
            : 'Creating your course and marking setup done. This usually takes a moment.')
        : '',
  );

  onMount(() => {
    // Back from the new course can restore this page from the back-forward
    // cache with its Svelte state intact; do not leave it disabled forever.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) { pending = null; redirecting = false; commitError = null; }
    };
    window.addEventListener('pageshow', onPageShow);
    draftId = crypto.randomUUID();
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const params = new URLSearchParams(location.search);
    if (params.get('import') === 'demo') {
      fromDemo = true;
      try {
        const draft = loadDemoDraft();
        demoHasRealCourse = draft.courses.some((c) => c.source.kind !== 'simulated');
        demoPreferences = draft.preferences;
      } catch {
        // A missing or corrupt trial draft is not an error here; the banner
        // falls back to the "nothing carries over" copy.
      }
    }
    return () => window.removeEventListener('pageshow', onPageShow);
  });

  function focusHeading() {
    void tick().then(() => headingEl?.focus());
  }

  const localId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

  // Thrown for anything we already have learner-facing copy for (term
  // validation, mapped HTTP statuses, server-supplied messages). Anything
  // else that reaches the catch block (a raw network failure, a JSON parse
  // error) is not learner-facing text and falls back to the generic message.
  class OnboardingError extends Error {}

  type ImportResponse = { data?: { course_slug: string | null }; error?: { message: string } };

  function makeDraft(): CourseDraftV2 | null {
    if (!topic.trim() || !level.trim() || !outcome.trim()) return null;
    const outcomeId = localId('outcome'); const kcId = localId('kc'); const experienceId = localId('experience');
    return {
      schema_version: 2,
      spec: { title: topic.trim(), topic: topic.trim(), level: level.trim(), constraints: [] },
      outcomes: [{ id: outcomeId, title: outcome.trim(), kc_ids: [kcId] }],
      kcs: [{ id: kcId, name: outcome.trim(), kc_form: 'variable_constant', rationale_level: 2, mastery_rule: { threshold: 0.8, minimum_evidence: 2 }, prerequisite_kc_ids: [] }],
      examples: [{ id: localId('example'), kc_ids: [kcId], content: { schema_version: 1, kind: 'text', body: `A concrete example of ${topic.trim()}.` } }],
      misconceptions: [],
      experiences: [{ id: experienceId, kind: 'exercise', target_kc_ids: [kcId], intended_processes: ['understanding_sensemaking'], evidence: { response_type: 'constructed_response', target_kc_ids: [kcId], diagnostic_misconception_ids: [] }, content: { schema_version: 1, kind: 'worked', prompt: `Explain or demonstrate: ${outcome.trim()}`, solution: 'A strong response shows you can do this on a case you have not seen before.' } }],
      references: [],
      modules: [{ id: localId('module'), title: outcome.trim(), outcome_ids: [outcomeId], kc_ids: [kcId], experience_ids: [experienceId], sort_order: 0 }],
    };
  }

  function shapeCourse() {
    if (!topic.trim() || !level.trim() || !outcome.trim()) {
      error = 'Add a topic, a level, and one learning outcome, then shape the course.';
      return;
    }
    if (courseDraft) {
      // Re-shaping after Back must keep every step 2 edit ("Your edits stay
      // if you go back"): update the fields that came from step 1 in place
      // and leave the rest of the structure alone.
      const previousOutcome = courseDraft.outcomes[0]?.title;
      const nextOutcome = outcome.trim();
      courseDraft.spec.title = topic.trim();
      courseDraft.spec.topic = topic.trim();
      courseDraft.spec.level = level.trim();
      if (courseDraft.outcomes[0]) courseDraft.outcomes[0].title = nextOutcome;
      if (courseDraft.kcs[0] && courseDraft.kcs[0].name === previousOutcome) courseDraft.kcs[0].name = nextOutcome;
      if (courseDraft.modules[0] && courseDraft.modules[0].title === previousOutcome) courseDraft.modules[0].title = nextOutcome;
    } else {
      courseDraft = makeDraft();
    }
    error = null; step = 2;
    focusHeading();
  }

  type TermState = 'none' | 'incomplete' | 'invalid-dates' | 'complete';
  // Single source of truth for the review summary and for Finish, so the
  // summary never claims something Finish will then reject.
  const termState = $derived.by((): TermState => {
    if (![institution, program, termName, startsOn, endsOn].some((value) => value.trim())) return 'none';
    if (!institution.trim() || !termName.trim() || !startsOn || !endsOn) return 'incomplete';
    if (endsOn < startsOn) return 'invalid-dates';
    return 'complete';
  });

  function goToStep(next: 1 | 2 | 3) {
    step = next;
    error = null;
    commitError = null;
    focusHeading();
  }

  function context() {
    if (termState === 'none') return undefined;
    if (termState === 'incomplete') {
      termOpen = true;
      throw new OnboardingError('To save a term, fill in the institution, term name, and both dates. Or clear these fields to leave the term out.');
    }
    if (termState === 'invalid-dates') {
      termOpen = true;
      throw new OnboardingError('The term end date must be on or after its start date.');
    }
    return { institution_name: institution.trim(), ...(program.trim() ? { program_name: program.trim() } : {}), term_label: termName.trim(), starts_on: startsOn, ends_on: endsOn, timezone };
  }

  async function commit(course?: CourseDraftV2) {
    pending = course ? 'finish' : 'skip';
    commitError = null;
    // The client cannot know whether the server's batch committed before a
    // lost response, so never claim "nothing was saved".
    const fallback = course
      ? 'We could not confirm that the course saved. Reload the page: if it exists it will open, otherwise try again.'
      : 'We could not confirm that this saved. Reload the page: if your course exists it will open, otherwise try again.';
    try {
      // Skip is intentionally lossy for optional scratch fields. Only Finish
      // validates and submits academic context.
      const academic = course ? context() : undefined;
      const preferences = demoPreferences ?? freshDemoDraft().preferences;
      const response = await fetch('/api/v1/onboarding/import-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema_version: 1,
          draft_id: draftId,
          preferences,
          courses: [],
          ...(academic ? { context: academic } : {}),
          ...(course ? { course } : {}),
          review_metrics: { renamed: 0, reordered: 0, excluded: 0 },
        }),
      });
      const payload: ImportResponse = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Map by status, not by echoing raw server text: a bare "Authentication
        // required", a joined Zod issue list, or an opaque 500 is not
        // learner-facing copy.
        if (response.status === 401) {
          throw new OnboardingError('Your session ended. Sign in again to finish setup.');
        }
        if (response.status === 400) {
          throw new OnboardingError('Some fields are empty or invalid. Check that every outcome, idea, example, and practice prompt has text, then try again.');
        }
        if (response.status >= 500) {
          throw new OnboardingError(fallback);
        }
        throw new OnboardingError(payload.error?.message ?? fallback);
      }
      redirecting = true;
      // An idempotent replay whose earlier import has no course returns 200
      // with a null slug: setup is complete, so land on the dashboard.
      window.location.href = payload.data?.course_slug ? `/courses/${payload.data.course_slug}` : '/dashboard';
      // A blocked or cancelled navigation (e.g. popup blocker, test harness,
      // back-forward cache) should not leave every control disabled forever.
      setTimeout(() => { pending = null; redirecting = false; }, 8000);
    } catch (cause) {
      commitError = cause instanceof OnboardingError ? cause.message : fallback;
      pending = null;
    }
  }
</script>

<main class="page">
  <header>
    <a href="/" class="wordmark" aria-label="studyus home">studyus<span>.</span></a>
    <button type="button" class="rd-btn-text" disabled={busy} onclick={() => commit()} aria-describedby={step !== 1 ? 'skip-note' : undefined}>
      {pending === 'skip' ? 'Opening Learning How to Learn…' : 'Skip to Learning How to Learn'}
    </button>
  </header>
  <section class="shell" aria-busy={busy}>
    {#if step === 2 || step === 3}
      <ol class="steps" aria-label="New course: two steps">
        <li aria-current={step === 2 ? 'step' : undefined} class:done={step === 3}>
          <span class="visually-hidden">Step 1 of 2: </span>Shape
        </li>
        <li aria-current={step === 3 ? 'step' : undefined}>
          <span class="visually-hidden">Step 2 of 2: </span>Review
        </li>
      </ol>
      <p id="skip-note" class="visually-hidden">Skipping leaves this draft behind. You can create a course later from Add course.</p>
    {/if}
    <p role="status" class="status-region">{statusText}</p>

    {#if fromDemo && !demoBannerDismissed}
      <div class="demo-banner" role="region" aria-label="About your trial">
        <p class="kicker">You came from the trial</p>
        {#if demoHasRealCourse}
          <p>Your trial notes are still in this browser for up to seven days, but studyus cannot bring them into your account yet. Shape a course below to recreate it, or open Learning How to Learn first. Trial practice and scores were never saved and are not copied.</p>
        {:else}
          <p>Trial practice and scores stay in the browser and are not copied to your account. Your account starts fresh with Learning How to Learn.</p>
        {/if}
        <button type="button" class="rd-btn rd-btn-ghost" onclick={() => { demoBannerDismissed = true; }}>Got it</button>
      </div>
    {/if}

    {#if step === 1}
      <p class="kicker">Your first course is ready</p>
      <h1 tabindex="-1" bind:this={headingEl}>Learning How to Learn</h1>
      <p class="lede">A short course on how learning actually works. Open it now, or shape a course around anything else you want to learn. Nothing is locked in; both stay editable.</p>
      <p class="module-preview-heading">Five short modules</p>
      <ol class="module-preview" aria-label="Modules in Learning How to Learn">{#each MODULES as module}<li>{module}</li>{/each}</ol>
      <button type="button" class="rd-btn rd-btn-primary open-course" disabled={busy} onclick={() => commit()}>
        {pending === 'skip' ? 'Opening Learning How to Learn…' : 'Open Learning How to Learn'}
      </button>
      {#if commitError}<p class="error" role="alert">{commitError}</p>{/if}

      <div class="authoring-start">
        <h2>Shape a course of your own <span>optional</span></h2>
        <p class="section-helper">Give it a topic, a level, and one thing you want to be able to do. You will review the structure before anything is created.</p>
        <div class="fields">
          <div class="field-group">
            <label for="topic-input">Topic</label>
            <input id="topic-input" bind:value={topic} placeholder="Documentary filmmaking" aria-describedby="topic-helper" disabled={busy} />
            <p id="topic-helper" class="field-helper">What the course is about.</p>
          </div>

          <div class="field-group">
            <label for="level-input">Level</label>
            <input id="level-input" bind:value={level} placeholder="Complete beginner" aria-describedby="level-helper" disabled={busy} />
            <p id="level-helper" class="field-helper">Where you are starting from.</p>
          </div>

          <div class="field-group wide">
            <label for="outcome-input">Learning outcome</label>
            <input id="outcome-input" bind:value={outcome} placeholder="Plan and shoot a short documentary" aria-describedby="outcome-helper" disabled={busy} />
            <p id="outcome-helper" class="field-helper">One thing you want to be able to do by the end.</p>
          </div>
        </div>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <button type="button" class="rd-btn rd-btn-ghost" disabled={busy} onclick={shapeCourse}>Shape course</button>
        <p class="section-helper term-pointer">Studying for a class with a term and dates? You can add that while shaping the course.</p>
      </div>
    {:else if step === 2 && courseDraft}
      <p class="kicker">Step 1 of 2 · Shape</p>
      <h1 tabindex="-1" bind:this={headingEl}>{courseDraft.spec.title}</h1>
      <p class="lede">studyus turned your topic, level, and outcome into a starting structure. Edit anything here, or leave it as it is and review. Nothing is created until you finish.</p>
      <CourseMapReview draft={courseDraft} onchange={(next) => { courseDraft = next; }} />
      {@render academicContext()}
      {#if commitError}<p class="error" role="alert">{commitError}</p>{/if}
      <div class="actions">
        <button type="button" class="rd-btn rd-btn-ghost" disabled={busy} onclick={() => goToStep(1)}>Back</button>
        <button type="button" class="rd-btn rd-btn-primary" disabled={busy} onclick={() => goToStep(3)}>Review and finish</button>
      </div>
      <p class="section-helper">Your edits stay if you go back.</p>
    {:else if step === 3 && courseDraft}
      <p class="kicker">Step 2 of 2 · Review</p>
      <h1 tabindex="-1" bind:this={headingEl}>{courseDraft.spec.title}</h1>
      <p class="lede">Here is what will be created when you finish.</p>
      <dl aria-label="Course summary">
        <div><dt>Topic</dt><dd>{courseDraft.spec.topic}</dd></div>
        <div><dt>Level</dt><dd>{courseDraft.spec.level}</dd></div>
        <div><dt>Outcomes</dt><dd>{courseDraft.outcomes.length}</dd></div>
        <div><dt>Ideas and skills</dt><dd>{courseDraft.kcs.length}</dd></div>
        <div>
          <dt>Term</dt>
          {#if termState === 'complete'}
            <dd>{termName} at {institution}, {startsOn} to {endsOn}</dd>
          {:else if termState === 'incomplete'}
            <dd class="dd-warning">Incomplete. Fill in institution, term name, and both dates, or clear them to skip.</dd>
          {:else if termState === 'invalid-dates'}
            <dd class="dd-warning">Term end must be on or after its start.</dd>
          {:else}
            <dd>None. This course is not tied to a term.</dd>
          {/if}
        </div>
      </dl>
      <p class="section-helper">
        Finishing creates this course in your account and opens it. Learning How to Learn stays in your account too.
        {#if termState === 'complete'} Your institution and term are saved to your account as well.{/if}
      </p>
      {@render academicContext()}
      {#if commitError}<p class="error" role="alert">{commitError}</p>{/if}
      <div class="actions">
        <button type="button" class="rd-btn rd-btn-ghost" disabled={busy} onclick={() => goToStep(2)}>Back</button>
        <button type="button" class="rd-btn rd-btn-primary" disabled={busy} onclick={() => commit(courseDraft)}>
          {pending === 'finish' ? `Creating ${courseDraft.spec.title || 'your course'}…` : 'Finish and open course'}
        </button>
      </div>
    {/if}
  </section>
</main>

{#snippet academicContext()}
  <details class="academic" bind:open={termOpen}>
    <summary>Add a term and institution <span>optional</span></summary>
    <p>Only for a course tied to a class or formal schedule. Saved with the course when you finish; skipping leaves it out.</p>
    <div class="fields">
      <div class="field-group">
        <label for="institution-input">Institution</label>
        <input id="institution-input" bind:value={institution} disabled={busy} />
      </div>

      <div class="field-group">
        <label for="program-input">Program</label>
        <input id="program-input" bind:value={program} aria-describedby="program-helper" disabled={busy} />
        <p id="program-helper" class="field-helper">Optional.</p>
      </div>

      <div class="field-group">
        <label for="term-name-input">Term name</label>
        <input id="term-name-input" bind:value={termName} placeholder="Fall 2026" disabled={busy} />
      </div>

      <div class="field-group">
        <label for="timezone-input">Time zone</label>
        <input id="timezone-input" bind:value={timezone} aria-describedby="timezone-helper" disabled={busy} />
        <p id="timezone-helper" class="field-helper">Detected from your device. Change it only if it is wrong.</p>
      </div>

      <div class="field-group">
        <label for="starts-input">Term starts</label>
        <input id="starts-input" type="date" bind:value={startsOn} disabled={busy} />
      </div>

      <div class="field-group">
        <label for="ends-input">Term ends</label>
        <input id="ends-input" type="date" bind:value={endsOn} disabled={busy} />
      </div>
    </div>
  </details>
{/snippet}

<style>
  :global(body) {
    font-family: var(--rd-body);
    background: var(--rd-cream);
    color: var(--rd-ink);
  }
  /* var(--rd-ink-faint) alone is 4.00:1 on white, below AA; this darker step
     (oklch 57% vs the token's 60%) reaches 4.53:1 while staying in the same
     ink-purple family. Every 12-13px faint label on this page uses it. */
  .page { --ob-ink-faint-aa: oklch(57% 0.04 305); }
  .page { min-height: 100dvh; padding: 22px clamp(16px, 4vw, 48px) 70px; }
  .page > header {
    max-width: 920px;
    margin: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .wordmark {
    font: 800 24px var(--rd-display);
    text-decoration: none;
    color: var(--rd-ink);
  }
  .wordmark span { color: var(--rd-accent-deep); }
  .rd-btn-text {
    border: 0;
    background: none;
    color: var(--rd-grape);
    text-decoration: underline;
    font-weight: 900;
    padding: 12px;
    min-height: 44px;
    cursor: pointer;
  }
  .rd-btn-text:hover { color: var(--rd-accent-deep); }
  .rd-btn-text:disabled { opacity: 0.6; cursor: not-allowed; }

  .shell {
    max-width: 920px;
    margin: clamp(34px, 6vh, 64px) auto 0;
    /* Opaque: the body behind is flat --rd-cream, so .rd-card's translucent
       white + backdrop blur would cost a page-tall compositor layer for no
       visible difference. This is that blend precomputed. */
    background: oklch(99% 0.008 85);
    border: 1.5px solid oklch(52% 0.06 305 / 0.14);
    border-radius: var(--rd-r-lg);
    box-shadow: var(--rd-shadow-card);
    padding: clamp(24px, 5vw, 48px);
  }

  .steps {
    display: flex;
    gap: 24px;
    list-style: none;
    border-bottom: 1px solid oklch(52% 0.06 305 / 0.14);
    padding: 0 0 12px;
    margin: 0 0 30px;
    color: var(--rd-ink-faint);
    font-size: 13px;
  }
  .steps li { color: var(--ob-ink-faint-aa); }
  .steps li[aria-current='step'] { color: var(--rd-grape); font-weight: 900; }
  .steps li.done::before { content: '✓ '; }

  .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .status-region:empty { display: none; }
  .status-region {
    font-size: 13px;
    font-weight: 800;
    color: var(--rd-grape);
    margin: 0 0 16px;
  }

  .demo-banner {
    background: oklch(58% 0.19 300 / 0.08);
    border: 1.5px solid oklch(58% 0.19 300 / 0.18);
    border-radius: var(--rd-r-md);
    padding: 16px 20px;
    margin: 0 0 24px;
    display: grid;
    gap: 8px;
  }
  .demo-banner p:not(.kicker) { margin: 0; overflow-wrap: anywhere; }
  .demo-banner .rd-btn { justify-self: start; margin-top: 0; }

  .kicker { color: var(--rd-grape); font-size: 13px; font-weight: 900; margin: 0 0 7px; }
  h1, h2 { font-family: var(--rd-display); }
  h1 {
    font-size: clamp(30px, 5vw, 58px);
    line-height: 1.02;
    margin: 0;
    letter-spacing: -0.02em;
    overflow-wrap: anywhere;
  }
  h1:focus-visible { outline: none; }
  .lede { max-width: 660px; color: var(--rd-ink-soft); font-size: 18px; overflow-wrap: anywhere; }

  .module-preview-heading {
    font-size: 12px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ob-ink-faint-aa);
    margin: 28px 0 0;
  }
  .module-preview {
    margin: 8px 0 24px;
    padding: 0;
    list-style: none;
    border-top: 1px solid oklch(52% 0.06 305 / 0.14);
  }
  .module-preview li {
    padding: 11px 0;
    border-bottom: 1px solid oklch(52% 0.06 305 / 0.14);
    font: 700 clamp(17px, 2.2vw, 22px) var(--rd-display);
    overflow-wrap: anywhere;
  }

  .open-course { display: inline-flex; }

  .authoring-start { margin-top: 32px; padding-top: 24px; border-top: 1px solid oklch(52% 0.06 305 / 0.14); }
  .authoring-start h2 { margin: 0 0 8px; }
  .authoring-start h2 span, .academic summary span {
    font: 700 12px var(--rd-body);
    color: var(--ob-ink-faint-aa);
  }
  .section-helper { color: var(--rd-ink-soft); font-size: 14px; margin: 0 0 16px; overflow-wrap: anywhere; }
  .term-pointer { margin-top: 20px; margin-bottom: 0; }

  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 13px;
    align-items: start;
  }
  .field-group.wide { grid-column: 1 / -1; }
  .field-group { min-width: 0; }
  label {
    display: block;
    font-size: 12px;
    font-weight: 900;
    color: var(--rd-ink-soft);
  }
  input {
    width: 100%;
    padding: 11px;
    border: 1px solid oklch(52% 0.06 305 / 0.14);
    border-radius: var(--rd-r-sm);
    background: #fff;
    font: inherit;
    box-sizing: border-box;
    margin-top: 6px;
    min-height: 44px;
  }
  input:disabled { opacity: 0.6; cursor: not-allowed; }
  .field-helper {
    font-size: 12px;
    color: var(--ob-ink-faint-aa);
    margin: 4px 0 0;
  }
  .dd-warning { color: var(--rd-danger-ink, oklch(38% 0.18 20)); }

  .rd-btn-primary, .rd-btn-ghost {
    margin-top: 24px;
    min-height: 44px;
  }
  .authoring-start .rd-btn-ghost { margin-top: 16px; }

  /* --rd-accent (L 65%) is 3.59:1 with white text — fails AA. Use the same
     deep step marketing-rd.css already reserves for :active as the default
     background for text-bearing buttons here; white text on it is 5.80:1. */
  .rd-btn-primary {
    background: var(--rd-accent-deep);
    box-shadow: none;
  }
  .rd-btn-primary:hover:not(:disabled) {
    transform: translateY(-2px) rotate(-1deg);
    background: oklch(48% 0.2 2);
  }
  .rd-btn-primary:active:not(:disabled) {
    transform: translateY(1px);
  }
  .rd-btn-ghost:hover:not(:disabled) {
    transform: translateY(-2px);
    border-color: var(--rd-grape);
  }
  .rd-btn-primary:disabled, .rd-btn-ghost:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }
  .rd-btn-primary:focus-visible, .rd-btn-ghost:focus-visible {
    outline: 3px solid var(--rd-grape);
    outline-offset: 3px;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 24px;
  }
  .actions .rd-btn { margin-top: 0; }

  .academic {
    border-top: 1px solid oklch(52% 0.06 305 / 0.14);
    margin-top: 32px;
    padding-top: 18px;
  }
  .academic summary {
    cursor: pointer;
    font-weight: 900;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  .academic summary::-webkit-details-marker { display: none; }
  .academic summary::before {
    content: '';
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--rd-grape);
    border-bottom: 2px solid var(--rd-grape);
    transform: rotate(-45deg);
    transition: transform 0.14s var(--rd-ease);
  }
  .academic[open] summary::before { transform: rotate(45deg); }
  .academic > p { color: var(--rd-ink-soft); overflow-wrap: anywhere; }

  .error {
    background: var(--rd-danger-soft, oklch(93% 0.06 20));
    color: var(--rd-danger-ink, oklch(38% 0.18 20));
    padding: 11px 14px;
    border-radius: var(--rd-r-sm);
    font-size: 14px;
    margin: 12px 0 0;
    overflow-wrap: anywhere;
  }

  dl { margin: 28px 0; }
  dl div {
    display: grid;
    grid-template-columns: minmax(120px, 30%) 1fr;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid oklch(52% 0.06 305 / 0.14);
    min-width: 0;
  }
  dt { font-weight: 900; }
  dd { margin: 0; overflow-wrap: anywhere; min-width: 0; }

  .rd-btn-text:focus-visible,
  input:focus-visible,
  summary:focus-visible {
    outline: 3px solid var(--rd-grape);
    outline-offset: 2px;
    border-radius: var(--rd-r-sm);
  }

  @media (max-width: 560px) {
    .shell { padding: 22px; }
    .fields { grid-template-columns: 1fr; }
    .field-group.wide { grid-column: auto; }
    .steps { gap: 12px; }
    .actions { flex-wrap: wrap; }
  }
</style>
