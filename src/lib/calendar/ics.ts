const CRLF = '\r\n';
const UTF8 = new TextEncoder();
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type CalendarIcsMethod = 'PUBLISH' | 'REQUEST' | 'CANCEL';
export type CalendarIcsStatus = 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED';

interface CalendarIcsEventBase {
  /** Stable source identifier. It must not contain a bearer feed token. */
  id: string;
  /** Override when the caller already owns a globally stable UID. */
  uid?: string;
  title: string;
  description?: string | null;
  location?: string | null;
  status?: CalendarIcsStatus;
  sequence?: number;
}

export interface TimedCalendarIcsEvent extends CalendarIcsEventBase {
  allDay?: false;
  start: Date;
  end: Date;
  startDate?: never;
  endDateExclusive?: never;
}

export interface AllDayCalendarIcsEvent extends CalendarIcsEventBase {
  allDay: true;
  /** Gregorian calendar date, formatted YYYY-MM-DD. */
  startDate: string;
  /** RFC 5545 DTEND is non-inclusive for all-day events. */
  endDateExclusive: string;
  start?: never;
  end?: never;
}

export type CalendarIcsEvent = TimedCalendarIcsEvent | AllDayCalendarIcsEvent;

export interface SerializeCalendarIcsInput {
  name: string;
  events: readonly CalendarIcsEvent[];
  /** Injected to make DTSTAMP deterministic in tests and jobs. */
  generatedAt?: Date;
  method?: CalendarIcsMethod;
  prodId?: string;
}

export interface CalendarFeedCredential {
  /** The bearer value returned once to the user and never stored directly. */
  token: string;
  /** Persist this digest. Revocation means deleting/replacing this value. */
  tokenHash: string;
}

function assertValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${field} must be a valid Date`);
  }
}

function compactUtc(value: Date): string {
  assertValidDate(value, 'Calendar timestamp');
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function compactDate(value: string, field: string): string {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new TypeError(`${field} must use YYYY-MM-DD`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new TypeError(`${field} must be a real Gregorian date`);
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

/** RFC 5545 TEXT escaping. Property names/parameters are authored internally. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Fold a content line without splitting a Unicode code point. RFC 5545 limits
 * physical lines to 75 octets; continuation lines spend one octet on a space.
 */
function foldContentLine(line: string): string {
  const physical: string[] = [];
  let segment = '';
  let segmentBytes = 0;
  let payloadLimit = 75;

  for (const character of line) {
    const characterBytes = UTF8.encode(character).byteLength;
    if (segment && segmentBytes + characterBytes > payloadLimit) {
      physical.push(segment);
      segment = '';
      segmentBytes = 0;
      payloadLimit = 74;
    }
    segment += character;
    segmentBytes += characterBytes;
  }
  physical.push(segment);

  return physical.map((part, index) => index === 0 ? part : ` ${part}`).join(CRLF);
}

function textProperty(name: string, value: string): string {
  return `${name}:${escapeText(value)}`;
}

function eventLines(event: CalendarIcsEvent, dtstamp: string): string[] {
  if (!event.id.trim()) throw new TypeError('Calendar event id cannot be empty');
  if (!event.title.trim()) throw new TypeError('Calendar event title cannot be empty');
  if (event.sequence !== undefined && (!Number.isSafeInteger(event.sequence) || event.sequence < 0)) {
    throw new TypeError('Calendar event sequence must be a non-negative integer');
  }

  const lines = [
    'BEGIN:VEVENT',
    textProperty('UID', event.uid ?? stableCalendarEventUid('event', event.id)),
    `DTSTAMP:${dtstamp}`,
  ];

  if (event.allDay) {
    const start = compactDate(event.startDate, 'startDate');
    const end = compactDate(event.endDateExclusive, 'endDateExclusive');
    if (event.endDateExclusive <= event.startDate) {
      throw new RangeError('endDateExclusive must be after startDate');
    }
    lines.push(`DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`);
  } else {
    assertValidDate(event.start, 'start');
    assertValidDate(event.end, 'end');
    if (event.end.getTime() <= event.start.getTime()) {
      throw new RangeError('end must be after start');
    }
    lines.push(`DTSTART:${compactUtc(event.start)}`, `DTEND:${compactUtc(event.end)}`);
  }

  lines.push(textProperty('SUMMARY', event.title));
  if (event.description) lines.push(textProperty('DESCRIPTION', event.description));
  if (event.location) lines.push(textProperty('LOCATION', event.location));
  if (event.status) lines.push(`STATUS:${event.status}`);
  if (event.sequence !== undefined) lines.push(`SEQUENCE:${event.sequence}`);
  lines.push('END:VEVENT');
  return lines;
}

/** Serialize an RFC 5545 calendar using CRLF and UTF-8-octet line folding. */
export function serializeCalendarIcs(input: SerializeCalendarIcsInput): string {
  const generatedAt = input.generatedAt ?? new Date();
  const dtstamp = compactUtc(generatedAt);
  if (!input.name.trim()) throw new TypeError('Calendar name cannot be empty');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    textProperty('PRODID', input.prodId ?? '-//Studyus//Calendar Feed//EN'),
    'CALSCALE:GREGORIAN',
    `METHOD:${input.method ?? 'PUBLISH'}`,
    textProperty('X-WR-CALNAME', input.name),
    ...input.events.flatMap((event) => eventLines(event, dtstamp)),
    'END:VCALENDAR',
  ];

  return lines.map(foldContentLine).join(CRLF) + CRLF;
}

/** Stable across event edits; only the immutable source kind and id matter. */
export function stableCalendarEventUid(source: string, id: string): string {
  if (!source.trim() || !id.trim()) throw new TypeError('UID source and id cannot be empty');
  return `${encodeURIComponent(source)}-${encodeURIComponent(id)}@studyus.app`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a 256-bit bearer secret suitable for an unguessable feed URL. */
export function createCalendarFeedToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** One-way digest intended for persistence instead of the bearer secret. */
export async function hashCalendarFeedToken(token: string): Promise<string> {
  if (!token) throw new TypeError('Calendar feed token cannot be empty');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', UTF8.encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-work comparison after hashing the presented bearer value. */
export async function verifyCalendarFeedToken(token: string, expectedHash: string): Promise<boolean> {
  const actualHash = await hashCalendarFeedToken(token);
  const normalizedExpected = expectedHash.toLowerCase();
  let difference = actualHash.length ^ normalizedExpected.length;
  for (let index = 0; index < actualHash.length; index += 1) {
    difference |= actualHash.charCodeAt(index) ^ (normalizedExpected.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** Issue a credential pair; expose token once and persist only tokenHash. */
export async function issueCalendarFeedCredential(): Promise<CalendarFeedCredential> {
  const token = createCalendarFeedToken();
  return { token, tokenHash: await hashCalendarFeedToken(token) };
}
