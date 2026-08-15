# Product Scope

## Current milestone

- Students can register with a mobile number, display name, and password.
- Students can log in and restore an existing local session.
- Administrators and teachers can log in to the web console or mobile staff workspace.
- Administrators can provision and enable or disable teacher/student accounts, create classrooms, archive/reactivate classrooms, and replace classroom teacher/student membership.
- Teachers can see only assigned active classrooms for scoped workflows, can create active classrooms assigned to themselves, and can edit student membership in their own active classrooms using active student candidates. Teachers cannot change teacher membership, classroom status, or account status. Staff authorization is resolved from the current database account and classroom membership rather than trusting a token role claim.
- Administrators and teachers can publish recurring homework through the web console or mobile app. Teacher publication requires one assigned active classroom and recipients from that classroom; administrators may publish without classroom ownership. Mobile publishing supports library selection or new content, local draft restore, full media preview, first publish time, and a final confirmation before upload.
- Administrators and teachers manage an independent homework library: teachers can create and delete their own templates, and can list, preview, and assign templates they own or that are referenced by homework instances visible through their active classrooms; administrators can manage the full library. Deleting a template removes it only from future selection.
- Publishing homework creates a distinct assigned instance with its own recipients, schedule, lifecycle, submissions, and immutable content snapshot. Staff can assign an existing library template to another classroom or student set, or create new inline content that is saved to the library and assigned in one operation.
- Staff can view classroom-scoped homework completion progress, pause and resume published homework, and end homework terminally without deleting its history; students see ended work as `已封存` in history.
- From each published homework, teachers and administrators can inspect the most recently started recurrence cycle in the web console and mobile app, including every assigned student's full-check-in, partial, or not-started state; check-in requires completing every question.
- Administrators can publish multi-page picture-book read-aloud instances with English reference text, a paired image, and sample audio for each card.
- Students complete a picture-book card one at a time, can play both sample and personal recordings, and can re-record completed cards.
- Teachers can publish sentence read-aloud and image-led word templates: word read-aloud, image match, word scramble, and fill blank.
- Students complete sentence and word read-aloud one item at a time, can listen to model, personal, and teacher-feedback audio, and can re-record after staff review.
- Student homework modals are centered, preserve complete homework images, and continue to the next unlocked item or next later incomplete occurrence through matching conversation cards.
- Students complete image match, word scramble, and image-led fill-blank exercises in sequence; the server scores answers and unlocks the next item after a correct answer.
- Teachers can review the latest submission for every homework question, retain objective automatic correctness as reference, assign a `SSS`, `SS`, `S`, `A`, or `B` grade, and record or upload voice feedback. Legacy `C` and `D` grades can appear read-only on old submissions but cannot be newly selected.
- Teachers and administrators start student-homework review from published-homework groups, default to pending work, can switch to history, and can search by student name. Opening a group shows the student occurrence list, then one occurrence opens every question for preview, audio playback, and review.
- Every new picture-book, sentence, or word recording creates a provider-neutral asynchronous speech-assessment job. Student and staff views show its normalized status and scores; re-recording creates a new current result while staff review remains independent.
- The web assessment workspace reports provider availability and scoped queue counts, filters queue states, and allows authorized staff to requeue failed jobs without changing human grades.
- Student recordings and teacher voice feedback are authenticated private media. Teachers cannot fetch recordings or results owned by another classroom even when the URL or object ID is known.
- Mobile polling for an unchanged queued or processing assessment is bounded to five minutes and restarts after visible assessment progress, a new attempt, or reopening the view.
- Mobile homework-template drafts auto-save locally per teacher and can be restored and previewed before publication.
- The mobile teacher workspace opens to `学生作业` and uses the top-left menu on every primary staff page for `学生作业`, `已发布作业`, `作业库`, and `班级管理`. Published-homework and library pages are browsable lists with server-side filters; tapping a published homework or template opens a media preview with images and audio.
- Students can edit non-sensitive personal fields in the mobile `我的` center while phone, role, status, and classroom membership remain read-only.
- Students receive idempotent server-owned points for first daily activity, first homework-occurrence completion, and configured streak milestones, with level progress and recent point reasons.
- Assigned teachers configure future check-in, completion, and consecutive-check-in rewards for their active classrooms; administrators retain operational access without changing points already earned.
- Students can view check-in totals, current streak, voice/homework duration, a zero-filled seven-day chart, and complete assigned homework history including paused and sealed instances.
- Teachers and administrators can view an active student's read-only learning summary and recent check-ins in the web console.

## Planned, not implemented

- SMS verification and password recovery.
- Parent or guardian binding and consent workflows.
- A commercial speech-scoring provider integration, production object storage, notifications, and richer learning reports.

These items require separate product and privacy decisions before implementation.
