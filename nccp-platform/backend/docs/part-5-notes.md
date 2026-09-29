# Part 5 - Certificates and public verification

Status is tracked per phase. Each phase ships as its own complete project zip.

| Phase | Scope | Status |
|---|---|---|
| 5A | Migration 0009, pure rules (eligibility, identifiers, public name, printable text), unit tests | Written; unit tests pass here |
| 5B | Certificate service and routes (eligibility, issue, revoke, list/get, public verify), wiring | Written; 30 service unit tests pass against a scripted fake database; SQL and HTTP never run |
| 5C | PDF rendering, PDF endpoint, integration tests, README/HANDOFF | Written; 18 new unit tests pass (renderer checked with qpdf/pdftotext/pdftoppm); gated integration test never run |

## Phase 5A - what exists

### Migration 0009 (`0009_part5_certificates.sql`)
- `certificates.holder_name` (NOT NULL): the name is snapshotted at issue time, so a later profile edit cannot change a printed certificate.
- Trigger `certificates_guard`: certificate number, verification code, trainee, enrolment, programme, title, holder name and issued_at cannot be updated, and a revoked certificate cannot go back to `issued`. Defence in depth behind the service.
- Seeds three settings (`ON CONFLICT DO NOTHING`): `certificates.min_attendance_percent` = 75, `certificates.require_assessments_passed` = true, `certificates.public_holder_name` = "full".
- No new permission codes. Existing `certificates:read`, `:issue`, `:revoke` are used, so the permissions test is unaffected.
- Next free migration: **0010**.

### Rules (`src/modules/certificates/certificates.rules.ts`, no DB or framework imports)
- `parseCertificateSettings`: wrong-typed or out-of-range values fall back to the default, never to something looser.
- `evaluateEligibility`: reports every failing reason. Attendance uses the Part 4 `attendancePercent` (late counts, excused leaves the denominator, null percent is never eligible). Assessments use the Part 4 `allPassed` rule, so a batch with no published assessments is not certifiable while the rule is on.
- Seat-holding enrolments only (`enrolled`, `in_progress`, `completed`). A completed enrolment still has to meet the thresholds (see decisions).
- Identifiers: certificate number `NCCP-<year>-<8 chars>`; verification code = 20 characters (100 bits) from a 32-character alphabet without I, L, O, U, grouped `XXXX-XXXX-XXXX-XXXX-XXXX`, generated with `crypto.randomInt` (no modulo bias). `normaliseVerificationCode` accepts lowercase, spaces, missing dashes and O/I/L look-alikes, and returns null for anything that cannot be a code.
- Public holder name: `full`, `initials` or `none` (none returns null so the field carries no name).
- `isWinAnsiPrintable`: true only when standard PDF fonts can draw the text (used in 5C to answer 409 for Devanagari names).

### Decisions taken (defaults from the v4 brief; change on request)
| Decision | Taken |
|---|---|
| Holder name on public verification | Full name, switchable to initials or none through a setting |
| Employer access | Only for a trainee who applied to one of that employer's jobs (implemented in 5B) |
| Thresholds | 75% attendance and all assessments passed, stored as settings |
| Completed enrolments | Still need the thresholds. The brief said "completed or eligible"; the stricter reading was chosen because completion is set by staff. Say so if completed should bypass the checks |
| Hindi certificates | English PDF only; 409 for names the standard font cannot print |

### Tests
`test/part5-rules.test.ts`: 23 unit tests (settings fallback, threshold edges, late/excused maths, null attendance, assessment rules, all-reasons reporting, identifier format and uniqueness, alphabet bias smoke test, code normalisation and rejection, holder-name modes, printable-text check).

### Not verified
Migration 0009 has passed only the structural SQL lint, never PostgreSQL (trigger and `ON CONFLICT` on `system_settings.key` are the parts to watch). Rules were not type-checked with real `@types/node`.

## Phase 5B - what exists

### Endpoints (all under `/api/v1`)
| Method and path | Who | Notes |
|---|---|---|
| `GET /certificates` | `certificates:read`, role-scoped | Filters `traineeId`, `enrolmentId`, `programmeId`, `institutionId`, `status`, `q`; sort `issued_at` (default, newest first), `certificate_no`, `holder`, `created_at`; keyset pagination |
| `GET /certificates/:id` | `certificates:read`, role-scoped | ETag from `version`; out of scope is 404 |
| `GET /certificates/eligibility/:enrolmentId` | `certificates:read` | Super admin, admin of the batch's institution, the batch trainer, the trainee themself. Returns percent, assessment counts, thresholds, `eligible`, all `reasons`, `alreadyIssued`. Employers get 404 |
| `POST /certificates` | `certificates:issue` (super admin, institution admin) | Body `{ enrolmentId }`. 201 with the certificate. 404 out of scope, 409 `NOT_ELIGIBLE` (with `reasons`) or `CERTIFICATE_EXISTS`. 60 per minute |
| `POST /certificates/:id/revoke` | `certificates:revoke` (super admin) | Body `{ reason }` (3-500 chars). 409 `ALREADY_REVOKED`. 30 per minute |
| `GET /verify/:code` | Public | 20 per IP per minute. `Cache-Control: no-store`, `X-Robots-Tag: noindex` |

### Visibility
- Super admin: all. Institution admin: certificates of their institutions. Trainer: certificates of trainees in batches they teach. Trainee: their own.
- Employer: a certificate is visible only if its holder has a non-withdrawn application to one of that employer's jobs (uses the existing `applications` and `jobs` tables; Part 6 will create the rows). Employers do not see score or grade.
- The revocation reason is shown to administrators only. Everyone who may read a certificate sees its verification code.

### Issue flow (one transaction)
1. Lock the enrolment row (`FOR UPDATE OF e`), so two simultaneous issues queue up and the second sees the first.
2. 404 if the caller cannot see the enrolment; 409 if a live certificate exists.
3. Load settings and live attendance and assessment numbers, evaluate eligibility, 409 with all reasons if not eligible.
4. Insert inside a SAVEPOINT. A certificate-number or verification-code collision rolls back to the savepoint and retries (up to 5, then 503). A hit on `certificates_one_live_per_enrolment` is 409.
5. Write the audit row in the same transaction. The verification code is not put in the audit log.

The certificate stores the programme title and holder name as they were at issue time, and `score` from `batch_enrolments.final_score` (may be null). `grade` is left null: no grading scale has been defined.

### Public verification
Response is exactly `valid`, `status`, `certificateNo`, `programmeTitle`, `issuedOn` (date), `holderName` (per setting, null when `none`). Revoked certificates return 200 with `valid: false, status: "revoked"`; unknown, malformed and never-issued codes all return the same 404, and malformed codes never reach the database. The query selects only the five public columns.

### Sync risk to remember
The attendance and assessment predicates in `loadInputs` duplicate the ones in `GET /attendance/summary` and `GET /assessments/summary`. If either changes, change all three.

### Tests added
`test/part5-service.test.ts` (30 tests, fake database): statement order inside the issue transaction, audit contents, ineligible/dropped/duplicate/collision/backstop paths, settings-driven threshold, 404 scoping for every wrong role, revoke paths, public response shape and column list, holder-name modes, malformed codes, list visibility SQL per role, parameter binding, role shaping. Mutation-checked: removing the employer withdrawn filter, the duplicate check, the savepoint rollback, or the eligibility check each makes at least one test fail.

These tests import the service, which imports `pg`; they need `npm install` on your machine (the sandbox used a throwaway stub for `pg`, which is not shipped).

### Not verified
Routes (zod, Fastify) were never loaded: those packages are not installed here. All SQL is unrun on PostgreSQL. Things to watch: `FOR UPDATE OF e` beside a LEFT JOIN, the CTE referenced from scalar subqueries in `loadInputs`, `ANY($n::uuid[])` with an empty employer list, and SAVEPOINT handling through `pg`.

## Phase 5C - what exists

### PDF endpoint
`GET /api/v1/certificates/:id/pdf` (`certificates:read`, 30 per minute). Same visibility as `GET /certificates/:id`, so an out-of-scope certificate is 404, never a PDF.
- 200 `application/pdf`, `Content-Disposition: attachment; filename="<certificate no>.pdf"`, `Cache-Control: private, no-store` (the page carries a live verification code).
- 409 `CERTIFICATE_REVOKED`: a revoked certificate is never rendered, so it cannot be passed around looking valid.
- 409 `UNSUPPORTED_CHARACTERS`: holder name, programme title or any other printed field contains characters the standard PDF fonts cannot draw (Devanagari etc.). Issuing such a certificate still works; only printing is refused until a Unicode font is bundled.
- The PDF is generated on demand, dated with the certificate's own issue date, and is deterministic for a given certificate. Nothing is stored (`certificates.file_id` stays null until Part 7 files exist).

### Deviation from the plan: no `pdf-lib`
The v4 brief planned `pdf-lib`. Instead `certificate.pdf.ts` writes the PDF directly: one A4 landscape page, Helvetica and Helvetica-Bold (WinAnsi), an embedded JPEG logo, a clickable verification link, no dependency. Reason: it could be produced and checked in the build sandbox (qpdf reports no errors, pdftotext extracts the text, pdftoppm renders it; a long name and a very long programme title were rendered and inspected). A library would have been another unverified install. Trade-off: text width for centring uses the standard Helvetica width tables for ASCII and an average for accented letters (centring is slightly approximate there; correctness is not affected). Adding Hindi later means embedding a TrueType font, which is where a library such as pdf-lib + fontkit is the better tool; the renderer's interface (`renderCertificatePdf(input)`) would stay the same.

### Layout and content
NCCP logo (generated from `frontend/src/assets/nccp/05_landing_logo_brand.png` into `certificate.logo.ts`, so the compiled server needs no asset files), "Certificate of Completion", holder name (shrunk to 18 pt, then wrapped to two lines), programme title (two lines max), issue date, certificate number, an "Authorised signatory" line with no name (signatory is an open decision), and the verification URL plus code. The PDF prints no score, grade, email, phone or institution details.

### Verification URL
The printed link is `${APP_BASE_URL}/verify/<code>`. That page does not exist until Part 9 (the API answers at `/api/v1/verify/<code>`). Until then the link is correct in shape but leads to the frontend, which has no such route yet.

### Tests
- `test/part5-pdf.test.ts` (18 unit tests): width tables and known AFM widths, date format, wrapping and hard word breaks, WinAnsi encoding and refusal of Devanagari/control characters, xref offsets and stream lengths, logo bytes embedded, printed fields present, deterministic output, URL validation, very long inputs, and `service.pdf` (scope, revoked, unsupported characters, no score in the PDF). Mutation check: removing the revoked guard makes a test fail.
- `test/integration/part5.certificates.test.ts` (gated by `RUN_DB_TESTS=1`, never run): permissions and scope, every ineligible reason, threshold from `system_settings`, issue and audit (no verification code in audit), five concurrent issues give one certificate, role-scoped reads, employer visibility through an application (and withdrawn removes it), public verification shape/leak check/typing tolerance/identical 404s, holder-name setting, PDF for owner/staff/others, Devanagari 409, revoke rules, re-issue after revoke, database guard trigger, and the `/verify` rate limit (20 per minute, using a non-test app because tests switch limits off).

### Not verified
Everything that touches PostgreSQL or Fastify/zod: the routes, the whole integration test, migration 0009 (trigger, `ON CONFLICT`), the `FOR UPDATE OF e` beside a LEFT JOIN. Also not checked: how the PDF looks in every viewer (checked with poppler only), and the `Buffer` typing under real `@types/node`.

### Behaviour notes and open items
- The integration test edits `certificates.*` rows in `system_settings` and restores them in a `finally`/`after`. Do not run it against a database where someone else is changing those settings.
- Downloads are not audited (reads are not audited anywhere in the API). Say so if a certificate download log is wanted.
- The decisions from 5A still hold (full name on public verification, employer access only through an application, 75% + all assessments, completed enrolments still need the thresholds, English-only PDF).
