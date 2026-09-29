# Part 1 notes

## Verification status (be aware)
Built in a sandbox with no network and no PostgreSQL, so:
- **Verified here:** unit tests for errors, pagination, request-id (14 passing); structural migration lint (5 files, 40 tables, FK ordering, PKs, touch triggers).
- **NOT yet run:** `npm install`, `tsc` typecheck, the SQL against a real PostgreSQL, the server boot, config tests (need `zod`). CI (`.github/workflows/ci.yml`) does all of these on a fresh Postgres, including applying migrations twice. Run `npm install && npm run typecheck && npm run migrate && npm test` first and send me any error output; I'll fix it in Part 2.

## Schema (40 tables)
- Identity/RBAC: roles (5 seeded), permissions, role_permissions, users, user_sessions, user_tokens, mfa_recovery_codes
- Orgs/people: institutions, institution_users, employers, employer_users, trainers, trainees
- Training: programmes, batches, batch_enrolments, class_sessions, attendance, courses, modules, lessons, lesson_progress, resources, assessments, assessment_results
- Certification: certificates
- Employment: jobs, applications, application_status_history, interviews, placements
- Platform: files, announcements, notifications, notification_deliveries, audit_logs, system_settings, system_settings_history, idempotency_keys, analytics_snapshots
- Plus `schema_migrations` (created by the runner).

Tables named in the spec as `attendance`, `assessments/results`, `courses/modules/lessons` map 1:1. Additions the UI implies: `class_sessions` (Live Classes / per-session attendance), `interviews` (Employer "Interviews"), `placements` (Selection & Placements), `announcements` (Institution notices), `lesson_progress`.

## Design decisions
- Roles: `super_admin`, `institution_admin`, `trainer`, `trainee`, `employer` — one per workspace (`roles.workspace`). Permissions are seeded in Part 2.
- Tenant scoping: institution-owned rows carry `institution_id`; employer-owned rows carry `employer_id`. Object-level checks (BOLA/IDOR) are enforced in the service layer using these columns.
- Refresh tokens and one-time tokens are stored only as SHA-256 hashes. Rotation families allow reuse detection.
- One live certificate per enrolment (partial unique index); revocation requires a reason (CHECK).
- Duplicate applications impossible: `UNIQUE (job_id, trainee_id)`. Duplicate enrolments: `UNIQUE (batch_id, trainee_id)`.
- Dashboard totals are never stored from the client; they are computed from these tables (Part 8).

## Frontend value mapping (applied in the API layer, Part 3+)
The UI uses display labels; the DB uses lowercase codes.
| UI | DB |
|----|----|
| Job status Active / Draft / Paused / Closed | `active` / `draft` / `paused` / `closed` |
| Applicant status Review / Shortlisted / Interview / Offer / Placed / Rejected | `review` / `shortlisted` / `interview` / `offer` / `placed` / `rejected` |
| Job `type`, `mode`, `salary` | `employment_type`, `work_mode`, `salary_text` |
| Job `required` / `preferred` | `required_skills` / `preferred_skills` |
| Applicant `match` | `applications.match_score` |
