# StudyBuddy User Journeys

## Onboarding (First-Time User)

1. **Sign in** with username/password (v1 seeded user). Redirect to onboarding if new.
2. **Explain KC concept**: what is a knowledge component? Why should you care? (Svelte stepper modal.)
3. **Set preferences**: your name, current term (defaults to Fall 2024, Winter 2025 from seed).
4. **Review imported courses**: the 9 seeded courses from `courses.json`, grouped by term. Confirm or archive. (Later: multi-user → email verification, manual signup.)
5. **Land on dashboard** with an empty calendar (no events yet) and quick tips ("Ready to log your first lecture?").

## Returning User: Three Doors

The sidebar offers three main entry points to Learning, each leading to a different workflow:

### Door 1: Dashboard (Status Check)
- **Route**: `/dashboard`
- **Flow**: Glance at the week ahead (7-day calendar strip), see due tasks, check grade snapshot, review recent events.
- **Use case**: "How am I doing this week? Any deadlines lurking?"

### Door 2: Feed (Unintentional Instruction)
- **Route**: `/feed`
- **Flow**: Browse curated and user-added resources (canonical links from seed + geek-feed + user shares), filtered by course. Optionally start a study session focused on a resource.
- **Use case**: "I have 20 minutes. What's a good thing to read or watch right now?"

### Door 3: Study (Deliberate Practice)
- **Route**: `/study`
- **Flow**: 
  1. Pick a course.
  2. Set a timer (minutes).
  3. Pick an event type (lecture attended, practice, reading, tutoring, self-assessment).
  4. Timer runs. On completion, reflect (which KCs touched? How confident?).
  5. Append events to the log.
- **Use case**: "I studied thermodynamics for 45 minutes. Record it."

## Recording Outside-App Events

A global "Record event" modal (in the nav) lets you log anything, anywhere:
- Attended or missed a lecture (course-scoped, optional KC link).
- Got a grade on an assessment (appends dual-role assessment+event records).
- Completed a reading, video, tutoring session (manual event entry).

Use case: "I just took the midterm. Let me enter the grade so the standing updates."

## Admin Workflows (Calendar, Grades, Attendance)

### Calendar (`/calendar`)
- Month + agenda views.
- **Course filter dropdown** (scoped to current term by default).
- Shows assessment deadlines, study-session blocks, other course events.

### Grades (`/grades`)
- Assessments table: assessment name, type, due date, weight, grade entered (editable inline).
- Weighted course standing (auto-calculated from entered grades).
- Visual grade summary per course.

### Attendance (`/courses/[slug]` Standing tab)
- Attendance percentage.
- One-tap "attended" / "missed" logging for each lecture (quick inline buttons).
- Visual streak display.

## Future: Bus-Quiz Channel

Post-v1, Flue agents enable agentic flows on new channels:
- **Bus quiz**: short MCQ on Telegram/SMS (via Durable Objects + channel router) given (course?, KC?, time budget). Generates N questions, grades, appends events.
- Other channels: WhatsApp, Discord, email digest.

*Fully specced in `docs/architecture/agentic-channels.md`, post-v1 experimental.*

## TODO

- Onboarding detail: stepper content, KC explanation language, pacing.
- Study-session organizer (Feed view): allow batching multiple resources into a session plan.
- Reflection prompts: after study, after an assessment, weekly check-in.
