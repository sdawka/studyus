import { render,screen,fireEvent,waitFor } from '@testing-library/svelte';
import { describe,it,expect,vi,beforeEach } from 'vitest';
import PlanningControls from '../../src/components/planner/PlanningControls.svelte';
const preferences={enabled:false,weeklyMinutes:420,availability:[],revision:3,timezone:'America/Toronto'};
let requests:Array<{path:string;body:unknown}>;
beforeEach(()=>{
  requests=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
    const body=init?.body?JSON.parse(String(init.body)):undefined;
    requests.push({path,body});
    const data=path.endsWith('/preferences')?{...preferences,...body,revision:body?4:3}:[];
    return new Response(JSON.stringify({data}),{headers:{'Content-Type':'application/json'}});
  }));
});
describe('planning controls',()=>{
  it('requires an explicit opt-in and sends the saved revision with availability',async()=>{
    const view=render(PlanningControls);
    (view.container.querySelector('details') as HTMLDetailsElement).open=true;
    const checkbox=await screen.findByRole('checkbox',{name:'Automatically adjust my study plan when things change'});
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    await fireEvent.click(screen.getByRole('button',{name:'Add study window'}));
    await fireEvent.click(checkbox);
    await fireEvent.click(screen.getByRole('button',{name:'Save planning settings'}));
    await waitFor(()=>expect(requests).toContainEqual({path:'/api/v1/planning/preferences',body:{enabled:true,weeklyMinutes:420,timezone:'America/Toronto',availability:[{day:1,startMinute:1080,endMinute:1200}],expectedRevision:3}}));
    expect((await screen.findByRole('status')).textContent).toContain('Automatic planning is on');
  });
  it('keeps a rejected preview visible with a refresh action rather than claiming it applied',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
      if(path.endsWith('/apply'))return new Response(JSON.stringify({error:{message:'Your plan changed. Preview again.'}}),{status:409});
      return new Response(JSON.stringify({data:path.endsWith('/preferences')?preferences:path.endsWith('/preview')?{id:'run',status:'preview',createdAt:Date.now(),changes:[],unplaced:[{id:'task',title:'Long assignment',reason:'No available time'}]}:[]}));
    }));
    const view=render(PlanningControls);
    (view.container.querySelector('details') as HTMLDetailsElement).open=true;
    await screen.findByRole('checkbox');
    await fireEvent.click(screen.getByRole('button',{name:'Preview changes'}));
    await fireEvent.click(await screen.findByRole('button',{name:'Apply these changes'}));
    expect((await screen.findByRole('alert')).textContent).toContain('Your plan changed');
    expect(screen.getByText('Long assignment')).toBeTruthy();
    expect(screen.queryByText('Your plan has been updated.')).toBeNull();
  });
});
