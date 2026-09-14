import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, users } from '../../db/schema';
import { DEFAULT_COURSE_KEY, DEFAULT_COURSE_VERSION, loadDefaultCourse } from '../content/defaultCourse';
import type { CourseDraftV2 } from '../schemas/courseDraft';
import { AccountInactiveError, assertClerkIdentityMayResolve, ensureActiveRuntimeRegistry } from './accountLifecycle';
import { buildCourseDraftStatements } from './courseDraft';
import { runBatch } from './util';

export const BOOTSTRAP_COURSE_KEY = 'first-party:learning-how-to-learn' as const;

/** The small Clerk profile subset needed to establish a local learner row. */
export interface ClerkIdentity {
  id: string;
  externalId?: string | null;
  primaryEmailAddress?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

export type BootstrapCourseTemplate = {
  draft: CourseDraftV2;
  key: string;
  version: string | number;
};

function currentDefaultCourse(): BootstrapCourseTemplate {
  return { draft: loadDefaultCourse(), key: DEFAULT_COURSE_KEY, version: DEFAULT_COURSE_VERSION };
}

function displayName(identity: ClerkIdentity): string | null {
  const name = [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}

function fallbackEmail(clerkUserId: string): string {
  // Phone/OAuth-only Clerk accounts still need a value for the required local column.
  return `${clerkUserId}@clerk-user.invalid`;
}

async function committedBootstrap(db: Db, clerkUserId: string) {
  const user = (await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1))[0];
  if (!user || user.accountState !== 'active') return null;
  const defaultCourse = (await db.select().from(courses)
    .where(and(eq(courses.userId, user.id), eq(courses.bootstrapKey, BOOTSTRAP_COURSE_KEY)))
    .limit(1))[0];
  return defaultCourse ? { user, defaultCourse } : null;
}

/** Creates a new local learner and its detached default course in one D1 transaction. */
export async function provisionLearner(
  db: Db,
  identity: ClerkIdentity,
  template: BootstrapCourseTemplate = currentDefaultCourse(),
) {
  await assertClerkIdentityMayResolve(db, identity.id);
  const existing = await committedBootstrap(db, identity.id);
  if (existing) {
    await ensureActiveRuntimeRegistry(db, existing.user.id);
    return { ...existing, wasCreated: false as const };
  }

  const userId = crypto.randomUUID();
  const createdAt = Date.now();
  const course = await buildCourseDraftStatements(db, userId, template.draft, {
    sourceTemplateKey: template.key,
    sourceTemplateVersion: String(template.version),
    bootstrapKey: BOOTSTRAP_COURSE_KEY,
  });
  const userStatement = db.insert(users).select(sql`
    SELECT ${userId}, ${identity.id}, ${identity.primaryEmailAddress ?? fallbackEmail(identity.id)},
      'active', NULL, 'clerk-managed', ${displayName(identity)}, NULL, NULL, NULL,
      'UTC', '{}', NULL, ${createdAt}
    WHERE NOT EXISTS (SELECT 1 FROM account_deletion_events WHERE clerk_user_id = ${identity.id})
    AND NOT EXISTS (SELECT 1 FROM account_deletion_jobs WHERE clerk_user_id = ${identity.id})
  `);

  try {
    await runBatch(db, [userStatement, ...course.statements]);
  } catch (error) {
    const winner = await committedBootstrap(db, identity.id);
    if (!winner) {
      await assertClerkIdentityMayResolve(db, identity.id);
      throw error;
    }
    await ensureActiveRuntimeRegistry(db, winner.user.id);
    return { ...winner, wasCreated: false as const };
  }

  const committed = await committedBootstrap(db, identity.id);
  if (!committed) throw new AccountInactiveError();
  await ensureActiveRuntimeRegistry(db, committed.user.id);
  return { ...committed, wasCreated: true as const };
}
