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
- Android release-signing material stays outside version control under `.secrets/` or another secure path; production APK builds must never use the debug keystore.
- Staff authority must come from the current database account and classroom membership, not a role claim cached in a client or token.
- Do not imply that placeholder homework data is backed by a finished homework service.
- A published homework instance must retain its selected students and generated trigger occurrences so later submission and grading data has a stable owner.
- Staff homework check-in views use the instance's most recently started occurrence sequence, retain every assigned student, and count a student as checked in only when that occurrence has completed every configured question; partial submissions remain in progress.
- Student speech recordings and teacher voice feedback are private assignment artifacts; access is limited to the assigned student and authorized staff workflows.
- Administrators manage accounts, classroom status, and classroom teacher membership; teachers may create active classrooms for themselves and manage student membership only inside their assigned active classrooms.
- Machine speech assessment is asynchronous reference data; each recording attempt owns its own result, failed jobs may be retried independently, and staff `SSS`/`SS`/`S`/`A`/`B` review remains the final evaluation. Legacy `C`/`D` grades may be displayed read-only but cannot be newly assigned.
- Staff student-homework review starts grouped by published homework instance, then opens the student occurrence list for that instance. Every latest submitted question, including server-scored objective work, remains visible and accepts a `SSS`/`SS`/`S`/`A`/`B` human grade without replacing automatic correctness.
- The mobile teacher workspace starts on `学生作业` and exposes `学生作业`, `已发布作业`, `作业库`, and `班级管理` from the top-left menu on every primary staff page.
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
- `deploy/`: production service and reverse-proxy templates. See `deploy/AGENTS.md`.
- `services/`: backend services and persistence. See `services/AGENTS.md`.
- `docs/`: durable product and architecture decisions. See `docs/AGENTS.md`.
