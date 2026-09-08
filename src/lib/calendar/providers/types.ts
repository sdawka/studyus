export type CalendarProviderName = 'google' | 'microsoft';

export interface ProviderEventInput {
  localId: string;
  source: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** Provider-reported IANA/Windows zone; adapters normalize UTC when absent. */
  timezone?: string;
  description?: string;
  location?: string;
  transactionId?: string;
}

export interface ProviderEvent {
  remoteId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  /** Provider-reported IANA/Windows zone; adapters normalize UTC when absent. */
  timezone?: string;
  updatedAt: string | null;
  localId: string | null;
  source: string | null;
  etag?: string;
  changeKey?: string;
  transactionId?: string;
  busyStatus?: 'free' | 'tentative' | 'busy' | 'out_of_office';
}

export type ProviderChange =
  | { operation: 'upsert'; event: ProviderEvent }
  | { operation: 'delete'; remoteId: string; etag?: string; changeKey?: string };

export interface ProviderSyncRequest {
  accessToken: string;
  calendarId: string;
  cursor?: string;
  from?: string;
  to?: string;
}

export interface ProviderSyncResult {
  changes: ProviderChange[];
  cursor: string;
}

export interface ProviderUpsertRequest {
  accessToken: string;
  calendarId: string;
  event: ProviderEventInput;
  remoteId?: string;
  etag?: string;
  changeKey?: string;
}

export interface ProviderEventVersion {
  remoteId: string;
  etag?: string;
  changeKey?: string;
}

export interface ProviderDeleteRequest {
  accessToken: string;
  calendarId: string;
  remoteId: string;
  etag?: string;
  changeKey?: string;
}

/** A provider calendar owned and managed by Studyus rather than a user calendar. */
export interface ProvisionedCalendar {
  id: string;
  name: string;
  timezone: string | null;
  accessRole: string | null;
}

export interface ProviderCalendarProvisionRequest {
  accessToken: string;
  marker: string;
  timezone: string;
}

export interface ProviderCalendarDiscoveryRequest {
  accessToken: string;
  marker: string;
}

export interface ProviderCalendarDeleteRequest {
  accessToken: string;
  calendarId: string;
}

export interface CalendarProviderAdapter {
  readonly name: CalendarProviderName;
  sync(request: ProviderSyncRequest): Promise<ProviderSyncResult>;
  upsert(request: ProviderUpsertRequest): Promise<ProviderEventVersion>;
  delete(request: ProviderDeleteRequest): Promise<void>;
  /** Optional because inbound-only adapters do not need provisioning access. */
  provisionCalendar?(request: ProviderCalendarProvisionRequest): Promise<ProvisionedCalendar>;
  discoverProvisionedCalendar?(request: ProviderCalendarDiscoveryRequest): Promise<ProvisionedCalendar | null>;
  deleteProvisionedCalendar?(request: ProviderCalendarDeleteRequest): Promise<void>;
}

export interface CalendarTokenBroker {
  getAccessToken(
    userId: string,
    provider: CalendarProviderName,
    requiredScopes?: readonly string[],
  ): Promise<string>;
}
