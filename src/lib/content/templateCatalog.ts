// Server-side reviewed-course registry. Rich authored content stays behind the
// API boundary; browser clients receive only the editable map/assessment
// summary produced by proposalFromReviewedTemplate.
import rawCourses from '../../../courses/courses.json';
import chee310ContentRaw from '../../../courses/chee-310-physical-chemistry-for-engineers/content.json';
import chee310ExercisesRaw from '../../../courses/chee-310-physical-chemistry-for-engineers/exercises.json';
import chee314ContentRaw from '../../../courses/chee-314-fluid-mechanics/content.json';
import chee314ExercisesRaw from '../../../courses/chee-314-fluid-mechanics/exercises.json';
import chee315ContentRaw from '../../../courses/chee-315-heat-and-mass-transfer/content.json';
import chee315ExercisesRaw from '../../../courses/chee-315-heat-and-mass-transfer/exercises.json';
import chee351ContentRaw from '../../../courses/chee-351-separation-processes/content.json';
import chee351ExercisesRaw from '../../../courses/chee-351-separation-processes/exercises.json';
import chee370ContentRaw from '../../../courses/chee-370-elements-of-biotechnology/content.json';
import chee370ExercisesRaw from '../../../courses/chee-370-elements-of-biotechnology/exercises.json';
import chee380ContentRaw from '../../../courses/chee-380-materials-science/content.json';
import chee380ExercisesRaw from '../../../courses/chee-380-materials-science/exercises.json';
import chee484ContentRaw from '../../../courses/chee-484-materials-engineering/content.json';
import chee484ExercisesRaw from '../../../courses/chee-484-materials-engineering/exercises.json';
import facc250ContentRaw from '../../../courses/facc-250-responsibilities-of-the-professional-engineer/content.json';
import facc250ExercisesRaw from '../../../courses/facc-250-responsibilities-of-the-professional-engineer/exercises.json';
import math264ContentRaw from '../../../courses/math-264-advanced-calculus-for-engineers/content.json';
import math264ExercisesRaw from '../../../courses/math-264-advanced-calculus-for-engineers/exercises.json';
import { courseContentSchema, type CourseContent } from './courseContent';
import { exerciseFileSchema, type ExerciseFile } from './exercises';
import type { CourseSetupProposal } from '../schemas/onboarding';

type CourseMeta = {
  code: string;
  slug: string;
  title: string;
  credits?: number;
  overview?: string;
  source?: string;
};

const rawBySlug = new Map((rawCourses as CourseMeta[]).map((course) => [course.slug, course]));
const authoredPairs = [
  [chee310ContentRaw, chee310ExercisesRaw],
  [chee314ContentRaw, chee314ExercisesRaw],
  [chee315ContentRaw, chee315ExercisesRaw],
  [chee351ContentRaw, chee351ExercisesRaw],
  [chee370ContentRaw, chee370ExercisesRaw],
  [chee380ContentRaw, chee380ExercisesRaw],
  [chee484ContentRaw, chee484ExercisesRaw],
  [facc250ContentRaw, facc250ExercisesRaw],
  [math264ContentRaw, math264ExercisesRaw],
] as const;

export type ReviewedTemplate = {
  meta: CourseMeta;
  content: CourseContent;
  exercises: ExerciseFile;
};

export type TemplateBaseline = {
  branches: Array<{
    ref: string;
    name: string;
    sort_order: number;
    kcs: Array<{
      ref: string;
      name: string;
      kc_type: string;
      description: string;
      practice_notes: string;
      sort_order: number;
      prereq_refs: string[];
    }>;
  }>;
};

const templates = new Map<string, ReviewedTemplate>();
for (const [contentRaw, exercisesRaw] of authoredPairs) {
  const content = courseContentSchema.parse(contentRaw);
  const exercises = exerciseFileSchema.parse(exercisesRaw);
  const meta = rawBySlug.get(content.course_slug);
  if (!meta) throw new Error(`Reviewed template metadata missing for ${content.course_slug}`);
  templates.set(content.course_slug, { meta, content, exercises });
}

function assessmentRef(index: number, title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'assessment';
  return `${index + 1}-${slug}`;
}

export function listReviewedTemplates() {
  return [...templates.values()].map(({ meta, content }) => ({
    template_id: meta.slug,
    code: meta.code,
    title: meta.title,
    credits: meta.credits ?? null,
    branch_count: content.branches.length,
    kc_count: content.branches.reduce((sum, branch) => sum + branch.kcs.length, 0),
    assessment_count: content.assessments.filter((assessment) => assessment.kind === 'official').length,
  }));
}

export function getReviewedTemplate(templateId: string): ReviewedTemplate | null {
  return templates.get(templateId) ?? null;
}

const revisionCache = new Map<string, Promise<string>>();

export function getReviewedTemplateRevision(templateId: string): Promise<string | null> {
  const template = getReviewedTemplate(templateId);
  if (!template) return Promise.resolve(null);
  let revision = revisionCache.get(templateId);
  if (!revision) {
    revision = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(JSON.stringify(template)))
      .then((digest) => [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
    revisionCache.set(templateId, revision);
  }
  return revision;
}

export function getTemplateBaseline(templateId: string): TemplateBaseline | null {
  const template = getReviewedTemplate(templateId);
  if (!template) return null;
  return {
    branches: template.content.branches.map((branch) => ({
      ref: branch.slug,
      name: branch.name,
      sort_order: branch.sort_order,
      kcs: branch.kcs.map((kc) => ({
        ref: kc.slug,
        name: kc.name,
        kc_type: kc.kc_type,
        description: kc.description,
        practice_notes: kc.practice_notes,
        sort_order: kc.sort_order,
        prereq_refs: kc.prereqs,
      })),
    })),
  };
}

export function proposalFromReviewedTemplate(templateId: string): CourseSetupProposal | null {
  const template = getReviewedTemplate(templateId);
  if (!template) return null;
  return {
    schema_version: 1,
    template_id: templateId,
    course: {
      code: template.meta.code,
      title: template.meta.title,
      ...(template.meta.credits !== undefined ? { credits: template.meta.credits } : {}),
    },
    branches: template.content.branches.map((branch) => ({
      client_id: crypto.randomUUID(),
      template_ref: branch.slug,
      included: true,
      name: branch.name,
      sort_order: branch.sort_order,
      kcs: branch.kcs.map((kc) => ({
        client_id: crypto.randomUUID(),
        template_ref: kc.slug,
        included: true,
        name: kc.name,
        kc_type: kc.kc_type,
        description: kc.description,
        sort_order: kc.sort_order,
        prereq_refs: kc.prereqs,
        source_refs: [`${template.meta.code} reviewed template`],
      })),
    })),
    assessments: template.content.assessments.map((assessment, index) => ({
      template_ref: assessmentRef(index, assessment.title),
      title: assessment.title,
      type: assessment.type,
      kind: assessment.kind,
      ...(assessment.weight_pct !== undefined ? { weight_pct: assessment.weight_pct } : {}),
      date_status: assessment.kind === 'practice' ? 'unknown' : 'unset',
    })),
    source: { kind: 'template' },
  };
}

export function getAssessmentTemplateRef(index: number, title: string): string {
  return assessmentRef(index, title);
}
