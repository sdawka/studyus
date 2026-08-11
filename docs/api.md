# StudyBuddy API (DRAFT)

**Status**: DRAFT. Frozen at end of M1; this contract drives the iPad client build.

**Base URL**: `/api/v1`

**Auth**: Session-based via HttpOnly cookie (`session_token`). Unauthenticated requests → `401 Unauthorized`.

**Envelope**:
```json
{
  "data": { /* response body */ }
}
```
or on error:
```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "..."
  }
}
```

---

## Authentication

### POST /auth/login
Login with username/password.

**Request**:
```json
{
  "username": "string",
  "password": "string"
}
```

**Response** (200):
```json
{
  "data": {
    "user": {
      "id": "uuid",
      "username": "string",
      "name": "string",
      "current_term": "string"
    }
  }
}
```

**Errors**: `401 Unauthorized` (wrong credentials), `400 Bad Request` (missing fields).

Sets `session_token` HttpOnly cookie.

### POST /auth/logout
Logout; invalidate session.

**Response** (200):
```json
{
  "data": {}
}
```

---

## User

### GET /user
Get current user.

**Response** (200):
```json
{
  "data": {
    "id": "uuid",
    "username": "string",
    "name": "string",
    "current_term": "string"
  }
}
```

### PATCH /user
Update user profile.

**Request**:
```json
{
  "name": "string?",
  "current_term": "string?"
}
```

**Response** (200): Updated user object.

---

## Courses

### GET /courses
List user's courses.

**Query**:
- `include=mastery` (optional): Include `mastery` and `status` for each course.

**Response** (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "code": "CHEM 213",
      "slug": "chem-213",
      "title": "Organic Chemistry I",
      "credits": 3.0,
      "term": "Fall 2024",
      "instructor": "string",
      "color": "#FF5733",
      "mastery": 65,
      "status": "in_progress"
    }
  ]
}
```

### GET /courses/:slug
Get course detail.

**Response** (200):
```json
{
  "data": {
    "id": "uuid",
    "code": "string",
    "slug": "string",
    "title": "string",
    "credits": "number",
    "term": "string",
    "instructor": "string",
    "prereqs": "string",
    "overview": "string",
    "color": "string",
    "branches": [
      {
        "id": "uuid",
        "name": "string",
        "kcs": [
          {
            "id": "uuid",
            "name": "string",
            "kc_type": "fact|association|concept|rule|principle",
            "mastery": 75,
            "status": "in_progress"
          }
        ]
      }
    ]
  }
}
```

### GET|POST /courses/:id/assessments
Get assessments for a course, or create one (future).

**GET Response** (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Midterm",
      "type": "quiz|assignment|midterm|final|lab",
      "due_date": "2024-10-15T23:59:00Z",
      "weight_pct": 25,
      "grade_received": 87.5,
      "grade_max": 100
    }
  ]
}
```

### PATCH|DELETE /assessments/:id
Update or delete an assessment. Triggers events recompute if grade changes.

---

## Knowledge Components (KCs)

### GET /kcs/:id
Get KC detail.

**Response** (200):
```json
{
  "data": {
    "id": "uuid",
    "name": "string",
    "kc_type": "fact|association|concept|rule|principle",
    "description": "string",
    "practice_notes": "string",
    "mastery": 65,
    "status": "in_progress",
    "last_event_at": "2024-10-15T10:30:00Z"
  }
}
```

### PATCH /kcs/:id
Update KC (e.g., change type or description).

**Request**:
```json
{
  "name": "string?",
  "kc_type": "fact|association|concept|rule|principle?",
  "description": "string?",
  "practice_notes": "string?"
}
```

### GET /kcs/:id/events
Get events for a KC (timeline).

**Query**:
- `limit=20` (default)
- `offset=0` (for pagination)

**Response** (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "ts": "2024-10-15T10:30:00Z",
      "type": "string",
      "is_instructional": true,
      "is_assessment": false,
      "payload": {},
      "source": "manual|session|tutor|seed"
    }
  ]
}
```

---

## Events

### POST /events
Create an event (manual entry, e.g., "I attended a lecture").

**Request**:
```json
{
  "type": "lecture_attended|lecture_missed|video_watched|reading_done|taught_someone|quiz_taken|assignment_graded|exam_graded|self_assessment|practice_done|retrieval_practice|tutor_session",
  "is_instructional": true,
  "is_assessment": false,
  "kc_id": "uuid?",
  "course_id": "uuid",
  "ts": "2024-10-15T10:30:00Z",
  "payload": {}
}
```

**Response** (201):
```json
{
  "data": {
    "id": "uuid",
    "type": "...",
    "payload": {},
    "mastery_deltas": [
      { "kc_id": "uuid", "old_mastery": 60, "new_mastery": 65 }
    ]
  }
}
```

### GET /events
List events (global timeline).

**Query**:
- `course=uuid` (optional)
- `kc=uuid` (optional)
- `limit=20`

**Response** (200):
```json
{
  "data": [
    { /* event */ }
  ]
}
```

### PATCH /events/:id
Update a manual event (e.g., correct a typo).

**Request**:
```json
{
  "type": "string?",
  "payload": "object?",
  "ts": "datetime?"
}
```

**Response** (200): Updated event + mastery deltas.

### DELETE /events/:id
Delete an event. System events require confirmation. Triggers mastery recompute.

**Response** (200):
```json
{
  "data": {
    "mastery_deltas": [ /* ... */ ]
  }
}
```

---

## Calendar & Schedule

### GET /calendar
Get calendar events (deadlines, study sessions) for a date range.

**Query**:
- `from=2024-10-01T00:00:00Z`
- `to=2024-10-31T23:59:59Z`
- `course=uuid` (optional)

**Response** (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "type": "assessment_due|study_session|lecture",
      "title": "string",
      "date": "2024-10-15",
      "course_id": "uuid",
      "details": {}
    }
  ]
}
```

### GET /grades/summary
Get overall grade standing by course.

**Response** (200):
```json
{
  "data": {
    "overall_gpa": 3.67,
    "by_course": [
      {
        "course_id": "uuid",
        "course_title": "string",
        "weighted_grade": 87.5,
        "assessments": [
          {
            "assessment_id": "uuid",
            "title": "Midterm",
            "type": "midterm",
            "weight_pct": 25,
            "grade_received": 87.5,
            "grade_max": 100
          }
        ]
      }
    ]
  }
}
```

---

## Tasks

### GET|POST /tasks
List or create tasks.

**GET Response** (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "description": "string",
      "due_date": "2024-10-20T23:59:00Z",
      "completed": false,
      "courses": [
        { "id": "uuid", "code": "string" }
      ]
    }
  ]
}
```

### PATCH|DELETE /tasks/:id
Update or delete a task.

---

## Notes

### GET|POST /notes
List or create notes.

**POST Request**:
```json
{
  "title": "string",
  "content": "string (markdown)",
  "links": [
    { "course_id": "uuid?" },
    { "kc_id": "uuid?" }
  ]
}
```

**GET Response** (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "string",
      "content": "string",
      "created_at": "2024-10-15T10:30:00Z"
    }
  ]
}
```

### GET|PATCH|DELETE /notes/:id
Get, update, or delete a note.

---

## Resources (Feed)

### GET /resources
List resources (curated + user-added).

**Query**:
- `course=uuid` (optional)
- `kind=canonical|feed|user_shared` (optional)

**Response** (200):
```json
{
  "data": [
    {
      "id": "uuid",
      "url": "string",
      "label": "string",
      "kind": "canonical|feed|user_shared",
      "course_id": "uuid?",
      "kc_id": "uuid?",
      "pinned": false
    }
  ]
}
```

### POST /resources
Add a new resource.

**Request**:
```json
{
  "url": "string",
  "label": "string",
  "course_id": "uuid?",
  "kc_id": "uuid?"
}
```

### DELETE /resources/:id
Remove a resource.

---

## File Uploads (R2)

### POST /courses/:id/attachments
Upload a file to R2 for a course.

**Request**: `multipart/form-data`
- `file`: File to upload

**Response** (201):
```json
{
  "data": {
    "attachment_id": "uuid",
    "r2_key": "attachments/...",
    "filename": "string",
    "mime_type": "string"
  }
}
```

### GET|DELETE /attachments/:id
Stream or delete an attachment.

---

## Study Sessions

### GET|POST /sessions
List or create a study session.

**POST Request**:
```json
{
  "course_id": "uuid",
  "intended_event_type": "retrieval_practice|reading_done|practice_done",
  "planned_minutes": 30,
  "kc_ids": ["uuid"]
}
```

**Response** (201):
```json
{
  "data": {
    "id": "uuid",
    "course_id": "uuid",
    "started_at": "2024-10-15T10:30:00Z",
    "planned_minutes": 30
  }
}
```

### PATCH /sessions/:id/complete
Complete a study session (append events).

**Request**:
```json
{
  "ended_at": "2024-10-15T11:00:00Z",
  "reflection": "string?",
  "kc_ids_touched": ["uuid"]
}
```

**Response** (200):
```json
{
  "data": {
    "id": "uuid",
    "events_appended": [ /* ... */ ],
    "mastery_deltas": [ /* ... */ ]
  }
}
```

---

## AI Tutor

### POST /tutor/conversations
Start a tutor conversation.

**Request**:
```json
{
  "kc_id": "uuid"
}
```

**Response** (201):
```json
{
  "data": {
    "id": "uuid",
    "kc_id": "uuid",
    "mode": "recall|classify|worked_example|self_explain|interactive_model"
  }
}
```

### GET /tutor/conversations/:id
Get conversation (transcript).

**Response** (200):
```json
{
  "data": {
    "id": "uuid",
    "kc_id": "uuid",
    "mode": "...",
    "messages": [
      {
        "role": "user|assistant",
        "content": "string",
        "created_at": "..."
      }
    ]
  }
}
```

### POST /tutor/conversations/:id/messages
Send a message to the tutor (SSE stream).

**Request**:
```json
{
  "content": "string"
}
```

**Response**: Server-Sent Events stream
```
event: message
data: {"role": "assistant", "content": "..."}

event: message
data: {"role": "assistant", "content": "..."}

event: done
```

---

## Agentic Flows (v1 Pattern: quick_quiz)

### POST /flows/quick_quiz
Generate a quick quiz.

**Request**:
```json
{
  "course_id": "uuid?",
  "kc_ids": ["uuid"]?,
  "time_minutes": 15
}
```

**Response** (201):
```json
{
  "data": {
    "id": "uuid",
    "questions": [
      {
        "id": "uuid",
        "kc_id": "uuid",
        "text": "string",
        "options": ["A", "B", "C", "D"],
        "explanation": "string"
      }
    ]
  }
}
```

### POST /flows/quick_quiz/:id/answers
Submit quiz answers.

**Request**:
```json
{
  "answers": [
    { "question_id": "uuid", "selected_option": 0 }
  ]
}
```

**Response** (200):
```json
{
  "data": {
    "score": 70,
    "max_score": 100,
    "feedback": ["Good on KC1", "Review KC2"],
    "events_appended": [ /* ... */ ],
    "mastery_deltas": [ /* ... */ ]
  }
}
```

---

## Profile (Aggregation)

### GET /profile
Get learner profile (overall mastery, streaks, knowledge-map stub).

**Response** (200):
```json
{
  "data": {
    "user_id": "uuid",
    "overall_mastery": 65,
    "by_course": [
      {
        "course_id": "uuid",
        "course_title": "string",
        "mastery": 70
      }
    ],
    "longest_streak": 15,
    "current_streak": 3,
    "recent_events": [ /* ... */ ],
    "knowledge_map": null
  }
}
```

---

## TODO

- Detailed request/response examples (JSON payloads).
- Rate limiting strategy and headers.
- CORS policy for native clients.
- Versioning strategy (how will we maintain API backward compatibility?).
- Webhook signatures for Agentic flows (Telegram, SMS callbacks).
