# Product Scope

## Current milestone

- Students can register with a mobile number, display name, and password.
- Students can log in and restore an existing local session.
- Administrators and teachers can log in to the web console or mobile staff workspace.
- Administrators can provision and enable or disable teacher/student accounts, create classrooms, and replace classroom teacher/student membership.
- Teachers can see only assigned active classrooms and their active students. Staff authorization is resolved from the current database account and classroom membership rather than trusting a token role claim.
- Administrators and teachers can publish recurring homework through the web console or mobile app. Teacher publication requires one assigned active classroom and recipients from that classroom; administrators may publish without classroom ownership.
- Staff can view classroom-scoped homework completion progress, pause and resume published homework, and archive homework terminally without deleting its history.
- Administrators can publish multi-page picture-book read-aloud plans with English reference text, a paired image, and sample audio for each card.
- Students complete a picture-book card one at a time, can play both sample and personal recordings, and can re-record completed cards.
- Teachers can publish sentence read-aloud and image-led word templates: word read-aloud, image match, word scramble, and fill blank.
- Students complete sentence and word read-aloud one item at a time, can listen to model, personal, and teacher-feedback audio, and can re-record after an A-D review.
- Student homework modals are centered, preserve complete homework images, and continue to the next unlocked item or next later incomplete occurrence through matching conversation cards.
- Students complete image match, word scramble, and image-led fill-blank exercises in sequence; the server scores answers and unlocks the next item after a correct answer.
- Teachers can review the current recording for picture-book, sentence, and word read-aloud items, assign an A-D grade, and record or upload voice feedback.
- Teachers and administrators can perform read-aloud review from the mobile app as well as the web console.
- Every new picture-book, sentence, or word recording creates a provider-neutral asynchronous speech-assessment job. Student and staff views show its normalized status and scores; re-recording creates a new current result while staff A-D review remains independent.
- The web assessment workspace reports provider availability and scoped queue counts, filters queue states, and allows authorized staff to requeue failed jobs without changing human grades.
- Student recordings and teacher voice feedback are authenticated private media. Teachers cannot fetch recordings or results owned by another classroom even when the URL or object ID is known.
- Mobile polling for an unchanged queued or processing assessment is bounded to five minutes and restarts after visible assessment progress, a new attempt, or reopening the view.
- Mobile homework-template drafts auto-save locally per teacher and can be restored and previewed before publication.
- Students can edit non-sensitive personal fields in the mobile `我的` center while phone, role, status, and classroom membership remain read-only.
- Students receive idempotent server-owned points for first daily activity, first homework-occurrence completion, and configured streak milestones, with level progress and recent point reasons.
- Assigned teachers configure future check-in, completion, and consecutive-check-in rewards for their active classrooms; administrators retain operational access without changing points already earned.
- Students can view check-in totals, current streak, voice/homework duration, a zero-filled seven-day chart, and complete assigned homework history including paused and archived plans.
- Teachers and administrators can view an active student's read-only learning summary and recent check-ins in the web console.

## Planned, not implemented

- SMS verification and password recovery.
- Parent or guardian binding and consent workflows.
- A commercial speech-scoring provider integration, production object storage, notifications, and richer learning reports.

These items require separate product and privacy decisions before implementation.
