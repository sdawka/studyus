import { describe, expect, it } from 'vitest';
import {
  CalendarDomainError,
  calendarItemId,
  normalizeProviderCalendarItem,
  parseCalendarItem,
  parseCalendarItemId,
} from '../src/lib/calendar/domain';

describe('canonical calendar domain', () => {
  describe('namespaced IDs', () => {
    it('round-trips source identity without collisions or delimiter ambiguity', () => {
      const local = calendarItemId('studyus.task', 'same-id');
      const remote = calendarItemId('provider.google', 'same-id');
      const complex = calendarItemId('provider.microsoft', 'AAMk:abc/123?x=1');

      expect(local).toBe('studyus.task:same-id');
      expect(remote).toBe('provider.google:same-id');
      expect(local).not.toBe(remote);
      expect(parseCalendarItemId(complex)).toEqual({
        namespace: 'provider.microsoft',
        externalId: 'AAMk:abc/123?x=1',
      });
    });

    it('rejects empty, malformed, and unsupported namespaces', () => {
      expect(() => calendarItemId('provider.google', '')).toThrow(CalendarDomainError);
      expect(() => parseCalendarItemId('plain-database-id')).toThrow(CalendarDomainError);
      expect(() => parseCalendarItemId('provider.unknown:event-1')).toThrow(CalendarDomainError);
    });
  });

  describe('date-only and timed values', () => {
    it('keeps a date-only item free of accidental midnight/timezone conversion', () => {
      const item = parseCalendarItem({
        id: calendarItemId('studyus.assessment', 'midterm'),
        title: 'Midterm',
        when: { kind: 'date', startDate: '2026-11-01', endDate: '2026-11-02' },
        ownership: { authority: 'studyus', userId: 'user-1' },
        syncPolicy: 'local-only',
      });

      expect(item.when).toEqual({
        kind: 'date',
        startDate: '2026-11-01',
        endDate: '2026-11-02',
      });
      expect(item.when).not.toHaveProperty('timeZone');
    });

    it('requires an IANA timezone for timed items and canonicalizes instants to UTC', () => {
      const item = parseCalendarItem({
        id: calendarItemId('studyus.session', 'session-1'),
        title: 'Review',
        when: {
          kind: 'timed',
          startsAt: '2026-11-01T01:30:00-04:00',
          endsAt: '2026-11-01T02:30:00-05:00',
          timeZone: 'America/Toronto',
        },
        ownership: { authority: 'studyus', userId: 'user-1' },
        syncPolicy: 'local-only',
      });

      expect(item.when).toEqual({
        kind: 'timed',
        startsAt: '2026-11-01T05:30:00.000Z',
        endsAt: '2026-11-01T07:30:00.000Z',
        timeZone: 'America/Toronto',
      });

      expect(() => parseCalendarItem({
        ...item,
        when: { ...item.when, timeZone: 'EST' },
      })).toThrow(/IANA time zone/i);
    });
  });

  describe('ownership and sync policy', () => {
    it('allows local-only Studyus items and read-only provider items', () => {
      expect(parseCalendarItem({
        id: calendarItemId('studyus.task', 'task-1'),
        title: 'Read chapter 4',
        when: { kind: 'date', startDate: '2026-09-10' },
        ownership: { authority: 'studyus', userId: 'user-1' },
        syncPolicy: 'local-only',
      }).syncPolicy).toBe('local-only');

      expect(parseCalendarItem({
        id: calendarItemId('provider.google', 'event-1'),
        title: 'Lab',
        when: {
          kind: 'timed',
          startsAt: '2026-09-10T14:00:00Z',
          timeZone: 'America/Toronto',
        },
        ownership: { authority: 'provider', provider: 'google', accountId: 'acct-1' },
        syncPolicy: 'read-only',
      }).syncPolicy).toBe('read-only');
    });

    it('rejects ownership, namespace, and sync-policy contradictions', () => {
      expect(() => parseCalendarItem({
        id: calendarItemId('provider.google', 'event-1'),
        title: 'Lab',
        when: { kind: 'date', startDate: '2026-09-10' },
        ownership: { authority: 'provider', provider: 'microsoft', accountId: 'acct-1' },
        syncPolicy: 'local-only',
      })).toThrow(/ownership|namespace|sync/i);
    });
  });

  describe('provider normalization boundary', () => {
    it('maps provider-shaped input into the canonical model and drops raw payloads', () => {
      const item = normalizeProviderCalendarItem({
        provider: 'google',
        accountId: 'acct-1',
        externalId: 'google:event/42',
        title: 'Seminar',
        description: 'Room changed',
        location: 'Library 201',
        readOnly: true,
        when: {
          allDay: false,
          start: '2026-09-12T09:00:00-04:00',
          end: '2026-09-12T10:15:00-04:00',
          timeZone: 'America/Toronto',
        },
        rawProviderPayload: { etag: 'must-not-cross-the-boundary' },
      });

      expect(item).toEqual({
        id: calendarItemId('provider.google', 'google:event/42'),
        title: 'Seminar',
        description: 'Room changed',
        location: 'Library 201',
        when: {
          kind: 'timed',
          startsAt: '2026-09-12T13:00:00.000Z',
          endsAt: '2026-09-12T14:15:00.000Z',
          timeZone: 'America/Toronto',
        },
        ownership: { authority: 'provider', provider: 'google', accountId: 'acct-1' },
        syncPolicy: 'read-only',
      });
      expect(item).not.toHaveProperty('rawProviderPayload');
    });

    it('normalizes provider all-day dates without turning them into instants', () => {
      const item = normalizeProviderCalendarItem({
        provider: 'microsoft',
        accountId: 'acct-2',
        externalId: 'event-2',
        title: 'Reading week',
        readOnly: false,
        when: { allDay: true, start: '2026-10-12', end: '2026-10-17' },
      });

      expect(item.when).toEqual({
        kind: 'date',
        startDate: '2026-10-12',
        endDate: '2026-10-17',
      });
      expect(item.syncPolicy).toBe('two-way');
    });
  });

  describe('validation', () => {
    it.each([
      ['blank title', { title: '   ' }],
      ['impossible date', { when: { kind: 'date', startDate: '2026-02-30' } }],
      ['reversed date range', { when: { kind: 'date', startDate: '2026-09-12', endDate: '2026-09-11' } }],
      ['offset-free instant', { when: { kind: 'timed', startsAt: '2026-09-12T09:00:00', timeZone: 'America/Toronto' } }],
      ['reversed timed range', { when: { kind: 'timed', startsAt: '2026-09-12T10:00:00Z', endsAt: '2026-09-12T09:00:00Z', timeZone: 'America/Toronto' } }],
    ])('rejects %s', (_label, patch) => {
      expect(() => parseCalendarItem({
        id: calendarItemId('studyus.task', 'task-1'),
        title: 'Valid title',
        when: { kind: 'date', startDate: '2026-09-12' },
        ownership: { authority: 'studyus', userId: 'user-1' },
        syncPolicy: 'local-only',
        ...patch,
      })).toThrow(CalendarDomainError);
    });
  });
});
