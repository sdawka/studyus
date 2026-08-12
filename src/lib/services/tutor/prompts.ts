// System-prompt builder: assembles server-side context (KC, branch, course,
// mastery, recent events, linked notes) into a mode-specific system prompt.
// The mode → instruction mapping is the KLI asymmetry hypothesis from
// docs/architecture/events-and-mastery.md: every mode ends a turn with a
// retrieval question (spaced retrieval is safe for all KC types); the
// complex, sense-making instruction (self-explanation, interactive models)
// is reserved for types where it actually pays off.
import type { KcType } from '../../schemas/kcs';
import type { TutorMode } from '../../schemas/tutor';
import { MODEL_SPEC_INSTRUCTIONS } from './modelSpec';

export function modeForKcType(kcType: KcType): TutorMode {
  switch (kcType) {
    case 'fact':
    case 'association':
      return 'recall';
    case 'concept':
      return 'classify';
    case 'rule':
      return 'worked_example';
    case 'principle':
      return 'interactive_model'; // default; 'self_explain' is the explicit fallback/override
  }
}

export type TutorContextEvent = { type: string; ts: number; payload: unknown };
export type TutorContextNote = { title: string; body: string };

export type TutorContext = {
  kc: { name: string; type: KcType; description: string | null; practiceNotes: string | null };
  branchName: string;
  course: { title: string; overview: string | null };
  mastery: number;
  status: string;
  recentEvents: TutorContextEvent[];
  linkedNotes: TutorContextNote[];
  mode: TutorMode;
};

const MODE_INSTRUCTIONS: Record<TutorMode, string> = {
  recall: `Mode: spaced recall drill (fact/association KC — constant condition, constant response). Run flashcard-style retrieval: ask a direct question drawn from the KC's name/description/practice notes, listen to the answer, then give brief corrective feedback. If correct, move to a slightly harder or differently-phrased question; if incorrect, give the correct answer plus a one-line explanation, then a slightly easier question. Keep exchanges short.`,
  classify: `Mode: classification practice (concept KC — variable condition, constant response). Pose a short classification scenario (2-3 plausible categories, a concrete variable context) and ask the student to classify it. When they answer, give feature-focusing feedback: name the specific feature(s) that determine the correct category, whether they got it right or wrong. Vary the surface details of the scenario each turn so the student learns the category boundary, not one memorized example.`,
  worked_example: `Mode: worked example with fading (rule KC — variable condition, variable response). Start by showing one complete worked example of the procedure with a brief explanation of each step. On the next turn, give a similar problem but only step through the first steps yourself, asking the student to complete the remainder. As they succeed, hand over more of the procedure until they're solving a new problem independently, offering hints only if asked.`,
  self_explain: `Mode: self-explanation dialogue (principle KC — variable condition/response + rationale). Use Socratic questioning to probe the student's understanding of *why* this holds, not just what it says: "Why do you think that happens?", "What would change if we adjusted X?". Let the student do most of the explaining; correct gently and only after they've tried.`,
  interactive_model: `Mode: interactive model (principle KC — variable condition/response + rationale). After 2-4 exchanges of Socratic questioning about why the relationship holds, you may emit an interactive model spec so the student can explore it directly. ${MODEL_SPEC_INSTRUCTIONS}`,
};

const RETRIEVAL_REMINDER =
  "Regardless of mode: end every one of your turns with a short retrieval question that asks the student to recall, restate, or predict something (per the KLI asymmetry hypothesis — spaced retrieval helps for every KC type, even when deeper instruction doesn't).";

function toneReminder(mastery: number): string {
  return `Tone: purely informational and encouraging — no hype, gamification, or pressure. Calibrate difficulty to the student's current mastery (${mastery}%): favor easier, confidence-building retrieval when mastery is low, and more challenging application/transfer questions as it climbs.`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function describePayload(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof p.correct === 'boolean') parts.push(p.correct ? 'correct' : 'incorrect');
  if (typeof p.score === 'number') parts.push(`score ${p.score}`);
  if (typeof p.self_rating === 'number') parts.push(`self-rating ${p.self_rating}/5`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

function summarizeEvents(events: TutorContextEvent[]): string {
  if (events.length === 0) return 'No recorded events yet for this KC — this is likely the student\'s first structured practice on it.';
  return events.map((e) => `- ${e.type} on ${new Date(e.ts).toISOString().slice(0, 10)}${describePayload(e.payload)}`).join('\n');
}

export function buildSystemPrompt(ctx: TutorContext): string {
  const lines: string[] = [];

  lines.push(
    `You are studyus's AI tutor, helping a student master the knowledge component "${ctx.kc.name}" (kc_type: ${ctx.kc.type}) in the "${ctx.branchName}" branch of "${ctx.course.title}".`,
  );
  if (ctx.kc.description) lines.push(`KC description: ${ctx.kc.description}`);
  if (ctx.kc.practiceNotes) lines.push(`Practice notes: ${ctx.kc.practiceNotes}`);
  if (ctx.course.overview) lines.push(`Course overview: ${truncate(ctx.course.overview, 400)}`);
  lines.push(`Current mastery: ${ctx.mastery}% (${ctx.status}).`);
  lines.push(`Recent events for this KC:\n${summarizeEvents(ctx.recentEvents)}`);
  if (ctx.linkedNotes.length) {
    lines.push(
      `The student's own linked notes on this KC:\n${ctx.linkedNotes.map((n) => `- ${n.title}: ${truncate(n.body, 500)}`).join('\n')}`,
    );
  }
  lines.push(MODE_INSTRUCTIONS[ctx.mode]);
  lines.push(RETRIEVAL_REMINDER);
  lines.push(toneReminder(ctx.mastery));

  return lines.join('\n\n');
}
