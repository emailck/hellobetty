# API Service DOX

## Purpose
- Provide authentication, account-management, homework-publication, protected asset-upload, read-aloud, and asynchronous speech-assessment APIs for Hello Betty clients.

## Ownership
- Own HTTP contracts, password hashing, JWT issuance and verification, role checks, SQLite schema initialization, homework plan publication, protected asset upload, student audio submissions, provider-neutral speech-assessment jobs, teacher voice feedback and grades, and API tests.

## Local Contracts
- Normalize account identifiers before uniqueness checks.
- Hash passwords with Node.js `scrypt` and a unique random salt.
- Return generic login errors so callers cannot distinguish unknown accounts from wrong passwords.
- Protect teacher-management routes with both a valid token and an `ADMIN` or `TEACHER` role check.
- Derive staff authority from the current database user record, not JWT role claims.
- API responses must never include `passwordHash`.
- Administrators provision teacher/student accounts and own classroom membership; teachers operate only active assigned classrooms plus legacy homework they originally published.
- Publish homework, recipients, and occurrence records in one transaction; reject the full publish request when any selected student is invalid or inactive.
- Teacher-published homework must include an active assigned classroom and active classroom students; administrators may publish without classroom ownership.
- Homework `ARCHIVED` status is terminal; paused or archived homework is hidden from student lists and rejects student detail, submission, answer, and session operations.
- Restrict uploads by media type and file size, and enforce card order server-side for picture-book submissions.
- Serve public homework assets only from `/uploads/assets/*`. Student recordings under `/uploads/submissions/*` and teacher feedback under `/uploads/feedback/*` require a valid active account; students may fetch only their own private audio while teachers and administrators may fetch scoped review audio.
- A card's status is `UNMADE`, `DONE`, or `GRADED`, derived from its latest student submission and review metadata.
- Keep `homework_cards` and `homework_card_submissions` exclusive to picture-book read-aloud work; sentence and word templates use `homework_items` and `homework_item_submissions`.
- Picture-book card submissions must reject attempts before the occurrence `scheduled_at` time and must not mutate status, submissions, learning, or points.
- Generic practice items unlock in position order. Recording items complete after a recording; objective items unlock the next item only after a server-scored correct answer.
- Staff review applies only to the latest picture-book, sentence, or word recording attempt. Feedback audio must be uploaded privately with admin upload `purpose=FEEDBACK`, recorded in `feedback_uploads`, and stored under `/uploads/feedback/*`; public asset URLs, unregistered feedback URLs, another staff member's unconsumed upload, and URLs already consumed by another submission are not valid review feedback. Re-review without a new `feedbackAudioUrl` preserves existing feedback. A later student recording becomes the current unreviewed attempt without rewriting prior submissions.
- Create one speech-assessment job in the same transaction as each assessable recording submission. Each job snapshots its reference text and locale; re-recording creates a separate job.
- Use picture-book `referenceText`, sentence `promptText`, and word-read-aloud `answerText` as the immutable assessment reference; word read-aloud must not require a duplicate prompt.
- Keep provider processing asynchronous and lease-based. Provider absence leaves work queued, retries stop after three attempts, and public responses expose only normalized assessment results.
- The default processing lease is five minutes so provider calls for full-length recordings are not reclaimed prematurely; expired or stale lease tokens must never complete or fail a job.
- Machine assessment must never set or replace staff grades, voice feedback, or review timestamps.
- Assessment operations may expose queue status, attempts, and last error, but never raw provider payloads, lease tokens, or student audio contents.
- Student profile extension fields live in `student_profiles`; `users.display_name` remains the account display name and phone is read-only.
- Student point events are append-only in `student_point_events` with one event per `(student_id, event_type, source_id)` and optional classroom source; award `DAILY_CHECKIN`, `HOMEWORK_COMPLETED`, and exact-day `STREAK_BONUS` from the activity occurrence classroom policy, or defaults 2/10/no streak for unscoped homework.
- Completion points are tied to the occurrence's first transition into `COMPLETED`; a zero-point award persists an internal idempotency claim in `student_point_events`, remains hidden from student event lists, and cannot be back-awarded after a policy change or service restart.
- Classroom point-policy API fields are `dailyCheckinPoints` and `homeworkCompletionPoints`; policies are editable only for active classrooms visible to current DB staff, replacement is atomic, validates bounded base points and unique streak days, and never rewrites existing point events.
- Migrations backfill `DAILY_CHECKIN` from existing `student_daily_learning.first_activity_at` rows and `HOMEWORK_COMPLETED` from existing completed occurrences without duplicating events on restart.
- Record student learning days using the `Asia/Shanghai` calendar. Recording submissions create a check-in even when duration is omitted, and one submitted duration contributes at most 600 voice seconds.
- Homework learning sessions use server start and completion times, complete only while the homework remains `PUBLISHED`, credit at most 7200 seconds, and add daily homework time exactly once when completion succeeds.
- Student homework history includes all assigned occurrences scheduled up to now, including paused and archived parent homework.
- Student homework list summaries return every due recurring occurrence independently with its `scheduledAt` dispatch timestamp, and expose whether it has a learning session plus completed and latest-submission reviewed counts so clients can distinguish unseen, incomplete, completed, and fully reviewed work without inferring server state.
- Student learning statistics are account-private; staff statistics require an active `STUDENT` target.

## Work Guidance
- Use Fastify, Node.js built-in SQLite for local development, and TypeScript.
- Validate every public request body and query at the route boundary.
- Keep seed credentials configurable through environment variables.

## Verification
- Run `npm run typecheck -w @hellobetty/api`.
- Run `npm test -w @hellobetty/api`.

## Child DOX Index
