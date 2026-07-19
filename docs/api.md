# Account API

All JSON request and response bodies use UTF-8. Authentication uses a bearer token issued after registration or login.

## Student authentication

### `POST /api/auth/register`

Creates a student account and returns a seven-day session token.

```json
{
  "phone": "13900139000",
  "displayName": "小贝",
  "password": "Practice123"
}
```

The phone number accepts Chinese mainland mobile numbers, with optional `+86` and separators. Passwords require 8 to 72 characters.

### `POST /api/auth/login`

Accepts `phone` and `password`. Invalid phone numbers and wrong passwords both return `401 INVALID_CREDENTIALS`.

### `GET /api/auth/me`

Requires `Authorization: Bearer <token>` and returns the current account without password data.

## Administration

Staff routes require an active `ADMIN` or `TEACHER` database account. The API reloads the current account and classroom membership for every request; the role embedded in an older bearer token does not grant authority.

### `GET /api/admin/context`

Returns the current public staff account plus speech-assessment provider availability:

```json
{
  "user": { "id": "teacher-id", "displayName": "Lin", "role": "TEACHER" },
  "speechAssessment": { "configured": false, "provider": null }
}
```

### `GET /api/admin/users`

Administrators receive paginated teacher and student accounts. Teachers receive only active students in their assigned active classrooms.

Query parameters:

- `page`, default `1`
- `pageSize`, default `20`, maximum `100`
- `search`, filters by phone number or display name
- `role`, optional `TEACHER` or `STUDENT`

The web console proxies this request server-side and keeps its token in an HttpOnly cookie.

### `POST /api/admin/users`

Administrator only. Creates a `TEACHER` or `STUDENT` account from `phone`, `displayName`, `password`, and `role`. Passwords are hashed before persistence and never returned.

### `PATCH /api/admin/users/:userId/status`

Administrator only. Accepts `{ "status": "ACTIVE" }` or `{ "status": "DISABLED" }`. The current administrator cannot disable their own account.

### `GET /api/admin/classrooms`

Administrators receive all classrooms. Teachers receive assigned classrooms only. Each classroom contains its public teacher/student members and `ACTIVE` or `ARCHIVED` status.

### `POST /api/admin/classrooms`

Administrator only. Creates an active classroom and validates all members against active database roles:

```json
{
  "name": "Betty A",
  "teacherIds": ["teacher-id"],
  "studentIds": ["student-id"]
}
```

### `PATCH /api/admin/classrooms/:classroomId`

Administrator only. Updates the name or status and replaces supplied `teacherIds` or `studentIds`. Membership arrays are validated atomically.

### `GET /api/admin/point-policies`

Returns reward policies for active classrooms visible to the current staff account. Administrators receive every active classroom; teachers receive only assigned active classrooms. Missing stored policies resolve to daily check-in `2`, homework completion `10`, and no streak milestones.

### `PUT /api/admin/classrooms/:classroomId/point-policy`

Administrators may replace any active classroom policy; teachers may replace only a policy for an assigned active classroom. The complete policy is validated and replaced atomically:

```json
{
  "dailyCheckinPoints": 3,
  "homeworkCompletionPoints": 12,
  "streakRewards": [
    { "days": 3, "points": 5 },
    { "days": 7, "points": 20 }
  ]
}
```

Daily points accept `0..100`, completion points accept `0..500`, and up to 20 unique streak milestones accept `2..365` days and `1..1000` points. Zero disables the corresponding visible award while the server retains an internal idempotency claim, so a later policy change or restart cannot back-award it. Changes apply only to future ledger events.

### `POST /api/admin/homeworks`

Publishes a recurring homework plan for selected active students and returns the created plan plus target, generated occurrence, and completed occurrence counts. Teachers must provide an assigned active `classroomId`, and every recipient must be an active student in that classroom. Administrators may send a classroom id or `null`.

```json
{
  "title": "Unit 1 朗读练习",
  "instructions": "完成录音并提交。",
  "classroomId": "classroom-id",
  "studentIds": ["student-id"],
  "schedule": {
    "startsAt": "2026-07-20T08:00:00.000Z",
    "unit": "WEEK",
    "interval": 2,
    "occurrenceLimit": 3
  }
}
```

`unit` supports `DAY` and `WEEK`. `interval` controls the gap between triggers; `occurrenceLimit` is the total number of triggers per selected student. The detailed model is in `docs/homework-model.md`.

Set `templateType` to `READ_ALOUD_PICTURE_BOOK` and add ordered `cards` to publish a picture-book read-aloud homework:

```json
{
  "templateType": "READ_ALOUD_PICTURE_BOOK",
  "cards": [
    {
      "imageUrl": "/uploads/assets/page-1.png",
      "sampleAudioUrl": "/uploads/assets/page-1.mp3",
      "referenceText": "This is my family."
    }
  ]
}
```

Sentence and word templates use ordered `items`:

```json
{
  "templateType": "SENTENCE_READ_ALOUD",
  "items": [
    {
      "promptText": "This is my family.",
      "sampleAudioUrl": "/uploads/assets/family-sentence.mp3"
    }
  ]
}
```

Supported types are `SENTENCE_READ_ALOUD`, `WORD_READ_ALOUD`, `WORD_IMAGE_MATCH`, `WORD_SCRAMBLE`, and `WORD_FILL_BLANK`. Word read-aloud requires `imageUrl`, `answerText`, and `sampleAudioUrl`; it does not require `promptText`. Objective word items require image and answer word; fill-blank also requires `promptText` containing `____`. Image-match and fill-blank may include `choices`. The server rejects invalid item combinations.

### `GET /api/admin/homeworks`

Returns the 20 most recent accessible plans with classroom metadata, target count, generated occurrence count, completed occurrence count, and lifecycle status. Administrators see all plans; teachers see assigned active-classroom plans plus legacy plans they originally published.

### `PATCH /api/admin/homeworks/:homeworkId/status`

Accepts `PUBLISHED`, `PAUSED`, or `ARCHIVED`. `PUBLISHED` and `PAUSED` may transition between each other; `ARCHIVED` is terminal. Paused or archived work is hidden from student lists and blocks new student detail, submission, answer, and learning-session operations without deleting history.

### `POST /api/admin/uploads`

Requires an active staff bearer token and one multipart `file` field. It accepts JPG, PNG, WebP, MP3, WAV, M4A, WebM, and OGG files up to 20 MB. Without `purpose`, homework presentation assets receive a public `/uploads/assets/*` path. Multipart `purpose=FEEDBACK` accepts audio only and returns `{ "kind": "audio", "purpose": "FEEDBACK", "url": "/uploads/feedback/..." }`. The server records the uploading staff account; that account may bind the URL to one submission exactly once.

## Student read-aloud

### `GET /api/student/reading-homeworks`

Returns available picture-book occurrences for the logged-in student and the number of completed cards.

### `GET /api/student/reading-homeworks/:occurrenceId`

Returns the ordered cards, their reference text and sample audio URLs, the student's latest personal recording, and its normalized asynchronous `assessment` when present.

### `POST /api/student/reading-homeworks/:occurrenceId/cards/:cardId/submissions`

Requires student authentication and one multipart audio `file` field. Optional `durationSeconds` is rounded and capped at 600 seconds for the student's voice-time aggregate. The server blocks attempts to submit an uncompleted later card, but accepts re-recordings for already submitted cards. Upload completion does not wait for speech assessment; a new assessment is queued in the same transaction as each new recording.

## Student sentence and word practice

### `GET /api/student/practice-homeworks`

Returns available sentence and word occurrences with template type, item count, and completed item count.

### `GET /api/student/practice-homeworks/:occurrenceId`

Returns ordered generic items and their latest student state. Recording items include model/personal/teacher-feedback audio, review state, and normalized asynchronous `assessment`. Word read-aloud exposes its answer word as the text to read. Objective items include choices or shuffled letters, but never return the answer word.

### `POST /api/student/practice-homeworks/:occurrenceId/items/:itemId/recordings`

Requires student authentication and one multipart audio `file` field, with optional `durationSeconds` using the same 600-second cap. It accepts only sentence or word read-aloud items, enforces sequence order, and creates a new recording attempt plus its own queued assessment without waiting for provider processing.

### `POST /api/student/practice-homeworks/:occurrenceId/items/:itemId/answers`

Requires JSON `{ "answerText": "apple" }`. It accepts only objective word items, calculates correctness server-side, and unlocks the next item only after a correct answer.

## Protected recording media

Homework images and model audio under `/uploads/assets/*` are public presentation assets. Student recording URLs under `/uploads/submissions/*` and teacher feedback under `/uploads/feedback/*` require a bearer token. An active student may fetch only media attached to that student's submissions; teachers may fetch only media in their assigned active classrooms, while administrators retain global access. Review requests reject unregistered feedback URLs, URLs uploaded by another staff account, and URLs already consumed by another submission. Re-reviewing the original submission may retain its existing feedback. Byte-range requests are supported for audio playback and seeking.

## Student learning statistics

### `GET /api/student/profile`

Returns the authenticated student's public account, optional personal fields, server-owned point balance and level progress, and the latest point events. Events may include `DAILY_CHECKIN`, `HOMEWORK_COMPLETED`, or `STREAK_BONUS` plus their optional classroom source. Phone, role, status, credentials, and classroom membership are not editable.

### `PATCH /api/student/profile`

Partially updates `displayName`, `englishName`, `schoolName`, `gradeLevel`, or `learningGoal`. Omitted fields remain unchanged; an empty optional field is stored as `null`. `displayName` is trimmed and must contain 2 to 24 characters. Sending `phone` is rejected.

### `GET /api/student/homework-history`

Returns the authenticated student's assigned occurrences scheduled up to now, newest first. Query parameters are `page` and `pageSize` with a maximum page size of 100. Each row includes template, parent homework lifecycle, occurrence status, completion fraction, and current latest-attempt review count. Paused and archived homework remains historical but cannot be reopened for submission.

### `POST /api/student/homework-sessions`

Requires JSON `{ "occurrenceId": "..." }` for an assigned, available occurrence. Starts or returns that student's active homework session and returns `{ session }` with `id`, `startedAt`, `completedAt`, and `creditedSeconds`.

### `POST /api/student/homework-sessions/:sessionId/complete`

Completes the authenticated student's session while its homework remains `PUBLISHED`. The server calculates credited duration, caps it at 7,200 seconds, and makes repeated completion idempotent. A pause or archive between session start and completion rejects completion and does not credit learning time.

### `GET /api/student/learning-stats`

Returns the authenticated student's own check-in aggregate:

```json
{
  "summary": {
    "checkinDays": 12,
    "currentStreak": 3,
    "voiceSeconds": 612,
    "homeworkSeconds": 2400
  },
  "checkins": [
    {
      "checkinDate": "2026-07-14",
      "firstActivityAt": "2026-07-14T09:00:00.000Z",
      "voiceSeconds": 84,
      "homeworkSeconds": 600
    }
  ],
  "recentDays": [
    {
      "checkinDate": "2026-07-08",
      "voiceSeconds": 0,
      "homeworkSeconds": 0
    }
  ]
}
```

## Teacher read-aloud review

Teacher access throughout this section is limited to assigned active classrooms plus legacy homework originally published by that teacher. Administrators retain global access.

### `GET /api/admin/read-aloud-submissions`

Requires an active administrator or teacher bearer token. Returns the latest student recording for each submitted picture-book card, including its student, homework, reference text, normalized assessment, current grade, feedback audio URL, and status.

### `POST /api/admin/read-aloud-submissions/:submissionId/review`

Requires an active administrator or teacher bearer token. Accepts an A-D `grade` and an optional uploaded `feedbackAudioUrl`. It updates the newest submission for that student and card; the student card then reports `GRADED`.

### `GET /api/admin/practice-recording-submissions`

Requires an active administrator or teacher bearer token. Returns the latest sentence and word read-aloud recording attempts with their item context, normalized assessment, grade, and voice feedback.

The public `assessment` object contains `id`, `status`, `provider`, nullable overall/accuracy/fluency/completeness/prosody scores, nullable ordered word results, and `completedAt`. Provider credentials, raw payloads, retry errors, attempt counts, and lease metadata are never returned. `QUEUED` and `PROCESSING` are pending states; `FAILED` does not assign a student grade.

### `POST /api/admin/practice-recording-submissions/:submissionId/review`

Requires an active administrator or teacher bearer token. Accepts an A-D `grade` and optional `feedbackAudioUrl` for the latest generic recording attempt. A re-recorded item must be reviewed through its new submission ID.

### `GET /api/admin/students/:studentId/learning-stats`

Requires an active administrator or teacher bearer token. Returns the same aggregate shape for an accessible active student. It returns `404 STUDENT_NOT_FOUND` for missing, disabled, non-student, or out-of-class targets.

## Speech-assessment operations

### `GET /api/admin/speech-assessments`

Returns a classroom-scoped, paginated operational queue. Query parameters are `page`, `pageSize` (maximum 100), and optional `status` (`QUEUED`, `PROCESSING`, `COMPLETED`, or `FAILED`). The response contains `assessments`, `pagination`, and unfiltered scoped status `summary` counts.

Operational items include normalized scores, attempt count, last error, and timestamps. They never include the private raw provider result, lease token, credentials, or audio contents.

### `POST /api/admin/speech-assessments/:assessmentId/retry`

Requeues an accessible `FAILED` assessment and resets its machine retry budget. Non-failed jobs return `409`; missing or out-of-class ids return `404`. Retrying never changes the recording submission, human grade, or teacher feedback.
