// quick_quiz — the pattern-setter agentic flow (docs/architecture/
// agentic-channels.md): given (course?, kc?, count), pick due KCs, generate
// MCQs via OpenRouter JSON mode, grade submitted answers, and append one
// dual-role event per KC. Every function here is `(db, userId, input, ...)
// -> result` with no route-handler logic inside it, so a future Flue tool
// can wrap it exactly as-is.
//
// Storage decision (the plan explicitly leaves this to the implementer —
// documented here and in docs/api.md): quizzes reuse the `study_sessions`
// row rather than a new table. `intended_event_type` is set to the sentinel
// 'quick_quiz' (not a real EVENT_TYPE; `completeSession` from
// services/sessions.ts is never called on these rows — grading is handled
// entirely by `submitQuickQuizAnswers` below). The generated items (with
// correct answers + explanations) and, once graded, the submitted answers +
// score are JSON-stringified into the otherwise-unused `reflection` text
// column. `session_kcs` still links the picked KCs, same as a real session.
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { courses, kcs, sessionKcs, studySessions } from '../../db/schema';
import type { CreateQuickQuizInput, SubmitQuickQuizAnswersInput } from '../schemas/quickQuiz';
import { createEvent } from '../services/events';
import { NotFoundError, requireOwnedCourse, requireOwnedKc } from '../services/util';
import { chatCompletionJSON, type ChatMessage } from '../services/tutor/openrouter';

const QUICK_QUIZ_SENTINEL = 'quick_quiz';
const DEFAULT_COUNT = 5;

type QuizItem = {
  kc_id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

type QuizBlob = {
  items: QuizItem[];
  graded?: { answers: Array<{ question_index: number; selected_index: number; correct: boolean }>; score: number };
};

type TutorEnv = { OPENROUTER_API_KEY: string; OPENROUTER_MODEL: string };

async function pickDueKcs(db: Db, userId: string, input: CreateQuickQuizInput, count: number) {
  if (input.kc_id) {
    const kc = await requireOwnedKc(db, userId, input.kc_id);
    return [kc];
  }

  const whereClauses = [eq(courses.userId, userId)];
  if (input.course_id) {
    await requireOwnedCourse(db, userId, input.course_id);
    whereClauses.push(eq(kcs.courseId, input.course_id));
  }

  // Lowest mastery, then oldest (or never-touched — NULL sorts first in
  // SQLite ASC) last_event_at: the "most due for review" heuristic.
  const rows = await db
    .select({ kc: kcs })
    .from(kcs)
    .innerJoin(courses, eq(kcs.courseId, courses.id))
    .where(and(...whereClauses))
    .orderBy(asc(kcs.mastery), asc(kcs.lastEventAt))
    .limit(count);

  if (rows.length === 0) throw new NotFoundError('No knowledge components available for a quiz yet');
  return rows.map((r) => r.kc);
}

function buildQuizPrompt(targetKcs: Array<{ id: string; name: string; description: string | null; kcType: string }>): ChatMessage[] {
  const kcList = targetKcs
    .map((k, i) => `${i + 1}. kc_id="${k.id}" name="${k.name}"${k.description ? ` — ${k.description}` : ''} (kc_type: ${k.kcType})`)
    .join('\n');

  const system = `You are generating a short multiple-choice retrieval-practice quiz for a student, exactly one question per listed knowledge component. Respond with ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{"items":[{"kc_id":"<the exact kc_id given>","question":"...","options":["...","...","...","..."],"correct_index":0,"explanation":"..."}]}
Rules: exactly one item per KC listed, in the same order, using the exact kc_id string given; exactly 4 options per item; correct_index is the 0-based index of the correct option; explanation is 1-2 sentences and purely informational (no hype); question difficulty should suit the KC's kc_type (simpler recall for fact/association, applied scenarios for concept/rule/principle).`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: `Generate one question per knowledge component:\n${kcList}` },
  ];
}

function parseQuizItem(raw: unknown, validKcIds: Set<string>, fallbackKcId: string): QuizItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.question !== 'string') return null;
  if (!Array.isArray(obj.options) || obj.options.length < 2) return null;
  if (typeof obj.correct_index !== 'number' || obj.correct_index < 0 || obj.correct_index >= obj.options.length) return null;

  const kcId = typeof obj.kc_id === 'string' && validKcIds.has(obj.kc_id) ? obj.kc_id : fallbackKcId;
  return {
    kc_id: kcId,
    question: obj.question,
    options: obj.options.map((o) => String(o)),
    correct_index: obj.correct_index,
    explanation: typeof obj.explanation === 'string' ? obj.explanation : '',
  };
}

export class QuizGenerationError extends Error {
  constructor() {
    super('Could not generate quiz questions right now — please try again');
    this.name = 'QuizGenerationError';
  }
}

function parseQuizItems(raw: unknown, targetKcs: Array<{ id: string }>): QuizItem[] {
  const validKcIds = new Set(targetKcs.map((k) => k.id));
  const rawItems = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: unknown[] }).items : [];

  const items: QuizItem[] = [];
  for (const raw of rawItems) {
    const parsed = parseQuizItem(raw, validKcIds, targetKcs[0].id);
    if (parsed) items.push(parsed);
  }
  if (items.length === 0) throw new QuizGenerationError();

  // Fall back to one generic self-check item for any KC the model skipped,
  // so grading/event-append still has full coverage of the picked KCs.
  const covered = new Set(items.map((it) => it.kc_id));
  for (const kc of targetKcs) {
    if (!covered.has(kc.id)) {
      items.push({
        kc_id: kc.id,
        question: 'Quick check: can you explain the key idea behind this topic in your own words?',
        options: ['Yes, confidently', 'Somewhat', 'Not really', 'No'],
        correct_index: 0,
        explanation: 'Self-assessed recall check (fallback question — the model skipped this KC).',
      });
    }
  }
  return items;
}

export async function generateQuickQuiz(db: Db, userId: string, input: CreateQuickQuizInput, env: TutorEnv) {
  const count = input.count ?? DEFAULT_COUNT;
  const targetKcs = await pickDueKcs(db, userId, input, count);

  const raw = await chatCompletionJSON({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
    messages: buildQuizPrompt(targetKcs),
  });
  const items = parseQuizItems(raw, targetKcs);

  const sessionId = crypto.randomUUID();
  const blob: QuizBlob = { items };

  await db.insert(studySessions).values({
    id: sessionId,
    userId,
    courseId: input.course_id ?? null,
    intendedEventType: QUICK_QUIZ_SENTINEL,
    plannedMinutes: null,
    startedAt: Date.now(),
    reflection: JSON.stringify(blob),
  });
  await db.insert(sessionKcs).values(targetKcs.map((k) => ({ id: crypto.randomUUID(), studySessionId: sessionId, kcId: k.id })));

  return {
    id: sessionId,
    questions: items.map((item, index) => ({ index, kc_id: item.kc_id, question: item.question, options: item.options })),
  };
}

export class QuizNotGradableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuizNotGradableError';
  }
}

export async function submitQuickQuizAnswers(db: Db, userId: string, sessionId: string, input: SubmitQuickQuizAnswersInput) {
  const rows = await db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.id, sessionId), eq(studySessions.userId, userId)))
    .limit(1);
  const session = rows[0];
  if (!session || session.intendedEventType !== QUICK_QUIZ_SENTINEL) throw new NotFoundError('Quiz');

  const blob: QuizBlob = session.reflection ? (JSON.parse(session.reflection) as QuizBlob) : { items: [] };
  if (blob.graded) throw new QuizNotGradableError('This quiz has already been graded');
  if (blob.items.length === 0) throw new QuizNotGradableError('This quiz has no questions to grade');

  const results = blob.items.map((item, index) => {
    const answer = input.answers.find((a) => a.question_index === index);
    const selectedIndex = answer?.selected_index ?? null;
    const correct = selectedIndex !== null && selectedIndex === item.correct_index;
    return { question_index: index, kc_id: item.kc_id, selected_index: selectedIndex, correct, correct_index: item.correct_index, explanation: item.explanation };
  });

  const score = Math.round((results.filter((r) => r.correct).length / results.length) * 100);

  blob.graded = {
    answers: results.map((r) => ({ question_index: r.question_index, selected_index: r.selected_index ?? -1, correct: r.correct })),
    score,
  };
  await db.update(studySessions).set({ reflection: JSON.stringify(blob), endedAt: Date.now() }).where(eq(studySessions.id, sessionId));

  // One dual-role `retrieval_practice` event per KC — a quiz answer is both
  // instruction (the explanation shown) and assessment (correctness), the
  // same KLI reasoning as tutor_session.
  const masteryDeltas = [];
  for (const r of results) {
    const { masteryDeltas: deltas } = await createEvent(db, userId, {
      type: 'retrieval_practice',
      kc_id: r.kc_id,
      course_id: session.courseId ?? undefined,
      payload: { correct: r.correct, session_id: sessionId, channel: 'quick_quiz' },
    });
    masteryDeltas.push(...deltas);
  }

  return {
    id: sessionId,
    score,
    results: results.map((r) => ({ question_index: r.question_index, kc_id: r.kc_id, correct: r.correct, correct_index: r.correct_index, explanation: r.explanation })),
    mastery_deltas: masteryDeltas,
  };
}
