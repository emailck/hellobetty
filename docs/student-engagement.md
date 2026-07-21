# Student Engagement Milestone Plan

## Scope

This milestone turns the existing student profile into a personal settings and learning center. It adds a server-owned points ledger, teacher-configurable classroom reward policies, editable non-sensitive profile fields, complete homework history, and seven-day learning visualizations in the mobile client.

Manual point balance overrides, point redemption, leaderboards, avatars, social ranking, and parent contact data remain outside this milestone.

## Assumptions And Ownership

- Points are server-owned accounting data. Clients render balances and event history but never calculate or submit awards.
- Each active classroom owns one reward policy. The defaults are 2 points for the first Asia/Shanghai learning day, 10 points for the first homework completion, and no streak milestones.
- Teachers set policies for active classrooms they are assigned to; administrators retain operational access to any active classroom policy.
- The classroom of the activity's homework selects the policy. Unscoped administrator homework keeps the 2/10 defaults and has no streak bonus.
- The first learning activity on a Shanghai day creates one daily award and at most one matching streak-milestone award. The first transition of an occurrence to `COMPLETED` creates one completion award.
- A policy may contain up to 20 unique streak milestones from 2 to 365 days. Reaching a configured milestone awards its positive point value once; skipped and non-matching streak lengths do not award it.
- Re-recording, repeated answers, repeated session completion, retries, and staff re-review do not create duplicate points.
- Policy changes apply only to future events. The append-only ledger never recalculates or rewrites points already earned.
- Each 100 accumulated points advances one growth level; points are never reduced in this milestone.
- A student may edit display name, English name, school name, grade level, and a short learning goal. Phone, role, status, classroom membership, and account credentials are not editable here.
- Homework history belongs to the authenticated student and includes assigned occurrences even when the parent homework is paused or ended; ended `ARCHIVED` rows are displayed as `已封存`.

## Data And API Contract

- Add `student_profiles`, keyed by `student_id`, for optional English name, school name, grade level, learning goal, and update timestamp.
- Add `student_point_events`, with an idempotent `(student_id, event_type, source_id)` key. Positive rows are append-only student-visible events; a zero-point base reward stores an internal claim that is excluded from balances and public event lists so later policy changes or restarts cannot back-award it.
- Add one point policy and normalized streak milestones per classroom. Missing policies resolve to the documented defaults without requiring seed rows.
- On upgrade, backfill one daily event for each existing learning day and one completion event for each existing completed occurrence through the same idempotent keys.
- `GET /api/admin/point-policies` returns only classroom policies visible to the current staff account.
- `PUT /api/admin/classrooms/:classroomId/point-policy` validates and replaces the classroom base values and complete streak-milestone list atomically.
- `GET /api/student/profile` returns the public account, optional profile fields, points balance/level progress, and recent point events.
- `PATCH /api/student/profile` validates and updates only the allowed profile fields and returns the same current profile shape.
- `GET /api/student/homework-history?page=&pageSize=` returns paginated occurrence history with template, schedule, parent lifecycle, completion progress, and staff-review progress.
- `GET /api/student/learning-stats` keeps its existing summary/check-in data and adds seven Asia/Shanghai calendar days, including zero-activity days, for charting.

## User Experience

- Rename the student profile destination to `我的` and provide segmented `资料`, `学习`, and `历史` views.
- Keep the phone read-only and make save state and validation visible beside the editable profile form.
- Show total points, current level, progress to the next level, and recent point reasons without implying cash value.
- Add a quiet staff `积分规则` workspace with a classroom selector, numeric base rewards, and editable streak milestones. It must show that changes affect future awards only.
- Visualize the latest seven days with stable voice/homework duration bars and accessible text values.
- Show homework history newest first with completion fraction, lifecycle, and human-review progress.

## Delivery Plan

| Status | Owner | Scope | Verification |
| --- | --- | --- | --- |
| completed | root | Architecture, trust boundaries, integration, migration audit, docs, and runtime verification | Workspace typecheck/test/build; Web phone viewport and Android emulator smoke |
| completed | backend | Profile/points schema and APIs, configurable policies, idempotent awards, history query, seven-day trend, focused tests | API suite: 8 files and 35 tests; legacy migration, restart claims, rule scope, milestones, and idempotency covered |
| completed | admin | Classroom point-policy management for authorized staff | Admin typecheck/build; teacher policy save and narrow-browser smoke |
| completed | mobile | Settings center, profile editing, points presentation, seven-day chart, homework history, reward labels | Mobile typecheck/export; Web and Android profile, learning, and history smoke |
| completed | review | Correctness, privacy, duplicate-award, responsive layout, and regression review | High findings fixed; final read-only review found no blockers |

## Acceptance Criteria

- A student can update allowed profile fields and retrieve them after a new session; another account cannot read or modify them.
- The first activity of a Shanghai day and first occurrence completion create the documented awards exactly once.
- Re-submission and repeated session completion leave the point balance unchanged.
- A teacher cannot read or update another classroom's policy, and one policy replacement cannot partially apply.
- Future check-in, completion, and configured streak events snapshot the classroom policy's value while past events remain unchanged.
- Paused and sealed assigned homework remains visible in personal history without becoming actionable.
- The learning view always renders seven dated values and distinguishes speaking from homework duration.
- Existing accounts and pre-milestone databases migrate without losing users, homework, submissions, reviews, or statistics.
