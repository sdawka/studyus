<script lang="ts">
  type Candidate = { id: string; name: string; course_id: string; course_title: string; course_slug: string };
  type MapKc = {
    id?: string; client_id?: string; name: string; kc_type: 'fact' | 'association' | 'concept' | 'rule' | 'principle';
    description: string | null; practice_notes: string | null; sort_order: number; archived: boolean;
    mastery?: number; status?: string; prerequisite_kc_ids: string[]; dependent_kc_ids?: string[];
  };
  type MapBranch = { id?: string; client_id?: string; name: string; sort_order: number; archived: boolean; kcs: MapKc[] };
  type Pending = { item_kind: 'branch' | 'kc'; template_ref: string; name: string; branch_name?: string; kc_type?: string; description?: string; kc_count?: number };
  type CourseMap = {
    course: { id: string; slug: string; title: string; map_revision: number; template_id: string | null };
    branches: MapBranch[];
    prerequisite_candidates: Candidate[];
    template_updates: { added: Pending[]; removed: Pending[]; dismissed: Array<{ item_kind: 'branch' | 'kc'; template_ref: string; decision: string }> };
  };

  export let initialMap: unknown;
  export let courseSlug: string;
  let map = initialMap as CourseMap;
  let draft: MapBranch[] = cloneBranches(map.branches);
  let editing = false;
  let saving = false;
  let error = '';
  let notice = '';

  function cloneBranches(branches: MapBranch[]): MapBranch[] {
    // Svelte 5 wraps reactive arrays/objects in proxies, which cannot cross
    // the browser's structuredClone boundary. Materialize the plain editable
    // shape explicitly so this works both for initial props and later drafts.
    return branches.map((branch) => ({
      ...branch,
      kcs: branch.kcs.map((kc) => ({ ...kc, prerequisite_kc_ids: [...(kc.prerequisite_kc_ids ?? [])] })),
    }));
  }

  function beginEdit() {
    draft = cloneBranches(map.branches);
    error = '';
    notice = '';
    editing = true;
  }

  function cancelEdit() {
    draft = cloneBranches(map.branches);
    editing = false;
    error = '';
  }

  function addBranch() {
    draft = [...draft, { client_id: crypto.randomUUID(), name: 'New branch', sort_order: draft.length, archived: false, kcs: [] }];
  }

  function addKc(branchIndex: number) {
    const branches = cloneBranches(draft);
    branches[branchIndex].kcs.push({
      client_id: crypto.randomUUID(), name: 'New concept', kc_type: 'concept', description: '', practice_notes: '',
      sort_order: branches[branchIndex].kcs.length, archived: false, prerequisite_kc_ids: [],
    });
    draft = branches;
  }

  function moveBranch(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= draft.length) return;
    const next = cloneBranches(draft);
    [next[index], next[target]] = [next[target], next[index]];
    next.forEach((branch, order) => branch.sort_order = order);
    draft = next;
  }

  function moveKc(branchIndex: number, kcIndex: number, direction: -1 | 1) {
    const target = kcIndex + direction;
    const next = cloneBranches(draft);
    if (target < 0 || target >= next[branchIndex].kcs.length) return;
    [next[branchIndex].kcs[kcIndex], next[branchIndex].kcs[target]] = [next[branchIndex].kcs[target], next[branchIndex].kcs[kcIndex]];
    next[branchIndex].kcs.forEach((kc, order) => kc.sort_order = order);
    draft = next;
  }

  function moveKcTo(kc: MapKc, fromIndex: number, targetKey: string) {
    const targetIndex = draft.findIndex((branch) => (branch.id ?? branch.client_id) === targetKey);
    if (targetIndex < 0 || targetIndex === fromIndex) return;
    const next = cloneBranches(draft);
    next[fromIndex].kcs = next[fromIndex].kcs.filter((item) => (item.id ?? item.client_id) !== (kc.id ?? kc.client_id));
    next[targetIndex].kcs.push(kc);
    next[fromIndex].kcs.forEach((item, order) => item.sort_order = order);
    next[targetIndex].kcs.forEach((item, order) => item.sort_order = order);
    draft = next;
  }

  function setPrereqs(kc: MapKc, event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    kc.prerequisite_kc_ids = [...select.selectedOptions].map((option) => option.value);
    draft = cloneBranches(draft);
  }

  function payloadBranches() {
    return draft.map((branch, branchOrder) => ({
      ...(branch.id ? { id: branch.id } : { client_id: branch.client_id }),
      name: branch.name, sort_order: branchOrder, archived: branch.archived,
      kcs: branch.kcs.map((kc, kcOrder) => ({
        ...(kc.id ? { id: kc.id } : { client_id: kc.client_id }),
        name: kc.name, kc_type: kc.kc_type, description: kc.description || null,
        practice_notes: kc.practice_notes || null, sort_order: kcOrder, archived: kc.archived,
        prerequisite_kc_ids: kc.prerequisite_kc_ids,
      })),
    }));
  }

  async function save() {
    saving = true; error = ''; notice = '';
    try {
      const response = await fetch(`/api/v1/courses/${map.course.id}/map`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: map.course.map_revision, branches: payloadBranches() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not save the course map.');
      map = body.data;
      draft = cloneBranches(map.branches);
      editing = false;
      notice = 'Course map saved.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save the course map.';
    } finally { saving = false; }
  }

  async function reload() {
    const response = await fetch(`/api/v1/courses/${map.course.id}/map`);
    const body = await response.json();
    if (response.ok) { map = body.data; draft = cloneBranches(map.branches); error = ''; editing = false; }
  }

  async function templateAction(item: Pending, action: 'include' | 'dismiss' | 'archive' | 'keep') {
    saving = true; error = ''; notice = '';
    try {
      const response = await fetch(`/api/v1/courses/${map.course.id}/template-updates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: map.course.map_revision, actions: [{ item_kind: item.item_kind, template_ref: item.template_ref, action }] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not apply this update.');
      map = body.data; draft = cloneBranches(map.branches); notice = 'Template update handled.';
    } catch (cause) { error = cause instanceof Error ? cause.message : 'Could not apply this update.'; }
    finally { saving = false; }
  }

  $: pendingCount = map.template_updates.added.length + map.template_updates.removed.length;
  $: visibleBranches = editing ? draft : map.branches.filter((branch) => !branch.archived);
</script>

<div class="map-toolbar">
  <div>
    <h2>Concept map</h2>
    <p>Shape what you are learning and how each concept depends on the others.</p>
  </div>
  {#if editing}
    <div class="actions"><button class="quiet" on:click={cancelEdit} disabled={saving}>Cancel</button><button on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save map'}</button></div>
  {:else}
    <button on:click={beginEdit}>Edit map</button>
  {/if}
</div>

{#if error}<div class="message error" role="alert">{error} {#if error.includes('another tab')}<button class="link" on:click={reload}>Reload map</button>{/if}</div>{/if}
{#if notice}<div class="message success" role="status">{notice}</div>{/if}

{#if pendingCount > 0}
  <section class="updates">
    <div><strong>{pendingCount} reviewed-template {pendingCount === 1 ? 'update' : 'updates'}</strong><span>Nothing changes structurally until you decide.</span></div>
    {#each map.template_updates.added as item}
      <article><div><b>New {item.item_kind}: {item.name}</b>{#if item.branch_name}<small>In {item.branch_name}</small>{/if}{#if item.description}<p>{item.description}</p>{/if}</div><div class="actions"><button on:click={() => templateAction(item, 'include')} disabled={saving}>Include</button><button class="quiet" on:click={() => templateAction(item, 'dismiss')} disabled={saving}>Dismiss</button></div></article>
    {/each}
    {#each map.template_updates.removed as item}
      <article><div><b>No longer in reviewed template: {item.name}</b><small>Your history will remain either way.</small></div><div class="actions"><button class="danger" on:click={() => templateAction(item, 'archive')} disabled={saving}>Archive</button><button class="quiet" on:click={() => templateAction(item, 'keep')} disabled={saving}>Keep mine</button></div></article>
    {/each}
  </section>
{/if}

{#if editing}
  <div class="edit-help">Changes are private until you press <strong>Save map</strong>. Archived concepts remain in your history.</div>
{/if}

{#each visibleBranches as branch, branchIndex (branch.id ?? branch.client_id)}
  {#if editing || !branch.archived}
    <section class:archived={branch.archived} class="branch">
      <header>
        {#if editing}
          <input class="branch-name" bind:value={branch.name} aria-label="Branch name" />
          <div class="actions compact">
            <button class="icon" on:click={() => moveBranch(branchIndex, -1)} disabled={branchIndex === 0} aria-label="Move branch up">↑</button>
            <button class="icon" on:click={() => moveBranch(branchIndex, 1)} disabled={branchIndex === draft.length - 1} aria-label="Move branch down">↓</button>
            <button class:danger={!branch.archived} class="quiet" on:click={() => { branch.archived = !branch.archived; draft = cloneBranches(draft); }}>{branch.archived ? 'Restore branch' : 'Archive branch'}</button>
          </div>
        {:else}<h3>{branch.name}</h3>{/if}
      </header>
      <div class="kc-list">
        {#each branch.kcs as kc, kcIndex (kc.id ?? kc.client_id)}
          {#if editing || !kc.archived}
            <article class:archived={kc.archived} class="kc-card">
              {#if editing}
                <div class="kc-grid">
                  <label>Name<input bind:value={kc.name} /></label>
                  <label>Knowledge type<select bind:value={kc.kc_type}><option value="fact">Fact</option><option value="association">Association</option><option value="concept">Concept</option><option value="rule">Rule</option><option value="principle">Principle</option></select></label>
                  <label class="wide">Description<textarea rows="2" bind:value={kc.description}></textarea></label>
                  <label class="wide">Practice notes<textarea rows="2" bind:value={kc.practice_notes}></textarea></label>
                  <label class="wide">Prerequisites <span class="hint">Select any active concept you own</span><select multiple size="4" value={kc.prerequisite_kc_ids} on:change={(event) => setPrereqs(kc, event)}>{#each map.prerequisite_candidates.filter((candidate) => candidate.id !== kc.id) as candidate}<option value={candidate.id} selected={kc.prerequisite_kc_ids.includes(candidate.id)}>{candidate.course_title} — {candidate.name}</option>{/each}</select></label>
                </div>
                <div class="row-tools">
                  <select aria-label="Move concept to branch" value={branch.id ?? branch.client_id} on:change={(event) => moveKcTo(kc, branchIndex, event.currentTarget.value)}>{#each draft as target}<option value={target.id ?? target.client_id}>{target.name}</option>{/each}</select>
                  <button class="icon" on:click={() => moveKc(branchIndex, kcIndex, -1)} disabled={kcIndex === 0} aria-label="Move concept up">↑</button>
                  <button class="icon" on:click={() => moveKc(branchIndex, kcIndex, 1)} disabled={kcIndex === branch.kcs.length - 1} aria-label="Move concept down">↓</button>
                  <button class:danger={!kc.archived} class="quiet" on:click={() => { kc.archived = !kc.archived; draft = cloneBranches(draft); }}>{kc.archived ? 'Restore concept' : 'Archive concept'}</button>
                </div>
              {:else}
                <div class="read-row"><a href={`/courses/${courseSlug}/kc/${kc.id}`}><strong>{kc.name}</strong><small>{kc.kc_type}</small></a><span>{kc.mastery ?? 0}% mastery</span><a class="understand" href={`/learn/${kc.id}`}>Understand</a></div>
                {#if kc.description}<p>{kc.description}</p>{/if}
              {/if}
            </article>
          {/if}
        {/each}
        {#if !editing && branch.kcs.filter((kc) => !kc.archived).length === 0}<p class="empty">No active concepts in this branch.</p>{/if}
      </div>
      {#if editing}<button class="add" on:click={() => addKc(branchIndex)}>+ Add concept</button>{/if}
    </section>
  {/if}
{/each}

{#if editing}
  <div class="footer-tools"><button class="quiet" on:click={addBranch}>+ Add branch</button><span>Archived items remain visible while editing.</span></div>
{/if}

<style>
  .map-toolbar,.map-toolbar>div,.actions,.branch header,.read-row,.row-tools,.footer-tools,.updates>div:first-child{display:flex;align-items:center;gap:.65rem}.map-toolbar{justify-content:space-between;margin-bottom:1rem}.map-toolbar h2{margin:0;font-size:1.2rem}.map-toolbar p{margin:.2rem 0 0;color:var(--muted);font-size:.88rem}.actions{flex-wrap:wrap}button{border:0;border-radius:8px;background:var(--accent);color:white;padding:.55rem .85rem;font:inherit;font-weight:650;cursor:pointer}button:disabled{opacity:.45;cursor:not-allowed}.quiet,.icon,.add{background:transparent;color:var(--text);border:1px solid var(--border)}.danger{color:#b42318;border-color:#f0b4ad;background:#fff7f6}.link{padding:0;background:none;color:var(--accent);text-decoration:underline}.message,.edit-help{padding:.7rem .85rem;border-radius:8px;margin:.75rem 0;font-size:.88rem}.error{background:#fff0ee;color:#9d2017}.success{background:#ebf8ef;color:#176b35}.edit-help{background:var(--surface-alt,#f5f6f8);color:var(--muted)}.updates{border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));border-radius:10px;padding:.85rem;margin-bottom:1rem;background:color-mix(in srgb,var(--accent) 5%,white)}.updates>div:first-child{justify-content:space-between}.updates article{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--border);padding:.75rem 0}.updates article:last-child{padding-bottom:0}.updates small,.updates p{display:block;color:var(--muted);margin:.2rem 0 0;font-size:.82rem}.branch{margin:0 0 1rem;border:1px solid var(--border);border-radius:10px;padding:.85rem}.branch.archived,.kc-card.archived{opacity:.65;background:var(--surface-alt,#f5f6f8)}.branch header{justify-content:space-between;margin-bottom:.65rem}.branch h3{margin:0;font-size:1rem}.branch-name{font-size:1rem;font-weight:700;max-width:24rem}.compact{flex-wrap:nowrap}.icon{padding:.35rem .55rem}.kc-list{display:flex;flex-direction:column;gap:.55rem}.kc-card{border:1px solid var(--border);border-radius:8px;padding:.7rem}.kc-grid{display:grid;grid-template-columns:2fr 1fr;gap:.65rem}.kc-grid label{display:flex;flex-direction:column;gap:.25rem;font-size:.76rem;color:var(--muted);font-weight:650}.kc-grid .wide{grid-column:1/-1}.hint{font-weight:400}input,select,textarea{box-sizing:border-box;width:100%;border:1px solid var(--border);border-radius:7px;background:var(--surface,#fff);color:var(--text);padding:.48rem .55rem;font:inherit}select[multiple]{padding:.25rem}.row-tools{justify-content:flex-end;margin-top:.6rem}.row-tools select{width:auto;max-width:15rem}.read-row{justify-content:space-between}.read-row>a:first-child{display:flex;flex:1;gap:.6rem;color:var(--text);text-decoration:none}.read-row small{text-transform:capitalize;color:var(--muted)}.read-row span{font-size:.82rem;color:var(--muted)}.understand{color:var(--accent);font-size:.84rem}.kc-card>p{margin:.45rem 0 0;color:var(--muted);font-size:.86rem}.add{margin-top:.65rem}.footer-tools{justify-content:space-between}.footer-tools span{font-size:.82rem;color:var(--muted)}.empty{color:var(--muted);font-size:.85rem}
  @media(max-width:640px){.map-toolbar,.updates article,.read-row{align-items:flex-start;flex-direction:column}.kc-grid{grid-template-columns:1fr}.kc-grid .wide{grid-column:auto}.row-tools{justify-content:flex-start;flex-wrap:wrap}.compact{flex-wrap:wrap}.read-row>a:first-child{flex-direction:column;gap:.1rem}}
</style>
