import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../src/db/client';
import { branches, courses, events, kcs, users } from '../src/db/schema';
import { generateQuickQuiz, QuizNotGradableError, submitQuickQuizAnswers } from '../src/lib/flows/quick_quiz';

const db = getDb(env.DB);

let userId: string;
let courseId: string;
let kcIds: string[];

beforeEach(async () => {
  userId = crypto.randomUUID();
  courseId = crypto.randomUUID();
  const branchId = crypto.randomUUID();
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, passwordHash: 'x' });
  await db.insert(courses).values({ id: courseId, userId, code: 'TEST 101', slug: `test-${courseId}`, title: 'Test Course' });
  await db.insert(branches).values({ id: branchId, courseId, name: 'Branch' });

  kcIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(kcs).values(
    kcIds.map((id, i) => ({ id, branchId, courseId, name: `KC ${i}`, kcType: 'concept' as const, sortOrder: i })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockJsonFetch(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = { choices: [{ message: { content: JSON.stringify(payload) } }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
}

describe('generateQuickQuiz', () => {
  it('picks due KCs (lowest mastery first), generates one MCQ per KC, and strips answers from the response', async () => {
    mockJsonFetch({
      items: kcIds.map((kc_id, i) => ({
        kc_id,
        question: `Question ${i}?`,
        options: ['A', 'B', 'C', 'D'],
        correct_index: 1,
        explanation: `Explanation ${i}`,
      })),
    });

    const quiz = await generateQuickQuiz(
      db,
      userId,
      { course_id: courseId, count: 3 },
      { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' },
    );

    expect(quiz.questions).toHaveLength(3);
    for (const q of quiz.questions) {
      expect(q).not.toHaveProperty('correct_index');
      expect(q).not.toHaveProperty('explanation');
      expect(q.options).toHaveLength(4);
    }
  });

  it('falls back to a generic self-check item for any KC the model failed to cover', async () => {
    // Model only returns one item even though 3 KCs were requested.
    mockJsonFetch({ items: [{ kc_id: kcIds[0], question: 'Q?', options: ['A', 'B'], correct_index: 0, explanation: 'E' }] });

    const quiz = await generateQuickQuiz(
      db,
      userId,
      { course_id: courseId, count: 3 },
      { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' },
    );

    expect(quiz.questions).toHaveLength(3);
    const coveredKcs = new Set(quiz.questions.map((q) => q.kc_id));
    expect(coveredKcs).toEqual(new Set(kcIds));
  });
});

describe('submitQuickQuizAnswers', () => {
  it('grades answers, computes a score, and appends one retrieval_practice event per KC', async () => {
    mockJsonFetch({
      items: kcIds.map((kc_id, i) => ({
        kc_id,
        question: `Question ${i}?`,
        options: ['A', 'B', 'C', 'D'],
        correct_index: 1,
        explanation: `Explanation ${i}`,
      })),
    });
    const quiz = await generateQuickQuiz(db, userId, { course_id: courseId, count: 3 }, { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' });

    // Answer question 0 correctly, 1 and 2 incorrectly.
    const result = await submitQuickQuizAnswers(db, userId, quiz.id, {
      answers: [
        { question_index: 0, selected_index: 1 },
        { question_index: 1, selected_index: 0 },
        { question_index: 2, selected_index: 0 },
      ],
    });

    expect(result.score).toBe(33);
    expect(result.results[0].correct).toBe(true);
    expect(result.results[1].correct).toBe(false);
    expect(result.mastery_deltas).toHaveLength(3);

    for (const kcId of kcIds) {
      const kcEvents = await db.select().from(events).where(eq(events.kcId, kcId));
      expect(kcEvents.some((e) => e.type === 'retrieval_practice' && e.isInstructional && e.isAssessment)).toBe(true);
    }
  });

  it('rejects grading the same quiz twice', async () => {
    mockJsonFetch({ items: [{ kc_id: kcIds[0], question: 'Q?', options: ['A', 'B'], correct_index: 0, explanation: 'E' }] });
    const quiz = await generateQuickQuiz(db, userId, { kc_id: kcIds[0] }, { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' });

    await submitQuickQuizAnswers(db, userId, quiz.id, { answers: [{ question_index: 0, selected_index: 0 }] });
    await expect(
      submitQuickQuizAnswers(db, userId, quiz.id, { answers: [{ question_index: 0, selected_index: 0 }] }),
    ).rejects.toThrow(QuizNotGradableError);
  });
});

describe('generateQuickQuiz — kc_ids explicit targeting (v1.7)', () => {
  it('overrides the mastery heuristic entirely, building the quiz from exactly the given KCs in the given order', async () => {
    // Give kcIds[2] the lowest mastery so the heuristic would normally favor
    // it first; kc_ids must override that and use exactly the given
    // subset/order regardless.
    await db.update(kcs).set({ mastery: 5 }).where(eq(kcs.id, kcIds[2]));

    mockJsonFetch({
      items: [kcIds[1], kcIds[0]].map((kc_id, i) => ({
        kc_id,
        question: `Question ${i}?`,
        options: ['A', 'B', 'C', 'D'],
        correct_index: 0,
        explanation: 'E',
      })),
    });

    const quiz = await generateQuickQuiz(
      db,
      userId,
      { kc_ids: [kcIds[1], kcIds[0]] },
      { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' },
    );

    expect(quiz.questions.map((q) => q.kc_id)).toEqual([kcIds[1], kcIds[0]]);
  });

  it('ownership-checks every id in kc_ids the same way as the singular kc_id', async () => {
    const otherUserId = crypto.randomUUID();
    const otherCourseId = crypto.randomUUID();
    const otherBranchId = crypto.randomUUID();
    const otherKcId = crypto.randomUUID();
    await db.insert(users).values({ id: otherUserId, email: `${otherUserId}@test.local`, passwordHash: 'x' });
    await db.insert(courses).values({ id: otherCourseId, userId: otherUserId, code: 'X 1', slug: `other-${otherCourseId}`, title: 'Other' });
    await db.insert(branches).values({ id: otherBranchId, courseId: otherCourseId, name: 'B' });
    await db.insert(kcs).values({ id: otherKcId, branchId: otherBranchId, courseId: otherCourseId, name: 'Other KC', kcType: 'concept' });

    await expect(
      generateQuickQuiz(db, userId, { kc_ids: [otherKcId] }, { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' }),
    ).rejects.toThrow();
  });

  it('falls back to the mastery heuristic unchanged when kc_ids is absent', async () => {
    mockJsonFetch({
      items: kcIds.map((kc_id, i) => ({ kc_id, question: `Q${i}?`, options: ['A', 'B', 'C', 'D'], correct_index: 0, explanation: 'E' })),
    });
    const quiz = await generateQuickQuiz(db, userId, { course_id: courseId, count: 3 }, { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' });
    expect(new Set(quiz.questions.map((q) => q.kc_id))).toEqual(new Set(kcIds));
  });
});

describe('submitQuickQuizAnswers — event source (v1.7)', () => {
  it('appends grading retrieval_practice events with source "tutor", not the createEvent default "manual"', async () => {
    mockJsonFetch({ items: [{ kc_id: kcIds[0], question: 'Q?', options: ['A', 'B'], correct_index: 0, explanation: 'E' }] });
    const quiz = await generateQuickQuiz(db, userId, { kc_id: kcIds[0] }, { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' });
    await submitQuickQuizAnswers(db, userId, quiz.id, { answers: [{ question_index: 0, selected_index: 0 }] });

    const kcEvents = await db.select().from(events).where(eq(events.kcId, kcIds[0]));
    const graded = kcEvents.find((e) => e.type === 'retrieval_practice');
    expect(graded?.source).toBe('tutor');
  });
});
