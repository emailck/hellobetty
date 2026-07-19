# Student Homework Flow Plan

## Scope

This increment improves the student homework conversation after an item submission. It centers homework modals, gives interactive controls visible press feedback, sizes homework images without cropping, and provides a continuous next-step path.

## Interaction Contract

- A homework detail modal is centered in the viewport, constrained to the safe area, and scrolls internally when its content is taller than the available space.
- Homework images preserve their source aspect ratio with `contain` rendering and bounded responsive dimensions in both conversation cards and detail modals.
- Homework cards, modal controls, answer controls, and next-step actions show a pressed state without changing their stable layout dimensions.
- After a successful recording submission, the completed item remains visible in the modal long enough to expose the next action.
- If the same occurrence has another unlocked item, `下一个练习` opens it and the conversation already contains its corresponding item card.
- If the occurrence is complete, `下一个作业` immediately opens the next incomplete scheduled occurrence across picture-book and practice templates. The destination is prefetched while the current occurrence is open and rendered as a homework card at the end of the current conversation.
- Homework ordering is ascending by `scheduledAt`, then stable by occurrence ID. Navigation never wraps to an earlier occurrence and never selects an already completed occurrence.
- If no later incomplete occurrence exists, the existing completion state remains visible and no false next action is shown.

## Ownership And Trust Boundaries

- The mobile client derives navigation only from authenticated student occurrence summaries returned by the existing student APIs.
- The API remains authoritative for visibility, schedule, sequence locks, completion, and submission state. Client navigation never unlocks or completes work.
- Point-award claims must persist independently from visible positive events so a zero-point policy cannot be backfilled with default points after a restart.

## Delivery Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | root | Contract, integration, DOX closeout, Web and Android runtime verification | Workspace typecheck/test/build; centered modal and next navigation smoke on Web and Android |
| completed | mobile | Responsive modal media, press feedback, same-occurrence and next-occurrence navigation, conversation homework card | Mobile typecheck and Expo export; Web and Android smoke |
| completed | backend | Persist zero-point award claims across restart and block future picture-book detail reads | Engagement regression tests and full 35-test API suite |
| completed | review | Read-only correctness and regression review | Previous findings fixed; no unresolved high-severity findings |

## Acceptance Criteria

- The modal is visually centered on a phone viewport and remains usable for both image and text-only work.
- Pressing a homework card or modal control produces an observable pressed state without shifting surrounding content.
- A portrait, landscape, or square homework image is fully visible without cropping or overflow.
- Submitting a non-final recording exposes and opens the next unlocked item; its card is present in the conversation.
- Completing the final item exposes the next incomplete occurrence as both a button destination and conversation card when one exists.
- Zero-point check-in and completion claims remain zero after recreating the account store.
- A future picture-book occurrence cannot be read or submitted before `scheduledAt`.
