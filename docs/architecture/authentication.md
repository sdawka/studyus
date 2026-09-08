# Authentication: Clerk with immutable local learner IDs

Clerk is the authentication authority. D1's `users.id` remains the learner
and tenancy key forever, so existing foreign keys continue to point at the
same learner after authentication migrates.

`users.clerk_user_id` is a nullable, unique bridge. Request middleware verifies
the Clerk session, resolves that bridge, and sets `Astro.locals.user` to the
local row. Existing pages and services must continue to authorize with that
local `user.id`; they must not use a Clerk user ID as a D1 foreign key.

## First sign-in and new learners

For an imported account, set Clerk's `external_id` to the old `users.id`.
`resolveLocalUser()` binds `clerk_user_id` on its first signed-in request.
This is idempotent and preserves the local ID. A Clerk account without that
external ID lazily provisions a new local learner row. Phone/OAuth-only Clerk
accounts receive a non-routable local email until a verified email is present.

The bridge returns `{ user, wasCreated }`; middleware queues `signup_completed`
only when `wasCreated` is true. Its method is reduced to
`oauth | phone | email | unknown`, its identity is the local `users.id`, and it
never sends a Clerk id, provider name, email, or profile value. A valid opaque
trial-handoff cookie contributes only `trial_session_id` for the anonymous join.

If a legacy row is already linked to a different Clerk account, the request
returns `409 identity_conflict`; do not overwrite the binding manually.

## Onboarding boundary

Authentication provisioning creates only the local `users` row. It does not
enroll a new learner in seed courses. Middleware requires completed onboarding
and a usable course before ordinary application pages; sign-in preserves a
validated same-origin return path and the explicit demo-import handoff.
`docs/product/onboarding.md` defines the atomic course/KC completion invariant.

## Retained account deletion

Verified Clerk deletion webhooks atomically record their delivery, mark the
local account `deleting`, revoke local credentials/feed access, and queue
Durable Object tombstoning. Ordinary requests, background work, and private
commit-time D1 writes reject inactive accounts. The runtime registry retains
all learner runtime identities so deletion can cover previously used objects.
The completed state is `deleted`; private rows and acknowledged `ready` uploaded
bytes remain retained. An attachment deletion already admitted by an active-owner
`ready` to `deleting` transition may finish cleanup after the fence. A new account
with the same email does not relink retained data.

Group contributions survive with author identity removed. Future events hosted
by the deleted account are canceled; an ownerless group becomes read-only.
`scripts/group-assignment.mjs` supports audited reassignment to an active member
and defaults to local storage. Retained-account restoration is not implemented.

The legacy `sessions` table and password/session helper files remain for
migration compatibility and historical tests. No new request may create a D1
session; the retired JSON login/logout endpoints return `410 auth_retired`.

## Production migration runbook

1. Apply D1 migration `0002_clerk_user_bridge.sql`.
2. Export legacy `users` through a secured administrative process. Never put
   the export or Clerk secret in this repository.
3. For every user, create a Clerk user with `external_id = users.id`, its
   email/name, `password_hasher = 'pbkdf2_sha256'`, and the result of
   `toClerkPbkdf2Sha256Digest(users.password_hash)`. This converts the old
   hex salt and digest to Clerk's required base64 format without plaintext
   passwords.
4. Validate representative legacy sign-ins, then deploy the Worker with
   `PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` configured. The first
   sign-in backfills each `clerk_user_id`; optionally bulk backfill it after
   verification for reporting.
5. Retire legacy `studyus_session` cookies. The old login and logout API
   endpoints intentionally return `410 auth_retired` so stale clients cannot
   create a second session system.

The app uses Clerk's Astro integration, middleware, prebuilt sign-in/sign-up,
and the dedicated `/account` `UserProfile` control. See Clerk's current
[Astro quickstart](https://clerk.com/docs/astro/getting-started/quickstart),
[Astro server helpers](https://clerk.com/docs/reference/astro/overview), and
[PBKDF2 import format](https://clerk.com/docs/reference/backend/user/create-user).
## Deployment verification

Configure `CLERK_WEBHOOK_SIGNING_SECRET` and `GROUP_INVITE_HMAC_SECRET` as
separate Worker secrets in each target environment. A successful application
build does not verify either secret or Clerk webhook delivery. Verify a signed
development deletion event and its background job before release. Staging
currently has no cron trigger: its request-time account fence is active, but
background tombstoning and reconciliation need an explicitly invoked isolated
scheduled run or an approved schedule before that lifecycle can be certified.
