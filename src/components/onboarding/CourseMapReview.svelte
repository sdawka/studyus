<script lang="ts">
  import type { CourseSetupProposal } from '../../lib/schemas/onboarding';

  let { proposal, termStart, termEnd, onchange } = $props<{
    proposal: CourseSetupProposal;
    termStart: string;
    termEnd: string;
    onchange: (proposal: CourseSetupProposal) => void;
  }>();

  type Branch = CourseSetupProposal['branches'][number];
  type Kc = Branch['kcs'][number];

  function emit() {
    onchange(structuredClone(proposal));
  }

  function selectedDependents(target: Kc): Kc[] {
    if (!target.template_ref) return [];
    return proposal.branches
      .filter((branch) => branch.included)
      .flatMap((branch) => branch.kcs)
      .filter((kc) => kc.included && kc.client_id !== target.client_id)
      .filter((kc) => kc.prereq_refs.some((ref) => {
        const [courseRef, kcRef] = ref.split('#');
        return kcRef === target.template_ref && (!courseRef || courseRef === proposal.template_id);
      }));
  }

  function toggleKc(kc: Kc) {
    if (kc.included && selectedDependents(kc).length) return;
    kc.included = !kc.included;
    if (kc.included) includePrereqs(kc);
    emit();
  }

  function includePrereqs(kc: Kc) {
    for (const ref of kc.prereq_refs) {
      const [courseRef, kcRef] = ref.split('#');
      if (!kcRef || (courseRef && courseRef !== proposal.template_id)) continue;
      const parent = proposal.branches.find((branch) => branch.kcs.some((candidate) => candidate.template_ref === kcRef));
      const prerequisite = parent?.kcs.find((candidate) => candidate.template_ref === kcRef);
      if (parent && prerequisite && !prerequisite.included) {
        parent.included = true;
        prerequisite.included = true;
        includePrereqs(prerequisite);
      }
    }
  }

  function toggleBranch(branch: Branch) {
    if (branch.included) {
      const blocked = branch.kcs.some((kc) => kc.included && selectedDependents(kc).some((dependent) => !branch.kcs.includes(dependent)));
      if (blocked) return;
      branch.included = false;
      branch.kcs.forEach((kc) => { kc.included = false; });
    } else {
      branch.included = true;
      branch.kcs.forEach((kc) => { kc.included = true; includePrereqs(kc); });
    }
    emit();
  }

  function move<T>(items: T[], index: number, direction: -1 | 1, setOrder: (item: T, order: number) => void) {
    const target = index + direction;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    items.forEach(setOrder);
    emit();
  }

  function updateDate(index: number, value: string) {
    const assessment = proposal.assessments[index];
    if (!assessment) return;
    assessment.date_status = value ? 'confirmed' : 'unset';
    if (value) assessment.due_on = value;
    else delete assessment.due_on;
    emit();
  }

  function setUnknown(index: number, unknown: boolean) {
    const assessment = proposal.assessments[index];
    if (!assessment) return;
    assessment.date_status = unknown ? 'unknown' : 'unset';
    delete assessment.due_on;
    emit();
  }

  function markAllUnknown() {
    proposal.assessments.forEach((assessment) => {
      if (assessment.kind !== 'official') return;
      assessment.date_status = 'unknown';
      delete assessment.due_on;
    });
    emit();
  }
</script>

<div class="review-shell">
  <div class="review-heading">
    <div>
      <p class="eyebrow">Review before import</p>
      <h3>{proposal.course.code} · {proposal.course.title}</h3>
      <p>Keep the map useful: rename, reorder, or remove material you will not study.</p>
    </div>
    <span>{proposal.branches.filter((branch) => branch.included).flatMap((branch) => branch.kcs.filter((kc) => kc.included)).length} concepts included</span>
  </div>

  <div class="branches">
    {#each proposal.branches as branch, branchIndex (branch.client_id)}
      <section class:excluded={!branch.included}>
        <div class="branch-row">
          <input class="check" aria-label={`Include ${branch.name}`} type="checkbox" checked={branch.included} onchange={() => toggleBranch(branch)} />
          <input aria-label="Branch name" value={branch.name} oninput={(event) => { branch.name = event.currentTarget.value; emit(); }} />
          <div class="reorder"><button type="button" aria-label="Move branch up" disabled={branchIndex === 0} onclick={() => move(proposal.branches, branchIndex, -1, (item, order) => { item.sort_order = order; })}>↑</button><button type="button" aria-label="Move branch down" disabled={branchIndex === proposal.branches.length - 1} onclick={() => move(proposal.branches, branchIndex, 1, (item, order) => { item.sort_order = order; })}>↓</button></div>
        </div>
        {#if branch.included}
          <div class="kcs">
            {#each branch.kcs as kc, kcIndex (kc.client_id)}
              {@const dependents = selectedDependents(kc)}
              <div class:excluded={!kc.included} class="kc-row">
                <input class="check" aria-label={`Include ${kc.name}`} type="checkbox" checked={kc.included} disabled={kc.included && dependents.length > 0} onchange={() => toggleKc(kc)} />
                <div>
                  <input aria-label="Concept name" value={kc.name} oninput={(event) => { kc.name = event.currentTarget.value; emit(); }} />
                  {#if kc.included && dependents.length}<small>Required by {dependents.map((dependent) => dependent.name).join(', ')}</small>{/if}
                </div>
                <span class="type">{kc.kc_type}</span>
                <div class="reorder"><button type="button" aria-label="Move concept up" disabled={kcIndex === 0} onclick={() => move(branch.kcs, kcIndex, -1, (item, order) => { item.sort_order = order; })}>↑</button><button type="button" aria-label="Move concept down" disabled={kcIndex === branch.kcs.length - 1} onclick={() => move(branch.kcs, kcIndex, 1, (item, order) => { item.sort_order = order; })}>↓</button></div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>

  {#if proposal.assessments.some((assessment) => assessment.kind === 'official')}
    <div class="assessment-heading">
      <div><h3>Known assessment dates</h3><p>Use real dates only. Unknown dates stay empty until you add them later.</p></div>
      <button type="button" onclick={markAllUnknown}>I don’t know the dates</button>
    </div>
    <div class="assessments">
      {#each proposal.assessments as assessment, index (assessment.template_ref)}
        {#if assessment.kind === 'official'}
          <div class="assessment-row">
            <div><strong>{assessment.title}</strong><small>{assessment.type}{assessment.weight_pct !== undefined ? ` · ${assessment.weight_pct}%` : ''}</small></div>
            <input aria-label={`${assessment.title} date`} type="date" min={termStart} max={termEnd} value={assessment.due_on ?? ''} disabled={assessment.date_status === 'unknown'} onchange={(event) => updateDate(index, event.currentTarget.value)} />
            <label><input type="checkbox" checked={assessment.date_status === 'unknown'} onchange={(event) => setUnknown(index, event.currentTarget.checked)} /> Date unknown</label>
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .review-shell{grid-column:2;border:1px solid #ddd4e2;border-radius:18px;background:#faf7fc;padding:18px;min-width:0}.review-heading,.assessment-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.review-heading h3,.assessment-heading h3{font:800 22px 'Fraunces Variable',serif;margin:0}.review-heading p,.assessment-heading p{margin:4px 0;color:#746979;font-size:13px}.review-heading>span{white-space:nowrap;border-radius:999px;background:#eee2f8;color:#7135a6;padding:7px 11px;font-size:12px;font-weight:900}.eyebrow{text-transform:uppercase;letter-spacing:.12em;color:#813cc0!important;font-size:10px!important;font-weight:900}.branches{display:grid;gap:10px;margin-top:16px}.branches section{border:1px solid #e2dce6;border-radius:14px;background:#fff;padding:10px}.branches section.excluded,.kc-row.excluded{opacity:.55}.branch-row,.kc-row{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center}.kc-row{grid-template-columns:22px minmax(0,1fr) auto auto;padding:7px 0 7px 16px;border-top:1px solid #eee9f0}.check{width:16px!important;accent-color:#8740c5}.branch-row>input:not(.check),.kc-row input:not(.check),.assessment-row>input{padding:8px!important}.kc-row small,.assessment-row small{display:block;color:#7a6f80;font-size:11px;margin-top:3px}.type{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#786982}.reorder{display:flex;gap:3px}.reorder button,.assessment-heading button{border:1px solid #d9d0df;background:#fff;color:#5c4d65;border-radius:8px;padding:5px 8px;font-weight:800}.reorder button:disabled{opacity:.3}.assessment-heading{margin-top:25px;padding-top:18px;border-top:1px solid #e1d9e5}.assessment-heading button{border-radius:999px;padding:8px 12px}.assessments{margin-top:10px}.assessment-row{display:grid;grid-template-columns:minmax(150px,1fr) 160px auto;align-items:center;gap:10px;padding:9px 0;border-top:1px solid #e7e0e9}.assessment-row label{display:flex;flex-direction:row;align-items:center}.assessment-row label input{width:16px!important}@media(max-width:760px){.review-shell{grid-column:1/-1}.review-heading,.assessment-heading{display:grid}.assessment-row{grid-template-columns:1fr}.kc-row{grid-template-columns:22px minmax(0,1fr);}.kc-row .type,.kc-row .reorder{grid-column:2}.review-heading>span{width:max-content}}
</style>
