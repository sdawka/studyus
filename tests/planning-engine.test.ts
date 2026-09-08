import { describe, expect, it } from 'vitest';
import { schedulePlan, availabilitySlots } from '../src/lib/planning/engine';
const minute = 60_000;
const now = Date.parse('2026-09-07T08:00:00Z');
const availability = [{day:1,startMinute:540,endMinute:720}];
describe('deterministic planning', () => {
  it('preserves duration, busy blocks and weekly capacity without dropping overflow', () => {
    const result = schedulePlan({ now, timezone:'UTC', availability, weeklyMinutes:60,
      busy:[{start:now+60*minute,end:now+90*minute}],
      items:[{id:'normal',minutes:40},{id:'urgent',minutes:35,priority:2},{id:'short',minutes:25}],
    });
    expect(result.scheduled.map(x=>x.id)).toEqual(['urgent','normal','short']);
    expect(result.scheduled[0].start).toBe(now+90*minute);
    for (const item of result.scheduled) expect(item.end-item.start).toBe(item.minutes*minute);
    const constrained = schedulePlan({now,timezone:'UTC',availability,weeklyMinutes:30,busy:[],items:[{id:'oversize',minutes:40}]});
    expect(constrained.scheduled).toEqual([]);
    expect(constrained.unplaced).toEqual([expect.objectContaining({id:'oversize',reason:'Weekly study capacity is too small for this session'})]);
  });
  it('does not place work after its deadline and is independent of input order', () => {
    const input={now,timezone:'UTC',availability,weeklyMinutes:120,busy:[],items:[{id:'b',minutes:25},{id:'a',minutes:25},{id:'late',minutes:25,deadline:now}]};
    expect(schedulePlan(input)).toEqual(schedulePlan({...input,items:[...input.items].reverse()}));
    expect(schedulePlan(input).unplaced[0]).toMatchObject({id:'late',reason:'Deadline has passed'});
  });
  it('skips nonexistent DST wall time and admits repeated real time without overlap', () => {
    const spring=availabilitySlots(Date.parse('2026-03-08T05:00:00Z'),'America/Toronto',[{day:0,startMinute:120,endMinute:180}],1);
    expect(spring).toEqual([]);
    const fall=availabilitySlots(Date.parse('2026-11-01T04:00:00Z'),'America/Toronto',[{day:0,startMinute:60,endMinute:120}],1);
    expect(fall.reduce((n,s)=>n+(s.end-s.start)/minute,0)).toBe(120);
    expect(fall.every((s,i)=>i===0 || s.start>=fall[i-1].end)).toBe(true);
  });
  it('does not infer mastery or prerequisites for unknown topics', () => {
    const result=schedulePlan({now,timezone:'UTC',availability,weeklyMinutes:60,busy:[],items:[{id:'topic',minutes:25}]});
    expect(result.scheduled[0].reasons).toEqual(['Fits your available study time']);
  });
});
