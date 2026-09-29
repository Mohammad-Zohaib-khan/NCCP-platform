# Part 3 notes: institutions, trainers, trainees, programmes, batches

Status: **written, unit-tested where possible, never run against PostgreSQL or a real Fastify instance.** See "What was and was not executed" at the bottom.

## What is new

| Area | Files |
|---|---|
| Shared helpers | `src/lib/http.ts` (reqInfo, actorOf, If-Match, ETag, rate-limit helper), `src/lib/list-query.ts` (sort whitelist, keyset pagination, partial UPDATE builder, LIKE escaping, date check), `scopeInstitutionIds` and `resolveInstitutionId` in `src/auth/context.ts` |
| Institutions | `src/modules/institutions/{state,service,routes}.ts` |
| Trainers and trainees | `src/modules/people/{trainers.service,trainees.service,routes}.ts` |
| Programmes and batches | `src/modules/training/{constants,programmes.state,programmes.service,batches.state,batches.service,routes}.ts` |
| Wiring | `src/routes/v1.ts` |
| Part 2 fix | `users.service.ts` list cursor now uses `created_at::text` (microseconds kept); the internal `_sort` field is not returned |

No new permissions and no new migration were needed (next free migration is still **0007**).

## Endpoints (all under `/api/v1`)

Institutions
- `POST /institutions/apply` public, 5 per hour per IP, always answers 202
- `GET /institutions`, `POST /institutions` (super admin), `GET|PATCH|DELETE /institutions/:id`
- `POST /institutions/:id/status` body `{ action: approve|reject|suspend|reactivate|reopen, reason? }`
- `GET|POST /institutions/:id/admins`, `DELETE /institutions/:id/admins/:userId`

People
- `GET|POST /trainers`, `GET|PATCH /trainers/me`, `GET|PATCH|DELETE /trainers/:id`
- `GET|POST /trainees`, `GET|PATCH /trainees/me`, `GET|PATCH|DELETE /trainees/:id`
- `POST /trainers` and `POST /trainees` create the user (status `invited`), the profile row and the invitation token in one transaction and send the mail after commit. The response has `emailSent`; if false, use `POST /users/:id/resend-invitation`.

Training
- `GET|POST /programmes`, `GET|PATCH|DELETE /programmes/:id`, `POST /programmes/:id/status` body `{ action: submit|approve|reject|archive, reason? }`
- `GET|POST /batches`, `GET|PATCH|DELETE /batches/:id`, `POST /batches/:id/status` body `{ status: ongoing|completed|cancelled }`, `PUT /batches/:id/trainer` body `{ trainerId: uuid|null }`

All lists: `?limit`, `?cursor`, `?sort=key` or `?sort=-key` (whitelisted per resource), plus the filters named in the handover brief. All PATCH calls need `If-Match` (from the ETag of a GET) and return 412 on a stale version. Records outside the caller's scope are always 404.

## Decisions taken (defaults; change them if you disagree)

1. **Public `POST /institutions/apply` stays public.** It is rate limited (5/hour/IP), the schema is strict (nobody can set their own status), the answer is always 202, and a second pending application with the same contact email is silently ignored, so it neither leaks which emails exist nor floods the review queue. There is still no CAPTCHA; add one (or make onboarding admin-only) before public launch.
2. **Suspension blocks creating new records only** (batches, trainers, trainees, programmes under that institution) with 409. Existing sessions keep working and existing records stay editable, except that an institution admin cannot edit a suspended institution's own profile. Revoking sessions or blocking all writes is a small follow-up if you want it.
3. **No trainer schedule-overlap detection.** Not built. It fits with Part 4 timetables.
4. **Suspension reason is stored in the audit log only.** The `institutions` table has `rejection_reason` but no column for it. A `status_reason` column would be an additive migration 0007 if you want it on the record.
5. **Trainee programme visibility:** active programmes that are national or belong to the trainee's own institution (the brief said "active only"; showing other institutions' programmes would leak across tenants).
6. **Soft-deleted users keep their email reserved** (the `users.email` unique constraint includes deleted rows), so a deleted trainer's email cannot be re-invited. Decide if you want this relaxed.
7. **Trainee "enrolled in" for batch visibility** means any enrolment row; the trainer's view of trainees uses the seat-occupying statuses (`CAPACITY_STATUSES`).

## Behaviours worth knowing

- `CAPACITY_STATUSES` (enrolled, in_progress, completed) lives in `training/constants.ts` and is re-exported from `batches.service.ts`. Part 4 must count seats with it and lock the batch row (`SELECT ... FOR UPDATE`), exactly as batch updates do.
- Batch update locks the batch row, checks the version, then the capacity floor, so a capacity change cannot race with an enrolment.
- Institution admins cannot remove the last admin of an active institution (row lock serialises concurrent removals).
- Deleting an institution, programme or batch is refused (409) while dependants exist. Deleting a trainer is refused while they are on planned/ongoing batches.
- Trainers see trainees only from their own batches, with date of birth and phone removed. Trainees see and edit only their own record, and only skills, careerProfile, openToWork, location, education.

## Tests

- Unit (run here, pass): `test/list-query.test.ts` (sort whitelist incl. hostile keys, keyset SQL and params, cursor validation, buildUpdate, LIKE escaping, dates, If-Match, rate-limit helper) and `test/part3-state.test.ts` (institution, programme and batch state machines exhaustively, batch dates and capacity, CAPACITY_STATUSES, scope helpers).
- Integration (`test/integration/part3.people-training.test.ts`, gated by `RUN_DB_TESTS=1`, not run): scope isolation, approval workflow and audit trail, public apply, concurrent PATCH gives exactly one 412 (institution and batch), last-admin rule, trainer/trainee creation and visibility, programme lifecycle, batch rules, suspended institution blocked, batch lifecycle and capacity floor, trainer/trainee batch visibility, cursor pagination returns every row exactly once (with ties, five sorts), trainer delete and session revocation, users-list microsecond fix.

## What was and was not executed

Executed in the build sandbox (no network, no PostgreSQL, no installed dependencies):
- 65 pure unit tests pass (`tsx --test test/*.test.ts`). `test/config.test.ts` (7 tests) still cannot load here because `zod` is not installed, same as Part 2.
- A syntax-level TypeScript pass over all new files with the third-party packages stubbed as `any`. This catches typos in our own code but **is not a real type check**.

Only written, never run:
- All SQL in the new services, every route and zod schema, the integration tests, and the wiring in `v1.ts`.

You must run (in `backend/`), in this order: `npm install` (commit `package-lock.json`), `npm run typecheck`, `npm run lint:sql`, `npm run migrate` twice, `RUN_DB_TESTS=1 npm test`, `npm run dev` and call `/healthz`, `/readyz`, `/api/v1`, then `npm run build`. Send me the output of anything that fails and I will fix it before Part 4. Riskiest spots: SQL parameter type inference, `FOR UPDATE OF` with joins, and the Fastify route/schema wiring.
