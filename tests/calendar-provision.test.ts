import { describe, expect, it, vi } from 'vitest';
import { createGoogleCalendarProvider } from '../src/lib/calendar/providers/google';
import { createMicrosoftCalendarProvider, MICROSOFT_STUDYUS_MARKER_PROPERTY } from '../src/lib/calendar/providers/microsoft';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('calendar provider provisioning boundary', () => {
  it('uses a hidden Google description marker for provision, discovery, and delete', async () => {
    const marker = crypto.randomUUID();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'google-studyus', summary: 'Studyus', timeZone: 'America/Toronto' }, 201))
      .mockResolvedValueOnce(json({ items: [{ id: 'google-studyus', summary: 'Studyus', description: `Studyus provision marker: ${marker}`, timeZone: 'America/Toronto', accessRole: 'owner' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = createGoogleCalendarProvider({ fetch });

    await expect(provider.provisionCalendar!({ accessToken: 'token', marker, timezone: 'America/Toronto' })).resolves.toMatchObject({ id: 'google-studyus', name: 'Studyus' });
    await expect(provider.discoverProvisionedCalendar!({ accessToken: 'token', marker })).resolves.toMatchObject({ id: 'google-studyus' });
    await provider.deleteProvisionedCalendar!({ accessToken: 'token', calendarId: 'google-studyus' });

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      summary: 'Studyus', description: expect.stringContaining(marker),
    });
    expect(String(fetch.mock.calls[1][0])).toContain('/users/me/calendarList');
    expect(fetch.mock.calls[2]).toEqual([expect.stringContaining('/calendars/google-studyus'), expect.objectContaining({ method: 'DELETE' })]);
  });

  it('uses the Microsoft single-value calendar property to provision and discover without exposing the marker in the name', async () => {
    const marker = crypto.randomUUID();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ id: 'ms-studyus', name: 'Studyus' }, 201))
      .mockResolvedValueOnce(json({ value: [{ id: 'ms-studyus', name: 'Studyus' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = createMicrosoftCalendarProvider({ fetch });

    await expect(provider.provisionCalendar!({ accessToken: 'token', marker, timezone: 'America/Toronto' })).resolves.toMatchObject({ id: 'ms-studyus', name: 'Studyus' });
    await expect(provider.discoverProvisionedCalendar!({ accessToken: 'token', marker })).resolves.toMatchObject({ id: 'ms-studyus' });
    await provider.deleteProvisionedCalendar!({ accessToken: 'token', calendarId: 'ms-studyus' });

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({
      name: 'Studyus', singleValueExtendedProperties: [{ id: MICROSOFT_STUDYUS_MARKER_PROPERTY, value: marker }],
    });
    expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('$filter')).toContain(`ep/value eq '${marker}'`);
    expect(fetch.mock.calls[2]).toEqual([expect.stringContaining('/me/calendars/ms-studyus'), expect.objectContaining({ method: 'DELETE' })]);
  });
});
