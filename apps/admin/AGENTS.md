# Admin Application DOX

## Purpose
- Provide teachers and operators with a web console for account and homework publication management.

## Ownership
- Own admin routes, components, browser session handling, student selection, homework publication forms, read-aloud review workflows, and admin-specific API consumption.

## Local Contracts
- Require an administrator session for every management view.
- Never expose password hashes, JWT secrets, or private server configuration to the browser.
- Favor scan-friendly tables and restrained status indicators over decorative cards.
- Keep homework publication explicit: selected student count and generated trigger count must be visible before and after publishing.
- For picture-book read-aloud templates, require reference text, one image, and one sample audio file for every card before publishing.
- For sentence read-aloud, require prompt text and sample audio per item. For word read-aloud, additionally require an image and English answer word.
- For image-match, scramble, and fill-blank word templates, require an image and English answer word per item; fill-blank prompts must contain `____`.
- Review controls must make the submitted recording, selected grade, optional voice feedback, and resulting review status visible together.
- Proxy private student recordings through the authenticated admin media route and forward the server-side bearer token and byte-range request; never expose that token to browser media elements.
- Show normalized machine speech assessment as read-only review context; poll visible queued or processing results at a restrained interval, and keep the staff A-D grade as the explicit final evaluation.
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
