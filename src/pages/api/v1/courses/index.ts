import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../../db/client';
import { apiOk } from '../../../../lib/api';
import { withServiceErrors } from '../../../../lib/apiErrors';
import { toApi } from '../../../../lib/serialize';
import { createCourseSchema, listCoursesQuerySchema } from '../../../../lib/schemas/courses';
import type { CourseDraftV2 } from '../../../../lib/schemas/courseDraft';
import { persistCourseDraft } from '../../../../lib/services/courseDraft';
import { colorHueForNewCourse, getCourseById, listCourses } from '../../../../lib/services/courses';

function legacyCourseDraft(input: { code: string; title: string; overview?: string }): CourseDraftV2 {
  const outcomeId = 'legacy-outcome';
  const kcId = 'legacy-kc';
  const exampleId = 'legacy-example';
  const experienceId = 'legacy-experience';
  return {
    schema_version: 2,
    spec: { title: input.title, topic: input.overview?.trim() || input.title, level: 'self-directed', constraints: [] },
    outcomes: [{ id: outcomeId, title: `Apply ${input.title}`, kc_ids: [kcId] }],
    kcs: [{ id: kcId, name: `${input.title} foundations`, kc_form: 'variable_constant', rationale_level: 1, mastery_rule: { minimum_evidence: 1 }, prerequisite_kc_ids: [] }],
    examples: [{ id: exampleId, kc_ids: [kcId], content: { schema_version: 1, kind: 'text', body: `A concrete example from ${input.title}.` } }],
    misconceptions: [],
    experiences: [{
      id: experienceId, kind: 'exercise', target_kc_ids: [kcId], intended_processes: ['understanding_sensemaking'],
      evidence: { response_type: 'constructed_response', target_kc_ids: [kcId], diagnostic_misconception_ids: [] },
      content: { schema_version: 1, kind: 'worked', prompt: `Explain one important idea in ${input.title}.`, solution: 'Describe a concrete application.' },
    }],
    references: [],
    modules: [{ id: 'legacy-module', title: `What are the foundations of ${input.title}?`, outcome_ids: [outcomeId], kc_ids: [kcId], experience_ids: [experienceId], sort_order: 0 }],
  };
}

export const GET: APIRoute = async ({ url, locals }) =>
  withServiceErrors(async () => {
    const query = listCoursesQuerySchema.parse(Object.fromEntries(url.searchParams));
    const db = getDb(env.DB);
    const courses = await listCourses(db, locals.user!.id, { includeMastery: query.include === 'mastery' });
    return apiOk(toApi(courses));
  });

// Preserve the deployed endpoint for older clients, but adapt its sparse
// payload into the same V2 aggregate used by all other manual creation.
export const POST: APIRoute = async ({ request, locals }) => withServiceErrors(async () => {
  const input = createCourseSchema.parse(await request.json().catch(() => ({})));
  const db = getDb(env.DB);
  const saved = await persistCourseDraft(db, locals.user!.id, legacyCourseDraft(input), {
    code: input.code,
    slugSeed: input.code,
    term: input.term,
    credits: input.credits,
    instructor: input.instructor,
    color: String(await colorHueForNewCourse(db, locals.user!.id, input.color_hue)),
  });
  return apiOk(toApi(await getCourseById(db, locals.user!.id, saved.courseId)), { status: 201 });
});
