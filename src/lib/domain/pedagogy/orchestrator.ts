// The sole composition point for pedagogy engines.  It returns a session arc
// and tool-ready payloads; it does not own persistence or transport.
import { z } from 'zod';
import type { DomainContext } from '../context';
import { idSchema } from '../../schemas/common';
import { getLearnerProfile } from '../learner/profile';
import { selectExercises } from './exercise';
import { prepareInstruction, instructionModeSchema } from './instruction';
import { getReviewQueue } from './admin';

export const planSessionSchema = z.strictObject({
  kc_id: idSchema.optional(),
  instruction_mode: instructionModeSchema.optional(),
});

export async function planSession(ctx: DomainContext, input: z.input<typeof planSessionSchema>) {
  const parsed = planSessionSchema.parse(input);
  const profile = await getLearnerProfile(ctx);
  const selectedKc = parsed.kc_id ?? profile.frontier.by_course.flatMap((course) => course.frontier)[0]?.kc_id;
  if (!selectedKc) return { arc: [], rationale: 'No available KC yet; add a course or complete onboarding.' };

  const mode = parsed.instruction_mode ?? 'socratic';
  const [instruction, exercise, reviewQueue] = await Promise.all([
    prepareInstruction(ctx, { kc_id: selectedKc, mode }),
    selectExercises(ctx, { kc_id: selectedKc, purpose: 'practice', count: 1 }),
    getReviewQueue(ctx, 3),
  ]);
  return {
    arc: ['check', 'teach', 'exercise', 'diagnose', 'reflect'] as const,
    rationale: `This starts with ${instruction.kc.name} because it is on your current learning frontier.`,
    instruction,
    exercise,
    review_queue: reviewQueue,
  };
}
