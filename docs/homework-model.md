# Homework Model

## Goal

Teachers maintain a reusable homework library, then create assigned homework instances from those templates. Templates own reusable content and presentation assets; instances own recipients, schedule, lifecycle, submissions, and review data. Each instance receives an immutable content snapshot at creation so later template deletion or replacement does not change assigned or completed work.

## Entities

### HomeworkTemplate

The reusable library record:

- `ownerId`: staff account that created the template. Teachers create and delete their own templates, and may inspect or reuse another owner's template when a currently accessible classroom homework references it. Administrators can list, inspect, create, and delete all templates.
- `title`, `instructions`: default student-facing summary and instructions reused when assigning the template.
- `templateType`: picture-book, sentence read-aloud, word read-aloud, image match, word scramble, or fill blank.
- Content assets: ordered picture-book cards or generic homework items with their image, sample-audio, prompt, answer, and choice data.
- `deletedAt`: removing a template hides it from the library and future assignment choices, but never changes existing homework instances.

### Homework

The assigned homework instance:

- `templateId`: source library template. Legacy instances are backfilled to an owned template during migration.
- `publisherId`: teacher or administrator that assigned it.
- `classroomId`: the owning classroom for new teacher-published homework; administrators may leave it null for exceptional or legacy flows.
- `title`, `instructions`, `templateType`, ordered cards/items, and asset URLs: immutable snapshot copied from the template or inline publish payload at assignment time.
- `status`: starts as `PUBLISHED`; `PAUSED` hides and blocks student work without deleting history. A staff end action writes terminal `ARCHIVED`, shown as `已结束` to staff and `已封存` in student history.
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

Future student submissions and teacher grading must refer to a `HomeworkOccurrence`, not directly to the reusable `Homework` instance.

Staff progress is derived as completed occurrences divided by all generated occurrences for the instance. Pausing or ending does not remove recipients, occurrences, submissions, reviews, or assessment results.

The staff latest-cycle view chooses the greatest `sequenceNumber` whose `scheduledAt` is not in the future. It returns the occurrence for every original recipient in that sequence. `COMPLETED` is the only checked-in state because it proves that every configured card or item is complete; an incomplete occurrence with at least one submission is shown as in progress, and one with no submissions is not started.

### Classroom

`Classroom` is the authorization owner for new teacher workflows. Administrators manage accounts, classroom active/archived status, and teacher membership. Teachers may create active classrooms assigned to themselves and may rename or replace student membership only inside their assigned active classrooms; they cannot change teacher membership or archive/reactivate classes. Student membership editors use active `STUDENT` candidates only. A user may belong to multiple classrooms. A teacher can publish, review, read statistics, retry assessments, and stream private media only through an assigned active classroom. Existing homework with no classroom remains available to administrators and its original publisher.

### PictureBookCard

`HomeworkTemplate.templateType` and the assigned `Homework` snapshot can be `READ_ALOUD_PICTURE_BOOK`. Picture-book content has ordered cards, and every card requires:

- `imageUrl`: teacher-uploaded page image.
- `sampleAudioUrl`: teacher-uploaded model recording.
- `position`: immutable page order within the homework.

### HomeworkCardSubmission

One student can submit a card more than once. Each submission stores its recording URL, attempt number, and timestamp. The latest attempt is shown as the student's personal recording; earlier attempts remain available for a later teacher-review workflow.

The latest submission may also store teacher review metadata:

- `grade`: `SSS`, `SS`, `S`, `A`, or `B` for new reviews.
- `feedbackAudioUrl`: optional teacher voice feedback.
- `reviewedAt`: timestamp of the latest review.

Legacy `C` and `D` values may remain on old submissions for display, but staff clients must not offer or write them.

Student-facing card state is derived from this data:

- `UNMADE`: no submitted recording.
- `DONE`: a recording exists but has no review.
- `GRADED`: a reviewed recording has a grade or feedback timestamp.

### HomeworkItem

Sentence and word templates and assigned snapshots use `HomeworkItem`, not `PictureBookCard`. Each item has immutable order and template-specific fields:

- sentence read-aloud: `promptText` and `sampleAudioUrl`;
- word read-aloud: `imageUrl`, `answerText`, and `sampleAudioUrl`;
- image match: `imageUrl`, `answerText`, and optional word choices;
- word scramble: `imageUrl` and `answerText`; the student receives only a deterministic shuffled letter list;
- fill blank: `promptText` containing `____`, `imageUrl`, `answerText`, and optional word choices.

### HomeworkItemSubmission

Recording items store append-only audio attempts with the same staff grade and optional voice-feedback review metadata as picture-book cards. A later recording becomes the current `DONE` attempt, leaving earlier reviews intact.

Objective word submissions store the submitted word and a server-calculated correctness flag. Only a correct objective attempt completes and unlocks the next item. Their latest attempts also accept the same human review metadata as recordings; automatic correctness remains independent. The student API never returns an objective item's answer word; it returns configured choices or scrambled letters instead.

### StaffHomeworkSubmissionConversation

Staff review starts with groups by published `Homework` instance so one top-level row represents a class assignment and can show target, in-progress, pending-review, reviewed, and latest-submission summaries. Opening a group lists current `HomeworkOccurrence` conversations for that instance, where one row represents one student completing one scheduled instance of one published homework. Occurrence rows expose student and homework identity, latest submission time, configured question count, submitted count, and latest-attempt reviewed count. Staff may filter by pending/history mode, accessible student or student-name search, published homework, and latest submission time range. Opening an occurrence returns every configured card or item in order, including unsubmitted questions and the latest answer, recording, automatic result, speech assessment, and human review when present.

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

Staff may publish from an existing `templateId` or from inline content. Inline publication atomically creates a `HomeworkTemplate`, copies it into the new `Homework` instance snapshot, and creates all recipient and occurrence records in one SQLite transaction. Publishing from `templateId` copies the current template content into the instance snapshot before recipients and occurrences are created. Any invalid, inactive, non-student, out-of-class recipient, invalid template reference, or invalid content rejects the full request; partial publication is not allowed. Teachers must provide an assigned active `classroomId`; administrators may publish with a nullable classroom.

Picture-book content requires every card to contain an image and a sample audio URL. Uploads are limited to 20 MB and accepted only for supported image and audio media types.

Sentence and word content uses ordered `items`. Item validation is template-specific, and invalid item content rejects the whole transaction together with invalid recipients.

Students read only their own learning aggregate. Administrators can read any active student's aggregate; teachers can read it only for active students in an assigned active classroom. The same scope controls reviews, assessments, and private media.

Example: a weekly instance with `interval: 2` and `occurrenceLimit: 3` begins on 20 July and schedules triggers on 20 July, 3 August, and 17 August for each selected student.
