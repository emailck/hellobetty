# Mobile Application DOX

## Purpose
- Provide mobile experiences for student English homework practice and teacher publishing and review.

## Ownership
- Own mobile navigation, session persistence, role-based student and teacher screens, and mobile API consumption.

## Local Contracts
- Optimize for touch, short reading spans, and clear single-step actions.
- Persist only the access token, minimal current-user data, and the most recently authenticated phone number; never persist passwords. Restore a saved session across app restarts, retain it through transient startup validation failures, and clear it only when the server explicitly reports that authentication is no longer valid.
- Registration and login must remain usable when the keyboard is visible.
- Authentication content stays centered and capped at 440 pixels on wide Web viewports while retaining the normal 20-pixel phone gutters.
- The signed-out Web homepage exposes the current Android APK at `/downloads/hellobetty.apk`; native builds do not show this download action.
- Native application identity uses display name `hellobetty` and Android application ID `com.hellobetty`.
- Picture-book read-aloud assignments are live: reveal one card at a time, unlock the next card only after submission, and allow completed cards to be re-recorded.
- Sentence and word read-aloud assignments use the same sequential recording lifecycle: unlock the next item after submission and allow a graded item to be re-recorded as a new current attempt.
- Student read-aloud views show only completed or failed normalized speech-assessment results, keep queued and processing states visually silent, and poll the visible occurrence while an assessment is queued or processing; machine results never replace the staff grade.
- Image match, word scramble, and image-led fill-blank exercises are sequential and server-scored; the client presents server-provided choices or letters and never decides correctness.
- The student `我的` center owns profile editing, learning statistics, points display, seven-day voice/homework charting, and homework history tabs.
- Student profile editing may update display name, English name, school, grade, and learning goal only; phone remains read-only and successful display-name saves must update the persisted current session.
- Student learning and points views render server-owned totals and read-only events, including optional classroom source names; the client never calculates, configures, or submits point awards.
- Student homework history reads the server-owned paginated history newest-first and shows lifecycle, completion progress, and staff-review progress without reopening paused or ended work; terminal `ARCHIVED` homework is labeled `已封存` for students.
- The student homework list renders one row per due occurrence from the latest five `Asia/Shanghai` calendar days, including repeated occurrences with identical content; it defaults to newest dispatch first and lets students sort by dispatch date or by `未查看`, `未完成`, `已完成`, `老师已批改` status, while older occurrences remain in homework history. Each row shows the `scheduledAt` date without a dispatch suffix at the lower right and shows bold completed/total progress above the status with visible separation; status comes from server-owned view sessions, completion counts, and latest-submission review counts.
- Student homework detail modals stay centered within the safe area, preserve image aspect ratios, and expose pressed states for interactive homework controls.
- After a recording submission, the mobile conversation exposes the next unlocked item; after the final item it immediately offers `下一个作业` for the next later incomplete occurrence returned by the authenticated student homework lists, with the same destination shown as a conversation homework card.
- Student recording submissions include the rounded recording duration captured immediately before stopping the recorder; statistics failures must never block audio submission.
- Entering a reading or practice occurrence starts a server homework session. Leaving, backgrounding, or unloading completes it, and start/complete operations must remain serialized across lifecycle races.
- A card modal presents the page image, English reference text when available, sample audio, personal audio when present, teacher feedback audio when present, grade, and the current completion status.
- Send the current bearer token when playing private `/uploads/submissions/*` recording URLs; public homework assets remain token-independent.
- Teacher voice feedback uploads declare `purpose=FEEDBACK` and must be treated as private review artifacts rather than public homework assets.
- Teachers and administrators enter the mobile review workspace through homework-occurrence cards modeled after the student homework list. Each card shows student, published homework, latest submission time, submitted progress, and review progress; filters cover student, homework, and submission date range. Student and homework filters are typeahead inputs: case-insensitive partial terms narrow authorized options, an exact or sole match selects automatically, and ambiguous matches require an explicit option selection.
- The mobile staff workspace defaults to `学生作业` and exposes `学生作业`, `已发布作业`, `作业库`, and `班级管理` through a top-left hamburger menu on every primary staff page; publish remains a direct page command and logout is separated at the bottom of the menu.
- Mobile staff review is grouped by published homework instance first, defaults to pending review, supports direct student-name search, then opens a student occurrence list before per-question review.
- Published homework history paginates every server-authorized plan newest-first, supports name/status/classroom filtering, shows classroom, template, recurrence, recipient and completion counts, and lifecycle state, and supports preview, latest-cycle view, reuse, pause, resume, and confirmed terminal end actions. Ended `ARCHIVED` homework is labeled `已结束` for staff.
- Each mobile published-homework card opens the server-owned latest started cycle and shows every assigned student as `已打卡`, `进行中`, or `未开始`; only full occurrence completion is a check-in.
- Mobile classroom management lets teachers create and edit their assigned active classrooms' student memberships while keeping their own teacher identity fixed. Administrators may create classrooms, replace active teacher/student memberships, rename, archive, and restore classrooms; all mutations remain server-authorized.
- Opening a mobile review card shows every configured question in a conversation flow with its latest answer or recording, automatic correctness or speech assessment, submission time, SSS/SS/S/A/B grade, and optional voice-feedback action. Unsubmitted questions remain visible but cannot be reviewed.
- The mobile staff workspace reads `/api/admin/context`; when speech assessment is unconfigured, it shows a neutral operations message and does not promise future machine scores.
- Teachers and administrators can publish picture-book homework from mobile: choose students, enter required English reference text, select page images and sample audio, set recurrence, and publish the same server-side plan used by the web console.
- Mobile homework publishing supports picture-book, sentence read-aloud, word read-aloud, image match, word scramble, and image-led fill-blank templates.
- Mobile teacher publishing treats reusable homework content as `作业库` templates and each assigned run as a published homework instance; creating new content from the publish flow saves the content to `作业库` while publishing an instance.
- The mobile staff workspace exposes a `作业库` entry for listing, adding, deleting owned templates, previewing, and reusing authorized homework templates; template reuse must ask for a fresh class/student/schedule selection instead of carrying old recipients. Legacy `STANDARD` templates with no content remain preview-only.
- Mobile publishing sample audio may come from a file upload or an explicit live-recording action; each item exposes playback and allows the teacher to upload or record a replacement.
- Mobile homework publishing reads `/api/admin/classrooms`; teachers must publish to an active assigned classroom and choose only active students in that classroom, while administrators may keep an unscoped authorized-student workflow.
- Administrator unscoped mobile publishing must load the full paginated `STUDENT`-role list before recipient selection; teacher accounts must never appear as candidates.
- Mobile publishing keeps one per-teacher local template draft with form data, first-start time, and durable app-local copies of selected or recorded assets. Selection and recording must update item previews immediately, support image replacement plus audio playback/replacement/re-recording, and must not upload until the teacher completes validation and confirms the final publication summary. Restore the draft when the teacher returns and clear its data and local assets only after successful publication.
- The mobile staff review context shows normalized machine assessment status and scores alongside student audio while keeping SSS/SS/S/A/B grading and optional voice feedback as independent staff actions.
- Student and staff speech-assessment polling uses a four-second no-overlap refresh and stops after five minutes for unchanged queued or processing assessment ID/status states; reopening a screen, seeing a new assessment ID, or seeing queued/processing status progress starts a new window.
- Native JavaScript hot updates remain disabled until an Expo Updates project ID, update URL, runtime-version policy, and release credentials are explicitly configured.

## Work Guidance
- Use Expo, React Native, and TypeScript with React Native Web for browser verification.
- Keep `metro.config.js` rooted at this application so native bundles resolve `index.ts` rather than the workspace root.
- Follow the `coco` visual language: `#fbfbfb` background, dark headings, grey help text, soft dividers, capsule fields, and pale-blue accents.
- Use platform-safe text symbols only when no icon library is installed.
- Request microphone permission only from an explicit student recording, teacher sample-audio recording, or teacher feedback action.
- Request photo-library and document access only from explicit teacher asset-selection actions.

## Verification
- Run `npm run typecheck -w @hellobetty/mobile`.
- Run `npm run web -w @hellobetty/mobile` and inspect the main auth states at a phone viewport.

## Child DOX Index
- `android/`: Expo 生成的 Android 原生工程。见 `android/AGENTS.md`。
