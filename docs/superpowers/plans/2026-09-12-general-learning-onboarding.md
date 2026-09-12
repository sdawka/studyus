# General Learning Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new account own a complete “Learning How to Learn” course and make onboarding/manual course creation work for any learning topic through a KLI-inspired course domain.

**Architecture:** A strict `CourseDraftV2` is the single input for manual, template, extracted, and future generated courses. A transactional persistence service deep-copies validated drafts into learner-owned relational records; new-account provisioning uses it idempotently for the bundled default course. Experiences connect authored instruction/practice to the existing evidence event stream and deterministic KC-state inference.

**Tech Stack:** Astro, Svelte 5, TypeScript, Zod 4, Drizzle ORM, Cloudflare D1/Workers, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-general-learning-onboarding-design.md`

## Global Constraints

- Courses may represent any learning goal; academic metadata is optional.
- Every new account receives one learner-owned, permanently detached copy of the current default course.
- There is no existing-user backfill.
- Manual and future generated courses use the same draft validation and commit service.
- KC state is inferred from evidence; learning is never stored as an observed fact.
- Keep the current event stream as the durable evidence source and preserve atomic mastery recomputation.
- Never synchronize an enrolled default course with later source revisions.

---

### Task 1: CourseDraftV2 contract and invariant validator

**Files:**
- Create: `src/lib/schemas/courseDraft.ts`
- Create: `src/lib/domain/courseDraft.ts`
- Test: `tests/course-draft.test.ts`

**Interfaces:**
- Produces: `courseDraftV2Schema`, `CourseDraftV2`, `validateCourseDraft(draft): CourseDraftV2`.
- Consumes: no database or Cloudflare runtime APIs.

- [ ] **Step 1: Write failing schema-shape tests**

Create a minimal valid draft fixture with one outcome, KC, example, misconception, evidence-producing experience, and reference. Assert strict rejection of unknown keys and invalid KC/process/kind enums.

```ts
expect(courseDraftV2Schema.parse(validDraft).spec.topic).toBe('Learning how to learn');
expect(() => courseDraftV2Schema.parse({ ...validDraft, surprise: true })).toThrow();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk vitest run tests/course-draft.test.ts`

Expected: FAIL because `src/lib/schemas/courseDraft.ts` does not exist.

- [ ] **Step 3: Implement the strict versioned schemas**

Define the exact enums and objects from the spec. Use stable string IDs inside drafts, `z.unknown()` for experience/example content, and a strict mastery rule:

```ts
export const masteryRuleSchema = z.strictObject({
  threshold: z.number().min(0).max(1).optional(),
  minimum_evidence: z.number().int().min(1).optional(),
  requires_transfer: z.boolean().optional(),
  requires_retention: z.boolean().optional(),
});
```

- [ ] **Step 4: Add failing invariant tests**

Cover missing outcome KCs, missing KC examples, missing evidence-producing experience, absent intended processes, dangling references, diagnostic misconceptions outside targets, and prerequisite cycles.

- [ ] **Step 5: Implement `validateCourseDraft`**

Parse first, index every ID, verify links and required coverage, and run DFS cycle detection. Return the parsed draft; throw a stable `CourseDraftValidationError` with issue paths/messages.

- [ ] **Step 6: Run focused tests and commit**

Run: `rtk vitest run tests/course-draft.test.ts`

Commit: `Add course draft domain contract`

### Task 2: Relational course-domain persistence

**Files:**
- Create: `migrations/0014_general_learning_domain.sql`
- Modify: `migrations/meta/_journal.json`
- Modify: `src/db/schema.ts`
- Create: `src/lib/services/courseDraft.ts`
- Test: `tests/course-draft-persistence.test.ts`

**Interfaces:**
- Consumes: `CourseDraftV2`, `validateCourseDraft`, existing `Db`, `runBatch`, course slug allocation.
- Produces: `persistCourseDraft(db, userId, draft, options): Promise<{courseId: string; slug: string}>` and `getCourseDomain(db, userId, courseId)`.

- [ ] **Step 1: Write failing persistence tests**

Assert a valid draft writes one owned course and all outcome/KC/example/experience/reference links with fresh IDs. Assert rollback when any statement fails and isolation between two learners.

- [ ] **Step 2: Verify RED**

Run: `rtk vitest run tests/course-draft-persistence.test.ts`

Expected: FAIL because the tables and service do not exist.

- [ ] **Step 3: Add the additive migration and Drizzle mirrors**

Add general course metadata and passive provenance. Add outcome, example, experience, target, diagnostic, reference, and link tables with cascading ownership paths and unique link indexes. Add `experience_id` to scaffolds, exercises, and evidence events. Add canonical `kc_form`, rationale, and mastery-rule JSON without deleting the legacy `kc_type` field in this migration.

- [ ] **Step 4: Implement transactional deep-copy persistence**

Validate before building statements. Resolve every draft-local ID to a fresh UUID. Insert the full aggregate in one `db.batch`; set scaffold/exercise subtype rows from experience content only after the experience parent statement is queued.

```ts
export type PersistCourseDraftOptions = {
  sourceTemplateKey?: string;
  sourceTemplateVersion?: string;
  bootstrapKey?: string;
};
```

- [ ] **Step 5: Implement the owner-scoped read model**

`getCourseDomain` must require an owned course and return the draft-shaped graph without exposing authored answer keys in browser-safe callers.

- [ ] **Step 6: Run migration/persistence tests and commit**

Run: `rtk vitest run tests/course-draft.test.ts tests/course-draft-persistence.test.ts`

Commit: `Persist general course domains`

### Task 3: First-party Learning How to Learn course

**Files:**
- Create: `courses/learning-how-to-learn/course.json`
- Create: `src/lib/content/defaultCourse.ts`
- Modify: `src/lib/content/templateCatalog.ts`
- Test: `tests/default-course-content.test.ts`

**Interfaces:**
- Consumes: `CourseDraftV2`, `validateCourseDraft`.
- Produces: `DEFAULT_COURSE_KEY`, `DEFAULT_COURSE_VERSION`, `loadDefaultCourse(): CourseDraftV2`.

- [ ] **Step 1: Write failing content-contract tests**

Assert the template validates, has exactly the five approved question-titled modules, resolves every outcome/KC/reference, covers all three KC forms and learning processes, and gives every KC examples plus evidence-producing practice.

- [ ] **Step 2: Verify RED**

Run: `rtk vitest run tests/default-course-content.test.ts`

- [ ] **Step 3: Author the compact course fixture**

Use these module names exactly:

```ts
[
  'How do you know you’ve learned something?',
  'How do you access what you’ve learned?',
  'What does learning feel like?',
  'What helps you learn best?',
  'How can you keep getting better at learning?',
]
```

Include KCs for evidence/calibration/retention/transfer; retrieval/cues/spacing/interleaving; effort/false fluency/chunking; examples/scaffolding/self-explanation/feedback/error analysis; and planning/reflection/adaptation. Include contrasting examples, fading support, diagnostic misconceptions, delayed retention markers, and the KLI paper reference.

- [ ] **Step 4: Add the pure loader**

Import bundled JSON, parse with the schema, run invariants, and export immutable template key/version constants. Do not register it for reviewed-template synchronization.

- [ ] **Step 5: Run focused tests and commit**

Run: `rtk vitest run tests/course-draft.test.ts tests/default-course-content.test.ts`

Commit: `Add learning how to learn course`

### Task 4: Atomic idempotent account bootstrap

**Files:**
- Create: `src/lib/services/learnerBootstrap.ts`
- Modify: `src/lib/auth/local-user.ts`
- Modify: `src/middleware.ts`
- Modify: `tests/middleware.test.ts`
- Create: `tests/learner-bootstrap.test.ts`

**Interfaces:**
- Consumes: `loadDefaultCourse`, draft persistence statement builder, Clerk identity fields.
- Produces: `provisionLearner(db, identity)` used by `resolveLocalUser`; stable bootstrap key `first-party:learning-how-to-learn`.

- [ ] **Step 1: Write failing bootstrap tests**

Assert the first resolution creates the learner plus usable default course; sequential and concurrent repeats return the same learner/course; a forced course-statement failure leaves neither visible; and different learners receive distinct editable IDs.

- [ ] **Step 2: Verify RED**

Run: `rtk vitest run tests/learner-bootstrap.test.ts tests/middleware.test.ts`

- [ ] **Step 3: Extract a batch statement builder**

Refactor course persistence only after its tests are green so user insertion and course aggregate statements can share one D1 batch. Keep identity-deletion guards in the atomic transaction.

- [ ] **Step 4: Integrate new-account provisioning**

Return `{ user, wasCreated, defaultCourse }`. Existing-user resolution must not backfill. Preserve active-account and runtime-registry checks; ensure runtime registry creation occurs only after the D1 user/course transaction commits.

- [ ] **Step 5: Add detachment tests**

Edit one learner’s cloned KC and archive one experience; assert the immutable bundled template and a second learner’s copy are unchanged. Change a test template version between enrollments and assert only the later learner gets it.

- [ ] **Step 6: Run focused tests and commit**

Run: `rtk vitest run tests/learner-bootstrap.test.ts tests/middleware.test.ts tests/course-draft-persistence.test.ts`

Commit: `Bootstrap every learner with a course`

### Task 5: General, skippable onboarding and manual authoring

**Files:**
- Modify: `src/lib/schemas/onboarding.ts`
- Modify: `src/lib/services/onboarding.ts`
- Modify: `src/lib/services/usableCourse.ts`
- Modify: `src/lib/onboardingRoute.ts`
- Modify: `src/components/onboarding/OnboardingFlow.svelte`
- Modify: `src/components/onboarding/OnboardingSetup.svelte`
- Modify: `src/components/onboarding/CourseMapReview.svelte`
- Modify: `src/pages/onboarding.astro`
- Modify: `tests/onboarding-validation.test.ts`
- Modify: `tests/onboarding.test.ts`
- Modify: `tests/onboarding-route.test.ts`
- Create: `tests/components/GeneralOnboarding.test.ts`

**Interfaces:**
- Consumes: `CourseDraftV2`, `persistCourseDraft`, provisioned default-course slug.
- Produces: general onboarding commit accepting optional context/course and a manual draft editor that progressively reveals outcomes, KCs, examples, experiences, and mastery rules.

- [ ] **Step 1: Write failing route/service tests**

Assert empty Skip stamps onboarding and returns the default course; academic context is optional; an any-topic manual course persists through `CourseDraftV2`; simulated evidence is still rejected; retries are idempotent.

- [ ] **Step 2: Write failing component tests**

Assert learner-facing copy announces the default course, uses topic/level/outcome language, hides academic fields behind an optional disclosure, and keeps Skip keyboard-operable from each step.

- [ ] **Step 3: Verify RED**

Run: `rtk vitest run tests/onboarding-validation.test.ts tests/onboarding.test.ts tests/onboarding-route.test.ts tests/components/GeneralOnboarding.test.ts`

- [ ] **Step 4: Generalize the onboarding schemas and commit service**

Make context optional, accept no additional course for Skip, and resolve the destination to the new course or provisioned default. Adapt legacy proposals to `CourseDraftV2` at one boundary until all callers use V2 directly.

- [ ] **Step 5: Implement progressive manual authoring UI**

Require only topic, level, and one outcome initially. Generate editable draft-local starter IDs in the browser, then let the learner add/modify KCs, examples, intended processes, experiences, and mastery requirements. Keep academic scheduling optional.

- [ ] **Step 6: Update route behavior and run tests**

Archiving all courses after onboarding must show the ordinary course empty state, not reopen onboarding. Preserve unfinished setup routing until Skip/Finish stamps `onboarded_at`.

Run: focused tests from Step 3 plus `rtk vitest run tests/onboarding-lockout.test.ts tests/onboarding-incomplete-retry.test.ts`.

- [ ] **Step 7: Commit**

Commit: `Generalize learner onboarding`

### Task 6: Evidence-aware KC state and next-experience selection

**Files:**
- Modify: `src/lib/schemas/events.ts`
- Modify: `src/lib/services/events.ts`
- Modify: `src/lib/services/mastery.ts`
- Create: `src/lib/domain/kcState.ts`
- Create: `src/lib/domain/nextExperience.ts`
- Modify: `tests/events.test.ts`
- Create: `tests/kc-state.test.ts`
- Create: `tests/next-experience.test.ts`

**Interfaces:**
- Consumes: owner-scoped experiences, evidence-role events, KC mastery rules and prerequisites.
- Produces: `deriveKcState(evidence, rule, now)`, `selectNextExperience(graph, states, now): {experienceId; reasons: string[]}`.

- [ ] **Step 1: Write failing inference tests**

Assert context-only events do not enter evidence; evidence IDs and confidence are derived; transfer/retention require appropriately tagged later observations; multiple KC targets remain owner-scoped.

- [ ] **Step 2: Verify RED**

Run: `rtk vitest run tests/events.test.ts tests/kc-state.test.ts`

- [ ] **Step 3: Implement evidence linkage and derived KC state**

Preserve the current mastery fold as the estimate input. Derive confidence from bounded evidence count, diversity, and recency; never expose it as probability of knowledge. Update caches in the same event batch.

- [ ] **Step 4: Write failing selector tests**

Cover prerequisite blocking, due spaced review, support fading after success, misconception repair after diagnostic evidence, and later transfer selection. Require deterministic tie-breaking and reason strings.

- [ ] **Step 5: Implement the pure selector**

Keep selection free of database/model calls. Query services assemble the graph and state, call the selector, then resolve the chosen learner-owned experience.

- [ ] **Step 6: Run focused tests and commit**

Run: `rtk vitest run tests/events.test.ts tests/kc-state.test.ts tests/next-experience.test.ts`

Commit: `Infer state and select experiences`

### Task 7: Product integration, documentation, and release gates

**Files:**
- Modify: `docs/product/vision.md`
- Modify: `docs/product/onboarding.md`
- Modify: `docs/product/user-journeys.md`
- Modify: `docs/product/student-lifecycle.md`
- Modify: `docs/product/learning-science.md`
- Modify: `docs/architecture/data-model.md`
- Modify: `docs/architecture/events-and-mastery.md`
- Modify: `docs/api.md`
- Modify: `docs/todo.md`
- Modify: `src/components/demo/PublicTrial.svelte`
- Modify: `src/components/marketing/compare/HonestExceptions.astro`
- Modify: focused Playwright specs under `tests/e2e/`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: accurate product/API documentation and browser journey evidence.

- [ ] **Step 1: Replace superseded claims in existing docs**

Remove the university-only target/gate and “future opt-in Learning to Learn” claims. Document the general course model, automatic detached enrollment, optional academic context, authoring boundary, and evidence/KC-state semantics in their existing source-of-truth files.

- [ ] **Step 2: Update public-trial and onboarding copy**

Use general studying examples by default while retaining academic examples as optional cases. Do not claim model generation, probabilistic mastery, or spaced scheduling beyond implemented behavior.

- [ ] **Step 3: Add focused Playwright journeys**

Cover a new account receiving the default course, Skip reaching it, creating a non-academic course manually, and mobile/keyboard interaction. Use reduced-motion assertions where animation is present.

- [ ] **Step 4: Run focused browser checks**

Run the smallest configured onboarding/browser project locally. Record authenticated verification as unverified if Clerk credentials are unavailable; do not substitute public smoke.

- [ ] **Step 5: Run all local gates**

Run:

```bash
rtk vitest run
rtk npm run check
rtk npm run build
rtk npm run check:layout
rtk npm run check:annotations
```

Expected: every command exits 0. Existing warnings must be reported separately from failures.

- [ ] **Step 6: Request independent code review**

Provide the reviewer the spec, plan, base SHA, and head SHA. Fix every Critical and Important finding, then rerun affected focused tests and all gates.

- [ ] **Step 7: Commit any integration fixes**

Commit: `Finish general learning onboarding`

- [ ] **Step 8: Push and create the PR**

Push `feature/general-learning-onboarding`, open a PR against `main`, and report its URL plus exact local CI evidence. Do not merge; all hosted CI must be green before any later merge.
