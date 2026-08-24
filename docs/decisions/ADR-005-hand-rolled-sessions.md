# ADR-005: Hand-Rolled Sessions (Lucia Deprecated)

**Status**: Superseded by Clerk (2026-08-23); retained as historical context and as the source format for legacy-account migration.

> **Current decision**: Clerk owns sign-in, sign-up, session validation, and sign-out. `src/middleware.ts` resolves a verified Clerk identity to immutable local `users.id`; see `docs/architecture/authentication.md`. The legacy `sessions` table, PBKDF2 hash helpers, and this ADR describe the pre-Clerk system and must not be used for new sessions.

> **2026-08-15 erratum**: the `sessions` table has no separate `token_hash` column — `id` **is** the SHA-256 hex digest of the random session token; the token itself is never stored (see `src/lib/auth/session.ts`). The cookie name is `studyus_session` (`SESSION_COOKIE_NAME` in `session.ts`), not `session_token` as the sketch below shows — this was renamed as part of the studybuddy→studyus rename (see `docs/api.md`:9's erratum). The code samples below (`token_hash` column, `session_token` cookie name) are the original design sketch, not what shipped; see `docs/architecture/data-model.md`'s `sessions` entry for the real column list.

**Decision**: Implement session management manually (no Lucia library), following Lucia's documented patterns.

## Context

Lucia (popular session library) was deprecated in 2024; maintainer recommends hand-rolling. studyus requires:
- Session creation on login.
- Session validation on every request (middleware).
- Session cleanup on logout.
- Sliding 30-day expiry (refreshed on access).

Alternatives:
- **Lucia**: No longer recommended.
- **Passport.js**: Overkill; adds dependency.
- **NextAuth**: Next.js specific.
- **Hand-rolled**: Simple, transparent, zero dependencies.

## Decision

**Hand-rolled sessions** following Lucia's guide patterns:
- `sessions` table: `(id, user_id, token_hash, expires_at, created_at)`.
- Session token: random 32 bytes (generated at signup/login), hashed as SHA-256 for storage.
- Cookie: `session_token` HTTP-only, secure, sameSite=strict.
- Sliding expiry: On each request, if session is >75% through its 30-day window, refresh expiry.

## Implementation

### Auth Service (`src/lib/auth/`)

```typescript
// Generate token
const token = crypto.getRandomValues(new Uint8Array(32));
const tokenString = Buffer.from(token).toString('hex');
const tokenHash = await hashToken(tokenString); // SHA-256

// Store in DB
await db.insert(sessions).values({
  id: nanoid(),
  user_id: userId,
  token_hash: tokenHash,
  expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  created_at: new Date(),
});

// Return token to client as HttpOnly cookie
response.headers.set('Set-Cookie', `session_token=${tokenString}; HttpOnly; Secure; SameSite=Strict; Path=/`);
```

### Middleware (`src/middleware.ts`)

On every request:
1. Extract `session_token` cookie.
2. Hash it.
3. Query `sessions` table for matching `token_hash`.
4. Check `expires_at`; if expired, delete and redirect to login.
5. If >75% of window elapsed, refresh `expires_at`.
6. Set `Astro.locals.user`.

### Password Hashing

**At acceptance**: PBKDF2 via Web Crypto API (built-in, no dependency).

```typescript
const encoder = new TextEncoder();
const saltBuffer = crypto.getRandomValues(new Uint8Array(16));
const keyBuffer = await crypto.subtle.pbkdf2(
  encoder.encode(password),
  saltBuffer,
  { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000 },
  256,
);
const hash = Buffer.concat([saltBuffer, keyBuffer]).toString('hex');
```

**Post-v1 TODO**: Migrate to argon2-WASM for better security (slow memory hash).

## Consequences

**Positive:**
- Zero dependencies; we own the implementation.
- Simple and transparent; easy to debug.
- Sliding expiry improves UX (active users stay logged in).
- Web Crypto API is stable; no polyfills needed.

**Negative:**
- Must handle token generation + hashing carefully (easy to get wrong).
- No built-in rate limiting on login (add via middleware if needed).
- Migration to argon2 is manual (data migration script).

## Security Notes

- **Never store plaintext tokens.** Always hash before storing.
- **Constant-time comparison** on token hash (done by DB).
- **HttpOnly + Secure + SameSite** flags prevent XSS/CSRF.
- **PBKDF2 is safe**, but argon2 is better (post-v1).

## Test Coverage

- Token generation and hashing (deterministic given seed).
- Session creation and lookup.
- Session expiry and cleanup.
- Sliding refresh logic.

See tests in `tests/unit/auth.test.ts`.
