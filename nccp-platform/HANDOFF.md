# NCCP Backend - Running Handoff

Paste this whole file at the start of a new chat together with the latest zip. It is updated after every part and always ships inside the zip, so nothing needs re-explaining.

## How we work
- 10 parts. After every part I send ONE zip with the WHOLE project (frontend + backend + this file). You re-upload it for the next part.
- Always unpack the zip and build on it, never on memory.
- Done for a part = code, unit tests, gated integration tests, docs/part-N-notes.md, README table, updated zip, and a plain statement of what was executed vs only written.
- Shipped migrations are never edited. Next free migration number: **0011** (0010 shipped in Part 6A).

## Stack and conventions (follow them)
- Backend: nccp-platform/backend, Node 20+, TypeScript, Fastify 5, PostgreSQL, zod, ESM/NodeNext (imports end in `.js`). Frontend: nccp-platform/frontend (TanStack Start, React 19, bun) - unchanged until Part 9; keep visuals and images.
- Errors: throw `AppError` (src/lib/errors.ts). Shape `{ error: { code, message, requestId, details? } }`. Validation 422, locked 423, stale If-Match 412, out-of-scope record 404 (never 403), unique conflict (23505) 409.
- Auth: `preHandler: app.authorize('permission:code')`; caller is `req.auth` (userId, role, institutionIds, employerIds). Permissions in src/auth/permissions.ts and seeded by a migration; a unit test keeps them equal.
- Object access: `assertInstitutionAccess / assertEmployerAccess / assertOwnRecord / scopeInstitutionIds` (src/auth/context.ts) on every read and write.
- Audit: `writeAudit(dbOrTx, entry)` on every mutation, inside the same transaction.
- Concurrency: `version` column bumped by DB trigger; PATCH needs `If-Match`; GET returns ETag.
- Lists: keyset pagination (lib/list-query.ts, lib/pagination.ts), `{ data, page: { limit, nextCursor, hasMore } }`; sort expressions NOT NULL; sort value as text.
- Writes: `withTransaction`; soft delete via `deleted_at`.
- Plugins needed app-wide are wrapped with `shared()` (src/lib/plugin.ts).
- Tests: node:test; unit in test/*.test.ts; DB tests in test/integration/*.test.ts, skipped unless `RUN_DB_TESTS=1`.
- Never build SQL from request input except whitelisted sort keys and bind parameters.

## Status
| Part | Scope | Status |
|---|---|---|
| 1 | Foundation, 40-table schema (0001-0005), Docker, CI | Delivered, never run |
| 2 | Auth, users, RBAC, sessions, MFA, invitations, audit writer (0006) | Delivered; 35 pure unit tests pass, DB/HTTP code unverified |
| 3 | Institutions, trainers, trainees, programmes, batches | Delivered (nccp-platform-part3-complete.zip). Written; 65 pure unit tests pass; SQL/routes/integration tests never run |
| 4 | Enrolments, LMS, sessions, attendance, assessments | Delivered (nccp-platform-part4-complete.zip). Written; 85 pure unit tests pass; SQL/routes/integration tests never run. Migration 0007 (permissions) |
| 4b | Part 4 revision for brief v3: localized LMS, verified QR attendance, fingerprint provider + dev-only Space bypass, optional face, language preference | Delivered (nccp-platform-part4b-complete.zip). Written; 101 pure unit tests pass; SQL/routes/integration tests never run. Migration 0008 |
| 5 | Certificates + public verification | Delivered (nccp-platform-part5c-complete.zip). 5A rules + migration 0009, 5B service/routes, 5C dependency-free PDF + gated integration test. 48 fake-DB/unit tests pass; SQL/HTTP never run. See backend/docs/part-5-notes.md |
| 6 | Employers, jobs, applications, interviews, placements | In progress. 6A delivered (migration 0010, `placements:read`, pure rules + match score, 30 unit tests). 6B (employers, jobs, discovery) and 6C (applications, interviews, placement transaction, integration tests) to do. See backend/docs/part-6-notes.md |
| 7 | Notifications, files (S3), audit API, settings, SMTP mailer | TODO |
| 8 | Dashboard aggregates and analytics | TODO |
| 9 | Frontend integration | TODO |
| 10 | Seed, e2e/security tests, backups, monitoring, deploy docs | TODO |

## Verification debt (critical)
Nothing in Parts 1-4 has ever run against PostgreSQL, been installed with npm, or been type-checked (the build sandbox has no network). The very next step, before Part 5, is for the owner to run the section "Verification never yet run" below on a machine with Node 20+ and PostgreSQL, and send back the output of anything that fails. Fix those first.

## Known problems in Part 2
- (Fixed in Part 3) Users list cursor lost microseconds; now `created_at::text`, and `_sort` is not returned.
- test/config.test.ts (7 tests) never run (zod not installed in sandbox).
- No first super admin: insert one user by hand until the Part 10 seed.
- Mailer only logs in development, refuses to send in staging/production until Part 7.
- POST /users/invite for trainer/trainee still creates no profile row; POST /trainers and POST /trainees (Part 3) are the normal route.

## Part 3 as built (details: backend/docs/part-3-notes.md)
- Helpers: `lib/http.ts` (reqInfo, actorOf, ifMatch/parseIfMatch, versioned ETag, limit), `lib/list-query.ts` (parseSort whitelist, keyset, keysetList, orderBy, likePattern, buildUpdate, isIsoDate, mapPage), `auth/context.ts` gained `scopeInstitutionIds` and `resolveInstitutionId`.
- Modules: `modules/institutions`, `modules/people` (trainers, trainees), `modules/training` (programmes, batches, constants). Each service factory takes `db` (people also take `auth`); routes are registered in `routes/v1.ts`.
- New services follow one pattern: `load(actor, id, client, lock)` scoped read (404 if out of scope), `visibility()` SQL per role, `keysetList` for lists, `withTransaction` + `SELECT ... FOR UPDATE OF` for writes, `buildUpdate` with version guard (0 rows -> 412), `writeAudit(tx, ...)` in the same transaction.
- `CAPACITY_STATUSES` (enrolled, in_progress, completed) in `training/constants.ts`, re-exported from `batches.service.ts`. Part 4 MUST use it and lock the batch row (`FOR UPDATE`) when enrolling.
- Decisions taken (defaults): public /institutions/apply kept (5/h/IP, always 202, dedupes pending by contact email, no CAPTCHA); suspension blocks only creation of new batches/trainers/trainees/programmes (409), sessions untouched; no trainer schedule-overlap check; suspension reason only in audit log (no column; would need migration 0007); trainees see active programmes that are national or of their own institution; soft-deleted users keep their email reserved.
- No new permissions, no new migration. Next free migration: **0007**.
- Test files: `test/list-query.test.ts`, `test/part3-state.test.ts` (unit, pass), `test/integration/part3.people-training.test.ts` (gated, not run). Integration tests get past MFA by inserting the super admin and flipping `mfa_enabled` after login (DB is authoritative per request).

## Part 4 as built (details: backend/docs/part-4-notes.md)
- New folder `modules/learning`: `access.ts` (`loadBatch(db, actor, id, need, lock)`, `batchVisibilitySql`, `seatsTaken`, `recomputeProgress`, `auditBase`), `enrolments.*`, `lms.service.ts`, `sessions.*`, `attendance.*`, `assessments.*`, `routes.ts` (one `learningRoutes` plugin, registered in `routes/v1.ts`).
- Migration 0007 seeds 4 new permissions (`enrolments:apply_own`, `lessons:progress_own`, `classes:read`, `classes:write`); the permissions test now reads 0006 + 0007. Any future permission needs the code change plus a new additive migration.
- `buildUpdate` accepts `softDeleted: false` for tables without `deleted_at`.
- Enrolment: batch row locked `FOR UPDATE`, seats via `CAPACITY_STATUSES`; `applied` takes no seat; dropped/rejected rows are reused. Progress % = completed lessons / lessons of published courses of the programme.
- Sessions: overlap rule ON (same batch or same trainer, advisory lock per trainer). Attendance: trainer/super admin mark; trainee self check-in (manual/qr/online, unverified, window -15 min to end, late after +15 min); fingerprint only by trainer. Attendance % formula in part-4-notes (late counts, excused leaves denominator). Part 5 should reuse `GET /attendance/summary` logic (`attendancePercent`) and `GET /assessments/summary` (`allPassed`).
- Assessments: mcq auto-graded, text/assignment manually graded with If-Match on the result; answer key never sent to trainees. Resources are links only until Part 7.
- Not built / open: session dates are not forced inside batch dates; `PUT /batches/:id/trainer` does not re-check overlaps; institution admins cannot mark attendance (would need `attendance:mark` + migration 0008); lesson progress is not audited.
- Tests: `test/part4-rules.test.ts` (unit, pass), `test/integration/part4.learning.test.ts` (gated, not run).

## Part 4b as built (brief v3; details: backend/docs/part-4b-notes.md)
- Migration 0008: `users.preferred_language`, `content_translations` (course/module/lesson x language), attendance `method` gains `face` plus `verification` column, `class_sessions` gains attendance open/close audit columns and `qr_secret`. No new permissions.
- i18n: `lib/i18n.ts` (pure helpers), env `I18N_DEFAULT_LANGUAGE` / `I18N_ENABLED_LANGUAGES` (default en / en,hi; Part 7 moves to settings). Reads take `?lang=`; order is explicit > saved preference > default; response says `translated` per item and `fallbackLanguage`. Base rows are the default-language text. Progress stays on the lesson. Endpoints: `GET|PUT|DELETE /{courses|modules|lessons}/:id/translations[/:lang]`, `GET /i18n/languages`, `PUT /me/language`. Assessment text is NOT localized yet.
- Attendance: `POST /attendance/sessions/:id/open|close`, `GET .../state`, `GET .../qr` (rotating 30 s HMAC token, staff only), `POST .../verify/qr|fingerprint|face`, `GET /attendance/methods`. QR/fingerprint/face are proof methods: no longer claimable via plain check-in or bulk mark (both manual/online only).
- `modules/learning/biometric.ts`: provider interfaces, Space-key simulator only when `FEATURE_FINGERPRINT_DEMO=true` and NODE_ENV is not production; startup fails if the flag is on in production; production also rejects any request carrying `simulatedKey` (403). Face has no provider and is off by default (503).
- `createAttendanceService(db, { config })` and `createLmsService(db, i18n)` signatures changed; `learningRoutes` now needs `db`.
- Tests: `test/part4-v3.test.ts` (unit, pass), `test/integration/part4.v3.attendance-i18n.test.ts` (gated, not run), extra cases in `test/config.test.ts` (not run, zod missing).

## Parts 5-10 (short)
- 5: certificates (75% attendance + assessment pass from settings, one live per enrolment, revocation reason), public rate-limited /verify/:code with minimal fields, PDF.
- 6: employers + verification, jobs, applications (UNIQUE job+trainee), status history, match score (skills + location + certification), interviews, offer, placement in same transaction; UI status labels map to lowercase DB codes.
- 7: SMTP mailer with retry, notifications, S3 files (type/size/content checks, signed downloads), audit API, settings history, announcements.
- 8: analytics aggregates per role (no external AI).
- 9: API client (token in memory, httpOnly refresh cookie + `X-Requested-With: nccp-web`, single-flight refresh), real login + MFA, replace demo data/localStorage, loading/empty/error states.
- 10: seed script, e2e + security tests, backups, monitoring, deployment docs. Not "production ready" before this.

## Verification never yet run (do first when a network/DB exists)
`npm install` (commit package-lock.json) -> `npm run typecheck` -> `npm run lint:sql` -> `npm run migrate` twice -> `RUN_DB_TESTS=1 npm test` -> `npm run dev` + /healthz, /readyz, /api/v1 -> `npm run build`.

## Decisions still needed from owner (defaults apply if silent)
Email provider (SMTP via SMTP_URL) - Part 7; object storage (S3-compatible, MinIO local) - Part 7; hosting/domains (separate origins, cookie auth, CORS allow-list) - Part 9/10; certificate design (simple layout with NCCP logo) - Part 5; thresholds (75%) - Part 5; match score (documented formula) - Part 6; QR = signed 30 s server-validated token, fingerprint = provider abstraction + dev Space bypass, face optional/off (Part 4b); biometric consent/retention still open (Part 10); data residency/retention/consent - Part 10 (not assumed).

## Part 5 as built (details: backend/docs/part-5-notes.md)
- `modules/certificates`: `certificates.rules.ts` (pure), `.dto.ts`, `.service.ts`, `.routes.ts`, `certificate.pdf.ts` (hand-written PDF, no dependency; standard fonts, WinAnsi only), `certificate.logo.ts` (generated base64 JPEG). Migration 0009 = holder_name snapshot, `certificates_guard` trigger, 3 settings.
- Endpoints: `GET /certificates`, `GET /certificates/:id`, `GET /certificates/:id/pdf`, `GET /certificates/eligibility/:enrolmentId`, `POST /certificates`, `POST /certificates/:id/revoke`, public `GET /verify/:code` (20/min/IP).
- PDF: 409 `CERTIFICATE_REVOKED` and 409 `UNSUPPORTED_CHARACTERS` (Devanagari) - Hindi PDFs need an embedded Unicode font (would swap the renderer for pdf-lib + fontkit or add TrueType embedding). Prints `${APP_BASE_URL}/verify/<code>`; that frontend page arrives in Part 9.
- `createCertificatesService(db, { appBaseUrl })`. Employer certificate visibility depends on `applications` + `jobs`; Part 6 must keep `applications.status` and `jobs.deleted_at` semantics (withdrawn/deleted give no access).
- Tests: `test/part5-rules.test.ts`, `test/part5-service.test.ts`, `test/part5-pdf.test.ts` (unit, pass), `test/integration/part5.certificates.test.ts` (gated, not run).

## Part 6 so far (details: backend/docs/part-6-notes.md)
- 6A only: `modules/employment/employment.rules.ts` (pure), migration 0010, permission `placements:read`. No services or routes yet.
- Rules to build on: `planEmployerTransition`, `planJobTransition`, `validateJobForPublish`, `isJobOpenForApplications`, `planApplicationTransition(current, action, side, reason)`, `planInterviewTransition`, `validateInterview`, `planPlacementTransition`, `assertOpeningAvailable`, `computeMatchScore` (formula in the notes).
- Certificates (Part 5) already read `applications` and `jobs`: an employer sees a certificate only via a non-withdrawn application to one of its non-deleted jobs. Keep those semantics.

## Next step
6B: employers service/routes (public apply, admin verify, members), jobs service/routes, trainee discovery. Then 6C. Ask for the output of the verification commands first if the owner has run them.

## Session log (append newest at the bottom)
- 29 Sep 2026: Uploaded brief + Part 2 zip. Found Part 3 files absent from the zip. Added this HANDOFF.md. Sandbox has no network, so npm install/tests could not be run.
- 29 Sep 2026: Built Part 3 from scratch (the Part 3 working files were not in the Part 2 zip). Owner said "start", so the default design decisions above apply. 65 unit tests pass in the sandbox; typecheck/SQL/integration untested. Delivered nccp-platform-part3-complete.zip.
- 29 Sep 2026: Built Part 4 on top of the Part 3 zip. 85 unit tests pass; typecheck only done with stubbed third-party types; SQL/integration untested. Overlap rule turned on, QR/fingerprint = record only. Delivered nccp-platform-part4-complete.zip.
- 29 Sep 2026: Owner uploaded brief v3 (multilingual, QR, fingerprint Space bypass, optional face) with the Part 4 zip (the brief still called Part 3 in progress; the zip was ahead of it). Built the Part 4 revision as 4b on migration 0008. 101 unit tests pass; stubbed typecheck only; SQL/integration untested. Delivered nccp-platform-part4b-complete.zip. Owner wants a complete zip after every part.
- 29 Sep 2026: Built Part 5 phases 5A-5C (uploaded zip was the 5B state; the v4 PDF said Part 5 not started). Added PDF endpoint using a dependency-free renderer instead of pdf-lib (verifiable here with qpdf/poppler), integration test, docs. 172 of 173 sandbox tests pass; the 1 failure is config.test.ts needing zod. Delivered nccp-platform-part5c-complete.zip. Then started Part 6.
- 29 Sep 2026: Started Part 6 after delivering 5C. Built 6A (migration 0010, permission, pure rules, 30 unit tests; 202 of 203 sandbox tests pass, the 1 failure is config.test.ts needing zod). Delivered nccp-platform-part6a-complete.zip.
