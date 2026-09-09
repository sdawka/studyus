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
and the dedicated `/account` `UserProfile` control. The local `ClerkUi.astro`
wrapper serializes props as escaped inert JSON; `/clerk-props-bridge.js` registers
them in Clerk's official component map before its mount code runs. This preserves
local redirects and OAuth scopes under CSP without allowing dynamic inline scripts. See Clerk's current
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

## Agent Tasks E2E status

The explicit `agent-tasks` Playwright project uses Clerk's Agent Tasks Backend
API, never the ordinary sign-in helper. Run it against the isolated Worker with
`STUDYUS_AGENT_TASK_DIAGNOSTIC=1 STUDYUS_ISOLATED_AUDIT=1 STUDYUS_AGENT_TASK_WORKERS=1 E2E_BASE_URL=https://studyus-agent-e2e.dawka.workers.dev npx playwright test --project=agent-tasks`.
It consumes one real task, verifies the delegated session's `actor.task_id`,
loads protected Planner and profile data, exercises task create/list/delete,
revokes the exact session, and verifies that the profile API returns 401.

Clerk's development handoff currently returns affected cross-site cookies as
`SameSite=None` without `Secure`, which Chromium rejects. The isolated harness
therefore consumes the two validated redirect responses once and installs only
those Clerk-issued cookies with `Secure`; it does not alter cookie values or
disable browser protections. This proves the delegated session and Studyus
authorization path, but not Clerk's native development-cookie transport. The
project remains opt-in and excluded from release CI.

A separately authorized production smoke on September 8 did consume real Agent
Tasks successfully. One disposable learner completed onboarding, protected task
creation/listing, Planner and Account rendering, and group/file creation/listing.
Its returned local ID was independently matched to the exact Clerk identity in
D1. This used a private, bounded production harness, not the localhost diagnostic
or a CI test. Failed harness attempts revoked their exact delegated sessions;
ordinary password sign-in was never substituted. The corrected harness accounts
for fresh local IDs, waits for Account hydration, and sends the legitimate browser
Origin on multipart uploads without changing CSRF enforcement.

The ordinary authenticated CI job is restricted to manual dispatch on `main`.
The user explicitly approved environment/secret setup and disposable production
smoke on September 8, superseding the earlier automatic-review blocks.
The `clerk-e2e` environment now restricts deployments to `main`, with administrative
bypass disabled. Its three development secrets and `CLERK_E2E_ENABLED=true` are
configured. Manual CI run `34229603733` passed all jobs: the authenticated job
reported 21 passed and two skipped (the then-blocked Agent Tasks diagnostic and
a missing seeded group-detail fixture). The isolated Worker result above
supersedes that Agent Tasks status without changing the historical CI result.

Production version `1f664e22-8ac2-4120-8e02-4fa906f5e688` deploys merged commit
`8e933ba`. Migrations 0014–0029 applied; the foreign-key check and runtime-registry
backfill check passed. Both required secret names are present, AI is disabled,
and the five-minute schedule is active. The production Clerk endpoint subscribes
only to `user.deleted` and is enabled. Exact disposable-user deletion returned
Clerk 404; its real webhook delivery succeeded and D1 recorded one delivery with
the immediate account/runtime `deleting` fence. The scheduled job then reached
`done` with zero retries and both states `deleted`. Its group became read-only
with no owner; its retained ready file lost author identity. The old browser
context received exactly 401, and temporary browser storage was removed.
