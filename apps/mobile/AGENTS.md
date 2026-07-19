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
- Student read-aloud views show the latest submission's normalized asynchronous speech assessment and poll the visible occurrence only while that assessment is queued or processing; machine results never replace the staff grade.
- Image match, word scramble, and image-led fill-blank exercises are sequential and server-scored; the client presents server-provided choices or letters and never decides correctness.
- The student profile reads server-owned learning statistics and shows total check-ins, current streak, accumulated voice/homework duration, and daily check-in records.
- Student recording submissions include the rounded recording duration captured immediately before stopping the recorder; statistics failures must never block audio submission.
- Entering a reading or practice occurrence starts a server homework session. Leaving, backgrounding, or unloading completes it, and start/complete operations must remain serialized across lifecycle races.
- A card modal presents the page image, English reference text when available, sample audio, personal audio when present, teacher feedback audio when present, grade, and the current completion status.
- Send the current bearer token when playing private `/uploads/submissions/*` recording URLs; public homework assets remain token-independent.
- Teachers and administrators enter the mobile review workspace, where they can listen to student recordings, set an A-D grade, and record optional voice feedback.
- The mobile review workspace keeps picture-book and sentence/word recording queues separate at the API boundary while presenting the same A-D and optional voice-feedback interaction.
- Teachers and administrators can publish picture-book homework from mobile: choose students, enter required English reference text, select page images and sample audio, set recurrence, and publish the same server-side plan used by the web console.
- Mobile homework publishing supports picture-book, sentence read-aloud, word read-aloud, image match, word scramble, and image-led fill-blank templates.
- Mobile publishing keeps one per-teacher local template draft with form data and uploaded asset URLs. Restore it when the teacher returns, clear it only after successful publication, and provide an item-by-item preview before publishing.
- The mobile staff review context shows normalized machine assessment status and scores alongside student audio while keeping A-D grading and optional voice feedback as independent staff actions.

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
