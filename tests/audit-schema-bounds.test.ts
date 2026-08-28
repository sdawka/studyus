// Audit fix: bounded free-text fields (previously unbounded z.string()/
// z.string().min(1)), intended_event_type tightened to the real EVENT_TYPES
// enum, and GET /kcs/:id/events limit/offset validated by zod instead of a
// raw Number() that could flow NaN/negative straight into the query.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, kcs, users } from '../src/db/schema';
import { createAssessmentSchema, updateAssessmentSchema } from '../src/lib/schemas/assessments';
import { createCourseSchema, updateCourseSchema } from '../src/lib/schemas/courses';
import { createCorrectionSchema } from '../src/lib/schemas/corrections';
import { kcEventsQuerySchema } from '../src/lib/schemas/events';
import { createNoteSchema, updateNoteSchema } from '../src/lib/schemas/notes';
import { createQuickQuizSchema } from '../src/lib/schemas/quickQuiz';
import { completeStudySessionSchema, createStudySessionSchema, discardStudySessionSchema } from '../src/lib/schemas/sessions';
import { createTaskSchema, updateTaskSchema } from '../src/lib/schemas/tasks';
import { createConversationSchema } from '../src/lib/schemas/tutor';
import { GET as kcEventsRoute } from '../src/pages/api/v1/kcs/[id]/events';

const db = getDb(env.DB);

describe('tasks — title/description caps', () => {
  it('rejects a title over 300 chars and a description over 2000', () => {
    expect(() => createTaskSchema.parse({ title: 'x'.repeat(301) })).toThrow();
    expect(() => createTaskSchema.parse({ title: 'ok', description: 'x'.repeat(2001) })).toThrow();
    expect(() => updateTaskSchema.parse({ title: 'x'.repeat(301) })).toThrow();
    expect(() => updateTaskSchema.parse({ description: 'x'.repeat(2001) })).toThrow();
  });

  it('accepts values at the cap', () => {
    expect(() => createTaskSchema.parse({ title: 'x'.repeat(300), description: 'y'.repeat(2000) })).not.toThrow();
  });
});

describe('notes — title/content caps', () => {
  it('rejects a title over 300 chars and content over 50000', () => {
    expect(() => createNoteSchema.parse({ title: 'x'.repeat(301) })).toThrow();
    expect(() => createNoteSchema.parse({ title: 'ok', content: 'x'.repeat(50001) })).toThrow();
    expect(() => updateNoteSchema.parse({ title: 'x'.repeat(301) })).toThrow();
    expect(() => updateNoteSchema.parse({ content: 'x'.repeat(50001) })).toThrow();
  });

  it('accepts values at the cap', () => {
    expect(() => createNoteSchema.parse({ title: 'x'.repeat(300), content: 'y'.repeat(50000) })).not.toThrow();
  });
});

describe('courses — title/term/instructor/overview caps', () => {
  it('rejects each free-text field once it exceeds its cap', () => {
    expect(() => createCourseSchema.parse({ code: 'X', title: 'x'.repeat(201) })).toThrow();
    expect(() => createCourseSchema.parse({ code: 'X', title: 'ok', term: 'x'.repeat(51) })).toThrow();
    expect(() => createCourseSchema.parse({ code: 'X', title: 'ok', instructor: 'x'.repeat(201) })).toThrow();
    expect(() => createCourseSchema.parse({ code: 'X', title: 'ok', overview: 'x'.repeat(5001) })).toThrow();
    expect(() => updateCourseSchema.parse({ title: 'x'.repeat(201) })).toThrow();
    expect(() => updateCourseSchema.parse({ overview: 'x'.repeat(5001) })).toThrow();
  });

  it('code’s existing 20-char cap is untouched', () => {
    expect(() => createCourseSchema.parse({ code: 'x'.repeat(21), title: 'ok' })).toThrow();
  });
});

describe('assessments — title cap', () => {
  it('rejects a title over 300 chars on create and update', () => {
    expect(() => createAssessmentSchema.parse({ title: 'x'.repeat(301), type: 'quiz' })).toThrow();
    expect(() => updateAssessmentSchema.parse({ title: 'x'.repeat(301) })).toThrow();
  });
});

describe('sessions — intended_event_type enum', () => {
  it('rejects an arbitrary string', () => {
    expect(() => createStudySessionSchema.parse({ intended_event_type: 'not_a_real_type' })).toThrow();
  });

  it('accepts every real value the client actually sends', () => {
    for (const type of ['practice_done', 'reading_done', 'retrieval_practice', 'video_watched']) {
      expect(() => createStudySessionSchema.parse({ intended_event_type: type })).not.toThrow();
    }
  });
});

describe('sessions — terminal command schemas', () => {
  const kcId = '00000000-0000-0000-0000-000000000001';

  it('accepts canonical KC outcomes and legacy exact-empty completion', () => {
    expect(completeStudySessionSchema.parse({ kc_outcomes: [{ kc_id: kcId, self_rating: 1 }] })).toEqual({
      kc_outcomes: [{ kc_id: kcId, self_rating: 1 }],
    });
    expect(completeStudySessionSchema.parse({ kc_ids_touched: [] })).toEqual({ kc_ids_touched: [] });
  });

  it('rejects ambiguous, duplicate, and out-of-range outcomes', () => {
    expect(() => completeStudySessionSchema.parse({ kc_outcomes: [], kc_ids_touched: [] })).toThrow();
    expect(() => completeStudySessionSchema.parse({ kc_outcomes: [{ kc_id: kcId }, { kc_id: kcId }] })).toThrow();
    expect(() => completeStudySessionSchema.parse({ kc_outcomes: [{ kc_id: kcId, self_rating: 0 }] })).toThrow();
    expect(() => completeStudySessionSchema.parse({ kc_outcomes: [{ kc_id: kcId, self_rating: 6 }] })).toThrow();
    expect(() => completeStudySessionSchema.parse({ kc_outcomes: [{ kc_id: kcId, self_rating: 2.5 }] })).toThrow();
  });

  it('keeps discard strict and evidence-free', () => {
    expect(discardStudySessionSchema.parse({})).toEqual({});
    expect(() => discardStudySessionSchema.parse({ kc_ids_touched: [] })).toThrow();
    expect(() => discardStudySessionSchema.parse({ reflection: 'discard' })).toThrow();
  });
});

describe('kcs/:id/events query — limit/offset validation', () => {
  it('rejects a non-numeric limit/offset instead of silently coercing to NaN', () => {
    expect(() => kcEventsQuerySchema.parse({ limit: 'abc' })).toThrow();
    expect(() => kcEventsQuerySchema.parse({ offset: 'abc' })).toThrow();
  });

  it('rejects an out-of-range limit (0 or over 200) and a negative offset', () => {
    expect(() => kcEventsQuerySchema.parse({ limit: '0' })).toThrow();
    expect(() => kcEventsQuerySchema.parse({ limit: '201' })).toThrow();
    expect(() => kcEventsQuerySchema.parse({ offset: '-1' })).toThrow();
  });

  it('accepts valid values, coerced from query-string form', () => {
    const parsed = kcEventsQuerySchema.parse({ limit: '50', offset: '10' });
    expect(parsed).toEqual({ limit: 50, offset: 10 });
  });

  it('accepts omitted limit/offset (both optional)', () => {
    expect(() => kcEventsQuerySchema.parse({})).not.toThrow();
  });
});

describe('corrections — prior_belief/correction caps (v1.7)', () => {
  it('rejects prior_belief over 2000 chars and correction over 2000', () => {
    expect(() => createCorrectionSchema.parse({ correction: 'x'.repeat(2001) })).toThrow();
    expect(() => createCorrectionSchema.parse({ prior_belief: 'x'.repeat(2001), correction: 'ok' })).toThrow();
  });

  it('accepts values at the cap', () => {
    expect(() =>
      createCorrectionSchema.parse({ prior_belief: 'x'.repeat(2000), correction: 'y'.repeat(2000) }),
    ).not.toThrow();
  });

  it('requires a non-empty correction', () => {
    expect(() => createCorrectionSchema.parse({ correction: '' })).toThrow();
  });
});

describe('quick_quiz — kc_ids explicit targeting (v1.7)', () => {
  it('rejects a malformed id in kc_ids', () => {
    expect(() => createQuickQuizSchema.parse({ kc_ids: ['not-a-valid-id'] })).toThrow();
  });

  it('accepts a well-formed kc_ids array', () => {
    expect(() => createQuickQuizSchema.parse({ kc_ids: ['12345678-1234-1234-1234-123456789012'] })).not.toThrow();
  });
});

describe('tutor conversations — absorb mode + details (v1.7)', () => {
  it('accepts mode "absorb" with a details.focus_order array', () => {
    expect(() =>
      createConversationSchema.parse({
        kc_id: '12345678-1234-1234-1234-123456789012',
        mode: 'absorb',
        details: { flow: 'absorb', focus_order: ['12345678-1234-1234-1234-123456789012'] },
      }),
    ).not.toThrow();
  });

  it('rejects a malformed id inside details.focus_order', () => {
    expect(() =>
      createConversationSchema.parse({
        kc_id: '12345678-1234-1234-1234-123456789012',
        details: { focus_order: ['not-an-id'] },
      }),
    ).toThrow();
  });
});

describe('GET /kcs/:id/events route — 400 not 500 on a bad query param', () => {
  let userId: string;
  let kcId: string;

  beforeEach(async () => {
    userId = crypto.randomUUID();
    const courseId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    kcId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
    await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });
    await db.insert(kcs).values({ id: kcId, branchId, courseId, name: 'KC' });
  });

  it('responds 400 invalid_input for a non-numeric limit, not a 500', async () => {
    const res = await kcEventsRoute({
      params: { id: kcId },
      url: new URL(`http://local.test/api/v1/kcs/${kcId}/events?limit=abc`),
      locals: { user: { id: userId } },
    } as any);
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('invalid_input');
  });

  it('responds 200 for a well-formed query', async () => {
    const res = await kcEventsRoute({
      params: { id: kcId },
      url: new URL(`http://local.test/api/v1/kcs/${kcId}/events?limit=10&offset=0`),
      locals: { user: { id: userId } },
    } as any);
    expect(res.status).toBe(200);
  });
});
