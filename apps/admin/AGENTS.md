# Admin Application DOX

## Purpose
- Provide teachers and operators with a web console for account, classroom, homework publication, point-policy, and speech-assessment operations.

## Ownership
- Own admin routes, components, browser session handling, account/classroom workspace, scoped student selection, homework publication forms, classroom point-policy management, read-aloud review workflows, speech-assessment operations views, and admin-specific API consumption.

## Local Contracts
- Require an authenticated `ADMIN` or `TEACHER` staff session for every management view; use backend context and scoped endpoints for role boundaries.
- Never expose password hashes, JWT secrets, or private server configuration to the browser.
- Favor scan-friendly tables and restrained status indicators over decorative cards.
- Keep account, homework, and assessment navigation available at both desktop and narrow browser widths.
- Account and classroom mutation controls are administrator-only; teachers may see assigned classroom context as read-only operational context.
- Teacher-published homework must be bound to an assigned active classroom, and selectable students must come from that classroom.
- Administrator-published homework may remain unscoped for legacy or exception workflows, but scoped classroom selection must filter selectable students.
- Homework history must expose classroom, status, completion progress, and lifecycle controls for pause, resume, and confirmed terminal end; ended `ARCHIVED` homework is labeled `已结束` for staff.
- Keep homework publication explicit: selected student count and generated trigger count must be visible before and after publishing.
- Point-policy management must use only server-returned accessible active classroom policies, validate classroom reward values locally before saving, and state that changes affect future point awards only.
- For picture-book read-aloud templates, require reference text, one image, and one sample audio file for every card before publishing.
- For sentence read-aloud, require prompt text and sample audio per item. For word read-aloud, additionally require an image and English answer word.
- For image-match, scramble, and fill-blank word templates, require an image and English answer word per item; fill-blank prompts must contain `____`.
- Review controls must make the submitted recording, selected grade, optional voice feedback, and resulting review status visible together.
- Proxy private student recordings through the authenticated admin media route and forward the server-side bearer token and byte-range request; never expose that token to browser media elements.
- Teacher voice-feedback uploads are private review media and must send upload `purpose=FEEDBACK` and require the upload response to confirm that purpose; homework images and sample audio remain default public publishing assets.
- Show normalized machine speech assessment as read-only review context; poll visible queued or processing results at a restrained interval, and keep the staff A-D grade as the explicit final evaluation.
- The assessment operations view must show provider configured/unconfigured state and normalized queue rows without raw provider payloads; retry is available only for failed assessments.
- Keep picture-book reviews on the read-aloud submission API and sentence/word reviews on the practice-recording submission API; the web UI may combine both queues but must return each review to its owning API.
- Request microphone permission only from an explicit teacher voice-feedback action; stopping a recording must upload it as the pending feedback audio for that submission.
- Staff learning statistics are read-only and scoped to active students; show aggregate check-ins, streak, voice time, homework time, and recent daily rows without exposing recordings or answer content.

## Work Guidance
- Use Next.js App Router and TypeScript.
- Keep access-token storage isolated in the auth client module.
- Follow the root `coco`-derived visual tokens without copying its product-specific content.

## Verification
- Run `npm run typecheck -w @hellobetty/admin`.
- Run `npm run build -w @hellobetty/admin`.

## Child DOX Index
