import { courseDraftV2Schema, type CourseDraftV2 } from '../schemas/courseDraft';

export type CourseDraftValidationIssue = {
  path: Array<string | number>;
  message: string;
};

export class CourseDraftValidationError extends Error {
  readonly issues: CourseDraftValidationIssue[];

  constructor(issues: CourseDraftValidationIssue[]) {
    super('Course draft validation failed');
    this.name = 'CourseDraftValidationError';
    this.issues = issues;
  }
}

type DraftEntity = { id: string };

function indexById<T extends DraftEntity>(
  entities: T[],
  collection: string,
  issues: CourseDraftValidationIssue[],
): Map<string, T> {
  const index = new Map<string, T>();
  entities.forEach((entity, position) => {
    if (index.has(entity.id)) {
      issues.push({ path: [collection, position, 'id'], message: `Duplicate ${collection} ID: ${entity.id}` });
      return;
    }
    index.set(entity.id, entity);
  });
  return index;
}

function requireTargets(
  ids: string[],
  index: Map<string, unknown>,
  path: Array<string | number>,
  label: string,
  issues: CourseDraftValidationIssue[],
): void {
  ids.forEach((id, position) => {
    if (!index.has(id)) issues.push({ path: [...path, position], message: `Unknown ${label} ID: ${id}` });
  });
}

/** Parses a course draft and verifies cross-record activation invariants. */
export function validateCourseDraft(draft: unknown): CourseDraftV2 {
  const parsed = courseDraftV2Schema.safeParse(draft);
  if (!parsed.success) {
    throw new CourseDraftValidationError(
      parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    );
  }

  const value = parsed.data;
  const issues: CourseDraftValidationIssue[] = [];
  const outcomes = indexById(value.outcomes, 'outcomes', issues);
  const kcs = indexById(value.kcs, 'kcs', issues);
  const examples = indexById(value.examples, 'examples', issues);
  const misconceptions = indexById(value.misconceptions, 'misconceptions', issues);
  const experiences = indexById(value.experiences, 'experiences', issues);
  const references = indexById(value.references, 'references', issues);
  indexById(value.modules, 'modules', issues);

  value.outcomes.forEach((outcome, position) => {
    if (outcome.kc_ids.length === 0) {
      issues.push({ path: ['outcomes', position, 'kc_ids'], message: 'Each outcome must target at least one KC' });
    }
    requireTargets(outcome.kc_ids, kcs, ['outcomes', position, 'kc_ids'], 'KC', issues);
  });

  value.kcs.forEach((kc, position) => {
    requireTargets(kc.prerequisite_kc_ids, kcs, ['kcs', position, 'prerequisite_kc_ids'], 'prerequisite KC', issues);
  });

  value.examples.forEach((example, position) => {
    requireTargets(example.kc_ids, kcs, ['examples', position, 'kc_ids'], 'KC', issues);
  });

  value.misconceptions.forEach((misconception, position) => {
    requireTargets(misconception.kc_ids, kcs, ['misconceptions', position, 'kc_ids'], 'KC', issues);
  });

  value.experiences.forEach((experience, position) => {
    if (experience.target_kc_ids.length === 0) {
      issues.push({ path: ['experiences', position, 'target_kc_ids'], message: 'Each experience must target at least one KC' });
    }
    if (experience.intended_processes.length === 0) {
      issues.push({ path: ['experiences', position, 'intended_processes'], message: 'Each experience needs an intended process' });
    }
    requireTargets(experience.target_kc_ids, kcs, ['experiences', position, 'target_kc_ids'], 'KC', issues);
    requireTargets(
      experience.diagnostic_misconception_ids,
      misconceptions,
      ['experiences', position, 'diagnostic_misconception_ids'],
      'misconception',
      issues,
    );

    const targets = new Set(experience.target_kc_ids);
    experience.diagnostic_misconception_ids.forEach((misconceptionId, diagnosticPosition) => {
      const misconception = misconceptions.get(misconceptionId);
      if (misconception && misconception.kc_ids.some((kcId) => !targets.has(kcId))) {
        issues.push({
          path: ['experiences', position, 'diagnostic_misconception_ids', diagnosticPosition],
          message: `Diagnostic misconception ${misconceptionId} targets a KC outside this experience`,
        });
      }
    });
  });

  value.references.forEach((reference, position) => {
    requireTargets(reference.kc_ids, kcs, ['references', position, 'kc_ids'], 'KC', issues);
    requireTargets(reference.example_ids, examples, ['references', position, 'example_ids'], 'example', issues);
    requireTargets(reference.experience_ids, experiences, ['references', position, 'experience_ids'], 'experience', issues);
    requireTargets(reference.misconception_ids, misconceptions, ['references', position, 'misconception_ids'], 'misconception', issues);
  });

  value.modules.forEach((module, position) => {
    requireTargets(module.outcome_ids, outcomes, ['modules', position, 'outcome_ids'], 'outcome', issues);
    requireTargets(module.kc_ids, kcs, ['modules', position, 'kc_ids'], 'KC', issues);
    requireTargets(module.experience_ids, experiences, ['modules', position, 'experience_ids'], 'experience', issues);
  });

  value.kcs.forEach((kc, position) => {
    if (!value.examples.some((example) => example.kc_ids.includes(kc.id))) {
      issues.push({ path: ['kcs', position], message: `KC ${kc.id} needs an example` });
    }
    if (!value.experiences.some((experience) => experience.produces_evidence && experience.target_kc_ids.includes(kc.id))) {
      issues.push({ path: ['kcs', position], message: `KC ${kc.id} needs an evidence-producing experience` });
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleKcs = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      cycleKcs.add(id);
      return;
    }
    const kc = kcs.get(id);
    if (!kc) return;
    visiting.add(id);
    kc.prerequisite_kc_ids.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  value.kcs.forEach((kc) => visit(kc.id));
  if (cycleKcs.size > 0) {
    issues.push({ path: ['kcs'], message: `Prerequisite cycle detected: ${[...cycleKcs].sort().join(', ')}` });
  }

  if (issues.length > 0) throw new CourseDraftValidationError(issues);
  return value;
}
