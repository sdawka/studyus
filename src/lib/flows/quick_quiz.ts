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
import { listCourseMcqBank, listKcExercises, type ExerciseRow } from '../services/exercises';
import { NotFoundError, requireOwnedCourse, requireOwnedKc } from '../services/util';
import { chatCompletionJSON, type ChatMessage } from '../services/tutor/openrouter';
import { requireAiFeature } from '../ai/capabilities';

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

type TutorEnv = { AI_FEATURES_ENABLED?: string; OPENROUTER_API_KEY?: string; OPENROUTER_MODEL: string };

type McqDetails = { options: string[]; correct_index: number; explanation: string };

// v2.0: QuickQuiz prefers the seeded exercise bank (courses/<slug>/
// exercises.json, see courses/exercise-schema.md) over AI generation — only
// KCs with no seeded `mcq` items fall through to the OpenRouter path below.
// Course-scoped requests (input.course_id set) pull the whole course's mcq
// bank in one query (listCourseMcqBank); otherwise (explicit kc_id/kc_ids,
// or the mastery heuristic with no course_id, which can span courses) we
// fetch per-KC since the target set is small (<=10) — the fewer-queries path
// per KC beats grouping by an unknown course.
async function loadSeededMcqByKc(
  db: Db,
  userId: string,
  input: CreateQuickQuizInput,
  targetKcs: Array<{ id: string }>,
): Promise<Map<string, ExerciseRow[]>> {
  const byKc = new Map<string, ExerciseRow[]>();

  if (input.course_id) {
    const bank = await listCourseMcqBank(db, userId, input.course_id);
    for (const row of bank) {
      const list = byKc.get(row.kcId) ?? [];
      list.push(row);
      byKc.set(row.kcId, list);
    }
    return byKc;
  }

  for (const kc of targetKcs) {
    const rows = await listKcExercises(db, userId, kc.id, { kind: 'mcq', withAnswers: true });
    if (rows.length > 0) byKc.set(kc.id, rows as unknown as ExerciseRow[]);
  }
  return byKc;
}

// Random-among-them is intentionally simple (Date.now-based randomness is
// fine here — this is runtime app code serving quiz variety, not a
// determinism-sensitive workflow script).
function pickSeededItems(pool: ExerciseRow[], kcId: string, count: number): QuizItem[] {
  // Sample without replacement. A recommendation is only routed here when
  // the authored bank can fill its requested budget, but generic callers may
  // still need the AI fallback for a short bank.
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  return shuffled.map((chosen) => {
    const details = chosen.details as McqDetails;
    return {
      kc_id: kcId,
      question: chosen.prompt,
      options: details.options,
      correct_index: details.correct_index,
      explanation: details.explanation,
    };
  });
}

async function pickDueKcs(db: Db, userId: string, input: CreateQuickQuizInput, count: number) {
  // v1.7: explicit KC targeting overrides the mastery heuristic entirely
  // (and takes precedence over the singular kc_id too, since it's the more
  // specific ask) — ownership-checked the same way, in the order given, so
  // an absorb flow can quiz exactly the not-yet-ready prereqs a prior graph
  // call flagged.
  if (input.kc_ids && input.kc_ids.length > 0) {
    const targetKcs = [];
    for (const id of input.kc_ids) {
      targetKcs.push(await requireOwnedKc(db, userId, id));
    }
    return targetKcs;
  }

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

  // Fall back for every missing target occurrence, not merely every unique
  // KC. An exact-KC recommendation intentionally repeats one KC to request a
  // 3/5/8-question set.
  const covered = new Map<string, number>();
  for (const item of items) covered.set(item.kc_id, (covered.get(item.kc_id) ?? 0) + 1);
  const consumed = new Map<string, number>();
  for (const kc of targetKcs) {
    const used = consumed.get(kc.id) ?? 0;
    consumed.set(kc.id, used + 1);
    if (used >= (covered.get(kc.id) ?? 0)) {
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

  // Existing callers get one question per selected KC. Only an explicit
  // singular target plus explicit count asks for several questions on that
  // same KC (the Global Next Move contract).
  const targetOccurrences = input.kc_id && !input.kc_ids?.length && input.count !== undefined
    ? Array.from({ length: count }, () => targetKcs[0])
    : targetKcs;

  const seededByKc = await loadSeededMcqByKc(db, userId, input, targetKcs);
  const requestedCountByKc = new Map<string, number>();
  for (const kc of targetOccurrences) requestedCountByKc.set(kc.id, (requestedCountByKc.get(kc.id) ?? 0) + 1);
  const seededItemsByKc = new Map<string, QuizItem[]>();
  const aiTargetKcs: typeof targetKcs = [];
  for (const kc of targetKcs) {
    const pool = seededByKc.get(kc.id);
    const requested = requestedCountByKc.get(kc.id) ?? 1;
    const seeded = pool ? pickSeededItems(pool, kc.id, requested) : [];
    seededItemsByKc.set(kc.id, seeded);
    for (let i = seeded.length; i < requested; i++) aiTargetKcs.push(kc);
  }

  // Only call out to AI generation for KCs the seeded bank didn't cover —
  // if every picked KC has seeded items, this quiz works with no
  // OPENROUTER_API_KEY set at all.
  let aiItems: QuizItem[] = [];
  if (aiTargetKcs.length > 0) {
    requireAiFeature(env, 'quiz_generation');
    const raw = await chatCompletionJSON({
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
      messages: buildQuizPrompt(aiTargetKcs),
    });
    aiItems = parseQuizItems(raw, aiTargetKcs);
  }

  const aiItemsByKc = new Map<string, QuizItem[]>();
  for (const item of aiItems) {
    const list = aiItemsByKc.get(item.kc_id) ?? [];
    list.push(item);
    aiItemsByKc.set(item.kc_id, list);
  }
  const items = targetOccurrences.map((kc) => seededItemsByKc.get(kc.id)?.shift() ?? aiItemsByKc.get(kc.id)?.shift()!);

  const sessionId = crypto.randomUUID();
  const blob: QuizBlob = { items };

  await db.insert(studySessions).values({
    id: sessionId,
    userId,
    courseId: input.course_id ?? null,
    intendedEventType: QUICK_QUIZ_SENTINEL,
    plannedMinutes: input.planned_minutes ?? null,
    startedAt: Date.now(),
    reflection: JSON.stringify(blob),
  });
  const linkedKcIds = [...new Set(targetKcs.map((kc) => kc.id))];
  await db.insert(sessionKcs).values(linkedKcIds.map((kcId) => ({ id: crypto.randomUUID(), studySessionId: sessionId, kcId })));

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
    const { masteryDeltas: deltas } = await createEvent(
      db,
      userId,
      {
        type: 'retrieval_practice',
        kc_id: r.kc_id,
        course_id: session.courseId ?? undefined,
        payload: { correct: r.correct, session_id: sessionId, channel: 'quick_quiz' },
      },
      'tutor',
    );
    masteryDeltas.push(...deltas);
  }

  return {
    id: sessionId,
    score,
    results: results.map((r) => ({ question_index: r.question_index, kc_id: r.kc_id, correct: r.correct, correct_index: r.correct_index, explanation: r.explanation })),
    mastery_deltas: masteryDeltas,
  };
}
