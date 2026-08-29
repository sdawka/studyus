/**
 * Provider-neutral calendar primitives.
 *
 * Calendar dates and instants are deliberately different types: a date such
 * as a due date must never be routed through `Date` and shifted by a timezone.
 * Timed values, conversely, always carry both an absolute instant and the IANA
 * timezone needed to render/edit the event in its intended wall time.
 */

export const CALENDAR_ID_NAMESPACES = [
  'studyus.task',
  'studyus.assessment',
  'studyus.session',
  'studyus.event',
  'studyus.class-session',
  'provider.google',
  'provider.microsoft',
  'provider.apple',
  'provider.ics',
] as const;

export type CalendarIdNamespace = (typeof CALENDAR_ID_NAMESPACES)[number];
export type CalendarProvider = 'google' | 'microsoft' | 'apple' | 'ics';
export type CalendarSyncPolicy = 'local-only' | 'read-only' | 'two-way';

/** How long a provider calendar's sync can go without a refresh before it is stale. */
export const CALENDAR_ACTIVITY_STALE_MS = 15 * 60 * 1_000;

export type CalendarDateSpan = {
  kind: 'date';
  startDate: string;
  /** Exclusive, matching iCalendar and major provider APIs. */
  endDate?: string;
};

export type CalendarTimedSpan = {
  kind: 'timed';
  startsAt: string;
  endsAt?: string;
  timeZone: string;
};

export type CalendarWhen = CalendarDateSpan | CalendarTimedSpan;

export type CalendarOwnership =
  | { authority: 'studyus'; userId: string }
  | { authority: 'provider'; provider: CalendarProvider; accountId: string };

export type CalendarItem = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  when: CalendarWhen;
  ownership: CalendarOwnership;
  syncPolicy: CalendarSyncPolicy;
};

export type ProviderCalendarItemInput = {
  provider: CalendarProvider;
  accountId: string;
  externalId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  readOnly: boolean;
  when:
    | { allDay: true; start: string; end?: string }
    | { allDay: false; start: string; end?: string; timeZone: string };
  /** Adapters may pass extra provider fields; they never enter the domain. */
  [providerField: string]: unknown;
};

export class CalendarDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarDomainError';
  }
}

const namespaceSet = new Set<string>(CALENDAR_ID_NAMESPACES);
const providerSet = new Set<CalendarProvider>(['google', 'microsoft', 'apple', 'ics']);
const syncPolicySet = new Set<CalendarSyncPolicy>(['local-only', 'read-only', 'two-way']);
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFFSET_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i;

function fail(message: string): never {
  throw new CalendarDomainError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonBlank(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-blank string`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return nonBlank(value, label);
}

function dateOnly(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be a YYYY-MM-DD date`);
  const match = DATE_ONLY.exec(value);
  if (!match) fail(`${label} must be a YYYY-MM-DD date`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    fail(`${label} is not a real calendar date`);
  }
  return value;
}

function instant(value: unknown, label: string): string {
  if (typeof value !== 'string' || !OFFSET_INSTANT.test(value)) {
    fail(`${label} must be an ISO 8601 instant with Z or a numeric UTC offset`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${label} is not a valid instant`);
  return parsed.toISOString();
}

function ianaTimeZone(value: unknown): string {
  const timeZone = nonBlank(value, 'timeZone');
  // Intl accepts legacy abbreviations such as EST. The canonical domain does
  // not: they are ambiguous and do not preserve daylight-saving behavior.
  if (timeZone !== 'UTC' && !timeZone.includes('/')) {
    fail('timeZone must be an IANA time zone');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
  } catch {
    fail('timeZone must be an IANA time zone');
  }
  return timeZone;
}

export function calendarItemId(namespace: CalendarIdNamespace, externalId: string): string {
  if (!namespaceSet.has(namespace)) fail(`Unsupported calendar ID namespace: ${namespace}`);
  const id = nonBlank(externalId, 'externalId');
  return `${namespace}:${encodeURIComponent(id)}`;
}

export function parseCalendarItemId(value: unknown): {
  namespace: CalendarIdNamespace;
  externalId: string;
} {
  const id = nonBlank(value, 'calendar item id');
  const separator = id.indexOf(':');
  if (separator <= 0 || separator === id.length - 1) fail('Malformed calendar item ID');

  const namespace = id.slice(0, separator);
  if (!namespaceSet.has(namespace)) fail(`Unsupported calendar ID namespace: ${namespace}`);

  let externalId: string;
  try {
    externalId = decodeURIComponent(id.slice(separator + 1));
  } catch {
    fail('Malformed calendar item ID encoding');
  }
  if (!externalId.trim()) fail('Calendar item external ID cannot be empty');
  return { namespace: namespace as CalendarIdNamespace, externalId };
}

function parseWhen(value: unknown): CalendarWhen {
  const input = record(value, 'when');
  if (input.kind === 'date') {
    const startDate = dateOnly(input.startDate, 'startDate');
    const endDate = input.endDate === undefined ? undefined : dateOnly(input.endDate, 'endDate');
    if (endDate !== undefined && endDate <= startDate) {
      fail('endDate must be after startDate');
    }
    return endDate === undefined
      ? { kind: 'date', startDate }
      : { kind: 'date', startDate, endDate };
  }

  if (input.kind === 'timed') {
    const startsAt = instant(input.startsAt, 'startsAt');
    const endsAt = input.endsAt === undefined ? undefined : instant(input.endsAt, 'endsAt');
    const timeZone = ianaTimeZone(input.timeZone);
    if (endsAt !== undefined && Date.parse(endsAt) <= Date.parse(startsAt)) {
      fail('endsAt must be after startsAt');
    }
    return endsAt === undefined
      ? { kind: 'timed', startsAt, timeZone }
      : { kind: 'timed', startsAt, endsAt, timeZone };
  }

  return fail('when.kind must be either date or timed');
}

function parseOwnership(value: unknown): CalendarOwnership {
  const input = record(value, 'ownership');
  if (input.authority === 'studyus') {
    return { authority: 'studyus', userId: nonBlank(input.userId, 'ownership.userId') };
  }
  if (input.authority === 'provider') {
    const provider = nonBlank(input.provider, 'ownership.provider');
    if (!providerSet.has(provider as CalendarProvider)) fail(`Unsupported calendar provider: ${provider}`);
    return {
      authority: 'provider',
      provider: provider as CalendarProvider,
      accountId: nonBlank(input.accountId, 'ownership.accountId'),
    };
  }
  return fail('ownership.authority must be studyus or provider');
}

/** Validate unknown data at service/API boundaries and return canonical data. */
export function parseCalendarItem(value: unknown): CalendarItem {
  const input = record(value, 'calendar item');
  const parsedId = parseCalendarItemId(input.id);
  const ownership = parseOwnership(input.ownership);
  const syncPolicy = nonBlank(input.syncPolicy, 'syncPolicy');
  if (!syncPolicySet.has(syncPolicy as CalendarSyncPolicy)) {
    fail(`Unsupported sync policy: ${syncPolicy}`);
  }

  if (ownership.authority === 'studyus') {
    if (!parsedId.namespace.startsWith('studyus.')) {
      fail('Calendar ID namespace contradicts Studyus ownership');
    }
    if (syncPolicy === 'read-only') {
      fail('Studyus-owned items cannot use the provider read-only sync policy');
    }
  } else {
    if (parsedId.namespace !== `provider.${ownership.provider}`) {
      fail('Calendar ID namespace contradicts provider ownership');
    }
    if (syncPolicy === 'local-only') {
      fail('Provider-owned items cannot use the local-only sync policy');
    }
  }

  const description = optionalText(input.description, 'description');
  const location = optionalText(input.location, 'location');
  return {
    id: input.id as string,
    title: nonBlank(input.title, 'title'),
    ...(description === undefined ? {} : { description }),
    ...(location === undefined ? {} : { location }),
    when: parseWhen(input.when),
    ownership,
    syncPolicy: syncPolicy as CalendarSyncPolicy,
  };
}

/**
 * The sole generic provider boundary. Provider adapters translate their raw
 * SDK responses into this narrow input; raw payloads and provider-only fields
 * are intentionally discarded here.
 */
export function normalizeProviderCalendarItem(input: ProviderCalendarItemInput): CalendarItem {
  const provider = nonBlank(input.provider, 'provider');
  if (!providerSet.has(provider as CalendarProvider)) fail(`Unsupported calendar provider: ${provider}`);
  if (typeof input.readOnly !== 'boolean') fail('readOnly must be a boolean');
  const whenInput = record(input.when, 'when');

  const when: CalendarWhen = whenInput.allDay === true
    ? {
        kind: 'date',
        startDate: nonBlank(whenInput.start, 'when.start'),
        ...(whenInput.end === undefined ? {} : { endDate: nonBlank(whenInput.end, 'when.end') }),
      }
    : whenInput.allDay === false
      ? {
          kind: 'timed',
          startsAt: nonBlank(whenInput.start, 'when.start'),
          ...(whenInput.end === undefined ? {} : { endsAt: nonBlank(whenInput.end, 'when.end') }),
          timeZone: nonBlank(whenInput.timeZone, 'when.timeZone'),
        }
      : fail('when.allDay must be a boolean');

  return parseCalendarItem({
    id: calendarItemId(`provider.${provider}` as CalendarIdNamespace, input.externalId),
    title: input.title,
    description: input.description,
    location: input.location,
    when,
    ownership: {
      authority: 'provider',
      provider,
      accountId: input.accountId,
    },
    syncPolicy: input.readOnly ? 'read-only' : 'two-way',
  });
}
