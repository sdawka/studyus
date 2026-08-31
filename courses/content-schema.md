# Course Content Schema (`courses/<slug>/content.json`) — v1

**Frozen contract** between the content research agents, `scripts/seed.ts`, and the wave-2 absorb experience. Schema version `1`. Changes require regenerating every affected content file.

## Relationship to `courses.json`

`courses/courses.json` remains the source of truth for **course-level metadata** (code, slug, title, credits, term, instructor, prereqs string, source URL, overview, color, meeting_days). When `courses/<slug>/content.json` exists, it **supersedes** that course's `branches`, `canonical`, and `feed` entries in `courses.json` — the seed reads branches/KCs/resources/assessments/scaffolds/misconceptions from `content.json` and ignores those three keys. Courses without a `content.json` fall back to the old `courses.json` path unchanged.

## Grounding: the KLI meta-ontology

KC typing, scaffold kinds, and tutor pedagogy all derive from `docs/architecture/events-and-mastery.md` (Koedinger, Corbett & Perfetti 2012). Summary of the mapping this schema encodes:

| kc_type | application/response | learning process | matched scaffold kinds |
|---|---|---|---|
| `fact` | constant/constant, verbal | memorization, rote fluency | `retrieval_prompt`, `mnemonic` |
| `association` | constant/constant, non-verbal | fluency via repeated exposure | `matching_drill`, `retrieval_prompt` |
| `concept` | variable/constant (classification) | induction & refinement | `classification_task`, `contrast_examples`, `retrieval_prompt` |
| `rule` | variable/variable (procedure) | induction, proceduralization | `worked_example` (faded levels), `procedure_outline`, `retrieval_prompt` |
| `principle` | variable/variable + rationale | sense-making, model-building | `self_explanation_prompt`, `derivation_walkthrough`, `interactive_model`, `analogy`, `retrieval_prompt` |

`retrieval_prompt` is valid for every type (KLI asymmetry hypothesis: spaced retrieval is universally safe). The other kinds should respect the row above — a `worked_example` on a `fact` is a schema violation in spirit, though not enforced by the validator.

## Top-level shape

```jsonc
{
  "schema_version": 1,
  "course_slug": "chee-314-fluid-mechanics",   // must match the directory + courses.json slug
  "branches": [ Branch, ... ],                  // replaces courses.json branches
  "course_resources": [ Resource, ... ],        // course-level (no KC) resources
  "assessments": [ Assessment, ... ]
}
```

## Branch

```jsonc
{
  "slug": "macroscopic-balances",   // kebab-case, unique within the course
  "name": "Macroscopic balances",
  "sort_order": 1,                  // 1-based, matches array order
  "kcs": [ KC, ... ]
}
```

Keep the branch structure from the existing course README / `courses.json` outline as the starting point; split or add branches only where the pedagogy clearly demands it.

## KC

```jsonc
{
  "slug": "bernoulli-equation",     // kebab-case, unique within the COURSE (not just the branch)
  "name": "Bernoulli equation",
  "kc_type": "principle",           // fact | association | concept | rule | principle
  "description": "1–3 sentences: what the learner can do when this KC is acquired.",
  "practice_notes": "How to practice this KC well (retrieval framing, common setups).",
  "sort_order": 1,
  "prereqs": [ "#fluid-properties", "math-264-advanced-calculus-for-engineers#partial-derivatives" ],
  "resources": [ Resource, ... ],
  "scaffolds": [ Scaffold, ... ],
  "misconceptions": [ Misconception, ... ]
}
```

- **`kc_type` must be a deliberate KLI classification**, not a default. "Reynolds number definition" is a `fact`; "recognize laminar vs turbulent regimes" is a `concept`; "apply the mechanical energy balance to a pipe network" is a `rule`; "why viscous dissipation makes Bernoulli fail" is a `principle`. Where a README bullet conflates several of these, split it into multiple KCs.
- **`prereqs`**: KC references. `#kc-slug` = same course; `other-course-slug#kc-slug` = cross-course (must match a seeded course slug). Edges mean "should be understood before". Keep the graph a DAG — no cycles, including through cross-course edges. Reference only KCs that exist in some content.json; the seed warns and skips unresolvable references (e.g. concepts from non-seeded courses like CHEE 204 — leave those out or model the needed fragment as a KC in the most related seeded course only if truly load-bearing).
- Target roughly **8–20 KCs per course** after splitting; every KC needs ≥1 scaffold and ≥1 resource at either KC or course level. Misconceptions: aim for the 2–5 best-documented per course's core KCs — quality over coverage; empty arrays are fine for peripheral KCs.

## Resource

```jsonc
{
  "label": "LearnChemE — Bernoulli equation screencast",
  "url": "https://learncheme.com/...",
  "kind": "canonical",              // canonical | feed  (user_shared is runtime-only, never seeded)
  "pinned": false                   // optional, default false; pin at most 1–2 per course
}
```

- **URLs must be real and load** (research agents: verify with a fetch — no guessed deep links; prefer stable roots like OCW course pages, LearnChemE section pages, NPTEL course pages over fragile deep links).
- `canonical` = authoritative learning material (textbook chapters, OCW, official course pages). `feed` = interest/curiosity material (videos, blogs, simulations).

## Assessment

```jsonc
{
  "title": "Midterm",
  "type": "midterm",                // quiz | assignment | midterm | final | lab
  "kind": "official",               // official | practice
  "weight_pct": 25,                 // official only; a course's official weights should sum to 100
  "due_date": "2024-10-22",         // optional ISO date; seed stores local-noon epoch ms; omit for practice kind
  "kc_slugs": [ "#bernoulli-equation", "#linear-momentum-theorem" ]   // qmatrix links, same reference syntax as prereqs
}
```

Model the plausible real structure of the McGill course (assignments + midterm + final + labs where the course has labs). Add 2–4 `practice` assessments per course (problem sets, past-exam practice) linked to the KCs they exercise. Every official assessment must link ≥1 KC.

## Scaffold

```jsonc
{
  "kind": "worked_example",         // retrieval_prompt | mnemonic | matching_drill | classification_task |
                                    // contrast_examples | worked_example | procedure_outline |
                                    // self_explanation_prompt | derivation_walkthrough | interactive_model | analogy
  "level": 1,                       // support level: 1 = high support (fully worked / heavily cued),
                                    //                2 = medium (partially faded / hinted),
                                    //                3 = low (independent / bare prompt)
  "title": "Pipe-flow energy balance, fully worked",
  "body": "Markdown. The actual scaffold content a tutor or the UI can present verbatim.",
  "details": {}                     // optional JSON. For interactive_model: a model spec matching
                                    // src/lib/services/tutor/modelSpec.ts (see docs/api.md AI Tutor section).
}
```

- For `rule` KCs, provide a **fading ladder**: the same worked example at levels 1→2→3 where feasible (full solution → student completes later steps → bare problem).
- `body` must be self-contained teaching content (real numbers, real setups from the course's domain), not meta-description ("show a worked example here" is invalid).
- `interactive_model.details` must validate against the modelSpec grammar (params with ranges + expressions using `+ - * / ^`, `sqrt sin cos tan log exp abs`, `pi e`).

## Misconception

```jsonc
{
  "slug": "bernoulli-applies-everywhere",
  "name": "Bernoulli holds along any two points",
  "description": "The learner believes Bernoulli's equation can relate any two points in any flow, ignoring viscous losses and the same-streamline requirement.",
  "root_cause": "Overgeneralization from frictionless textbook problems; energy conservation intuition imported without the work-loss term.",
  "diagnostic_probe": "A pump moves water through 100 m of narrow pipe. A student equates pressure heads at inlet and outlet using Bernoulli and gets a contradiction. What did they miss?",
  "correction": "Bernoulli's equation applies only along a streamline in steady, incompressible, inviscid flow; with friction or shaft work you must use the extended mechanical energy balance with a head-loss term."
}
```

- `description` states the **wrong belief** in the learner's voice/logic. `root_cause` explains **where the belief comes from** (prior intuition, overgeneralized rule, surface-feature pattern) — this drives the tutor's root-cause dialogue. `diagnostic_probe` is a question whose answer reveals whether the learner holds it. `correction` is the canonical corrected statement — **this exact text becomes the user's accepted-correction ledger entry** when they accept it in the tutor, so write it to stand alone.
- Ground these in the physics/chemistry/engineering education literature where it exists (force-concept-inventory-style, thermal/transport misconception studies); otherwise use well-known instructor experience. `slug` unique within the KC.

## Validation

The seed validates every content.json against the Zod schema in `src/lib/schemas/courseContent.ts` (owned by the foundation track; this document is authoritative on shape). Validation failures abort the seed with the file + path. Cross-reference resolution (prereqs, kc_slugs) happens after all files load; unresolvable references warn and are skipped, cycles abort.

## Capabilities (`courses/capabilities.json`) — v1.9, sibling file

A single **global** file (not per-course, unlike `content.json`) authoring seed-sourced competencies — higher-order aggregates of KCs that intentionally cross course boundaries (e.g. "transport phenomena intuition" spanning fluid mechanics and heat-and-mass transfer). Resolved in a second seed pass, after every `content.json` has loaded, since a competency's members reference KCs across the whole content graph.

```jsonc
{
  "schema_version": 1,
  "capabilities": [
    {
      "slug": "transport-phenomena-intuition",   // kebab-case, unique in this file
      "name": "Transport phenomena intuition",
      "description": "1-2 sentences: what unifies these concepts as one competency.",
      "members": [
        // "<course-slug>/<kc-slug>" — same two KCs this file's schema uses
        // elsewhere, but "/" separated (not "#", to read as a plain cross-file
        // path rather than a same-file-relative ref). Every ref must resolve
        // to a real KC in some seeded course's content.json.
        { "ref": "chee-314-fluid-mechanics/bernoulli-equation", "weight": 2 },
        { "ref": "chee-315-heat-and-mass-transfer/fouriers-law-and-conduction", "weight": 1 }
      ]
    }
  ]
}
```

- `weight` (optional, default 1): relative contribution to the competency's weighted-mean derived mastery (`src/lib/capabilityMastery.ts::foldCapabilityMastery`) — an integer, matching `capability_kcs.weight`.
- Target **3-5 competencies**, each genuinely crossing at least two courses (a competency scoped to one course's KCs is just a branch — model it as one instead) — aim for real integrative reasoning, not an arbitrary bundle.
- Unresolvable `ref`s warn and are skipped (same posture as `content.json`'s prereq/kc_slugs refs), not a hard abort — a typo in one competency shouldn't block the rest of the seed.
- Seeded rows carry `source: 'seed'` on `capabilities`; `source: 'user'` is schema-ready for a future user-authored-competency UI, but nothing writes it yet.

## Exercises (`courses/<slug>/exercises.json`) — v2.0, sibling file

Another sibling to `content.json`, one per course: auto-gradeable/self-checkable exercise banks attached to this course's KCs (`mcq`, `numeric`, `worked`) — the complement to `content.json`'s scaffolds, which teach but carry no answer. Frozen contract, own schema: `courses/exercise-schema.md`.
- Idempotent across reseeds: `scripts/seed.ts` upserts by a deterministic id derived from `(userId, slug)`, and purges any `capability_kcs` row (or whole seed-sourced `capabilities` row) no longer present in this file — editing membership or removing a competency here and re-running the seed reflects the change, it doesn't just accumulate.
