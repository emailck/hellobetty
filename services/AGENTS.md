# Services DOX

## Purpose
- Own server-side business rules, authorization, and persistence.

## Ownership
- This folder defines service boundaries and operational expectations.
- Individual services own their routes, data models, and tests.

## Local Contracts
- Server authorization is authoritative; client role claims are never trusted on their own.
- Persist timestamps in UTC and return ISO-8601 strings at API boundaries.

## Work Guidance
- Keep services independently testable and avoid coupling them to client source trees.

## Verification
- Run the verification commands in the affected service's `AGENTS.md`.

## Child DOX Index
- `api/`: account and application API. See `api/AGENTS.md`.
