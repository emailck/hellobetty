# Homework Template Expansion Plan

## Scope

This increment adds sentence read-aloud and word homework to the existing recurring homework plan model.

- `SENTENCE_READ_ALOUD`: ordered sentences with a model recording. Students record sentence by sentence. Staff can assign A-D and optional voice feedback; a later student recording becomes the current unreviewed attempt.
- `WORD_READ_ALOUD`: ordered image, English word, and model recording cards with the same recording and review lifecycle.
- `WORD_IMAGE_MATCH`: image-to-English-word matching.
- `WORD_SCRAMBLE`: image-led English-word letter ordering.
- `WORD_FILL_BLANK`: a sentence with a blank and the answer word's image; the student chooses the English word.

Objective word exercises are server-scored. Sentence and word recordings remain private submission artifacts and use the same staff-only review authorization as picture-book recordings.

## Data Ownership

Existing `homework_cards` and card submissions continue to own only picture-book read-aloud data. New templates use generic `homework_items` and `homework_item_submissions`, so existing published picture books and their recordings are not migrated or reinterpreted.

Every item has immutable order and template-specific payload fields: prompt text, optional image, optional model audio, answer word, and optional choices. A recording submission is append-only; the latest attempt is the current item state. A review is attached only to that latest attempt, so a child can always re-record after feedback.

## Delivery Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | root | Design, plan, cross-contract integration, docs, final verification | API tests `8/8`; API, admin, and mobile type checks pass |
| completed | backend | SQLite schema, publishing validation, student submission/answer APIs, staff review, focused API tests | `npm test -w @hellobetty/api`; `npm run typecheck -w @hellobetty/api` |
| completed | admin | Web template builder and staff review presentation for new recording types | `npm run typecheck -w @hellobetty/admin`; `npm run build -w @hellobetty/admin` |
| completed | mobile | Teacher template publishing and student sentence/word practice UI | `npm run typecheck -w @hellobetty/mobile`; Expo web bundle HTTP 200 |

## Integration Rules

- Publishing remains transactional: invalid recipients or invalid template content reject the entire plan.
- Sentence recording items require `promptText` and `sampleAudioUrl`. Word read-aloud requires `imageUrl`, `answerText`, and `sampleAudioUrl`, and uses the answer word directly without duplicating it into `promptText`.
- Every word exercise item requires an image and English answer word. Fill-blank additionally requires sentence text containing `____`.
- The API decides answer correctness and sequence eligibility. Clients only present content and submit attempts.
- Staff review accepts one latest recording at a time and cannot review another student's item without staff authorization.
- Picture-book review remains at `/api/admin/read-aloud-submissions`; generic recording review uses `/api/admin/practice-recording-submissions`.
