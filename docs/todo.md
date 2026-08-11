# StudyBuddy Roadmap: Deferred Features

This document lists features explicitly deferred to post-v1. Each is prioritized and scoped to avoid scope creep during M0–M5.

## Core Features

### Multi-User Signup & Email Verification

**Scope**: Currently, v1 is single-user (seeded user for demo). Multi-user requires:
- Signup form (username, email, password).
- Email verification flow (token, TTL, retry).
- Password reset (forgot-password link).
- Role-based access (student / instructor, post-v1).

**Rationale**: Single-user keeps auth minimal for M0. Multi-user is essential for real deployment but can follow the same hand-rolled session pattern.

### Argon2 Password Hashing

**Current**: PBKDF2 (safe, simple, built-in via Web Crypto).

**Post-v1**: Migrate to argon2-WASM (memory-hard, slower, better against GPU attacks).

**Scope**: Data migration script (re-hash all existing passwords), library integration.

## Mastery Inference

### AFM (Additive Factors Model)

**Scope**: Extend the v1 fold to estimate per-KC learning rate and per-instructional-method effectiveness.

- Model: `log-odds = base + sum(factor_effects)`.
- Factors: KC, instruction type (worked example, self-explanation, etc.), student background.
- Outcome: More nuanced mastery curves; predict future performance.

**Rationale**: Post-v1 research direction; requires larger event dataset.

### BKT (Bayesian Knowledge Tracing)

**Scope**: Probabilistic state-space model of KC mastery.

- Latent states: KC is learned/not-learned (unobserved).
- Parameters: guess (guess correctly despite not knowing), slip (fail despite knowing), learn (P(learn | attempt)).
- Inference: EM or particle filtering to estimate KC state from observations.

**Rationale**: Standard in ITS research; improves mastery confidence estimates.

### Spaced-Repetition Scheduler

**Scope**: Recommend review timing based on forgetting curve + mastery uncertainty.

- Algorithm: SuperMemo SM-2 or modern variants.
- Input: KC mastery, last review, review history.
- Output: "Time to review this KC (70% likely to forget by then)".

**Rationale**: Powerful for retention; requires robust mastery model (AFM/BKT).

## Content & Feed

### Real Social Feed

**Current**: Curated seed + user-added resources (static links).

**Post-v1**: True social learning:
- Peer resource recommendations ("Sarah shared a great Bernoulli derivation").
- Upvoting / flagging resources.
- Comments on resources.
- Resource collections (study guides, playlists).

**Scope**: Requires multi-user, moderation policy, feed algorithm.

### Global Knowledge Map

**Current**: Stubbed in `LearnerProfile.knowledgeMap = null`.

**Post-v1**: Build a concept prerequisite graph:
- Nodes: KCs across all courses.
- Edges: "X is a prerequisite for Y" (directed, weighted).
- Transitive closure: compute derived mastery for unmastered prerequisites.
- Recommendation: "To master Navier-Stokes, strengthen Conservation of Momentum first."

**Scope**: Knowledge engineering (map each course's KC dependencies), query optimization, adaptive sequencing.

## Platforms & Channels

### iPad Client

**Current**: Webapp only (responsive design, but not optimized for tablet).

**Post-v1**: Native SwiftUI app for iPad.

- Offline-first sync (CloudKit or local SQLite).
- Pencil-based note-taking (Apple Pencil integration).
- Study planner with calendar widgets.
- Tutor chat optimized for larger screen.

**Scope**: Separate codebase (Swift); reuse API contract from `docs/api.md`.

### Flue Agents + Channels

**Current**: Fully specced in `docs/architecture/agentic-channels.md`, but not implemented.

**Post-v1**: Deploy Flue agents to multiple channels:

- **Telegram channel**: `/quiz` → quick MCQ on the bus.
- **SMS channel** (Twilio): "Text START to StudyBuddy" → tutor over SMS.
- **Discord bot**: Study group channel integration (announce events, record study sessions).
- **Email digest**: Daily study recommendation based on mastery.
- **Slack bot**: For schools with institutional Slack.

**Scope**: Flue API stabilization (currently experimental), channel-specific UX, rate limiting.

## AI & Tutoring

### Advanced Tutor Modes

**Current**: Static mode selection by KC type (recall, classify, worked_example, self_explain, interactive_model).

**Post-v1**:
- Multi-turn lesson planning (agent plans a 5-turn arc, not one-shot).
- Prerequisite probing ("Before SN2, let's check SN1...").
- Adaptive difficulty (track performance mid-conversation, adjust).
- Mode switching (if student isn't progressing in one mode, suggest another).
- Knowledge map integration (tutor suggests related KCs to study).

**Scope**: Prompt engineering, agent planning algorithms.

### Interactive Model Rendering (Advanced)

**Current**: Basic sliders + constraint re-evaluation (math.js).

**Post-v1**:
- 2D/3D visualization (e.g., Bernoulli streamlines, pressure field).
- Symbolic math (SageMath or similar, for derivation walkthroughs).
- Physics simulation (drag forces, gravity, etc.).

**Scope**: 3D library integration (Babylon.js, Three.js), expensive computations (serverless function).

## Analytics & Insights

### Learning Analytics Dashboard

**Current**: Learner profile (mastery, streaks), but no trends or cohort comparisons.

**Post-v1**:
- Time spent per KC (heatmap by week).
- Most challenging topics (bottleneck analysis).
- Study session effectiveness (pre-test vs. post-test mastery).
- Peer benchmarking (how does my mastery compare to classmates?).
- Course success predictor (based on current trajectory).

**Scope**: Analytics DB (separate from operational DB), visualization library, privacy (anonymization).

### Educator Dashboard (Instructor View)

**Current**: Single-student app; no instructor features.

**Post-v1**:
- Class mastery overview (which KCs is the cohort struggling with?).
- Assignment analytics (score distribution, common errors).
- Student-level intervention prompts ("Alice is at risk in Thermodynamics").
- Curriculum effectiveness (which KCs improve most after instruction?).

**Scope**: Role-based access control, institutional deployment, data privacy.

## Operational

### Monitoring & Observability

**Post-v1**: Deploy production monitoring:
- Cloudflare Analytics Engine (event tracing).
- Error tracking (Sentry or similar).
- Mastery fold performance (query & recompute latency).
- API response times (SLA tracking).

**Scope**: Dashboard setup, alerting thresholds.

### Database Optimization

**Current**: No indexing beyond basic lookups.

**Post-v1**:
- Index on (user_id, course_id, ts) for event timeline.
- Index on (user_id, kc_id) for mastery rollups.
- Partitioning if events table grows (post-large-scale).
- Query plan analysis (EXPLAIN).

**Scope**: Profiling, slow-query logging.

### Backup & Disaster Recovery

**Post-v1**: Establish backup policy:
- D1 snapshots (daily).
- R2 versioning or archival bucket.
- Event log immutability (cannot delete/modify after retention period).

**Scope**: Backup job scheduling, restore procedures.

## Design & UX

### Onboarding Depth

**Current**: Svelte stepper to explain KCs, set name, confirm courses. Minimal.

**Post-v1**:
- Video tutorials (how to use the app).
- Guided walkthroughs (first login → first event → first tutor session).
- Contextual help tooltips.
- FAQ & troubleshooting.

**Scope**: Content creation, UX testing.

### Design Polish

**Post-v1**: Visual refinement:
- Consistent color palette & typography.
- Animation & micro-interactions (transitions, loading states).
- Accessibility audit (WCAG 2.1 AA).
- Dark mode toggle.

**Scope**: Design system documentation, designer time.

### Motivational Features

**Current**: Pure information; no gamification.

**Post-v1**:
- Achievement badges (e.g., "Mastered 5 KCs in one week").
- Streak display and celebrations.
- Reflection prompts (after study, after exams).
- Study goal setting ("Master Thermodynamics by exam date").

**Scope**: Research on intrinsic vs. extrinsic motivation, careful deployment to avoid dark patterns.

## Testing & Quality

### E2E Test Automation

**Current**: Manual smoke tests per milestone.

**Post-v1**:
- Playwright or similar for automated E2E tests.
- Test matrix (browser, mobile, tablet).
- Performance tests (load, stress).

**Scope**: Test infrastructure, CI integration.

### Load Testing

**Post-v1**: Validate Cloudflare scalability:
- Simulate 1000+ concurrent users.
- Measure D1 concurrency limits.
- R2 upload throughput.
- API SLA compliance.

**Scope**: Load testing tool setup, bottleneck identification.

---

## Priority Order (Rough Estimate)

**Tier 1** (Within 2–3 months post-v1):
- Multi-user signup.
- iPad client (parallel with v1 wrap-up).
- Flue agents + SMS/Telegram channels.
- Analytics dashboard (basic).

**Tier 2** (3–6 months):
- Argon2 migration.
- Real social feed.
- Knowledge map.
- Advanced tutor modes.
- Educator dashboard.

**Tier 3** (Post-6 months / research):
- AFM/BKT mastery.
- Spaced-repetition scheduler.
- 3D visualization for interactive models.

---

## Notes

- All deferred features have a placeholder (`// TODO`) in code or a stub in the docs.
- Features are scoped to avoid goldplating; each one has clear "done" criteria.
- API contract (docs/api.md) is stable across all post-v1 features; they extend via new endpoints or flow types, not rewrites.
