import { createClerkClient } from '@clerk/backend';
import { clerk, clerkSetup } from '@clerk/testing/playwright';
import dotenv from 'dotenv';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const CLERK_AUTH_STATE_PATH = resolve(process.cwd(), 'playwright/.clerk/user.json');

let envLoaded = false;

function deterministicId(namespace, key) {
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

/** Load the dedicated E2E file without allowing it to override CI-provided values. */
export function loadClerkE2EEnv() {
  if (!envLoaded) {
    const envPath = resolve(process.cwd(), '.env.e2e.local');
    if (existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });
    envLoaded = true;
  }

  process.env.CLERK_PUBLISHABLE_KEY ||= process.env.PUBLIC_CLERK_PUBLISHABLE_KEY;
  process.env.PUBLIC_CLERK_PUBLISHABLE_KEY ||= process.env.CLERK_PUBLISHABLE_KEY;

  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!publishableKey || !secretKey) {
    throw new Error(
      'Clerk E2E keys are missing. Copy .env.e2e.example to .env.e2e.local and add development-instance pk_test_*/sk_test_* keys.',
    );
  }
  if (!publishableKey.startsWith('pk_test_') || !secretKey.startsWith('sk_test_')) {
    throw new Error('Clerk browser tests refuse to run with production keys; use a development Clerk instance.');
  }

  const email = process.env.E2E_CLERK_USER_EMAIL || 'student+clerk_test@example.com';
  if (!email.includes('+clerk_test')) {
    throw new Error('E2E_CLERK_USER_EMAIL must use Clerk\'s reserved +clerk_test subaddress.');
  }

  const seedEmail = process.env.E2E_SEED_USER_EMAIL || 'student@example.com';
  const externalId = process.env.E2E_SEED_USER_ID || deterministicId('user', seedEmail);
  const password = process.env.E2E_CLERK_USER_PASSWORD || 'Studyus-E2E-2026!';
  return { publishableKey, secretKey, email, externalId, password };
}

/**
 * Ensure the dedicated Clerk test identity resolves to Studyus's seeded local
 * learner. Never replaces a conflicting external ID: that requires an
 * intentional cleanup in the Clerk development instance.
 */
export async function ensureClerkE2EUser() {
  const env = loadClerkE2EEnv();
  const client = createClerkClient({ secretKey: env.secretKey });
  const [emailMatches, externalIdMatches] = await Promise.all([
    client.users.getUserList({ emailAddress: [env.email], limit: 2 }),
    client.users.getUserList({ externalId: [env.externalId], limit: 2 }),
  ]);

  const emailUser = emailMatches.data[0];
  const externalIdUser = externalIdMatches.data[0];
  if (externalIdUser && externalIdUser.id !== emailUser?.id) {
    throw new Error(
      `The seeded learner ID ${env.externalId} is already linked to another Clerk user (${externalIdUser.id}). ` +
        'Remove that stale development user or set E2E_CLERK_USER_EMAIL to its email.',
    );
  }

  if (!emailUser) {
    return client.users.createUser({
      emailAddress: [env.email],
      externalId: env.externalId,
      password: env.password,
      firstName: 'Studyus',
      lastName: 'E2E',
      skipLegalChecks: true,
    });
  }

  if (emailUser.externalId && emailUser.externalId !== env.externalId) {
    throw new Error(
      `The Clerk E2E user already has externalId=${emailUser.externalId}; expected ${env.externalId}. ` +
        'Use a dedicated +clerk_test user or correct it in the Clerk development dashboard.',
    );
  }
  if (!emailUser.externalId) {
    return client.users.updateUser(emailUser.id, { externalId: env.externalId });
  }
  return emailUser;
}

/** Sign in through Clerk's supported Playwright helper and persist reusable state. */
export async function authenticateClerkContext({
  context,
  page,
  baseUrl,
  storageStatePath = CLERK_AUTH_STATE_PATH,
}) {
  const env = loadClerkE2EEnv();
  await clerkSetup({ dotenv: false, publishableKey: env.publishableKey, secretKey: env.secretKey });
  const user = await ensureClerkE2EUser();

  await page.goto(new URL('/login', baseUrl).href, { waitUntil: 'domcontentloaded' });
  await clerk.signIn({ page, emailAddress: env.email });

  // This API request forces Studyus middleware to bind Clerk externalId to
  // the seeded local row before any layout route is visited.
  const profile = await context.request.get(new URL('/api/v1/user', baseUrl).href);
  if (!profile.ok()) {
    throw new Error(`Studyus rejected the Clerk E2E identity (${profile.status()}): ${await profile.text()}`);
  }

  mkdirSync(dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
  return user;
}
