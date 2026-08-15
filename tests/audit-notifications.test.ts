// Audit fix: new GET /api/v1/notifications/count endpoint (frozen contract:
// 200 { data: { unread: <int> } }, no side effects — must never run
// sweepNotifications), and the listNotifications second unread-count query
// replaced with a count(*) aggregate instead of fetching every unread row.
import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { assessments, courses, notifications, tasks, users } from '../src/db/schema';
import { getUnreadNotificationCount, listNotifications } from '../src/lib/services/notifications';
import { GET as countRoute } from '../src/pages/api/v1/notifications/count';

const db = getDb(env.DB);

let userId: string;
let courseId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
});

describe('getUnreadNotificationCount', () => {
  it('counts only this user’s unread notifications', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });

    await db.insert(notifications).values([
      { id: crypto.randomUUID(), userId, type: 'task_overdue', title: 'a', href: '/tasks', dedupeKey: 'c1', createdAt: Date.now() },
      { id: crypto.randomUUID(), userId, type: 'task_overdue', title: 'b', href: '/tasks', dedupeKey: 'c2', createdAt: Date.now(), readAt: Date.now() },
      { id: crypto.randomUUID(), userId: otherUserId, type: 'task_overdue', title: 'c', href: '/tasks', dedupeKey: 'c3', createdAt: Date.now() },
    ]);

    expect(await getUnreadNotificationCount(db, userId)).toBe(1);
  });

  it('does not run the sweep — no rows are created as a side effect', async () => {
    const taskId = crypto.randomUUID();
    await db.insert(assessments).values({ id: crypto.randomUUID(), courseId, title: 'Due soon', type: 'quiz', dueDate: Date.now() + 60_000 });
    await db.insert(tasks).values({ id: taskId, userId, title: 'Overdue task', dueDate: Date.now() - 86_400_000, done: false });

    await getUnreadNotificationCount(db, userId);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows).toHaveLength(0);
  });
});

describe('listNotifications — unread_count via aggregate', () => {
  it('unread_count matches the actual unread row count after marking one read', async () => {
    const now = Date.now();
    await db.insert(tasks).values([
      { id: crypto.randomUUID(), userId, title: 'Overdue A', dueDate: now - 86_400_000, done: false },
    ]);

    const first = await listNotifications(db, userId, {});
    expect(first.unread_count).toBe(first.notifications.filter((n) => n.readAt === null).length);

    await db.update(notifications).set({ readAt: now }).where(eq(notifications.userId, userId));
    const second = await listNotifications(db, userId, {});
    expect(second.unread_count).toBe(0);
  });
});

describe('GET /api/v1/notifications/count route', () => {
  it('returns { data: { unread } } and creates no notification rows', async () => {
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      userId,
      type: 'task_overdue',
      title: 'Overdue',
      href: '/tasks',
      dedupeKey: 'route-1',
      createdAt: Date.now(),
    });

    const res = await countRoute({ locals: { user: { id: userId } } } as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.unread).toBe(1);

    // No sweep-generated rows appeared alongside the one we seeded.
    const rows = await db.select().from(notifications).where(eq(notifications.userId, userId));
    expect(rows).toHaveLength(1);
  });
});
