# Hello Betty DOX

## Purpose
- `hellobetty` is a children's English after-class practice product.
- Students complete homework in the mobile app; teachers can publish and review from both the web console and the mobile app.
- The current milestone owns account registration, login, session, administrator account provisioning, classroom membership, scoped recurring homework operations, picture-book and sentence read-aloud, image-led word practice, asynchronous provider-neutral speech-assessment operations, and the student profile, points, history, and learning-statistics center.

## Ownership
- The root owns workspace configuration, repository-wide commands, product boundaries, and the top-level DOX index.
- Implementation rules live in the closest child `AGENTS.md`.

## Local Contracts
- Keep student-facing flows simple, encouraging, and readable on small screens.
- Keep management workflows quiet, dense, and optimized for repeated operations.
- Use `coco` as the visual reference: near-white surfaces, dark text, grey supporting text, light dividers, capsule inputs, and pale-blue primary accents.
- Account secrets must never be stored or logged in plaintext.
- Staff authority must come from the current database account and classroom membership, not a role claim cached in a client or token.
- Do not imply that placeholder homework data is backed by a finished homework service.
- A published homework plan must retain its selected students and generated trigger instances so later submission and grading data has a stable owner.
- Student speech recordings and teacher voice feedback are private assignment artifacts; access is limited to the assigned student and authorized staff workflows.
- Teachers operate only assigned active classrooms; administrators own account and classroom membership changes.
- Machine speech assessment is asynchronous reference data; each recording attempt owns its own result, failed jobs may be retried independently, and staff A-D review remains the final evaluation.
- Student points are server-owned, append-only learning records; authorized staff may configure future classroom check-in, completion, and streak rewards, clients never submit awards, and repeated activity must not duplicate an award source.

## Work Guidance
- Use npm workspaces and TypeScript across applications and services.
- Prefer direct, milestone-sized implementations over speculative shared abstractions.
- Run the closest documented checks after a change and finish every meaningful change with a DOX pass.

## Verification
- Run `npm run typecheck` for workspace TypeScript checks.
- Run `npm test` for automated tests.
- Run `npm run build` before release or handoff.

## Child DOX Index
- `apps/`: user-facing clients. See `apps/AGENTS.md`.
- `services/`: backend services and persistence. See `services/AGENTS.md`.
- `docs/`: durable product and architecture decisions. See `docs/AGENTS.md`.
