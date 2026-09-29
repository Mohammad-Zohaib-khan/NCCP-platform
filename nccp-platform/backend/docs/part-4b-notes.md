# Part 4b notes: brief v3 revision of Part 4

Status: **written, 101 pure unit tests pass, never run against PostgreSQL, a real Fastify instance, or a real type check.** See the end for exactly what was and was not executed.

Why "4b": the uploaded zip already contained Part 4 built to the old scope (the v3 brief still described Part 3 as in progress, so the zip was ahead of the brief). The v3 requirements for Part 4 are added on top, as migration **0008**. Next free migration: **0009**.

## What changed

| Area | Files |
|---|---|
| Migration | `0008_part4_v3_i18n_attendance.sql` (additive) |
| Language helpers | `src/lib/i18n.ts` |
| Localized LMS | `lms.service.ts` (`translationsFor`, `listTranslations`, `putTranslation`, `removeTranslation`; `getCourse/listCourses/outline/getLesson` take a language) |
| Language preference | `src/modules/i18n/routes.ts` |
| QR | `attendance.qr.ts` |
| Fingerprint / face | `biometric.ts` |
| Attendance service and routes | `attendance.service.ts`, `attendance.rules.ts`, `routes.ts`, `sessions.service.ts` (`attendanceOpen` in the session DTO) |
| Config | `env.ts`, `.env.example`: `FEATURE_QR_ATTENDANCE` (true), `FEATURE_FACE_ATTENDANCE` (false), `FEATURE_FINGERPRINT_DEMO` (false), `I18N_DEFAULT_LANGUAGE` (en), `I18N_ENABLED_LANGUAGES` (en,hi) |

No new permissions: opening/QR use `attendance:mark`, scanning uses `attendance:checkin_own`, translations use `courses:write` / `courses:read`, language uses `profile:*_own`.

## Multilingual LMS

- Translations live in `content_translations`, keyed by (course | module | lesson, id, language). Core entities are not duplicated. Course: title, description. Module: title. Lesson: title, content.
- The base row is the default-language text. Translating into the default language is refused (422); edit the item instead.
- Language for a read: `?lang=` (422 if not enabled) > the user's saved `preferred_language` > the default. A saved language that was later disabled quietly falls back to the default.
- Fallback: a missing translation returns the base text with `translated: false`; the response also carries `language` and `fallbackLanguage`. A translation with a null description/content falls back to the base value for that field only.
- Progress is on the lesson, never on a translation (a unit test and an integration test cover it).
- Who may write: same rule as editing the item (national content: super admin; institution content: that institution's admins and trainers). Outsiders get 404, trainees 403. Replacing an existing translation needs `If-Match` (missing: 400, stale: 412).
- Endpoints: `GET|PUT|DELETE /courses|modules|lessons/:id/translations[/:lang]`, `GET /i18n/languages`, `PUT /me/language`; `lang` on `GET /courses`, `/courses/:id`, `/courses/:id/outline`, `/lessons/:id`.
- **Not done:** assessment questions/instructions are not localized (they are a jsonb blob; needs its own design). Resource titles are not localized. Enabled languages come from env for now; Part 7 moves them to system settings.

## Attendance

**Flow.** Trainer (or super admin) `POST /attendance/sessions/:id/open` -> trainer screen polls `GET .../qr` for a fresh token (30 s lifetime) -> trainee scans and `POST .../verify/qr {token}` -> one transaction: seat in that batch (else 404), active enrolment, session not cancelled/completed, attendance open, token valid, check-in window, insert. `POST .../close` ends it. Opening records who opened it and when; audited (`attendance.open`, `attendance.close`, `attendance.checkin`).

**QR token.** `v1.<exp>.<nonce>.<HMAC-SHA256(sessionSecret, sessionId.exp.nonce)>`. The secret is random per opening and deleted on close, so a token from another session, an earlier opening or a closed session never verifies. Signature is checked before expiry, so a forged token never learns anything. A static or printed QR cannot work.
- **Known limit, stated plainly:** the code is shared by a room, so it is not single-use. Someone could photograph the screen and send it to a friend elsewhere within the 30 s window. Mitigations in place: 30 s lifetime, seat check, one record per trainee (DB unique), audit trail. If that is not enough, add geofence or per-trainee challenge codes later; not built.

**Proof methods are no longer claimable.** Plain `POST .../check-in` and the trainer's bulk `PUT /attendance/sessions/:id` now accept only `manual` and `online`. `qr`, `fingerprint`, `face` are written only by their verify endpoints, so per-method analytics (Part 8) are honest. This changes Part 4 behaviour (a trainee could previously claim `qr`); the old integration assertion was updated.

**Fingerprint.** `FingerprintProvider` interface in `biometric.ts`; a real USB/serial/vendor SDK can be passed to `createAttendanceService(db, { config, fingerprint })` without touching attendance logic.
- Development/demo: with `FEATURE_FINGERPRINT_DEMO=true` the simulator accepts `{ "simulatedKey": "Space" }` and records `method=fingerprint`, `verification=fingerprint_simulated`.
- Production: startup **fails** if the flag is true; the simulator cannot be constructed when `NODE_ENV=production`; and any request carrying `simulatedKey` gets 403. With no device, verification is 503 "not available". `staging` may use the demo flag (decision; say if you want it blocked there too).
- Failed verification attempts are rejected (403) but not audited, because the transaction rolls back. Add a separate audit write if you need them (Part 10 review).

**Face (optional).** `FEATURE_FACE_ATTENDANCE` is off by default and no provider ships, so `POST .../verify/face` is 503 and `GET /attendance/methods` reports it unavailable; nothing else depends on it. No images are stored; only `method=face` and `verification=face_provider` would be recorded. Enabling it needs the Part 10 privacy review.

`GET /attendance/methods` tells the UI what to show (`qr.available`, `fingerprint.available/simulated`, `face.available`). The frontend may show the Space-key bypass only when `fingerprint.simulated` is true.

Minimum metadata kept per record: trainee, session (-> batch), method, verification kind, status, timestamp, actor (`marked_by`). No template, image or device id is stored.

## Tests

- Unit (run here, pass): `test/part4-v3.test.ts` (QR valid/expired/forged/other-session/reopen, nonce uniqueness, production flag rejected, simulator only outside production, Space succeeds and other keys fail, no-device 503, simulated key rejected in production, face default off, proof methods not claimable, language pick/fallback/overlay). Total suite: 101 pass (config tests excluded, see below).
- Config (`test/config.test.ts`, two new cases: production rejects the demo flag, language settings validated): **not run**, `zod` is not installed here.
- Integration (`test/integration/part4.v3.attendance-i18n.test.ts`, gated by `RUN_DB_TESTS=1`, **not run**): QR lifecycle and scoping, six concurrent scans by one trainee give exactly one record, fingerprint simulator on vs off (two app instances), face unavailable, staff cannot hand-write verified methods, translation CRUD with If-Match, scoping, fallback flag, progress stays on the lesson, saved language preference.

## What was and was not executed

Executed in the build sandbox (no network, no PostgreSQL, no installed dependencies):
- 101 pure unit tests pass with the global `tsx` (`tsx --test test/*.test.ts` minus `config.test.ts`).
- `npm run lint:sql` passes (8 migrations, 42 tables).
- A TypeScript pass over the changed files and both new test files with `pg`, `zod` and `fastify` stubbed as `any`. It found and I fixed two real mistakes in my code; the remaining output was stub noise only. **This is not a real type check.**

Only written, never run: migration 0008 (including dropping `attendance_method_check` by its default name, which assumes PostgreSQL named the inline CHECK that way), all new SQL, routes and zod schemas, `content_translations` queries, the `FOR UPDATE` open/close flow, and the integration tests.

You must run (in `backend/`): `npm install` (commit `package-lock.json`), `npm run typecheck`, `npm run lint:sql`, `npm run migrate` twice, `RUN_DB_TESTS=1 npm test`, `npm run dev` and call `/healthz`, `/readyz`, `/api/v1`, then `npm run build`. Send me the output of anything that fails. Riskiest spots: the constraint drop in 0008, `ANY($3::uuid[])` in `translationsFor`, the zod `.regex` on route params, and timing in the integration tests.
