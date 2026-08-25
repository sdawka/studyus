# Calendar integrations

Studyus uses one canonical calendar model and treats Google, Microsoft, and
ICS as transports around it. Provider payloads are normalized at the adapter
boundary; provider IDs never become application IDs without a provider
namespace.

## Sync policy

The integration is deliberately asymmetric:

- Personal calendars are imported as read-only busy context. Studyus never
  edits or deletes their events.
- Studyus creates and owns a separate `Studyus` calendar at each writable
  provider.
- Planned study sessions are written only to that owned calendar.
- Moving or resizing a linked Studyus event at the provider updates the local
  study session. Deleting it unschedules the session.
- Imported events that are linked to native Studyus entities are suppressed
  from the local projection, preventing visual duplicates and sync loops.
- ICS is a one-way fallback. Its private URL is a bearer secret, can be
  rotated or revoked, and is stored only as a SHA-256 hash.

This is controlled bidirectional sync: provider events can inform scheduling,
but Studyus only claims write authority over events it created.

## Data flow

1. Clerk supplies a fresh provider access token on demand. Studyus never
   stores OAuth access or refresh tokens.
2. A provider adapter performs incremental reads with Google sync tokens or
   Microsoft delta links.
3. Normalized external events and deletion tombstones are persisted in D1.
4. The application calendar projects native and external events into one
   collision-safe response.
5. Study-session mutations append idempotent operations to a D1 outbox.
6. The outbox writer targets only the provider calendar marked
   `studyus_owned`, uses provider version checks, and records a durable link
   between the local session and remote event.

The provider cursor advances only after all inbound changes are stored.
Outbound operations are claimed once, retried with backoff after transient
failures, and use deterministic provider idempotency metadata where available.

## Time

Date-only values and timed instants are distinct domain types. Timed events
carry an IANA timezone in addition to their UTC instant; all-day end dates are
exclusive. A user's timezone is stored on their profile and can be detected
from the browser in Settings.

## Permissions and setup

Google requires read access for busy context plus access to calendars created
by Studyus. Microsoft requires `Calendars.ReadWrite`. Those scopes are declared
on the Clerk account page; the matching social providers and scopes must also
be enabled in the Clerk dashboard.

Provider connection, manual sync, disconnect, timezone, and private ICS URL
controls live in Settings. Reconnecting an existing provider account reuses
the previously created remote Studyus calendar instead of creating a duplicate.
