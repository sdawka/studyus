# studyus Product Vision

## Target User

A university student (our pilot: a ChemEng undergrad at McGill with a typical course load). The student has:
- A calendar of course schedules, assignment deadlines, and exams.
- Grade records from assessments (quizzes, labs, midterms, finals).
- Course material to study: textbooks, videos, problem sets, instructor notes.
- KCs (knowledge components) they're building mastery in — concepts, equations, procedures, design principles.
- External learning events: lectures attended, grades received, tutoring sessions, study groups.

The student faces **cognitive overload**: navigating multiple systems (learning management, email, calendar, gradebook, note-taking apps), forgetting when to study and what, losing track of which topics they're weak in.

## Two Halves: Admin & Learning

### Admin (Keeping track)
- **Calendar view**: All deadlines in one place, filtered by course. When is the next assessment? Upcoming lab submission?
- **Grade dashboard**: Current standing in each course, visualized per assessment and weighted overall. Did I improve on this topic?
- **Attendance log**: Which lectures did I miss? Quick one-tap logging from the course view.

The admin half is **minimal and administrative**: not a classroom — just a mirror of external records (grades, deadlines) and a log of outside-app events (I attended this lecture, I got this grade).

### Learning (Building mastery)
- **Resource feed**: Curated and user-added learning materials (textbooks, videos, problem sets, lecture notes) organized by course. Browseable, searchable, shareable.
- **Per-course view**: Overview of the course, all knowledge components (KCs) with mastery bars, grouped by branch (chapters, units, themes).
- **KC detail**: Mastery history, event timeline (all ways you've encountered this topic), linked resources and notes, interactive "Tutor me" button.
- **AI tutor**: Adaptive dialogue by KC type — spaced recall drills for facts, classification exercises for concepts, worked examples for procedures, interactive models for principles (e.g. sliders to adjust Bernoulli flow parameters).
- **Absorb a KC** (v1.7): a guided *understand* flow, distinct from open-ended tutor dialogue. Before teaching a KC, the tutor checks its prerequisites against the seeded knowledge graph (a real prereq edge, e.g. a CHEE 314 fluid-mechanics KC requiring a MATH 264 calculus KC first — 190 such edges across the 9 seeded courses, some crossing course boundaries) and works through any that aren't yet solidly understood. It then teaches using the KC's matched scaffolds — worked examples, retrieval prompts, derivation walkthroughs, and eight other KLI-grounded kinds, faded across support levels for procedural KCs — and watches for the KC's documented misconceptions along the way, proposing a correction when one surfaces.
- **Accepted-corrections ledger**: a wrong belief the tutor catches and corrects during an absorb session becomes a first-class, revisitable asset — "things I used to believe and have corrected" — not just a line in a chat transcript. studyus resurfaces an active (not-yet-internalized) correction every couple of weeks as a gentle reminder, until the student marks it internalized.
- **Study planner**: Pick a course, set a duration, choose an event type (lecture, practice, reading, tutoring), timer, then reflection. Appends events tied to KCs.

The learning half is **low-distraction and mastery-focused**: what should I study next? How far am I from mastery? Dialogue, not lecturing.

## Design Vibe

**Simple and minimal.** No chrome, animations, or gamification. Avoid dark patterns. The vibe is **motivational-but-purely-informational**: show progress (mastery curves, attendance streaks), but don't coerce engagement.

**Student-friendly.** The student should feel like this is *their* tool, not another institutional system. Keyboard-navigable, fast, zero configuration.

**Frozen API contract** from day one. Webapp first; iPad app follows, consuming the same JSON API so features land once. The public API contract becomes our north star.

## TODO

- Onboarding flow: how do we explain KCs, events, and mastery to a first-time user? (Deferred to M5 design pass.)
- Motivational messaging: streaks, celebration, reflection prompts. (Post-v1 polish.)
- Social features: study groups, shared resources, peer feedback. (Post-v1; currently single-user seed.)
