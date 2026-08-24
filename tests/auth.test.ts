import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';
import { generateSessionToken, hashToken } from '../src/lib/auth/session';
import { toClerkPbkdf2Sha256Digest } from '../src/lib/auth/clerk-import';

describe('password hashing', () => {
  it('round-trips a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a distinct salt per hash', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toEqual(b);
  });
});

describe('session tokens', () => {
  it('derives a stable, deterministic session id from a token', async () => {
    const token = generateSessionToken();
    const idA = await hashToken(token);
    const idB = await hashToken(token);
    expect(idA).toEqual(idB);
    expect(idA).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toEqual(b);
  });
});

describe('Clerk legacy-password import', () => {
  it('converts the legacy hex PBKDF2 salt and digest to Clerk base64', () => {
    expect(toClerkPbkdf2Sha256Digest('pbkdf2$100000$00ff$deadbeef')).toBe(
      'pbkdf2_sha256$100000$AP8=$3q2+7w==',
    );
  });

  it('rejects malformed legacy password hashes', () => {
    expect(() => toClerkPbkdf2Sha256Digest('not-a-hash')).toThrow('Expected legacy password hash format');
  });
});
