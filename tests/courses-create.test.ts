import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, users } from '../src/db/schema';
import { createCourse, updateCourse } from '../src/lib/services/courses';
import { eq } from 'drizzle-orm';

const db = getDb(env.DB);

let userId: string;

beforeEach(async () => {
  userId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
});

describe('courses.createCourse', () => {
  it('slugifies the code, creates a General branch, and assigns a hue', async () => {
    const course = await createCourse(db, userId, { code: 'CS 101', title: 'Intro to CS' });
    expect(course.slug).toBe('cs-101');
    expect(course.colorHue).toBe(235); // first assigned hue for a user's first course

    const courseBranches = await db.select().from(branches).where(eq(branches.courseId, course.id));
    expect(courseBranches).toHaveLength(1);
    expect(courseBranches[0].name).toBe('General');
    expect(courseBranches[0].sortOrder).toBe(0);
  });

  it('honors an explicit color_hue instead of auto-assigning', async () => {
    const course = await createCourse(db, userId, { code: 'MATH 200', title: 'Calc II', color_hue: 190 });
    expect(course.colorHue).toBe(190);
  });

  it('cycles hues by the user\'s existing course count', async () => {
    const first = await createCourse(db, userId, { code: 'A 1', title: 'A' });
    const second = await createCourse(db, userId, { code: 'B 1', title: 'B' });
    expect(first.colorHue).toBe(235);
    expect(second.colorHue).toBe(25);
  });

  it('appends -2 on a slug collision', async () => {
    const first = await createCourse(db, userId, { code: 'COLL 101', title: 'Intro to CS' });
    const second = await createCourse(db, userId, { code: 'coll 101', title: 'Intro to CS (retake)' });
    expect(first.slug).toBe('coll-101');
    expect(second.slug).toBe('coll-101-2');
  });

  it('rejects color_hue outside 0-360 at the schema layer', async () => {
    const { createCourseSchema } = await import('../src/lib/schemas/courses');
    expect(() => createCourseSchema.parse({ code: 'X 1', title: 'X', color_hue: 400 })).toThrow();
    expect(() => createCourseSchema.parse({ code: 'X 1', title: 'X', color_hue: -1 })).toThrow();
  });
});

describe('courses.updateCourse', () => {
  it('404s when the course belongs to a different user', async () => {
    const otherUserId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    const course = await createCourse(db, otherUserId, { code: 'CS 101', title: 'Intro to CS' });

    await expect(updateCourse(db, userId, course.id, { archived: true })).rejects.toThrow('Course not found');
  });

  it('updates archived and color_hue without regenerating the slug', async () => {
    const course = await createCourse(db, userId, { code: 'PATCH 101', title: 'Intro to CS' });
    const updated = await updateCourse(db, userId, course.id, { archived: true, color_hue: 65 });
    expect(updated.archived).toBe(true);
    expect(updated.colorHue).toBe(65);
    expect(updated.slug).toBe('patch-101');
  });
});
