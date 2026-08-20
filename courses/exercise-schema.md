# Exercise authoring schema (`courses/<slug>/exercises.json`) — v2.0

Sibling file to `content.json` (same pattern as `courses/capabilities.json`): per-course
exercise banks attached to KCs. Grounding: exercises are the auto-gradeable /
self-checkable complement to scaffolds — scaffolds teach (no answers), exercises
assess (structured answers). QuickQuiz prefers seeded `mcq` items over AI
generation; `numeric` items power tolerance-checked practice; `worked` items are
study material with a full solution.

## File shape

```json
{
  "schema_version": 1,
  "exercises": [ Exercise, ... ]
}
```

## Exercise

| field | type | rules |
|---|---|---|
| `kc` | string | kc slug in THIS course's content.json (no `#`, no cross-course refs) |
| `slug` | string | kebab-case, unique per (kc, slug) within the file |
| `kind` | `"mcq"` \| `"numeric"` \| `"worked"` | |
| `difficulty` | 1 \| 2 \| 3 | mirrors scaffold fading: 1 = supported/recall, 2 = standard, 3 = independent/transfer |
| `prompt` | string | markdown; the full problem statement incl. given values + units |
| `source` | string | real citation: textbook + chapter/section/problem style (e.g. "Bird, Stewart & Lightfoot, Transport Phenomena 2e, §3.5 style") or a course-material / OCW URL. Never fabricate a page-exact citation — "in the style of" is honest and sufficient. |
| `options` | string[] (3–5) | **mcq only, required.** Distractors must be plausible — derive them from documented misconceptions or classic sign/unit errors where possible. |
| `correct_index` | int | **mcq only, required.** 0-based, < options.length. |
| `explanation` | string | **mcq only, required.** Why the right answer is right AND what error each distractor represents. |
| `answer` | `{ "value": number, "unit": string \| null, "tolerance_pct": number }` | **numeric only, required.** tolerance_pct default 2, 0 allowed (exact match for integer/count answers); unit null for dimensionless. Value must be VERIFIED by actually working the problem. |
| `solution` | string | **numeric + worked, required.** Full worked solution, markdown. For `worked`, `prompt` poses the problem and `solution` is the complete walkthrough. |

## Authoring rules

- ASCII-only math in prompt/solution/explanation bodies (`rho`, `v^2`, `dP/dx`,
  `--` for em dash) — same convention as content.json scaffold bodies.
- Self-contained: every prompt includes all given values with units; never
  reference "the figure" or "the table in the book".
- Per KC targets: 4–6 exercises — at least 2 `mcq`, at least 1 `worked`; at
  least 1 `numeric` for quantitative KCs (most `rule`/`principle` KCs).
  Qualitative courses (e.g. FACC 250) substitute scenario `mcq` + case-analysis
  `worked` for `numeric`.
- Spread difficulties: don't cluster everything at 2.
- Numeric answers must be checked by computation before authoring the `answer`
  block; show the arithmetic in `solution`.
- MCQ distractor quality beats quantity: 4 options with 3 diagnostic
  distractors > 5 filler options.
- **Vary `correct_index`** — never default the right answer to position 0
  (the 2026-08-20 wave authored 323/392 MCQs answer-first and needed a
  post-hoc shuffle). Prefer referencing options by CONTENT in explanations;
  letter references ("Option B") break silently if options are ever reordered.

## Identity & seeding

Deterministic id: `deterministicId('exercise', "<courseSlug>#<kcSlug>:<exerciseSlug>")` —
slug-keyed like misconceptions (NOT index-keyed like scaffolds), so reordering
is safe and removals purge cleanly. Seed pass upserts `ON CONFLICT(id) DO UPDATE`
and purges seed-sourced rows whose (kc, slug) no longer appears in the file.

Validated at seed time by the Zod mirror in `src/lib/content/exercises.ts`
(strict objects; unknown keys fail; kind-conditional required fields enforced).
