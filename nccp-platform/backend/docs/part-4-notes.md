# Part 4 notes: enrolments, LMS, sessions, attendance, assessments

Status: **written, unit-tested where possible, never run against PostgreSQL or a real Fastify instance.** See "What was and was not executed" at the bottom.

## What is new

| Area | Files |
|---|---|
| Shared access helpers | `src/modules/learning/access.ts` (`loadBatch` scoped + lockable, `batchVisibilitySql`, `seatsTaken`, `recomputeProgress`, `auditBase`) |
| Enrolments | `enrolments.state.ts`, `enrolments.service.ts` |
| LMS (courses, modules, lessons, resources, progress) | `lms.service.ts` |
| Class sessions and timetable | `sessions.state.ts`, `sessions.service.ts` |
| Attendance | `attendance.rules.ts`, `attendance.service.ts` |
| Assessments | `assessments.rules.ts`, `assessments.service.ts` |
| Routes and wiring | `src/modules/learning/routes.ts`, `src/routes/v1.ts` |
| Permissions | 4 new codes in `src/auth/permissions.ts` + **migration 0007** (next free migration is **0008**) |
| Helper change | `buildUpdate` got `softDeleted: false` for tables with no `deleted_at` (class_sessions, attendance, assessment_results). Default behaviour unchanged. |
| Test change | `test/permissions.test.ts` now compares the in-code catalogue with 0006 **plus** 0007 |

New permissions: `enrolments:apply_own` (trainee), `lessons:progress_own` (trainee), `classes:read` (institution admin, trainer, trainee), `classes:write` (institution admin, trainer). Super admin has all.

## Endpoints (all under `/api/v1`)

Enrolments
- `GET /enrolments` (filters `batchId, traineeId, status, q, institutionId`; sort `enrolled_at, trainee, created_at`), `GET /enrolments/:id`
- `POST /enrolments` body `{ batchId, traineeId }` (institution admin / super admin, status `enrolled`)
- `POST /enrolments/apply` body `{ batchId }` (trainee, status `applied`)
- `POST /enrolments/:id/status` body `{ action: approve|reject|start|complete|drop|withdraw, reason?, finalScore? }`

LMS
- `GET|POST /courses`, `GET|PATCH|DELETE /courses/:id`, `GET /courses/:id/outline` (modules and lessons in order; trainees also get their own progress)
- `POST /modules`, `PATCH|DELETE /modules/:id`
- `POST /lessons`, `GET|PATCH|DELETE /lessons/:id`, `PUT /lessons/:id/progress` body `{ status: in_progress|completed }` (trainee)
- `GET /resources?courseId|lessonId|batchId`, `POST /resources`, `GET|PATCH|DELETE /resources/:id`

Sessions
- `GET|POST /sessions`, `GET|PATCH|DELETE /sessions/:id`, `POST /sessions/:id/status` body `{ status: live|completed|cancelled }`
- `GET /timetable?from&to[&batchId&trainerId&institutionId]` (max 93 days, max 500 rows, `truncated` flag)

Attendance
- `GET /attendance` (filters `sessionId, batchId, traineeId, status, from, to`), `GET /attendance/summary?batchId[&traineeId]`
- `PUT /attendance/sessions/:id` body `{ records: [{ traineeId, status, method?, checkedInAt?, notes? }] }` (trainer of that batch, or super admin; up to 500, re-sending a trainee corrects the record)
- `POST /attendance/sessions/:id/check-in` body `{ method? }` (trainee)

Assessments
- `GET|POST /assessments`, `GET|PATCH|DELETE /assessments/:id`, `POST /assessments/:id/status` body `{ status: published|closed }`
- `POST /assessments/:id/attempts` body `{ answers: { [questionId]: string } }` (trainee)
- `GET /assessments/:id/results`, `POST /assessments/:id/results/:resultId/grade` body `{ score, feedback? }` (needs `If-Match` = result version)
- `GET /assessments/summary?batchId[&traineeId]`: per seat holder, number of published/closed assessments and how many they have passed (feeds Part 5)

As before: lists take `limit`, `cursor`, `sort`; PATCH needs `If-Match`; out-of-scope records are 404.

## Rules as built

**Enrolment**
- Seats are counted with `CAPACITY_STATUSES` (enrolled, in_progress, completed) under `SELECT ... FOR UPDATE` on the batch row, the same lock batch edits take. `applied` does not take a seat; `approve` re-checks capacity.
- Admin enrol: batch must be planned or ongoing, institution active, trainee active and in the batch's institution. Trainee apply: planned batches of their own institution only (anything else is 404).
- `dropped` and `rejected` rows are reused on re-enrolment (UNIQUE(batch_id, trainee_id)).
- Transitions: approve applied->enrolled; reject applied->rejected (reason required, stored in audit only); start enrolled->in_progress; complete enrolled|in_progress->completed (batch must be ongoing/completed; optional `finalScore` 0-100); drop applied|enrolled|in_progress->dropped (staff); withdraw applied|enrolled->dropped (the trainee's own row only).
- `progress_percent` = completed lessons / lessons in **published** courses of the batch's programme, recalculated in the same transaction whenever progress, lessons, modules or course status change. First completed lesson moves `enrolled` to `in_progress`.

**LMS**
- Content hangs off programmes. National programme content (institution NULL) is readable by every institution's admins and trainers, **writable by super admin only**. Institution content is writable by that institution's admins and trainers (any trainer of the institution, not only trainers with a batch in the programme).
- Trainees see only `published` courses of programmes where they hold a seat; drafts are 404.
- Resources are **external links only** (http/https). File-backed resources arrive with Part 7 (`file_id` exists in the table but is not exposed). A resource points at exactly one of course, lesson or batch.
- Deleting a course or module soft-deletes its children.

**Sessions**
- Created by super admin, institution admin, or the batch's own trainer; batch must be planned or ongoing. Online sessions need `joinUrl`. Length at most 12 hours.
- **Overlap rule (decision, answers the Part 3 open question):** two non-cancelled sessions may not overlap for the same batch or the same trainer across batches (409 with the clashing session). Serialised per trainer with an advisory lock. Not enforced: session dates falling inside the batch's start/end dates, and changing a batch's trainer (`PUT /batches/:id/trainer`) does not re-check existing sessions.
- Trainer availability stays the free-form `availability` field on the trainer (Part 3, `PATCH /trainers/me`); nothing enforces it, the overlap rule is the only enforcement.
- Sessions with attendance cannot be deleted, only cancelled.

**Attendance**
- Only the batch's trainer (or super admin) marks. Institution admins have read access only (they do not hold `attendance:mark`). Trainees must hold a seat.
- **QR / fingerprint decision (default applied):** only the method and result are recorded, no signing and no hardware. A trainee may self check-in with `manual`, `qr` or `online` (the claim is unverified); `fingerprint` can only be recorded by a trainer. Self check-in opens 15 minutes before the start, closes at the end, counts as `late` more than 15 minutes after the start, only for `enrolled`/`in_progress` enrolments, and never overwrites a trainer's record.
- **Attendance percentage** (for Part 5): counted sessions = non-cancelled sessions that are completed or already ended. Excused sessions leave the denominator, late counts as attended, a counted session with no record counts as absent. `null` when nothing is countable yet.

**Assessments**
- Questions are `mcq` (options + `correctOptionId`) or `text`; marks must add up to `totalMarks`. If every question is mcq the attempt is graded immediately; otherwise it waits for manual grading (`POST .../grade`, regrading allowed, version-guarded).
- Trainees never receive `correctOptionId`, never see answers of others, and see score/pass/feedback only once graded.
- Draft: fully editable. Published: only `opensAt`/`dueAt`. Closed: read-only. Quizzes and final exams need questions to be published. Attempt limits are serialised per trainee+assessment with an advisory lock (unique constraint as backstop). Deleting is refused once submissions exist.

## Decisions taken (defaults; tell me if you disagree)
1. Trainer overlap check is **on** (sessions only, see above).
2. Institution admins cannot mark attendance; add `attendance:mark` to their role (code + a new migration 0008) if you want corrections by admins.
3. Any trainer of an institution can write that institution's course content.
4. Resource files wait for Part 7; links only for now.
5. QR/fingerprint: record only.
6. Lesson progress is not audited (high volume, own data); everything else that mutates is.

## Tests
- Unit (run here, pass): `test/part4-rules.test.ts` (20 tests: enrolment state machine exhaustively, session rules, self check-in window, attendance percentage, question/answer validation, grading, answer-key stripping, attempt limits, `buildUpdate` softDeleted) and the updated `test/permissions.test.ts`.
- Integration (`test/integration/part4.learning.test.ts`, gated by `RUN_DB_TESTS=1`, **not run**): six concurrent enrolments into a batch of three give exactly three seats; enrolment scoping (other institution, trainer, trainee); apply/approve/reject/withdraw workflow; suspended institution refuses enrolment; LMS ownership, draft hiding, progress percent and status move; session overlap, scope, concurrent PATCH gives exactly one 200 and the rest 412, timetable limits; attendance marking, uniqueness, self check-in window, scoping, summary numbers; assessment answer-key hiding, auto grading, attempt limit under parallel requests, manual grading with stale version 412, result scoping.

## What was and was not executed

Executed in the build sandbox (no network, no PostgreSQL, no installed dependencies):
- 85 pure unit tests pass (`tsx --test test/*.test.ts`). `test/config.test.ts` (7 tests) still cannot load because `zod` is not installed, same as Parts 2 and 3.
- `npm run lint:sql` passes (7 migration files, 41 tables).
- A TypeScript pass over the Part 4 files and tests with `pg`, `zod`, `fastify` and Node types stubbed. This catches mistakes in our own code but **is not a real type check**; it cannot see errors that depend on the real zod/fastify/pg types.

Only written, never run:
- All SQL in the new services (in particular `recomputeProgress` with its `CROSS JOIN LATERAL`, the `ON CONFLICT ... DO UPDATE` in attendance with a repeated `$5` parameter, `pg_advisory_xact_lock(hashtext($1::text))`, `FOR UPDATE OF a/b` with `LEFT JOIN`), every route and zod schema, migration 0007, and the integration tests.

You must run (in `backend/`), in this order: `npm install` (commit `package-lock.json`), `npm run typecheck`, `npm run lint:sql`, `npm run migrate` twice, `RUN_DB_TESTS=1 npm test`, `npm run dev` and call `/healthz`, `/readyz`, `/api/v1`, then `npm run build`. Send me the output of anything that fails and I will fix it before Part 5. Riskiest spots: SQL parameter type inference, the lateral join in `recomputeProgress`, timing-based integration tests (check-in window), and the zod discriminated union for questions.
