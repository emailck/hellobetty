# Homework Library, Assignment Preview, And Reuse

## Outcome
- Homework templates are reusable library entries that own title, instructions, template type, ordered content, and public assets.
- Homework instances own the actual publication: template reference, publisher, classroom, recipients, schedule, lifecycle, occurrences, submissions, and grades.
- Creating new content from the publish flow saves a template and creates its first instance in one transaction.
- Selecting an existing library template creates a new instance for a fresh classroom or student selection and schedule.
- Each instance retains an immutable content snapshot so existing student work cannot change when template editing is introduced later.
- A staff member can tap an instance-history card to open a read-only preview with images and playable sample audio.
- The staff workspace exposes a dedicated homework-library destination. Its list supports add, delete, and tap-to-preview operations.
- Deleting a template removes it from future library selection but never deletes or changes instances previously created from its snapshot.

## Ownership And Trust
- The API owns staff authorization for both template discovery and instance creation.
- Teachers create and delete their own templates, and may list, preview, and reuse templates referenced by homework instances visible through their active classrooms; administrators may manage the complete library.
- Existing public `/uploads/assets/*` URLs may be referenced by multiple immutable instance snapshots without re-uploading media.
- Teachers may create instances only for active assigned classrooms and active students in those classrooms. Administrators retain the existing scoped or unscoped publication choices.
- Legacy homework rows are backfilled into one template per historic homework and linked without changing old instance IDs or submissions.

## Success Criteria
- Allowed staff can list and load authorized templates; unrelated teachers cannot discover or instantiate them.
- New-content publication atomically creates one library template and one linked homework instance.
- Existing-template publication creates a distinct homework instance ID, snapshots its content, and leaves prior instances unchanged.
- History card taps open instance preview while the list action still opens the latest occurrence cycle.
- Images render and sample audio plays from preview.
- The mobile publish page supports `从作业库选择` and `新建作业`; both require a fresh target and schedule.
- The homework library is a browsable list with template type, question count, and creation time; tapping a row opens a complete template preview with images and playable sample audio before `使用此模板` is chosen.
- A template can also be created without publishing an instance from the dedicated library. Deletion uses `homeworks.template_id ON DELETE SET NULL` semantics while existing instance snapshots remain intact.

## Implementation Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | API detail agent | Scoped homework-instance preview contract and tests | Focused test and API typecheck passed |
| completed | API model agent | Template schema, legacy backfill, immutable instance snapshots, and store operations | Store migration, restart, deletion, and snapshot tests passed |
| completed | API route agent | Authorized template list/detail/create/delete and create-instance HTTP contracts | Allowed/denied API tests passed |
| completed | Mobile API agent | Template DTOs and publish API client contracts | API client additions and mobile typecheck passed |
| completed | Mobile UI agent | Dedicated library list/add/delete/preview, library/new publish modes, instance preview, image/audio playback | Mobile typecheck plus Web and physical-device preview passed |
| completed | Verification agent | Authorization, migration, immutability, navigation, and regression review | Findings recorded for integration |
| completed | Main agent | DOX/API docs, integrated test suite, release build, install, and device smoke test | 63 API tests, workspace typecheck/build, release install, and Android media-preview evidence passed |
