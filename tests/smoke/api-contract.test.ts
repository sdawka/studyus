/**
 * API Contract Smoke Tests — Every endpoint from docs/api.md
 *
 * Coverage: Every endpoint gets ≥1 happy-path test with response shape assertion.
 * Key spot checks: 401-when-unauthenticated (auth), 404 (not found), attachments roundtrip.
 */

import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../../src/db/client';
import { attachments, branches, courses, kcs, users } from '../../src/db/schema';
import * as authLoginRoutes from '../../src/pages/api/v1/auth/login';
import * as authLogoutRoutes from '../../src/pages/api/v1/auth/logout';
import * as userRoutes from '../../src/pages/api/v1/user/index';
import * as coursesIndexRoutes from '../../src/pages/api/v1/courses/index';
import * as coursesSlugRoutes from '../../src/pages/api/v1/courses/[slug]';
import * as assessmentsRoutes from '../../src/pages/api/v1/courses/[id]/assessments';
import * as attachmentsUploadRoutes from '../../src/pages/api/v1/courses/[id]/attachments';
import * as attachmentsRoutes from '../../src/pages/api/v1/attachments/[id]';
import * as kcsDetailRoutes from '../../src/pages/api/v1/kcs/[id]/index';
import * as kcsEventsRoutes from '../../src/pages/api/v1/kcs/[id]/events';
import * as eventsIndexRoutes from '../../src/pages/api/v1/events/index';
import * as eventsDetailRoutes from '../../src/pages/api/v1/events/[id]';
import * as tasksIndexRoutes from '../../src/pages/api/v1/tasks/index';
import * as tasksDetailRoutes from '../../src/pages/api/v1/tasks/[id]';
import * as notesIndexRoutes from '../../src/pages/api/v1/notes/index';
import * as notesDetailRoutes from '../../src/pages/api/v1/notes/[id]';
import * as resourcesIndexRoutes from '../../src/pages/api/v1/resources/index';
import * as resourcesDetailRoutes from '../../src/pages/api/v1/resources/[id]';
import * as sessionsIndexRoutes from '../../src/pages/api/v1/sessions/index';
import * as sessionsDetailRoutes from '../../src/pages/api/v1/sessions/[id]';
import * as sessionsCompleteRoutes from '../../src/pages/api/v1/sessions/[id]/complete';
import * as gradesRoutes from '../../src/pages/api/v1/grades/summary';
import * as calendarRoutes from '../../src/pages/api/v1/calendar/index';
import * as profileRoutes from '../../src/pages/api/v1/profile/index';
import * as tutorConvIndexRoutes from '../../src/pages/api/v1/tutor/conversations/index';
import * as tutorConvDetailRoutes from '../../src/pages/api/v1/tutor/conversations/[id]/index';
import * as tutorEndRoutes from '../../src/pages/api/v1/tutor/conversations/[id]/end';
import * as quickQuizIndexRoutes from '../../src/pages/api/v1/flows/quick_quiz/index';
import * as quickQuizAnswersRoutes from '../../src/pages/api/v1/flows/quick_quiz/[id]/answers';

const db = getDb(env.DB);

// ============================================================================
// Helpers
// ============================================================================

async function setupFixture() {
  const userId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  const kcId = crypto.randomUUID();

  await db.insert(users).values({
    id: userId,
    email: `smoke-${userId}@test.local`,
    passwordHash: 'dummy',
    name: 'Test User',
  });

  await db.insert(courses).values({
    id: courseId,
    userId,
    code: 'TEST 101',
    slug: `smoke-${courseId}`,
    title: 'Test Course',
    credits: 3,
    term: 'Fall 2024',
    instructor: 'Prof. Test',
    overview: 'Test',
  });

  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });

  await db.insert(kcs).values({
    id: kcId,
    branchId,
    courseId,
    name: 'Test KC',
    kcType: 'concept',
  });

  return { userId, courseId, branchId, kcId };
}

// Mock for quick_quiz JSON-mode (non-streaming) OpenRouter calls
function mockOpenRouterJsonFetch(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = { choices: [{ message: { content: JSON.stringify(payload) } }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

// Helper to construct proper Astro APIContext
function astroContext(overrides: any = {}) {
  const cookies = new Map<string, string>();
  // Default to a basic user for testing; routes expect locals.user with id, email, name, currentTerm, onboardedAt
  const defaultUser = overrides.locals?.user === undefined ? undefined : overrides.locals?.user || {
    id: crypto.randomUUID(),
    email: 'test@test.local',
    name: 'Test User',
    currentTerm: null,
    onboardedAt: null,
  };

  // Build proper URL from request if not specified
  let url = overrides.url;
  if (!url && overrides.request) {
    url = new URL(overrides.request.url);
  }
  if (!url) {
    url = new URL('http://local.test/api/v1');
  }

  const defaults = {
    request: new Request('http://local.test/api/v1'),
    url,
    cookies: {
      get: (name: string) => ({ value: cookies.get(name) }),
      set: (name: string, value: string, _opts?: any) => cookies.set(name, value),
      has: (name: string) => cookies.has(name),
      delete: (name: string) => cookies.delete(name),
    },
    locals: { user: defaultUser },
    params: {},
  };

  // Merge, preserving explicit overrides
  const merged = { ...defaults, ...overrides };
  if (overrides.locals?.user !== undefined) {
    merged.locals.user = overrides.locals.user;
  }
  return merged;
}

// ============================================================================
// Tests
// ============================================================================

describe('API Contract Smoke Tests (docs/api.md)', () => {
  let fixture: Awaited<ReturnType<typeof setupFixture>>;

  beforeEach(async () => {
    fixture = await setupFixture();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ========== AUTHENTICATION ==========

  describe('POST /auth/login', () => {
    it('authenticates user and returns user data', async () => {
      const email = `login-${crypto.randomUUID()}@test.local`;
      const password = 'password123';
      const hash = await (async () => {
        const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
        const km = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
        const derived = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, km, 256);
        const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
        return `pbkdf2$100000$${hex(salt.buffer)}$${hex(derived)}`;
      })();

      const userId = crypto.randomUUID();
      await db.insert(users).values({ id: userId, email, passwordHash: hash, name: 'Test' });

      const req = new Request('http://local.test/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      const res = await authLoginRoutes.POST(astroContext({ request: req }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.user.id).toBe(userId);
      expect(body.data.user.email).toBe(email);
    });

    it('rejects invalid credentials with 401', async () => {
      const req = new Request('http://local.test/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'nonexistent@test.local', password: 'wrong' }),
      });
      const res = await authLoginRoutes.POST(astroContext({ request: req }) as any);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns ok: true', async () => {
      const req = new Request('http://local.test/api/v1/auth/logout', { method: 'POST' });
      const res = await authLogoutRoutes.POST(astroContext({ request: req }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.ok).toBe(true);
    });
  });

  // ========== USER ==========

  describe('GET|PATCH /user', () => {
    it('GET returns user profile', async () => {
      const res = await userRoutes.GET(astroContext({
        request: new Request('http://local.test/api/v1/user'),
        locals: { user: { id: fixture.userId, email: 'test@test.local', name: 'Test User', currentTerm: null, onboardedAt: null } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.id).toBe(fixture.userId);
      expect(body.data.email).toBe('test@test.local');
      expect(body.data.current_term).toBeNull();
      expect(body.data.onboarded_at).toBeNull();
      expect(body.data.settings).toHaveProperty('theme');
      expect(body.data.settings).toHaveProperty('task_generators');
    });

    it('PATCH updates user name', async () => {
      const req = new Request('http://local.test/api/v1/user', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated', current_term: 'Spring 2025' }),
      });
      const res = await userRoutes.PATCH(astroContext({ request: req, locals: { user: { id: fixture.userId } } }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.name).toBe('Updated');
      expect(body.data.current_term).toBe('Spring 2025');
    });
  });

  // ========== COURSES ==========

  describe('GET /courses', () => {
    it('returns list of user courses', async () => {
      const url = new URL('http://local.test/api/v1/courses');
      const res = await coursesIndexRoutes.GET(astroContext({ url, locals: { user: { id: fixture.userId } } }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.some((c: any) => c.id === fixture.courseId)).toBe(true);
    });

    it('supports include=mastery query parameter', async () => {
      const url = new URL('http://local.test/api/v1/courses?include=mastery');
      const res = await coursesIndexRoutes.GET(astroContext({ url, locals: { user: { id: fixture.userId } } }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      if (body.data.length > 0) {
        expect(body.data[0]).toHaveProperty('mastery');
        expect(body.data[0]).toHaveProperty('status');
      }
    });
  });

  describe('GET /courses/:slug', () => {
    it('returns course with branches and KCs', async () => {
      const slug = `smoke-${fixture.courseId}`;
      const res = await coursesSlugRoutes.GET(astroContext({
        params: { slug },
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.id).toBe(fixture.courseId);
      expect(Array.isArray(body.data.branches)).toBe(true);
      expect(body.data.branches.some((b: any) => Array.isArray(b.kcs))).toBe(true);
    });

    it('returns 404 for nonexistent course', async () => {
      const res = await coursesSlugRoutes.GET(astroContext({
        params: { slug: 'nonexistent' },
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(404);
    });
  });

  describe('GET|POST /courses/:id/assessments', () => {
    it('GET lists assessments', async () => {
      const url = new URL('http://local.test/api/v1/courses');
      const res = await assessmentsRoutes.GET(astroContext({
        params: { id: fixture.courseId },
        url,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST creates assessment', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ title: 'Midterm', type: 'midterm', weight_pct: 30 }),
      });
      const res = await assessmentsRoutes.POST(astroContext({
        params: { id: fixture.courseId },
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.title).toBe('Midterm');
    });
  });

  // ========== KCs ==========

  describe('GET|PATCH /kcs/:id', () => {
    it('GET returns KC detail with mastery/status', async () => {
      const res = await kcsDetailRoutes.GET(astroContext({
        params: { id: fixture.kcId },
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.id).toBe(fixture.kcId);
      expect(body.data.name).toBe('Test KC');
      expect(body.data.kc_type).toBe('concept');
    });

    it('PATCH updates KC name/description', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated KC', description: 'New desc' }),
      });
      const res = await kcsDetailRoutes.PATCH(astroContext({
        params: { id: fixture.kcId },
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.name).toBe('Updated KC');
    });
  });

  describe('GET /kcs/:id/events', () => {
    it('returns paginated KC events', async () => {
      const url = new URL('http://local.test/api/v1/kcs');
      url.searchParams.set('limit', '20');
      const res = await kcsEventsRoutes.GET(astroContext({
        params: { id: fixture.kcId },
        url,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  // ========== EVENTS ==========

  describe('POST|GET|PATCH|DELETE /events', () => {
    it('POST creates manual event with mastery_deltas', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ type: 'lecture_attended', kc_id: fixture.kcId }),
      });
      const res = await eventsIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.type).toBe('lecture_attended');
      expect(body.data.is_instructional).toBe(true);
      expect(Array.isArray(body.data.mastery_deltas)).toBe(true);
    });

    it('GET returns events list', async () => {
      const url = new URL('http://local.test/api/v1/events');
      const res = await eventsIndexRoutes.GET(astroContext({
        url,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('GET supports course/kc filtering', async () => {
      const url = new URL(`http://local.test?course=${fixture.courseId}&kc=${fixture.kcId}`);
      const res = await eventsIndexRoutes.GET(astroContext({
        url,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('PATCH updates event type', async () => {
      // Create event first
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ type: 'lecture_attended', kc_id: fixture.kcId }),
      });
      const createRes = await eventsIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const eventId = ((await createRes.json()) as any).data.id;

      // Update it
      const updateReq = new Request('http://local.test/api/v1', {
        method: 'PATCH',
        body: JSON.stringify({ type: 'video_watched' }),
      });
      const updateRes = await eventsDetailRoutes.PATCH(astroContext({
        params: { id: eventId },
        request: updateReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(updateRes.status).toBe(200);
      const body = ((await updateRes.json()) as any).data;
      expect(body.type).toBe('video_watched');
    });

    it('DELETE removes event', async () => {
      // Create event first
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ type: 'lecture_attended', kc_id: fixture.kcId }),
      });
      const createRes = await eventsIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const eventId = ((await createRes.json()) as any).data.id;

      // Delete it
      const delRes = await eventsDetailRoutes.DELETE(astroContext({
        params: { id: eventId },
        request: new Request('http://local.test/api/v1', { method: 'DELETE' }),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(delRes.status).toBe(200);
    });

    it('POST rejects invalid event type with 400', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ type: 'invalid_type', kc_id: fixture.kcId }),
      });
      const res = await eventsIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(400);
    });
  });

  // ========== TASKS ==========

  describe('GET|POST|PATCH|DELETE /tasks', () => {
    it('GET returns task list', async () => {
      const res = await tasksIndexRoutes.GET(astroContext({
        request: new Request('http://local.test/api/v1/tasks'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST creates task', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ title: 'Study', description: 'Chapters 1-5' }),
      });
      const res = await tasksIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.title).toBe('Study');
      expect(body.data.completed).toBe(false);
    });

    it('PATCH|DELETE work on task', async () => {
      // Create
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ title: 'Task' }),
      });
      const createRes = await tasksIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const taskId = ((await createRes.json()) as any).data.id;

      // Update
      const patchReq = new Request('http://local.test/api/v1', {
        method: 'PATCH',
        body: JSON.stringify({ completed: true }),
      });
      const patchRes = await tasksDetailRoutes.PATCH(astroContext({
        params: { id: taskId },
        request: patchReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(patchRes.status).toBe(200);

      // Delete
      const delRes = await tasksDetailRoutes.DELETE(astroContext({
        params: { id: taskId },
        request: new Request('http://local.test/api/v1', { method: 'DELETE' }),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(delRes.status).toBe(200);
    });
  });

  // ========== NOTES ==========

  describe('GET|POST|PATCH|DELETE /notes', () => {
    it('GET returns notes list', async () => {
      const res = await notesIndexRoutes.GET(astroContext({
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST creates note with optional links', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Notes',
          content: 'Key concepts',
          links: [{ course_id: fixture.courseId, kc_id: fixture.kcId }],
        }),
      });
      const res = await notesIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.title).toBe('Notes');
      expect(Array.isArray(body.data.links)).toBe(true);
    });

    it('GET|PATCH|DELETE work on note', async () => {
      // Create
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ title: 'Note', content: 'Content' }),
      });
      const createRes = await notesIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const noteId = ((await createRes.json()) as any).data.id;

      // Get
      const getRes = await notesDetailRoutes.GET(astroContext({
        params: { id: noteId },
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(getRes.status).toBe(200);
      const note = ((await getRes.json()) as any).data;
      expect(note.id).toBe(noteId);

      // Patch
      const patchReq = new Request('http://local.test/api/v1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated' }),
      });
      const patchRes = await notesDetailRoutes.PATCH(astroContext({
        params: { id: noteId },
        request: patchReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(patchRes.status).toBe(200);

      // Delete
      const delRes = await notesDetailRoutes.DELETE(astroContext({
        params: { id: noteId },
        request: new Request('http://local.test/api/v1', { method: 'DELETE' }),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(delRes.status).toBe(200);
    });
  });

  // ========== RESOURCES (FEED) ==========

  describe('GET|POST|DELETE /resources', () => {
    it('GET returns resources list', async () => {
      const url = new URL(`http://local.test/api/v1/resources?course=${fixture.courseId}`);
      const res = await resourcesIndexRoutes.GET(astroContext({
        url,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST creates user_shared resource', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/article', label: 'Great article', course_id: fixture.courseId }),
      });
      const res = await resourcesIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.url).toBe('https://example.com/article');
      expect(body.data.label).toBe('Great article');
      expect(body.data.kind).toBe('user_shared');
      expect(body.data.course_id).toBe(fixture.courseId);
    });

    it('DELETE removes resource', async () => {
      // Create
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/to-delete', label: 'Delete' }),
      });
      const createRes = await resourcesIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const resourceId = ((await createRes.json()) as any).data.id;

      // Delete
      const delRes = await resourcesDetailRoutes.DELETE(astroContext({
        params: { id: resourceId },
        request: new Request('http://local.test/api/v1', { method: 'DELETE' }),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(delRes.status).toBe(200);
    });
  });

  // ========== ATTACHMENTS + R2 ROUNDTRIP ==========

  describe('POST /courses/:id/attachments → GET → DELETE (R2 roundtrip)', () => {
    it('uploads file to R2, downloads, deletes, verifies DB/R2 cleanup', async () => {
      const content = 'Test file content';
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', file);

      // Upload
      const uploadReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: formData,
      });
      const uploadRes = await attachmentsUploadRoutes.POST(astroContext({
        params: { id: fixture.courseId },
        request: uploadReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(uploadRes.status).toBe(201);

      const uploadBody = (await uploadRes.json()) as any;
      const attachmentId = uploadBody.data.attachment_id;
      expect(uploadBody.data.filename).toBe('test.txt');
      expect(uploadBody.data.mime_type).toBe('text/plain');

      // Verify in DB
      const dbRows = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
      expect(dbRows).toHaveLength(1);
      expect(dbRows[0].contentType).toBe('text/plain');

      // Download
      const downloadRes = await attachmentsRoutes.GET(astroContext({
        params: { id: attachmentId },
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(downloadRes.status).toBe(200);
      expect(downloadRes.headers.get('Content-Type')).toBe('text/plain');
      expect(downloadRes.headers.get('Content-Disposition')).toMatch(/inline.*test\.txt/);
      const downloadedContent = await downloadRes.text();
      expect(downloadedContent).toBe(content);

      // Delete
      const deleteRes = await attachmentsRoutes.DELETE(astroContext({
        params: { id: attachmentId },
        request: new Request('http://local.test/api/v1', { method: 'DELETE' }),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(deleteRes.status).toBe(200);

      // Verify deleted from DB
      const deletedRows = await db.select().from(attachments).where(eq(attachments.id, attachmentId)).limit(1);
      expect(deletedRows).toHaveLength(0);
    });

    it('returns 404 for nonexistent attachment', async () => {
      const res = await attachmentsRoutes.GET(astroContext({
        params: { id: 'nonexistent' },
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(404);
    });
  });

  // ========== SESSIONS & STUDY FLOW ==========

  describe('GET|POST /sessions + PATCH /sessions/:id/complete', () => {
    it('GET returns sessions list', async () => {
      const res = await sessionsIndexRoutes.GET(astroContext({
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('POST creates study session', async () => {
      // A real EVENT_TYPES value (see src/lib/schemas/events.ts) rather than
      // an arbitrary string — intended_event_type is currently a bare
      // z.string().min(1), but is future-proof if it's later tightened to
      // z.enum(EVENT_TYPES).
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ course_id: fixture.courseId, intended_event_type: 'practice_done', kc_ids: [fixture.kcId] }),
      });
      const res = await sessionsIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.course_id).toBe(fixture.courseId);
      expect(body.data.intended_event_type).toBe('practice_done');
      expect(body.data.ended_at).toBeNull();
    });

    it('PATCH /sessions/:id/complete marks session done and appends one event per touched KC', async () => {
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ course_id: fixture.courseId, intended_event_type: 'practice_done', kc_ids: [fixture.kcId] }),
      });
      const createRes = await sessionsIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const sessionId = ((await createRes.json()) as any).data.id;

      const completeReq = new Request('http://local.test/api/v1', {
        method: 'PATCH',
        body: JSON.stringify({ reflection: 'Went well' }),
      });
      const completeRes = await sessionsCompleteRoutes.PATCH(astroContext({
        params: { id: sessionId },
        request: completeReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(completeRes.status).toBe(200);
      const body = (await completeRes.json()) as any;
      expect(body.data.id).toBe(sessionId);
      expect(body.data.events_appended).toHaveLength(1);
      expect(body.data.events_appended[0].kc_id).toBe(fixture.kcId);
      expect(Array.isArray(body.data.mastery_deltas)).toBe(true);
    });
  });

  describe('PATCH|DELETE /sessions/:id (v1.6)', () => {
    it('PATCH reschedules a still-planned session', async () => {
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ course_id: fixture.courseId, intended_event_type: 'practice_done' }),
      });
      const createRes = await sessionsIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const sessionId = ((await createRes.json()) as any).data.id;

      const patchReq = new Request('http://local.test/api/v1', {
        method: 'PATCH',
        body: JSON.stringify({ planned_minutes: 45 }),
      });
      const patchRes = await sessionsDetailRoutes.PATCH(astroContext({
        params: { id: sessionId },
        request: patchReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(patchRes.status).toBe(200);
      const body = (await patchRes.json()) as any;
      expect(body.data.planned_minutes).toBe(45);
    });

    it('DELETE removes a session', async () => {
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ course_id: fixture.courseId, intended_event_type: 'practice_done' }),
      });
      const createRes = await sessionsIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const sessionId = ((await createRes.json()) as any).data.id;

      const delRes = await sessionsDetailRoutes.DELETE(astroContext({
        params: { id: sessionId },
        request: new Request('http://local.test/api/v1', { method: 'DELETE' }),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(delRes.status).toBe(200);
    });
  });

  // ========== GRADES & CALENDAR & PROFILE ==========

  describe('GET /grades/summary', () => {
    it('returns weighted grades with by_course breakdown', async () => {
      const res = await gradesRoutes.GET(astroContext({
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data).toHaveProperty('overall_weighted_grade');
      expect(Array.isArray(body.data.by_course)).toBe(true);
    });
  });

  describe('GET /calendar', () => {
    it('returns calendar items within date range', async () => {
      const from = '2024-01-01T00:00:00Z';
      const to = '2024-12-31T23:59:59Z';
      const url = new URL('http://local.test/api/v1/calendar');
      url.searchParams.set('from', from);
      url.searchParams.set('to', to);

      const res = await calendarRoutes.GET(astroContext({
        url,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns 400 when from/to are missing', async () => {
      const url = new URL('http://local.test/api/v1/calendar');
      const res = await calendarRoutes.GET(astroContext({
        url,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /profile', () => {
    it('returns learner profile with mastery, streaks, events', async () => {
      const res = await profileRoutes.GET(astroContext({
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.user_id).toBe(fixture.userId);
      expect(body.data.overall_mastery).toBeDefined();
      expect(body.data.current_streak).toBeDefined();
      expect(body.data.longest_streak).toBeDefined();
      expect(Array.isArray(body.data.recent_events)).toBe(true);
      expect(Array.isArray(body.data.by_course)).toBe(true);
      expect(body.data.knowledge_map).toBeNull();
    });
  });

  // ========== AI TUTOR ==========

  describe('POST /tutor/conversations + GET + POST /end', () => {
    it('POST creates conversation with mode from KC type', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ kc_id: fixture.kcId }),
      });
      const res = await tutorConvIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.kc_id).toBe(fixture.kcId);
      expect(body.data.mode).toBe('classify');
    });

    it('POST honors explicit mode override', async () => {
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ kc_id: fixture.kcId, mode: 'self_explain' }),
      });
      const res = await tutorConvIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.mode).toBe('self_explain');
    });

    it('GET returns conversation with messages', async () => {
      // Create
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ kc_id: fixture.kcId }),
      });
      const createRes = await tutorConvIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const convId = ((await createRes.json()) as any).data.id;

      // Get
      const getRes = await tutorConvDetailRoutes.GET(astroContext({
        params: { id: convId },
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(getRes.status).toBe(200);
      const body = (await getRes.json()) as any;
      expect(body.data.id).toBe(convId);
      expect(Array.isArray(body.data.messages)).toBe(true);
    });

    it('POST /end appends tutor_session event with final_rating', async () => {
      // Create
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ kc_id: fixture.kcId }),
      });
      const createRes = await tutorConvIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const convId = ((await createRes.json()) as any).data.id;

      // End
      const endReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ final_rating: 4 }),
      });
      const endRes = await tutorEndRoutes.POST(astroContext({
        params: { id: convId },
        request: endReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(endRes.status).toBe(200);
      const body = (await endRes.json()) as any;
      expect(body.data.event.type).toBe('tutor_session');
      expect(Array.isArray(body.data.mastery_deltas)).toBe(true);
    });

    it('returns 404 for nonexistent conversation', async () => {
      const res = await tutorConvDetailRoutes.GET(astroContext({
        params: { id: 'nonexistent' },
        request: new Request('http://local.test/api/v1'),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(404);
    });
  });

  // ========== QUICK QUIZ (AGENTIC FLOWS) ==========

  describe('POST /flows/quick_quiz + POST /answers (with mocked OpenRouter)', () => {
    it('POST /flows/quick_quiz generates quiz questions and strips answers from the response', async () => {
      mockOpenRouterJsonFetch({
        items: [{ kc_id: fixture.kcId, question: 'Q?', options: ['A', 'B', 'C', 'D'], correct_index: 1, explanation: 'E' }],
      });
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ kc_id: fixture.kcId }),
      });
      const res = await quickQuizIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.questions).toHaveLength(1);
      expect(body.data.questions[0].kc_id).toBe(fixture.kcId);
      expect(body.data.questions[0].options).toHaveLength(4);
      expect(body.data.questions[0]).not.toHaveProperty('correct_index');
      expect(body.data.questions[0]).not.toHaveProperty('explanation');
    });

    it('POST /flows/quick_quiz supports course_id filtering', async () => {
      mockOpenRouterJsonFetch({
        items: [{ kc_id: fixture.kcId, question: 'Q?', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'E' }],
      });
      const req = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ course_id: fixture.courseId, count: 1 }),
      });
      const res = await quickQuizIndexRoutes.POST(astroContext({
        request: req,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.questions.map((q: any) => q.kc_id)).toEqual([fixture.kcId]);
    });

    it('POST /flows/quick_quiz/:id/answers grades and returns results', async () => {
      mockOpenRouterJsonFetch({
        items: [{ kc_id: fixture.kcId, question: 'Q?', options: ['A', 'B', 'C', 'D'], correct_index: 1, explanation: 'E' }],
      });
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ kc_id: fixture.kcId }),
      });
      const createRes = await quickQuizIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const quizId = ((await createRes.json()) as any).data.id;

      const answersReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ answers: [{ question_index: 0, selected_index: 1 }] }),
      });
      const answersRes = await quickQuizAnswersRoutes.POST(astroContext({
        params: { id: quizId },
        request: answersReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(answersRes.status).toBe(200);
      const body = (await answersRes.json()) as any;
      expect(body.data.score).toBe(100);
      expect(body.data.results[0].correct).toBe(true);
      expect(body.data.mastery_deltas.length).toBeGreaterThan(0);
    });

    it('POST /flows/quick_quiz/:id/answers returns 400 on re-submission', async () => {
      mockOpenRouterJsonFetch({
        items: [{ kc_id: fixture.kcId, question: 'Q?', options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'E' }],
      });
      const createReq = new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ kc_id: fixture.kcId }),
      });
      const createRes = await quickQuizIndexRoutes.POST(astroContext({
        request: createReq,
        locals: { user: { id: fixture.userId } },
      }) as any);
      const quizId = ((await createRes.json()) as any).data.id;

      const answersReq = () => new Request('http://local.test/api/v1', {
        method: 'POST',
        body: JSON.stringify({ answers: [{ question_index: 0, selected_index: 0 }] }),
      });
      const first = await quickQuizAnswersRoutes.POST(astroContext({
        params: { id: quizId },
        request: answersReq(),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(first.status).toBe(200);

      const second = await quickQuizAnswersRoutes.POST(astroContext({
        params: { id: quizId },
        request: answersReq(),
        locals: { user: { id: fixture.userId } },
      }) as any);
      expect(second.status).toBe(400);
      const body = (await second.json()) as any;
      expect(body.error.code).toBe('quiz_not_gradable');
    });
  });

  // ========== 401 AUTHORIZATION (MIDDLEWARE) ==========
  //
  // This file exercises route handlers directly (bypassing src/middleware.ts
  // entirely), so it can't be the place that verifies 401 enforcement — that's
  // a property of the middleware, not of any individual handler. Real
  // coverage: tests/middleware.test.ts, which invokes src/middleware.ts's
  // onRequest directly (stubbing the astro:middleware virtual module) and
  // asserts both the 401-on-API-path and redirect-to-/login behaviors for an
  // unauthenticated request, plus the public-path (/login, /api/v1/auth/*)
  // passthrough case.
});
