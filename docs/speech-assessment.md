# Asynchronous Speech Assessment Plan

## Scope

Hello Betty will assess submitted picture-book, sentence, and word recordings after the student upload succeeds. Assessment is asynchronous and provider-neutral. Students may submit another attempt at any time, and staff retain the final A-D grade and optional voice feedback authority.

This increment does not select or integrate a commercial assessment provider. A configured provider processes queued work; without one, submissions remain usable and their assessment jobs remain durably queued.

## Ownership And Trust Boundaries

- A speech assessment belongs to one immutable recording submission, never directly to a card, item, occurrence, or student.
- Every re-recording creates a new submission and a new assessment. Earlier recordings and results remain historical artifacts.
- The API owns assessment state, normalized scores, retries, and authorization. Clients never call a provider with permanent credentials.
- Provider credentials and raw responses stay server-side. Student and staff APIs return only normalized results.
- Student recording files are not public static assets. The assigned student or active staff must authenticate to stream them, while the server-side worker resolves the private file directly from storage.
- Machine assessment does not set or replace the staff `grade`, `feedbackAudioUrl`, or `reviewedAt` fields.
- Students can read assessments only through their assigned occurrence. Active teachers and administrators can read them only through existing staff review queues.

## Reference Text

- Sentence read-aloud uses the item's `promptText`.
- Word read-aloud uses the item's `answerText`.
- Newly published picture-book cards require `referenceText` in addition to an image and sample audio.
- Existing picture-book cards are migrated with a nullable reference. They remain recordable but do not enqueue an assessment when no reference exists.
- Each assessment snapshots its reference text and locale so a later content edit cannot reinterpret an existing recording.

## Lifecycle

Assessment status is one of:

- `QUEUED`: durably waiting for a configured worker.
- `PROCESSING`: claimed by one worker under a time-bounded lease.
- `COMPLETED`: normalized scores were stored successfully.
- `FAILED`: retry limits were exhausted; the recording and staff review remain available.

Recording submission and `QUEUED` assessment creation occur in the same SQLite transaction. A worker claims the oldest eligible job atomically, retries transient failures with bounded backoff, and recovers expired `PROCESSING` leases. Provider absence is not a failure and leaves work queued.

## Provider Contract

The server-side provider interface accepts:

- assessment ID and submission ID;
- absolute private audio path;
- reference text snapshot;
- locale;
- recording duration when supplied.

It returns provider-independent scores on a 0-100 scale:

- overall, accuracy, fluency, completeness, and prosody where available;
- ordered word results with optional error type;
- ordered phoneme results with optional accuracy.

Only the adapter knows provider-specific authentication, transport, field names, and raw payload. Missing optional metrics remain `null`; adapters must not synthesize unsupported scores.

## Persistence And API Contract

`speech_assessments` stores submission ownership, source kind, state, provider identifier, reference snapshot, locale, normalized scores, word results, private raw payload, retry metadata, lease timestamps, and completion/error data.

Student occurrence responses expose the latest submission's normalized `assessment`. Staff recording queues expose the same normalized object alongside the existing human review fields. Raw provider payloads, lease data, and internal error detail are never public.

Clients poll only while a visible latest assessment is `QUEUED` or `PROCESSING`. A newer recording immediately becomes the visible current attempt and may therefore replace a completed result with a new pending result. `FAILED` presents a neutral retry-later state and never becomes a failing grade.

## Delivery Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | root | Architecture, ownership, migration, public contract, and implementation plan | Re-read against recording and review call paths |
| completed | backend | Schema upgrade, provider interface, durable worker, submission enqueue, normalized student/staff responses, focused tests | API typecheck and 20 API tests pass |
| completed | mobile | Picture-book reference publishing, assessment types, student pending/result polling, staff result context | Mobile typecheck and Expo web export pass |
| completed | admin | Picture-book reference publishing and machine assessment context in the review queue | Admin typecheck and production build pass |
| completed | root | Integration review, legacy migration check, private-media authorization proof, docs and final workspace verification | Workspace typecheck, 20 API tests, production build, and Expo web export pass |

## Acceptance Criteria

- A recording upload succeeds without waiting for provider processing.
- One queued assessment is created for every assessable recording attempt.
- A provider adapter can complete a job without changing HTTP routes or domain ownership.
- Re-recording creates a new pending current assessment without deleting the earlier result.
- Students cannot read another student's result, and staff review remains role-protected.
- A teacher can grade before or after machine completion; machine completion never changes that grade.
- Existing accounts, homework, recordings, and reviews survive the additive schema upgrade.
