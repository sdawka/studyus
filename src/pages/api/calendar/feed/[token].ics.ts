import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { serializeCalendarIcs, type CalendarIcsEvent } from '../../../../lib/calendar/ics';
import { getCalendar } from '../../../../lib/services/calendar';
import { resolveCalendarFeedUser } from '../../../../lib/services/calendarFeed';

function dateKey(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export const GET: APIRoute = async ({ params }) => {
  const db = getDb(env.DB);
  const user = await resolveCalendarFeedUser(db, params.token ?? '');
  if (!user) return new Response('Not found', { status: 404 });

  const from = Date.now() - 30 * 86_400_000;
  const to = Date.now() + 370 * 86_400_000;
  const items = await getCalendar(db, user.id, from, to, undefined, { sweep: false });
  const events: CalendarIcsEvent[] = [];
  for (const item of items) {
    // External events are already in the subscriber's provider; reflecting
    // them back creates loops. Logged activity is history, not a commitment.
    if (item.type === 'external_event' || item.type === 'event_logged' || item.type === 'class_session') continue;
    if (item.all_day) {
      const startDate = typeof item.details.date_only === 'string'
        ? item.details.date_only
        : dateKey(item.date, user.timezone);
      const endDateExclusive = typeof item.details.end_date_exclusive === 'string'
        ? item.details.end_date_exclusive
        : nextDate(startDate);
      events.push({ id: `${item.type}:${item.id}`, title: item.title, allDay: true, startDate, endDateExclusive });
      continue;
    }
    const start = new Date(item.date);
    const end = item.end_date ? new Date(item.end_date) : new Date(start.getTime() + 30 * 60_000);
    events.push({ id: `${item.type}:${item.id}`, title: item.title, start, end });
  }
  const body = serializeCalendarIcs({ name: `${user.name ?? 'My'} Studyus calendar`, events });
  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="studyus.ics"',
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
};
