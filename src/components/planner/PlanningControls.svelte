<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import { CALENDAR_SYNCED_EVENT } from '../../lib/plannerCalendarRefresh';
  type Availability = {day:number;startMinute:number;endMinute:number};
  type Preferences = {enabled:boolean;weeklyMinutes:number;availability:Availability[];revision:number;timezone:string};
  type Run = {id:string;status:string;sourceRevision:number;createdAt:number;changes:Array<{sessionId:string;title:string;before:{scheduledAt:number;plannedMinutes:number}|null;after:{scheduledAt:number;plannedMinutes:number}|null;reason:string}>;unplaced:Array<{id:string;title?:string;reason:string}>};
  type Task = {id:string;title:string;completed:boolean;estimatedMinutes:number;priority:number;type:string};
  let preferences = $state<Preferences|null>(null);
  let runs = $state<Run[]>([]);
  let preview = $state<Run|null>(null);
  let tasks = $state<Task[]>([]);
  let busy = $state(false);
  let error = $state('');
  let message = $state('');
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const time=(minutes:number)=>`${Math.floor(minutes/60).toString().padStart(2,'0')}:${(minutes%60).toString().padStart(2,'0')}`;
  const minutes=(value:string)=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
  const when=(value:number)=>new Intl.DateTimeFormat(undefined,{timeZone:preferences?.timezone,dateStyle:'medium',timeStyle:'short'}).format(value);
  const json=(body:unknown,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  async function load() {
    busy=true; error='';
    const [p,r,t]=await Promise.all([
      apiFetch<Preferences>('/api/v1/planning/preferences'),
      apiFetch<Run[]>('/api/v1/planning/runs'),
      apiFetch<Task[]>('/api/v1/tasks'),
    ]);
    if (p.ok) preferences=p.data; else error=p.error;
    if (r.ok) runs=r.data; else error ||= r.error;
    if (t.ok) tasks=t.data.filter(t=>!t.completed && !['attend_class','grade_entry'].includes(t.type));
    busy=false;
  }
  onMount(()=>{void load();});
  async function save() {
    if (!preferences) return;
    if (preferences.enabled && preferences.availability.length===0) {error='Add a study window before turning on automatic planning.';return;}
    busy=true; error=''; message='';
    const {revision,enabled,weeklyMinutes,availability,timezone}=preferences;
    const values={enabled,weeklyMinutes,availability,timezone};
    const result=await apiFetch<Preferences>('/api/v1/planning/preferences',json({...values,expectedRevision:revision},'PUT'));
    if (result.ok) {preferences=result.data; preview=null; message=preferences.enabled?'Automatic planning is on. Changes will appear below.':'Automatic planning is off.';}
    else error=result.error;
    busy=false;
  }
  async function makePreview() {
    busy=true;error='';message='';
    const result=await apiFetch<Run>('/api/v1/planning/preview',json({}));
    if(result.ok) preview=result.data; else error=result.error;
    busy=false;
  }
  async function changeRun(run:Run,operation:'apply'|'undo') {
    busy=true;error='';message='';
    const result=await apiFetch(`/api/v1/planning/runs/${run.id}/${operation}`,json(operation==='apply'?{sourceRevision:run.sourceRevision}:{}));
    if(result.ok) {
      preview=null; await load();
      message=operation==='apply'?'Your plan has been updated.':'Those planning changes were undone.';
      window.dispatchEvent(new Event(CALENDAR_SYNCED_EVENT));
    } else {error=result.error;busy=false;}
  }
  async function saveTask(task:Task) {
    busy=true;error='';
    const result=await apiFetch(`/api/v1/tasks/${task.id}`,json({estimated_minutes:task.estimatedMinutes,priority:task.priority},'PATCH'));
    if(result.ok) {preview=null;message='Study estimate saved.';await load();} else {error=result.error;busy=false;}
  }
</script>

<details class="planning-controls">
  <summary>Automatic planning <span>{preferences?.enabled?'On':'Off'}</span></summary>
  <div class="planning-content" aria-busy={busy}>
    <p>Make a realistic plan for the next 14 days. Locked sessions, active study, and completed work keep their place. Anything that does not fit stays listed.</p>
    {#if error}<p role="alert">{error} <button type="button" disabled={busy} onclick={load}>Refresh and try again</button></p>{/if}
    {#if message}<p role="status">{message}</p>{/if}
    {#if preferences}
      <form onsubmit={(event)=>{event.preventDefault();void save();}}>
        <label class="consent"><input type="checkbox" bind:checked={preferences.enabled} disabled={busy} /> Automatically adjust my study plan when things change</label>
        <div class="settings-row">
          <label>Weekly study capacity (minutes)<input type="number" min="0" max="10080" step="5" bind:value={preferences.weeklyMinutes} required disabled={busy} /></label>
          <label>Time zone<input type="text" bind:value={preferences.timezone} required disabled={busy} placeholder="America/Toronto" /></label>
        </div>
        <fieldset disabled={busy}>
          <legend>When can you study?</legend>
          {#each preferences.availability as window, index}
            <div class="availability-row">
              <select aria-label={`Day for availability ${index+1}`} bind:value={window.day}>{#each days as day,value}<option {value}>{day}</option>{/each}</select>
              <label>From<input type="time" value={time(window.startMinute)} onchange={e=>window.startMinute=minutes(e.currentTarget.value)} required /></label>
              <label>Until<input type="time" value={time(window.endMinute)} onchange={e=>window.endMinute=minutes(e.currentTarget.value)} required /></label>
              <button type="button" aria-label={`Remove availability ${index+1}`} onclick={()=>{if(preferences)preferences.availability=preferences.availability.filter((_,i)=>i!==index);}}>Remove</button>
            </div>
          {/each}
          {#if preferences.availability.length===0}<p>Add a study window before turning on automatic planning.</p>{/if}
          <button type="button" onclick={()=>preferences?.availability.push({day:1,startMinute:1080,endMinute:1200})}>Add study window</button>
        </fieldset>
        <div class="actions"><button type="submit" disabled={busy}>Save planning settings</button><button type="button" disabled={busy} onclick={makePreview}>Preview changes</button></div>
      </form>
      <details><summary>Study estimates and priorities</summary>
        <p>New tasks start with a 25-minute estimate. Adjust them to match the work.</p>
        {#each tasks as task (task.id)}
          <form class="task-estimate" onsubmit={e=>{e.preventDefault();void saveTask(task);}}>
            <strong>{task.title}</strong>
            <label>Minutes<input type="number" min="5" max="480" bind:value={task.estimatedMinutes} required disabled={busy} /></label>
            <label>Priority<select bind:value={task.priority} disabled={busy}><option value={0}>Low</option><option value={1}>Normal</option><option value={2}>High</option></select></label>
            <button type="submit" disabled={busy} aria-label={`Save estimate for ${task.title}`}>Save</button>
          </form>
        {:else}<p>No unfinished study tasks yet. <a href="/tasks">Add a task</a>.</p>{/each}
      </details>
      {#if preview}
        <section aria-label="Planning preview"><h2>Proposed changes</h2>{@render changes(preview)}<button type="button" disabled={busy} onclick={()=>changeRun(preview!,'apply')}>Apply these changes</button></section>
      {/if}
      <section aria-label="Planning history"><h2>Recent planning changes</h2>
        {#each runs.slice(0,5) as run (run.id)}
          <details><summary>{when(run.createdAt)} · {run.status}</summary>{@render changes(run)}
            {#if run.status==='applied' && runs.find(item=>item.status==='applied')?.id===run.id}<button type="button" disabled={busy} onclick={()=>changeRun(run,'undo')}>Undo these changes</button>{/if}
          </details>
        {:else}<p>No automatic changes yet.</p>{/each}
        <button type="button" disabled={busy} onclick={load}>Refresh planning history</button>
      </section>
    {:else if busy}<p role="status">Loading planning settings…</p>{/if}
  </div>
</details>

{#snippet changes(run:Run)}
  <ul>{#each run.changes as change}<li><strong>{change.title}</strong>: {change.before?when(change.before.scheduledAt):'Unscheduled'} → {change.after?`${when(change.after.scheduledAt)} (${change.after.plannedMinutes} min)`:'Unscheduled'}. {change.reason}</li>{:else}<li>No session moves needed.</li>{/each}</ul>
  {#if run.unplaced.length}<h3>Still unscheduled</h3><ul>{#each run.unplaced as item}<li><strong>{item.title??'Study task'}</strong>: {item.reason}</li>{/each}</ul>{/if}
{/snippet}

<style>
  .planning-controls{border-block:1px solid var(--border);margin-bottom:18px;padding:12px 0;color:var(--text)}
  summary{cursor:pointer;font-weight:650;min-height:28px}summary span{color:var(--muted);font-weight:400;margin-left:12px}
  .planning-content{display:grid;gap:16px;padding:12px 0;max-width:900px}.planning-content p{max-width:70ch;color:var(--muted)}
  form,fieldset{display:grid;gap:12px}fieldset{border:1px solid var(--border);padding:12px;border-radius:var(--radius-sm)}
  label{display:grid;gap:5px;font-size:13px}.consent{display:flex;align-items:center;gap:8px}.consent input{width:auto}
  .settings-row,.availability-row,.actions,.task-estimate{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.task-estimate{border-bottom:1px solid var(--border);padding:12px 0}.task-estimate strong{flex:1 1 220px;overflow-wrap:anywhere}
  input,select{padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);max-width:100%;min-width:0}input[type=number]{width:110px}
  button{padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);min-height:40px}button:hover{background:var(--hover)}button:disabled{opacity:.55;cursor:wait}
  h2{font-size:16px}h3{font-size:14px}li{margin:8px 0;overflow-wrap:anywhere}section{display:grid;gap:10px}
  @media(max-width:480px){.settings-row>label{width:100%}.availability-row{align-items:stretch}.availability-row select{width:100%}.availability-row label{flex:1}.task-estimate strong{flex-basis:100%}}
</style>
