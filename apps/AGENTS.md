# Applications DOX

## Purpose
- Own user-facing applications for students and administrators.

## Ownership
- This folder owns cross-client experience boundaries.
- Each application owns its local routing, state, styles, and build workflow.

## Local Contracts
- Clients consume the API contract; they do not duplicate password or authorization logic.
- Authentication failures must return users to a clear login state without exposing technical details.

## Work Guidance
- Keep mobile and admin implementations independent unless proven duplication warrants a shared package.

## Verification
- Run the verification commands in the affected application's `AGENTS.md`.

## Child DOX Index
- `admin/`: web management console. See `admin/AGENTS.md`.
- `mobile/`: student homework client. See `mobile/AGENTS.md`.
