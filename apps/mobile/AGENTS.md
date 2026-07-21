# Mobile Application DOX

## Purpose
- Provide mobile experiences for student English homework practice and teacher publishing and review.

## Ownership
- Own mobile navigation, session persistence, role-based student and teacher screens, and mobile API consumption.

## Local Contracts
- Optimize for touch, short reading spans, and clear single-step actions.
- Persist only the access token and minimal current-user data; never persist passwords.
- Registration and login must remain usable when the keyboard is visible.
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
- Teachers and administrators enter the mobile review workspace, where they can listen to student recordings, set an A-D grade, and record optional voice feedback.
- The mobile staff workspace exposes review, publish, published-history, and classroom-management destinations through stable icon actions that remain usable on phone widths.
- Published homework history paginates every server-authorized plan newest-first, shows classroom, template, recurrence, recipient and completion counts, and lifecycle state, and supports pause, resume, and confirmed terminal end actions. Ended `ARCHIVED` homework is labeled `已结束` for staff.
- Mobile classroom management lets teachers inspect only their assigned classroom members. Administrators may create classrooms, replace active teacher/student memberships, rename, archive, and restore classrooms; all mutations remain server-authorized.
- The mobile review workspace keeps picture-book and sentence/word recording queues separate at the API boundary while presenting the same A-D and optional voice-feedback interaction.
- The mobile staff workspace reads `/api/admin/context`; when speech assessment is unconfigured, it shows a neutral operations message and does not promise future machine scores.
- Teachers and administrators can publish picture-book homework from mobile: choose students, enter required English reference text, select page images and sample audio, set recurrence, and publish the same server-side plan used by the web console.
- Mobile homework publishing supports picture-book, sentence read-aloud, word read-aloud, image match, word scramble, and image-led fill-blank templates.
- Mobile homework publishing reads `/api/admin/classrooms`; teachers must publish to an active assigned classroom and choose only active students in that classroom, while administrators may keep an unscoped authorized-student workflow.
- Administrator unscoped mobile publishing must load the full paginated `STUDENT`-role list before recipient selection; teacher accounts must never appear as candidates.
- Mobile publishing keeps one per-teacher local template draft with form data and uploaded asset URLs. Restore it when the teacher returns, clear it only after successful publication, and provide an item-by-item preview before publishing.
- The mobile staff review context shows normalized machine assessment status and scores alongside student audio while keeping A-D grading and optional voice feedback as independent staff actions.
- Student and staff speech-assessment polling uses a four-second no-overlap refresh and stops after five minutes for unchanged queued or processing assessment ID/status states; reopening a screen, seeing a new assessment ID, or seeing queued/processing status progress starts a new window.

## Work Guidance
- Use Expo, React Native, and TypeScript with React Native Web for browser verification.
- Keep `metro.config.js` rooted at this application so native bundles resolve `index.ts` rather than the workspace root.
- Follow the `coco` visual language: `#fbfbfb` background, dark headings, grey help text, soft dividers, capsule fields, and pale-blue accents.
- Use platform-safe text symbols only when no icon library is installed.
- Request microphone permission only from an explicit student recording or teacher feedback action.
- Request photo-library and document access only from explicit teacher asset-selection actions.

## Verification
- Run `npm run typecheck -w @hellobetty/mobile`.
- Run `npm run web -w @hellobetty/mobile` and inspect the main auth states at a phone viewport.

## Child DOX Index
- `android/`: Expo 生成的 Android 原生工程。见 `android/AGENTS.md`。
