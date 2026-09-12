import { courseDraftV2Schema, type CourseDraftV2 } from '../schemas/courseDraft';

export type CourseDraftValidationIssue = {
  path: Array<string | number>;
  code: string;
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

function indexById<T extends DraftEntity>(entities: T[], collection: string, issues: CourseDraftValidationIssue[]): Map<string, T> {
  const index = new Map<string, T>();
  entities.forEach((entity, position) => {
    if (index.has(entity.id)) {
      issues.push({ path: [collection, position, 'id'], code: 'duplicate_id', message: `Duplicate ${collection} ID` });
      return;
    }
    index.set(entity.id, entity);
  });
  return index;
}

function rejectDuplicateLinks(ids: string[], path: Array<string | number>, issues: CourseDraftValidationIssue[]): void {
  const seen = new Set<string>();
  ids.forEach((id, position) => {
    if (seen.has(id)) issues.push({ path: [...path, position], code: 'duplicate_link', message: 'Relationship IDs must be unique' });
    seen.add(id);
  });
}

function requireTargets(ids: string[], index: Map<string, unknown>, path: Array<string | number>, label: string, issues: CourseDraftValidationIssue[]): void {
  ids.forEach((id, position) => {
    if (!index.has(id)) issues.push({ path: [...path, position], code: 'unknown_target', message: `Unknown ${label} ID` });
  });
}

function validateLinks(
  ids: string[],
  index: Map<string, unknown>,
  path: Array<string | number>,
  label: string,
  issues: CourseDraftValidationIssue[],
): void {
  rejectDuplicateLinks(ids, path, issues);
  requireTargets(ids, index, path, label, issues);
}

/** Parses a course draft and verifies cross-record activation invariants. */
export function validateCourseDraft(draft: unknown): CourseDraftV2 {
  const parsed = courseDraftV2Schema.safeParse(draft);
  if (!parsed.success) {
    throw new CourseDraftValidationError(parsed.error.issues.map((issue) => ({
      path: issue.path.map((segment) => typeof segment === 'symbol' ? String(segment) : segment),
      code: 'schema_invalid',
      message: 'Invalid course draft value',
    })));
  }

  const value = parsed.data;
  const issues: CourseDraftValidationIssue[] = [];
  const outcomes = indexById(value.outcomes, 'outcomes', issues);
  const kcs = indexById(value.kcs, 'kcs', issues);
  const examples = indexById(value.examples, 'examples', issues);
  const misconceptions = indexById(value.misconceptions, 'misconceptions', issues);
  const experiences = indexById(value.experiences, 'experiences', issues);
  indexById(value.references, 'references', issues);
  indexById(value.modules, 'modules', issues);

  value.outcomes.forEach((outcome, position) => {
    const path = ['outcomes', position, 'kc_ids'];
    if (outcome.kc_ids.length === 0) issues.push({ path, code: 'missing_outcome_target', message: 'Each outcome must target at least one KC' });
    validateLinks(outcome.kc_ids, kcs, path, 'KC', issues);
  });

  value.kcs.forEach((kc, position) => {
    validateLinks(kc.prerequisite_kc_ids, kcs, ['kcs', position, 'prerequisite_kc_ids'], 'prerequisite KC', issues);
  });
  value.examples.forEach((example, position) => {
    validateLinks(example.kc_ids, kcs, ['examples', position, 'kc_ids'], 'KC', issues);
  });
  value.misconceptions.forEach((misconception, position) => {
    validateLinks(misconception.kc_ids, kcs, ['misconceptions', position, 'kc_ids'], 'KC', issues);
  });

  value.experiences.forEach((experience, position) => {
    const targetPath = ['experiences', position, 'target_kc_ids'];
    if (experience.target_kc_ids.length === 0) {
      issues.push({ path: targetPath, code: 'missing_experience_target', message: 'Each experience must target at least one KC' });
    }
    if (experience.intended_processes.length === 0) {
      issues.push({ path: ['experiences', position, 'intended_processes'], code: 'missing_intended_process', message: 'Each experience needs an intended process' });
    }
    validateLinks(experience.target_kc_ids, kcs, targetPath, 'KC', issues);

    if (!experience.evidence && experience.kind === 'exercise') {
      issues.push({
        path: ['experiences', position, 'evidence'],
        code: 'missing_experience_evidence',
        message: 'Interactive exercise content requires an evidence contract',
      });
    }
    if (!experience.evidence) return;
    const evidenceTargetPath = ['experiences', position, 'evidence', 'target_kc_ids'];
    const evidenceDiagnosticPath = ['experiences', position, 'evidence', 'diagnostic_misconception_ids'];
    const selectedResponse = experience.evidence.response_type === 'selected_response';
    const multipleChoice = experience.content.kind === 'mcq';
    if (selectedResponse !== multipleChoice) {
      issues.push({
        path: ['experiences', position, 'evidence', 'response_type'],
        code: 'incompatible_evidence_response',
        message: 'Selected-response evidence requires MCQ content, and MCQ content requires the selected-response type',
      });
    }
    validateLinks(experience.evidence.target_kc_ids, kcs, evidenceTargetPath, 'KC', issues);
    validateLinks(experience.evidence.diagnostic_misconception_ids, misconceptions, evidenceDiagnosticPath, 'misconception', issues);

    const experienceTargets = new Set(experience.target_kc_ids);
    experience.evidence.target_kc_ids.forEach((kcId, targetPosition) => {
      if (!experienceTargets.has(kcId)) {
        issues.push({
          path: [...evidenceTargetPath, targetPosition],
          code: 'evidence_target_outside_experience',
          message: 'Evidence targets must also be experience targets',
        });
      }
    });

    const evidenceTargets = new Set(experience.evidence.target_kc_ids);
    experience.evidence.diagnostic_misconception_ids.forEach((misconceptionId, diagnosticPosition) => {
      const misconception = misconceptions.get(misconceptionId);
      if (misconception && misconception.kc_ids.some((kcId) => !evidenceTargets.has(kcId))) {
        issues.push({
          path: [...evidenceDiagnosticPath, diagnosticPosition],
          code: 'diagnostic_target_outside_evidence',
          message: 'Diagnostic misconception targets must be evidence targets',
        });
      }
    });
  });

  value.references.forEach((reference, position) => {
    validateLinks(reference.kc_ids, kcs, ['references', position, 'kc_ids'], 'KC', issues);
    validateLinks(reference.example_ids, examples, ['references', position, 'example_ids'], 'example', issues);
    validateLinks(reference.experience_ids, experiences, ['references', position, 'experience_ids'], 'experience', issues);
    validateLinks(reference.misconception_ids, misconceptions, ['references', position, 'misconception_ids'], 'misconception', issues);
  });
  value.modules.forEach((module, position) => {
    validateLinks(module.outcome_ids, outcomes, ['modules', position, 'outcome_ids'], 'outcome', issues);
    validateLinks(module.kc_ids, kcs, ['modules', position, 'kc_ids'], 'KC', issues);
    validateLinks(module.experience_ids, experiences, ['modules', position, 'experience_ids'], 'experience', issues);
  });

  value.kcs.forEach((kc, position) => {
    if (!value.examples.some((example) => example.kc_ids.includes(kc.id))) {
      issues.push({ path: ['kcs', position], code: 'missing_kc_example', message: `KC ${kc.id} needs an example` });
    }
    if (!value.experiences.some((experience) => experience.evidence?.target_kc_ids.includes(kc.id))) {
      issues.push({ path: ['kcs', position], code: 'missing_kc_evidence', message: `KC ${kc.id} needs an evidence-producing experience` });
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  let foundCycle = false;
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      foundCycle = true;
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
  if (foundCycle) issues.push({ path: ['kcs'], code: 'prerequisite_cycle', message: 'Prerequisite cycle detected' });

  if (issues.length > 0) throw new CourseDraftValidationError(issues);
  return value;
}
