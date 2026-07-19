# Learning Check-in and Statistics Plan

## Scope

Students receive a personal learning summary with check-in days, consecutive check-in count, accumulated recording duration, effective homework duration, and a zero-filled seven-day trend. Staff can view the aggregate and check-ins for an active student in the web console. Student points and personal history build on this measurement contract in `student-engagement.md`.

## Measurement Model

- A check-in day is an Asia/Shanghai calendar day with either a completed homework session or a submitted student recording.
- Student recording endpoints accept `durationSeconds`. The API validates a positive value and caps one submission at 10 minutes before adding it to the daily voice total. Re-recordings count as additional speaking practice.
- Opening a student homework occurrence starts a server-owned session. Completing it records server elapsed time, capped at 2 hours. Only completed sessions contribute to homework duration.
- `student_daily_learning` is the durable daily aggregate: `checkinDate`, first activity timestamp, voice seconds, and homework seconds. It is updated in the same transaction as a recording submission or session completion.
- Current streak is consecutive calendar days ending today or yesterday; total check-ins are distinct daily rows.
- `recentDays` always contains the latest seven Asia/Shanghai dates in chronological order, using zero seconds when no aggregate row exists.
- The first daily aggregate row also creates one idempotent `DAILY_CHECKIN` ledger event using the activity homework's current classroom policy. An exact configured streak milestone may create one `STREAK_BONUS`; the points ledger remains independent from accumulated duration.

## Privacy and Authorization

Students can read only their own statistics. Active teachers and administrators can read an active student's summary through a staff route. Neither route exposes recordings, answer text, or another student's activity.

## Delivery Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | root | Design, integration, documentation, and final verification | Workspace type checks, API tests, and production builds pass |
| completed | backend | Daily aggregate/session schema, recording duration persistence, student/staff stats APIs, tests | `npm test -w @hellobetty/api`; `npm run typecheck -w @hellobetty/api` |
| completed | admin | Student statistics entry point and staff-facing summary panel | `npm run typecheck -w @hellobetty/admin`; `npm run build -w @hellobetty/admin` |
| completed | mobile | Student profile check-in UI, recording-duration upload, homework session lifecycle | `npm run typecheck -w @hellobetty/mobile` |

## API Contract

- `POST /api/student/homework-sessions` body `{ occurrenceId }` starts or returns an active session for the student's assigned occurrence.
- `POST /api/student/homework-sessions/:sessionId/complete` completes that session and returns its credited seconds.
- `GET /api/student/learning-stats` returns `{ summary, checkins, recentDays }` for the authenticated student.
- `GET /api/admin/students/:studentId/learning-stats` returns the same shape for an active student.
- Student recording uploads add multipart field `durationSeconds`; existing clients may omit it and then contribute zero seconds.
