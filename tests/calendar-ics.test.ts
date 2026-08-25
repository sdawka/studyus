import { describe, expect, it } from 'vitest';
import {
  createCalendarFeedToken,
  hashCalendarFeedToken,
  issueCalendarFeedCredential,
  serializeCalendarIcs,
  stableCalendarEventUid,
  verifyCalendarFeedToken,
} from '../src/lib/calendar/ics';

const generatedAt = new Date('2026-08-25T15:30:45.123Z');

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

describe('serializeCalendarIcs', () => {
  it('uses CRLF exclusively and terminates the calendar with CRLF', () => {
    const ics = serializeCalendarIcs({ name: 'Studyus', generatedAt, events: [] });

    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).not.toMatch(/(?<!\r)\n/);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('escapes text values and folds every physical line to 75 UTF-8 octets or fewer', () => {
    const summary = 'Lab, draft; review\\redo ' + '🧪'.repeat(40);
    const description = 'First line\nSecond line, with; punctuation\\';
    const ics = serializeCalendarIcs({
      name: 'Studyus',
      generatedAt,
      events: [{
        id: 'event-escape',
        title: summary,
        description,
        start: new Date('2026-09-03T14:05:06.789Z'),
        end: new Date('2026-09-03T15:35:06.789Z'),
      }],
    });
    const logical = unfold(ics);

    expect(logical).toContain(`SUMMARY:Lab\\, draft\\; review\\\\redo ${'🧪'.repeat(40)}\r\n`);
    expect(logical).toContain('DESCRIPTION:First line\\nSecond line\\, with\\; punctuation\\\\\r\n');
    for (const line of ics.split('\r\n').slice(0, -1)) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
  });

  it('serializes timed events as whole-second UTC DTSTART and DTEND values', () => {
    const ics = unfold(serializeCalendarIcs({
      name: 'Studyus',
      generatedAt,
      events: [{
        id: 'timed-1',
        title: 'Office hours',
        start: new Date('2026-09-03T14:05:06.789Z'),
        end: new Date('2026-09-03T15:35:06.789Z'),
      }],
    }));

    expect(ics).toContain('DTSTAMP:20260825T153045Z\r\n');
    expect(ics).toContain('DTSTART:20260903T140506Z\r\n');
    expect(ics).toContain('DTEND:20260903T153506Z\r\n');
    expect(ics).not.toContain('TZID=');
  });

  it('serializes all-day events with VALUE=DATE and an exclusive end date', () => {
    const ics = unfold(serializeCalendarIcs({
      name: 'Studyus',
      generatedAt,
      events: [{
        id: 'all-day-1',
        title: 'Reading week',
        allDay: true,
        startDate: '2026-10-12',
        endDateExclusive: '2026-10-17',
      }],
    }));

    expect(ics).toContain('DTSTART;VALUE=DATE:20261012\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20261017\r\n');
  });

  it('keeps UIDs stable across content changes and marks cancellations', () => {
    const uid = stableCalendarEventUid('task', 'task 123');
    expect(uid).toBe(stableCalendarEventUid('task', 'task 123'));
    expect(uid).not.toBe(stableCalendarEventUid('task', 'task 124'));

    const ics = unfold(serializeCalendarIcs({
      name: 'Studyus',
      generatedAt,
      method: 'CANCEL',
      events: [{
        id: 'task 123',
        uid,
        title: 'Cancelled quiz',
        start: new Date('2026-09-04T13:00:00Z'),
        end: new Date('2026-09-04T14:00:00Z'),
        status: 'CANCELLED',
        sequence: 2,
      }],
    }));

    expect(ics).toContain('METHOD:CANCEL\r\n');
    expect(ics).toContain(`UID:${uid}\r\n`);
    expect(ics).toContain('STATUS:CANCELLED\r\n');
    expect(ics).toContain('SEQUENCE:2\r\n');
  });
});

describe('revocable calendar feed credentials', () => {
  it('issues high-entropy opaque tokens, stores only their digest, and verifies them', async () => {
    const first = await issueCalendarFeedCredential();
    const secondToken = createCalendarFeedToken();

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondToken).not.toBe(first.token);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toContain(first.token);
    expect(await hashCalendarFeedToken(first.token)).toBe(first.tokenHash);
    expect(await verifyCalendarFeedToken(first.token, first.tokenHash)).toBe(true);
    expect(await verifyCalendarFeedToken(secondToken, first.tokenHash)).toBe(false);
  });

  it('never writes the bearer feed secret into calendar content', async () => {
    const { token } = await issueCalendarFeedCredential();
    const ics = serializeCalendarIcs({
      name: 'Studyus calendar',
      generatedAt,
      events: [{
        id: 'safe-event',
        title: 'Review notes',
        start: new Date('2026-09-03T14:00:00Z'),
        end: new Date('2026-09-03T14:30:00Z'),
      }],
    });

    expect(ics).not.toContain(token);
    expect(ics).not.toMatch(/token=/i);
  });
});
