/**
 * Identity helpers for the deterministic fixture seed.
 *
 * The first seed user predates per-learner fixture ids. Keep those historical
 * ids stable so reseeding an existing database does not orphan URLs or leave
 * a second copy of every fixture row behind. Every other seed user gets an
 * explicit learner namespace in each direct fixture id.
 */

export const DEFAULT_SEED_USER_EMAIL = 'student@example.com';

export type SeedIdentity = {
  email: string;
  userId: string;
  preservesLegacyIds: boolean;
};

/**
 * Deterministic UUID-shaped id derived from a stable key.
 *
 * This deliberately matches the historical implementation in scripts/seed.ts
 * so the default learner's existing fixture ids remain unchanged.
 */
export function deterministicId(namespace: string, key: string): string {
  const input = `${namespace}:${key}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  const hex = h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  const padded = (hex + hex).slice(0, 32);
  return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

export function createSeedIdentity(email: string): SeedIdentity {
  return {
    email,
    userId: deterministicId('user', email),
    preservesLegacyIds: email === DEFAULT_SEED_USER_EMAIL,
  };
}

/**
 * Return a direct fixture id with a learner namespace for non-legacy users.
 * Parent-derived ids (for example a scaffold keyed by an already-scoped KC)
 * can continue to use deterministicId directly because their parent carries
 * the learner namespace.
 */
export function seedFixtureId(identity: SeedIdentity, namespace: string, key: string): string {
  return deterministicId(namespace, identity.preservesLegacyIds ? key : `${identity.userId}:${key}`);
}
