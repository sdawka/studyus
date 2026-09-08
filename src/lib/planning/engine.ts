import { comparePlanningPriority, priorityReasons, type PlanningPriority } from './priority';

export type Availability = { day: number; startMinute: number; endMinute: number };
export type Interval = { start: number; end: number };
export type PlanItem = PlanningPriority & { minutes: number; title?: string };
type Slot = Interval & { week: string };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const formatters = new Map<string, Intl.DateTimeFormat>();

export function zonedClock(time: number, timezone: string) {
  let formatter=formatters.get(timezone);
  if (!formatter) {
    formatter=new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23' });
    if (formatters.size>=8) formatters.delete(formatters.keys().next().value!);
    formatters.set(timezone,formatter);
  }
  const parts = formatter.formatToParts(time);
  const get = (type: string) => Number(parts.find(p=>p.type===type)?.value);
  const date = Date.UTC(get('year'),get('month')-1,get('day'));
  const day = new Date(date).getUTCDay();
  const monday = date - ((day+6)%7)*DAY;
  return { day, minute:get('hour')*60+get('minute'), date:new Date(date).toISOString().slice(0,10), week:new Date(monday).toISOString().slice(0,10) };
}

/** Enumerate real instants, so spring gaps and repeated autumn hours are exact. */
export function availabilitySlots(now: number, timezone: string, availability: Availability[], days = 14): Slot[] {
  const slots: Slot[] = [];
  const step = 5 * MINUTE;
  for (let time=Math.ceil(now/step)*step; time+step<=now+days*DAY; time+=step) {
    const wall=zonedClock(time,timezone);
    if (!availability.some(a=>a.day===wall.day && wall.minute>=a.startMinute && wall.minute+5<=a.endMinute)) continue;
    const previous=slots.at(-1);
    if (previous && previous.end===time && previous.week===wall.week) previous.end=time+step;
    else slots.push({start:time,end:time+step,week:wall.week});
  }
  return slots;
}

export function schedulePlan(input: {
  now: number; timezone: string; availability: Availability[]; weeklyMinutes: number;
  items: PlanItem[]; busy: Interval[]; committedStudy?: Interval[];
}) {
  const slots=availabilitySlots(input.now,input.timezone,input.availability);
  const busy=[...input.busy].sort((a,b)=>a.start-b.start);
  const used=new Map<string,number>();
  // Split existing study across local weeks; external busy time is not study capacity.
  for (const interval of input.committedStudy ?? []) {
    for (let t=interval.start;t<interval.end;) {
      const end=Math.min(t+MINUTE,interval.end);
      const week=zonedClock(t,input.timezone).week;
      used.set(week,(used.get(week)??0)+(end-t)/MINUTE);
      t=end;
    }
  }
  const scheduled: Array<PlanItem & Interval & { reasons: string[] }> = [];
  const unplaced: Array<PlanItem & {reason:string}> = [];
  for (const item of [...input.items].sort(comparePlanningPriority)) {
    let placed=false;
    if (!Number.isFinite(item.minutes) || item.minutes<=0) throw new RangeError('Session duration must be positive');
    for (const slot of slots) {
      if ((used.get(slot.week)??0)+item.minutes>input.weeklyMinutes) continue;
      let start=slot.start;
      for (const block of busy) {
        if (block.end<=start) continue;
        if (block.start>=start+item.minutes*MINUTE) break;
        start=Math.max(start,block.end);
      }
      const end=start+item.minutes*MINUTE;
      if (end>slot.end || end>(item.deadline??Infinity)) continue;
      scheduled.push({...item,start,end,reasons:priorityReasons(item)});
      busy.push({start,end}); busy.sort((a,b)=>a.start-b.start);
      used.set(slot.week,(used.get(slot.week)??0)+item.minutes);
      placed=true; break;
    }
    if (!placed) unplaced.push({...item,reason:
      item.deadline!=null && item.deadline<=input.now ? 'Deadline has passed'
      : item.minutes>input.weeklyMinutes ? 'Weekly study capacity is too small for this session'
      : input.availability.length===0 ? 'Set your study availability first'
      : 'No available time before the deadline within the next 14 days',
    });
  }
  return {scheduled,unplaced};
}
