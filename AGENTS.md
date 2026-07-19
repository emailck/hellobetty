# Hello Betty DOX

## Purpose
- `hellobetty` is a children's English after-class practice product.
- Students complete homework in the mobile app; teachers can publish and review from both the web console and the mobile app.
- The current milestone owns account registration, login, session, account management, recurring homework publication, picture-book and sentence read-aloud, image-led word practice, asynchronous provider-neutral speech assessment, and student learning check-in statistics.

## Ownership
- The root owns workspace configuration, repository-wide commands, product boundaries, and the top-level DOX index.
- Implementation rules live in the closest child `AGENTS.md`.

## Local Contracts
- Keep student-facing flows simple, encouraging, and readable on small screens.
- Keep management workflows quiet, dense, and optimized for repeated operations.
- Use `coco` as the visual reference: near-white surfaces, dark text, grey supporting text, light dividers, capsule inputs, and pale-blue primary accents.
- Account secrets must never be stored or logged in plaintext.
- Do not imply that placeholder homework data is backed by a finished homework service.
- A published homework plan must retain its selected students and generated trigger instances so later submission and grading data has a stable owner.
- Student speech recordings are private assignment artifacts; access is limited to the assigned student and authorized staff workflows.
- Machine speech assessment is asynchronous reference data; each recording attempt owns its own result and staff A-D review remains the final evaluation.

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
