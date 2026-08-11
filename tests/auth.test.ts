import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/auth/password';
import { generateSessionToken, hashToken } from '../src/lib/auth/session';

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
