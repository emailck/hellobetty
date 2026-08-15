# Teacher Workspace Navigation And Classroom Editing

## Outcome
- The teacher workspace uses one top-left menu button instead of a row of feature icons.
- The menu contains `学生作业`, `已发布作业`, `作业库`, and `班级管理`; each item opens its own page, every primary page keeps the menu in the top-left corner, and `学生作业` is the default.
- `学生作业` defaults to submissions that still need review, offers an explicit history view, and supports server-side partial student-name search.
- The student-homework landing page groups work by published homework instance. Each group summarizes pending review occurrences, submitted occurrences, assigned students, question progress, and latest submission time; opening it lists the student occurrences for that instance before opening question-level review.
- New human reviews use the ordered grade scale `SSS`, `SS`, `S`, `A`, `B`. Existing legacy `C` or `D` values remain readable historical data but cannot be submitted again.
- Publishing remains a clear add action on the student-homework page and from a homework-library template preview.
- Teachers can create classrooms that automatically assign themselves as teacher, and can replace the student membership of active classrooms they teach.
- Published-homework history supports server-side title, classroom, and lifecycle filters while keeping preview, latest-cycle, lifecycle, and reuse commands distinct.
- The homework library supports server-side title and template-type filters and shows creator, usage count, and last-use context.
- New and template-based publication require an explicit first start time and a final confirmation summary before the request is sent.

## Authorization
- Administrators retain full classroom creation, membership, lifecycle, and account permissions.
- Teachers may create a classroom with themselves as its teacher and active student accounts as members.
- Teachers may rename and replace students only for active classrooms where they are currently assigned; they may not change teacher membership, archive or restore classrooms, or manage accounts.
- A staff-only classroom-candidate endpoint returns minimal identity fields for active student accounts so a teacher can populate a new classroom. It never returns account secrets.
- Review search and status filtering remain constrained by the existing database-derived homework/classroom scope.

## Review Semantics
- `待批改` includes an occurrence when at least one latest submission exists and `reviewedCount < submittedCount`.
- `历史` lists all accessible submitted occurrences newest-first, including reviewed and still-pending rows.
- `studentSearch` is trimmed, bounded, case-insensitive partial matching on the student's display name and composes with existing student, homework, and date filters.
- `待批改` group membership requires at least one matching occurrence with an unreviewed latest submission. Its summary retains all matching submitted occurrences for the published instance, while the opened occurrence list applies the pending filter.

## Success Criteria
- At 320px and the physical phone width, the header menu button, title, and page commands remain visible without overlap.
- Opening and closing the menu preserves the selected destination; initial login lands on `学生作业` with `待批改` active.
- Switching to `历史` reloads all accessible submission conversations; name search returns only matching authorized students.
- The first student-homework page renders one row per published homework instance rather than one row per student occurrence.
- Question review accepts only `SSS`, `SS`, `S`, `A`, or `B`, and completing a review can advance to the next pending occurrence in the opened instance.
- A teacher can create a classroom, select active students, then edit that classroom's students.
- A teacher receives `403` or `404` when attempting to edit a classroom they do not teach, change teacher membership, or change classroom lifecycle.
- Published-history and library filters operate across the full authorized result set, not only the currently loaded page.
- Publication confirmation shows template/content, classroom, selected-student count, first start time, recurrence, and total generated occurrences.

## Implementation Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | API agent | Published-instance review groups, review/name filters, five-level grading, classroom candidates, teacher create/edit authorization, history/library filters | API typecheck and 63-test suite passed; mixed reviewed/pending summary test added |
| completed | Mobile API agent | Grouped review, five-level grading, list-filter, and classroom-management client contracts | API client source typecheck passed |
| completed | Mobile UI agent | Menu navigation, grouped pending/history/search review flow, history/library filters, publish confirmation/time, teacher classroom editor | Mobile typecheck and 320px responsive interaction passed |
| completed | Admin agent | Five-level grading compatibility in the web console | Admin typecheck passed |
| completed | Docs agent | API, product, model, grade, and DOX contract updates | Diff check and contract reread passed |
| completed | Review agent | Integrated authorization, grouping, navigation, and responsive review | Findings resolved for stale template detail, complete group metrics, archived-class filtering, and narrow-history actions |
| completed | Main agent | Full regression, build, install, and physical-device workflow | Workspace typecheck/build, 63 API tests, release install, menu/group/media device screenshots passed |
