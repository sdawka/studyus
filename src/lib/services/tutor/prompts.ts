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

// v1.7 absorb-mode context superset (docs/api.md "Absorb context assembly").
// Shapes are intentionally local/structural rather than imported from
// ../knowledgeMap (owned by a parallel track) — they mirror the frozen
// getKcGraph/listKcMisconceptions/listKcScaffolds row shapes structurally,
// so conversations.ts's assembleTutorContext just needs to map field names
// once, rather than coupling this module to that one's exact export names.
export type AbsorbPrereq = {
  kcId: string;
  slug: string | null;
  name: string;
  kcType: KcType;
  mastery: number;
  status: string;
  ready: boolean;
  depth: number;
};

export type AbsorbMisconception = {
  slug: string;
  name: string;
  description: string;
  rootCause: string;
  diagnosticProbe: string;
  correction: string;
};

export type AbsorbScaffold = {
  kind: string;
  level: number;
  title: string;
  body: string;
};

export type AbsorbContext = {
  // KC ids in the learner's declared interest order (details.focus_order).
  focusOrder: string[];
  // Prereq nodes, already ordered by the caller: focus_order first (for any
  // prereq the learner explicitly ordered), then remaining prereqs by graph
  // depth ascending as a fallback.
  prereqs: AbsorbPrereq[];
  misconceptions: AbsorbMisconception[];
  scaffolds: AbsorbScaffold[];
  plannedMinutes?: number | null;
};

export type TutorContext = {
  kc: { name: string; type: KcType; description: string | null; practiceNotes: string | null };
  branchName: string;
  course: { title: string; overview: string | null };
  mastery: number;
  status: string;
  recentEvents: TutorContextEvent[];
  linkedNotes: TutorContextNote[];
  mode: TutorMode;
  // Present only for mode === 'absorb'.
  absorb?: AbsorbContext;
};

const MODE_INSTRUCTIONS: Record<TutorMode, string> = {
  recall: `Mode: spaced recall drill (fact/association KC — constant condition, constant response). Run flashcard-style retrieval: ask a direct question drawn from the KC's name/description/practice notes, listen to the answer, then give brief corrective feedback. If correct, move to a slightly harder or differently-phrased question; if incorrect, give the correct answer plus a one-line explanation, then a slightly easier question. Keep exchanges short.`,
  classify: `Mode: classification practice (concept KC — variable condition, constant response). Pose a short classification scenario (2-3 plausible categories, a concrete variable context) and ask the student to classify it. When they answer, give feature-focusing feedback: name the specific feature(s) that determine the correct category, whether they got it right or wrong. Vary the surface details of the scenario each turn so the student learns the category boundary, not one memorized example.`,
  worked_example: `Mode: worked example with fading (rule KC — variable condition, variable response). Start by showing one complete worked example of the procedure with a brief explanation of each step. On the next turn, give a similar problem but only step through the first steps yourself, asking the student to complete the remainder. As they succeed, hand over more of the procedure until they're solving a new problem independently, offering hints only if asked.`,
  self_explain: `Mode: self-explanation dialogue (principle KC — variable condition/response + rationale). Use Socratic questioning to probe the student's understanding of *why* this holds, not just what it says: "Why do you think that happens?", "What would change if we adjusted X?". Let the student do most of the explaining; correct gently and only after they've tried.`,
  interactive_model: `Mode: interactive model (principle KC — variable condition/response + rationale). After 2-4 exchanges of Socratic questioning about why the relationship holds, you may emit an interactive model spec so the student can explore it directly. ${MODEL_SPEC_INSTRUCTIONS}`,
  absorb: `Mode: absorb — a staged lesson arc that teaches the target KC by first shoring up its prerequisites, then synthesizing them into the target, while watching for misconceptions along the way. Work through these stages in order, but don't announce stage names to the student — just move through them naturally:

Stage A — prereq verification: look at "Prerequisite readiness" below. For each prereq marked not-ready, weakest (lowest mastery) first, ask ONE targeted retrieval or application question about it, give brief corrective feedback, then move to the next not-ready prereq. If every prereq is already ready, say so briefly (one sentence) and move straight to Stage B.

Stage B — interest-ordered synthesis: teach the target KC by walking through its prerequisites in the order given under "Focus order" (that's the learner's own declared interest order — respect it over any other ordering), explicitly connecting each prereq to the target KC as you go — don't just re-teach each prereq in isolation, show how it feeds into the target. Calibrate the depth of sense-making instruction to the *target* KC's kc_type: heavy self-explanation/derivation work only when the target is a rule or principle; a lighter feature-focused treatment when the target is a concept (fact/association targets are unusual for absorb but treat the same way as concept if they occur). Reach for a matching seeded scaffold under "Scaffolds" when one fits, respecting its fading level against the student's current target-KC mastery (level 1 below 40% mastery, level 2 from 40-79%, level 3 at 80%+) rather than always defaulting to the most-scaffolded option.

Stage C — misconception probing: weave the seeded diagnostic_probe questions from "Known misconceptions" naturally into the dialogue rather than asking them as an obvious pop quiz. When a student's answer reveals one of these misconceptions (or a new one you didn't have seeded), do root-cause work before correcting: name where you think the belief comes from (the misconception's root_cause, or your own inference for an unseeded one), then contrast it explicitly with the correct model.

Stage D — correction proposals: once you've done that root-cause + contrast work for a genuinely surfaced misbelief, emit exactly one additional fenced json block (in addition to, never instead of, your prose response) in this exact shape:
\`\`\`json
{"type": "correction_proposal", "misconception_slug": "known-slug-if-any", "prior_belief": "the misconception, phrased in the student's own words from this conversation", "correction": "the correct belief, standing alone and understandable without the prior_belief"}
\`\`\`
Omit "misconception_slug" entirely for a freeform correction that doesn't match one of the seeded misconceptions. At most one such block per message. Never emit this block speculatively — only when the dialogue itself actually surfaced the misbelief in this conversation, not because a misconception is merely listed as possible for this KC.

${MODEL_SPEC_INSTRUCTIONS}`,
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

// Renders the absorb-mode context superset (docs/api.md "Absorb context
// assembly"): prereq readiness, focus_order, misconceptions, scaffolds.
// Only ever called when ctx.mode === 'absorb' and ctx.absorb is present.
function describeAbsorbContext(absorb: AbsorbContext): string {
  const sections: string[] = [];

  if (absorb.plannedMinutes !== null && absorb.plannedMinutes !== undefined) {
    sections.push(`Session budget: about ${absorb.plannedMinutes} minutes. Pace the lesson to reach one useful retrieval check within that budget; do not rush, promise completion, or mention an exact countdown.`);
  }

  if (absorb.prereqs.length === 0) {
    sections.push('Prerequisite readiness: this KC has no recorded prerequisites — skip straight to Stage B.');
  } else {
    const lines = absorb.prereqs.map(
      (p) =>
        `- ${p.name} (kc_type: ${p.kcType}, mastery ${p.mastery}%, status ${p.status}) — ${p.ready ? 'ready' : 'NOT ready'}`,
    );
    sections.push(`Prerequisite readiness (target-KC dependencies, ordered — see "Focus order" below for the priority to teach them in):\n${lines.join('\n')}`);
  }

  sections.push(
    absorb.focusOrder.length
      ? `Focus order (the learner's own declared interest order — teach/synthesize prereqs in this order in Stage B): ${absorb.focusOrder.join(', ')}`
      : 'Focus order: none declared — fall back to prerequisite graph depth order (nearest dependencies first).',
  );

  if (absorb.misconceptions.length) {
    const lines = absorb.misconceptions.map(
      (m) =>
        `- "${m.name}" (slug: ${m.slug}): ${m.description}\n  Root cause: ${m.rootCause}\n  Diagnostic probe to weave in naturally: ${m.diagnosticProbe}\n  Correct model: ${m.correction}`,
    );
    sections.push(`Known misconceptions for this KC (Stage C — probe for these, don't just recite them):\n${lines.join('\n')}`);
  }

  if (absorb.scaffolds.length) {
    const lines = absorb.scaffolds.map((s) => `- [level ${s.level}] ${s.kind} — "${s.title}": ${truncate(s.body, 400)}`);
    sections.push(
      `Scaffolds available for this KC (Stage B — fading levels: level 1 = high support for mastery below 40%, level 2 = medium support for 40-79%, level 3 = low/independent support at 80%+):\n${lines.join('\n')}`,
    );
  }

  return sections.join('\n\n');
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
  if (ctx.mode === 'absorb' && ctx.absorb) {
    lines.push(describeAbsorbContext(ctx.absorb));
  }
  lines.push(MODE_INSTRUCTIONS[ctx.mode]);
  lines.push(RETRIEVAL_REMINDER);
  lines.push(toneReminder(ctx.mastery));

  return lines.join('\n\n');
}
