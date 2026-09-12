# Decision log

- 2026-09-07T15:54:47-04:00 — Audit UI/UX, journeys, and test coverage; add missing tests using the existing stack, but do not implement product or UI changes. Report evidence and unverified areas explicitly.

- 2026-09-07T16:26:31-04:00 — Use a Clerk MCP agent task for authenticated testing and continue the experience audit. Add an evidence-backed security audit and isolated security regression tests; do not change application behavior or security configuration, or probe production or third-party systems.

- 2026-09-07T20:38:53-04:00 — Implement the approved remediation plan using Luna xhigh, Terra high and Sol agents; include real automatic scheduling, grounded personalized previews and invite-only group resources/sessions.
- 2026-09-07T20:38:53-04:00 — Replanning is opt-in, preserves locked/external events, supports undo and leaves capacity conflicts unscheduled rather than dropping work. Preview recommendations are deterministic and grounded; simulations remain local.
- 2026-09-07T20:38:53-04:00 — Uploaded files download only. Keep AI disabled while implementing conservative quotas. Study time supports one active session across devices with durable pause/recovery.
- 2026-09-07T20:38:53-04:00 — Account deletion soft-deletes backend data and retains the Durable Object reference in an operator-only registry; no automatic restoration/email relinking. Shared contributions remain available with deleted-author attribution. Ownerless groups become read-only until operator reassignment; future deleted-host sessions are canceled.
- 2026-09-07T20:38:53-04:00 — Groups support shared links/files and scheduled sessions/RSVPs; invitations are single-use and bound to verified email. Personal notes, grades, mastery and tutor history remain private.

- 2026-09-08T07:49:15-04:00 — Approve the CSP-compatible Clerk UI wrapper replacement and continued Agent Tasks E2E testing; authorize merging after all CI checks pass and deploying the remediation.

- 2026-09-08T08:48:22-04:00 — Approve Clerk webhook and Worker-secret setup, a main-only GitHub E2E environment with development secrets, and production smoke testing using disposable test data to complete deployment.

- 2026-09-08T09:44:00-04:00 — Use the identity specialist to investigate the remaining Clerk Agent Tasks localhost diagnostic. Keep the investigation isolated to development credentials and environments; production smoke remains the release evidence.

- 2026-09-08T10:18:00-04:00 — Use an isolated Cloudflare workers.dev deployment for real Clerk Agent Tasks E2E, keeping production unchanged.

- 2026-09-11T15:53:42-04:00 — Generalize studyus from university-specific onboarding to courses for any learning goal. Manual course authoring must use the same KLI-inspired domain shape as optional generated courses.

- 2026-09-11T15:53:42-04:00 — Make a short first-party “Learning How to Learn” course available as the usable default when onboarding is skipped.

- 2026-09-11T15:59:53-04:00 — Offer “Learning How to Learn” to every new learner. Cover practical learning methods beyond KLI, including spaced repetition, scaffolding, and chunking.

- 2026-09-11T16:00:46-04:00 — Automatically add “Learning How to Learn” to every newly created account. Assume there are no existing users, so no backfill is required.

- 2026-09-11T16:10:07-04:00 — Enroll the first-party course as a learner-owned copy. New accounts receive the current template version and control their copy after provisioning.

- 2026-09-11T16:34:33-04:00 — Permanently detach each enrolled “Learning How to Learn” course from its source template. Later revisions apply only to new accounts.

- 2026-09-12T01:39:55-04:00 — Frame every “Learning How to Learn” module as a learner-facing question, progressing from evidence of learning through access, experience, effective practice, and continued improvement.

- 2026-09-12T06:08:34-04:00 — Update V2 course content atomically in place with stable course, KC, and experience IDs and an optimistic revision fence. Reject structural ID-set changes in this editor; new courses continue through the aggregate create path.

- 2026-09-12T08:48:41-04:00 — Fix all release-blocking review findings before opening or merging the general-learning PR: score supported rubric/numeric evidence, make experience responses idempotent, and batch next-experience state loading within Worker limits.
