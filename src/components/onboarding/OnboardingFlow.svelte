<script lang="ts">
  interface CourseSummary {
    id: string;
    code: string;
    title: string;
    term: string | null;
  }
  interface Props {
    courses: CourseSummary[];
    initialName: string | null;
    initialTerm: string | null;
  }
  const { courses, initialName, initialTerm }: Props = $props();

  const STEPS = ['Welcome', 'How it works', 'Your courses', 'You, this term'];

  let step = $state(1);
  let name = $state(initialName ?? '');
  let currentTerm = $state(initialTerm ?? '');
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  function goTo(n: number) {
    step = Math.min(Math.max(n, 1), STEPS.length);
  }

  // No markOnboarded flag: Skip (available on every step) and the step-4
  // Finish button both just call this — whatever's typed in the name/term
  // fields at the moment either is pressed goes along, so Skip never
  // silently drops what the user already filled in.
  async function finish() {
    saving = true;
    saveError = null;
    try {
      const body: Record<string, unknown> = { onboarded: true };
      if (name.trim()) body.name = name.trim();
      if (currentTerm.trim()) body.current_term = currentTerm.trim();
      const res = await fetch('/api/v1/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        saveError = json?.error?.message ?? 'Could not save — try again.';
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      saveError = 'Network error, please try again.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="onboarding">
  <div class="top-row">
    <div class="steps">
      {#each STEPS as label, i (label)}
        <div class="step" class:active={step === i + 1} class:done={step > i + 1}>{i + 1}. {label}</div>
      {/each}
    </div>
    <button type="button" class="skip" disabled={saving} onclick={() => finish()}>Skip setup</button>
  </div>

  {#if saveError}<p class="error">{saveError}</p>{/if}

  {#if step === 1}
    <div class="card panel">
      <h2>What studyus is</h2>
      <p class="stepdesc">Two sides, one place to keep track of your semester.</p>
      <div class="two-col">
        <div class="side">
          <h3>Admin</h3>
          <p>Deadlines, grades, and where you stand — the calendar, grade tracker, and each course's standing view.</p>
        </div>
        <div class="side">
          <h3>Learning</h3>
          <p>What you're actually learning and how well — course concepts, a study flow, an AI tutor, and a feed of readings.</p>
        </div>
      </div>
      <div class="aside-muted">Everything here is purely informational — no scores to game, no streaks to keep alive.</div>
      <div class="nav-row">
        <span></span>
        <button type="button" class="ink-btn" onclick={() => goTo(2)}>Continue</button>
      </div>
    </div>
  {:else if step === 2}
    <div class="card panel">
      <h2>How learning is modeled</h2>
      <p class="stepdesc">The short version of how mastery numbers get calculated.</p>
      <ol class="explain-list">
        <li><strong>Concepts.</strong> Each course is broken into small topics — a "concept" might be one idea, formula, or skill (e.g. "Bernoulli equation").</li>
        <li><strong>Events.</strong> Anything that touches a concept gets logged as an event — a lecture attended, a graded quiz, a study session, a tutor chat.</li>
        <li><strong>Mastery.</strong> Each concept's mastery is calculated from its own event history — more successful, recent evidence pushes it up; going quiet lets it drift back down.</li>
      </ol>
      <div class="aside-muted">Nothing is guessed — every number traces back to something you or a course actually logged.</div>
      <div class="coming-soon">
        <span class="cs-dot"></span>
        <div>
          <strong>Personalized pacing &amp; goals</strong>
          <span class="cs-tag">coming soon</span>
          <p>Tailoring the plan to a target grade or exam date isn't built yet — for now, standing and mastery are purely descriptive.</p>
        </div>
      </div>
      <div class="nav-row">
        <button type="button" class="ink-btn ghost" onclick={() => goTo(1)}>Back</button>
        <button type="button" class="ink-btn" onclick={() => goTo(3)}>Continue</button>
      </div>
    </div>
  {:else if step === 3}
    <div class="card panel">
      <h2>Your courses <span class="num">{courses.length} imported</span></h2>
      <p class="stepdesc">These came in from your course records. Adding or removing courses yourself is a later iteration.</p>
      {#if courses.length === 0}
        <p class="placeholder">No courses found yet.</p>
      {:else}
        <ul class="course-list">
          {#each courses as c (c.id)}
            <li>
              <span class="tick">✓</span>
              <span class="code">{c.code}</span>
              <span class="title">{c.title}</span>
              {#if c.term}<span class="term">{c.term}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      <div class="nav-row">
        <button type="button" class="ink-btn ghost" onclick={() => goTo(2)}>Back</button>
        <button type="button" class="ink-btn" onclick={() => goTo(4)}>Continue</button>
      </div>
    </div>
  {:else if step === 4}
    <div class="card panel">
      <h2>You, this term</h2>
      <p class="stepdesc">A name and a term label — both optional, both editable later from your profile.</p>
      <label class="field">
        <span>Display name</span>
        <input type="text" bind:value={name} placeholder="What should we call you?" />
      </label>
      <label class="field">
        <span>Current term</span>
        <input type="text" bind:value={currentTerm} placeholder="e.g. Fall 2024" />
      </label>
      <div class="nav-row">
        <button type="button" class="ink-btn ghost" onclick={() => goTo(3)}>Back</button>
        <button type="button" class="ink-btn" disabled={saving} onclick={() => finish()}>
          {saving ? 'Saving…' : 'Finish'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .onboarding { max-width: 680px; }
  .top-row { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
  .steps { display: flex; gap: 0; flex: 1; }
  .step {
    flex: 1;
    text-align: center;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
    padding-bottom: 0.5rem;
    border-bottom: 2px solid var(--hairline);
  }
  .step.active { color: var(--accent); border-color: var(--accent); font-weight: 600; }
  .step.done { color: var(--good); border-color: var(--good); }
  .skip {
    background: none;
    border: none;
    color: var(--muted);
    font-family: var(--font-display);
    font-size: 0.82rem;
    font-style: italic;
    cursor: pointer;
    text-decoration: underline;
    padding: 0;
    white-space: nowrap;
  }
  .skip:disabled { opacity: 0.5; cursor: default; }

  /* main content-box ≤ 720px (STACK): the 4-label step strip has no room
     beside Skip once the sidebar collapses, so it claims its own line. */
  @container (max-width: 720px) {
    .top-row { flex-wrap: wrap; }
    .steps { flex: 1 1 100%; }
    .step { min-width: 0; }
  }

  .panel { min-height: 300px; }
  h2 { font-size: 1.15rem; margin: 0 0 0.3rem; }
  .num { color: var(--muted); font-weight: 400; font-size: 0.8rem; margin-left: 0.4rem; }
  .stepdesc { color: var(--muted); font-size: 0.9rem; margin: 0 0 1.25rem; }

  .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 1.5rem; }
  .side h3 { margin: 0 0 0.3rem; font-size: 0.98rem; }
  .side p { margin: 0; font-size: 0.9rem; color: var(--text); }

  .explain-list { margin: 0 0 1rem; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.6rem; font-size: 0.92rem; }
  .explain-list li::marker { color: var(--muted); }

  .aside-muted { margin: 1rem 0; }

  .coming-soon {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
    margin: 1rem 0 0;
    padding: 0.75rem 0.9rem;
    background: var(--bg);
    border: 1px dashed var(--hairline);
    border-radius: 3px;
    opacity: 0.85;
  }
  .cs-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hairline); margin-top: 0.4rem; flex-shrink: 0; }
  .coming-soon strong { font-size: 0.9rem; }
  .cs-tag {
    margin-left: 0.5rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    font-style: italic;
  }
  .coming-soon p { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--muted); }

  .course-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.1rem; }
  .course-list li {
    display: flex;
    align-items: baseline;
    gap: 0.7rem;
    padding: 0.55rem 0;
    border-bottom: 1px dotted var(--hairline);
    font-size: 0.9rem;
  }
  .course-list li:last-child { border-bottom: none; }
  .tick { color: var(--good); font-weight: 600; }
  .code { font-size: 0.78rem; letter-spacing: 0.04em; color: var(--muted); width: 5.5rem; flex-shrink: 0; }
  .title { flex: 1; }
  .term { font-size: 0.78rem; color: var(--muted); }
  .placeholder { color: var(--muted); font-size: 0.9rem; }

  .field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.88rem; margin-bottom: 1rem; max-width: 360px; }
  .field input {
    font-family: var(--font-display);
    font-size: 0.95rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--hairline);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
  }
  .field input:focus { outline: 1px solid var(--accent); }
  /* Rendered above the step panel (not inside it) so it shows regardless of
     which step Skip/Finish was pressed from, not just step 4. */
  .error { color: var(--danger); font-size: 0.85rem; margin: 0 0 0.9rem; }

  .nav-row { display: flex; justify-content: space-between; margin-top: 1.5rem; }
  .ink-btn {
    font-family: var(--font-display);
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--surface);
    background: var(--accent);
    border: none;
    border-radius: 3px;
    padding: 0.6rem 1.3rem;
    cursor: pointer;
  }
  .ink-btn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  .ink-btn:disabled { opacity: 0.5; cursor: default; }
  .ink-btn:hover:not(:disabled) { opacity: 0.88; }
</style>
