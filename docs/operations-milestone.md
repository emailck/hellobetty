# Operations Milestone Plan

## Scope

This milestone turns the existing single-tenant demonstration flow into a provider-independent school operations flow. It adds staff account provisioning, classroom ownership, teacher/student authorization boundaries, homework lifecycle and progress, speech-assessment operations, and bounded client polling.

Commercial speech-provider SDKs, SMS, external push delivery, object storage, and production database migration remain separate integrations because they require vendor selection and deployment credentials. The application must report those capabilities honestly rather than simulate them.

## Assumptions And Ownership

- `ADMIN` accounts own staff provisioning, account status, classroom creation, and classroom membership.
- `TEACHER` accounts operate only on active classrooms assigned to them.
- A student may belong to multiple classrooms. A teacher may belong to multiple classrooms.
- New teacher-published homework belongs to one active classroom. Its selected recipients must be active students in that classroom.
- Administrators may publish without a classroom for exceptional or legacy workflows.
- Existing homework is migrated with nullable classroom ownership. Its publisher retains staff access so historical data remains usable.
- Homework, submissions, reviews, speech assessments, private student recordings, and private teacher feedback inherit access from classroom membership and homework ownership. Client role claims are never sufficient without a current database authorization check. Each private feedback upload is owned by its uploader and can be consumed by only one submission.
- Machine assessment remains reference data. Retry operations change only queue state and never staff grades or feedback.

## Data Model And Migration

Add:

- `classrooms`: name, active/archived status, creator, and timestamps.
- `classroom_teachers`: classroom-to-active-teacher membership.
- `classroom_students`: classroom-to-active-student membership.
- nullable `homeworks.classroom_id` for backward-compatible ownership.

The upgrade is additive. Existing users, sessions, homework plans, occurrences, recordings, assessments, grades, and learning statistics must survive unchanged. Existing homework remains visible to administrators and its original publisher.

## API Contract

Account and classroom operations:

- `GET /api/admin/context`: current staff identity, role, and speech-provider availability.
- `POST /api/admin/users`: administrator-only creation of `TEACHER` or `STUDENT` accounts with an initial password.
- `PATCH /api/admin/users/:userId/status`: administrator-only activation or disabling; an administrator cannot disable the current account.
- `GET /api/admin/classrooms`: administrators see all classrooms; teachers see assigned classrooms.
- `POST /api/admin/classrooms`: administrator-only classroom creation with teacher and student membership.
- `PATCH /api/admin/classrooms/:classroomId`: administrator-only name, status, and membership replacement.

Homework operations:

- Publishing accepts optional `classroomId`. It is required for teachers and validates every recipient against that classroom.
- `GET /api/admin/homeworks` is scoped and returns target, occurrence, and completed-occurrence counts.
- `PATCH /api/admin/homeworks/:homeworkId/status` supports `PUBLISHED`, `PAUSED`, and terminal `ARCHIVED` transitions; the terminal transition is the staff `结束作业` action.
- Paused or ended homework is hidden from current student lists and rejects detail, submission, answer, session start, and session completion without crediting learning time. Ended work remains in student history as `已封存`.

Assessment operations:

- `GET /api/admin/speech-assessments` returns a scoped, paginated operational queue without raw provider payloads, credentials, lease tokens, or student audio contents.
- `POST /api/admin/speech-assessments/:assessmentId/retry` requeues an accessible `FAILED` job and resets its retry budget. It never alters the submission or staff review.
- The admin context reports whether a provider is configured and its public identifier when available.
- Student and staff occurrence polling stops after five minutes for an unchanged assessment id and pending state. A queued-to-processing transition, a new attempt, or reopening the view starts a new bounded observation window.

## User Experience

- The web console provides separate, scan-friendly account/classroom and assessment operations views.
- Homework publishing requires teachers to select a classroom before selecting students; administrators may use an unscoped workflow.
- Homework history exposes progress and icon actions for pause, resume, and confirmed terminal end.
- The mobile staff workspace includes paginated published-homework history and classroom management. Teachers inspect assigned classrooms; administrators create, edit membership, archive, and restore classrooms.
- The assessment view distinguishes provider-unconfigured, queued, processing, failed, and completed states and offers retry only for failed work.
- Mobile teacher publishing loads only authorized classrooms/students and includes `classroomId` in publication.

## Delivery Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | root | Architecture, trust boundaries, migration, API/UI contracts, integration | Re-read against current routes and persistence |
| completed | backend | Additive schema, account/classroom APIs, scoped authorization, homework lifecycle/progress, assessment operations, focused tests | API typecheck and 24 API tests pass |
| completed | admin | Account/classroom workspace, scoped publishing, lifecycle/progress controls, assessment operations view | Admin typecheck and production build pass |
| completed | mobile | Scoped classroom publishing and bounded speech-assessment polling | Mobile typecheck, Expo web export, Android native build, recording submission, and staff-grade smoke pass |
| completed | root | Cross-boundary audit, legacy migration, allowed/denied authorization proof, docs and workspace verification | Workspace typecheck, 27 API tests, production build, Expo export, browser smoke, and Android student-to-staff runtime flow pass |

## Acceptance Criteria

- An administrator can create a teacher, create a classroom, and assign teachers and students.
- A teacher sees and operates only assigned classroom students, homework, submissions, assessments, statistics, recordings, and feedback.
- Cross-class access is denied even when a valid object ID or private recording/feedback URL is known.
- A private teacher-feedback URL cannot be reused by another uploader or rebound to another submission.
- Teacher publication rejects a missing classroom or an out-of-class student atomically.
- Pausing hides and blocks homework without deleting work; resuming restores it; archiving is terminal and retains history.
- Staff can see completion progress for each homework plan.
- An authorized staff member can requeue a failed assessment without changing the human grade.
- Provider absence is visible in operations UI, and clients do not poll an unchanged pending assessment forever.
- A representative pre-milestone SQLite database upgrades without losing existing records.
