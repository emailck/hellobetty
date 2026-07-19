# API Service DOX

## Purpose
- Provide authentication, account-management, homework-publication, protected asset-upload, read-aloud, and asynchronous speech-assessment APIs for Hello Betty clients.

## Ownership
- Own HTTP contracts, password hashing, JWT issuance and verification, role checks, SQLite schema initialization, homework plan publication, protected asset upload, student audio submissions, provider-neutral speech-assessment jobs, teacher voice feedback and grades, and API tests.

## Local Contracts
- Normalize account identifiers before uniqueness checks.
- Hash passwords with Node.js `scrypt` and a unique random salt.
- Return generic login errors so callers cannot distinguish unknown accounts from wrong passwords.
- Protect teacher-management routes with both a valid token and an `ADMIN` or `TEACHER` role check.
- API responses must never include `passwordHash`.
- Publish homework, recipients, and occurrence records in one transaction; reject the full publish request when any selected student is invalid or inactive.
- Restrict uploads by media type and file size, and enforce card order server-side for picture-book submissions.
- Serve public homework assets only from `/uploads/assets/*`. Student recordings under `/uploads/submissions/*` require a valid active account; students may fetch only their own recordings while teachers and administrators may fetch review recordings.
- A card's status is `UNMADE`, `DONE`, or `GRADED`, derived from its latest student submission and review metadata.
- Keep `homework_cards` and `homework_card_submissions` exclusive to picture-book read-aloud work; sentence and word templates use `homework_items` and `homework_item_submissions`.
- Generic practice items unlock in position order. Recording items complete after a recording; objective items unlock the next item only after a server-scored correct answer.
- Staff review applies only to the latest picture-book, sentence, or word recording attempt. A later student recording becomes the current unreviewed attempt without rewriting prior submissions.
- Create one speech-assessment job in the same transaction as each assessable recording submission. Each job snapshots its reference text and locale; re-recording creates a separate job.
- Use picture-book `referenceText`, sentence `promptText`, and word-read-aloud `answerText` as the immutable assessment reference; word read-aloud must not require a duplicate prompt.
- Keep provider processing asynchronous and lease-based. Provider absence leaves work queued, retries stop after three attempts, and public responses expose only normalized assessment results.
- The default processing lease is five minutes so provider calls for full-length recordings are not reclaimed prematurely; expired or stale lease tokens must never complete or fail a job.
- Machine assessment must never set or replace staff grades, voice feedback, or review timestamps.
- Record student learning days using the `Asia/Shanghai` calendar. Recording submissions create a check-in even when duration is omitted, and one submitted duration contributes at most 600 voice seconds.
- Homework learning sessions use server start and completion times, credit at most 7200 seconds, and add daily homework time exactly once when completion succeeds.
- Student learning statistics are account-private; staff statistics require an active `STUDENT` target.

## Work Guidance
- Use Fastify, Node.js built-in SQLite for local development, and TypeScript.
- Validate every public request body and query at the route boundary.
- Keep seed credentials configurable through environment variables.

## Verification
- Run `npm run typecheck -w @hellobetty/api`.
- Run `npm test -w @hellobetty/api`.

## Child DOX Index
