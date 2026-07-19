# Homework Model

## Goal

Teachers publish a homework plan once, choose its students, and define how often it is triggered. The plan is immutable at publication time in the current milestone.

## Entities

### Homework

The teacher-owned plan:

- `publisherId`: teacher or administrator that published it.
- `classroomId`: the owning classroom for new teacher-published homework; administrators may leave it null for exceptional or legacy flows.
- `title`, `instructions`: student-facing summary and instructions.
- `status`: starts as `PUBLISHED`; `PAUSED` hides and blocks student work without deleting history, while `ARCHIVED` is terminal.
- `startsAt`: UTC timestamp for the first trigger.
- `repeatUnit`: `DAY` or `WEEK`.
- `repeatInterval`: number of units between triggers, from 1 to 52.
- `occurrenceLimit`: total number of triggers, from 1 to 365.

### HomeworkRecipient

The selected active student set. It is a many-to-many link between `Homework` and `User` records where `User.role` is `STUDENT`.

### HomeworkOccurrence

One scheduled instance for one recipient. It contains:

- `sequenceNumber`: starts at 1 for every recipient.
- `scheduledAt`: calculated from `startsAt`, unit, interval, and sequence number.
- `status`: starts as `SCHEDULED`; later workflow states are `AVAILABLE`, `COMPLETED`, and `EXPIRED`.

Future student submissions and teacher grading must refer to a `HomeworkOccurrence`, not directly to the reusable `Homework` plan.

Staff progress is derived as completed occurrences divided by all generated occurrences for the plan. Pausing or archiving does not remove recipients, occurrences, submissions, reviews, or assessment results.

### Classroom

`Classroom` is the authorization owner for new teacher workflows. Administrators manage its name, active/archived status, teachers, and students. A user may belong to multiple classrooms. A teacher can publish, review, read statistics, retry assessments, and stream private media only through an assigned active classroom. Existing homework with no classroom remains available to administrators and its original publisher.

### PictureBookCard

`Homework.templateType` can be `READ_ALOUD_PICTURE_BOOK`. Such a homework has ordered cards, and every card requires:

- `imageUrl`: teacher-uploaded page image.
- `sampleAudioUrl`: teacher-uploaded model recording.
- `position`: immutable page order within the homework.

### HomeworkCardSubmission

One student can submit a card more than once. Each submission stores its recording URL, attempt number, and timestamp. The latest attempt is shown as the student's personal recording; earlier attempts remain available for a later teacher-review workflow.

The latest submission may also store teacher review metadata:

- `grade`: `A`, `B`, `C`, or `D`.
- `feedbackAudioUrl`: optional teacher voice feedback.
- `reviewedAt`: timestamp of the latest review.

Student-facing card state is derived from this data:

- `UNMADE`: no submitted recording.
- `DONE`: a recording exists but has no review.
- `GRADED`: a reviewed recording has a grade or feedback timestamp.

### HomeworkItem

Sentence and word templates use `HomeworkItem`, not `PictureBookCard`. Each item has immutable order and template-specific fields:

- sentence read-aloud: `promptText` and `sampleAudioUrl`;
- word read-aloud: `imageUrl`, `answerText`, and `sampleAudioUrl`;
- image match: `imageUrl`, `answerText`, and optional word choices;
- word scramble: `imageUrl` and `answerText`; the student receives only a deterministic shuffled letter list;
- fill blank: `promptText` containing `____`, `imageUrl`, `answerText`, and optional word choices.

### HomeworkItemSubmission

Recording items store append-only audio attempts with the same A-D and optional voice-feedback review metadata as picture-book cards. A later recording becomes the current `DONE` attempt, leaving earlier reviews intact.

Objective word submissions store the submitted word and a server-calculated correctness flag. Only a correct objective attempt completes and unlocks the next item. The student API never returns an objective item's answer word; it returns configured choices or scrambled letters instead.

### Learning Statistics

`StudentDailyLearning` stores one Asia/Shanghai calendar-day aggregate per student: first activity timestamp, voice seconds, and credited homework seconds. A day is a check-in when either value is written.

`HomeworkLearningSession` is a student-owned start/completion record for an assigned occurrence. The server calculates its credited duration at completion, caps one session at two hours, and applies that value to the daily aggregate exactly once. Recording submissions persist their duration separately and contribute at most ten minutes each to daily voice time.

## Sequential Read-Aloud Flow

- Student chat shows completed cards and the first unsubmitted card only.
- The server rejects a first submission for card N until cards 1 through N-1 have a submission.
- After submitting the active card, the next card becomes available.
- A submitted card remains clickable; a new recording creates a newer submission without locking later cards again.
- Teachers review the newest recording only. A re-recording becomes the current `DONE` submission and awaits a new review.

## Publish Contract

`POST /api/admin/homeworks` publishes a plan and creates all recipient and occurrence records in one SQLite transaction. Any invalid, inactive, non-student, or out-of-class recipient rejects the full request; partial publication is not allowed. Teachers must provide an assigned active `classroomId`; administrators may publish with a nullable classroom.

Picture-book publication additionally requires every card to contain an image and a sample audio URL. Uploads are limited to 20 MB and accepted only for supported image and audio media types.

Sentence and word template publication uses ordered `items`. Item validation is template-specific, and invalid item content rejects the whole transaction together with invalid recipients.

Students read only their own learning aggregate. Administrators can read any active student's aggregate; teachers can read it only for active students in an assigned active classroom. The same scope controls reviews, assessments, and private media.

Example: a weekly plan with `interval: 2` and `occurrenceLimit: 3` begins on 20 July and schedules triggers on 20 July, 3 August, and 17 August for each selected student.
