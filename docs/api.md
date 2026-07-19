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

### `GET /api/admin/users`

Requires an active administrator bearer token. Returns paginated student accounts.

Query parameters:

- `page`, default `1`
- `pageSize`, default `20`, maximum `100`
- `search`, filters by phone number or display name

The web console proxies this request server-side and keeps its token in an HttpOnly cookie.

### `POST /api/admin/homeworks`

Requires an active administrator bearer token. Publishes a recurring homework plan for selected active students and returns the created plan plus its target and occurrence counts.

```json
{
  "title": "Unit 1 朗读练习",
  "instructions": "完成录音并提交。",
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

Requires an active administrator bearer token. Returns the 20 most recently published plans with their target student count and generated occurrence count.

### `POST /api/admin/uploads`

Requires an active administrator bearer token and one multipart `file` field. It accepts JPG, PNG, WebP, MP3, WAV, M4A, WebM, and OGG files up to 20 MB. Returns a protected asset path for homework card creation.

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

Homework images and model audio under `/uploads/assets/*` are public presentation assets. Student recording URLs under `/uploads/submissions/*` require a bearer token. An active student may fetch only recordings owned by that student; active teachers and administrators may fetch recordings available to staff review. Byte-range requests are supported for audio playback and seeking.

## Student learning statistics

### `POST /api/student/homework-sessions`

Requires JSON `{ "occurrenceId": "..." }` for an assigned, available occurrence. Starts or returns that student's active homework session and returns `{ session }` with `id`, `startedAt`, `completedAt`, and `creditedSeconds`.

### `POST /api/student/homework-sessions/:sessionId/complete`

Completes the authenticated student's session. The server calculates credited duration, caps it at 7,200 seconds, and makes repeated completion idempotent.

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
  ]
}
```

## Teacher read-aloud review

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

Requires an active administrator or teacher bearer token. Returns the same aggregate shape for an active student. It returns `404 STUDENT_NOT_FOUND` for missing, disabled, or non-student targets.
