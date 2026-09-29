# NCCP Backend

Production backend for the National Cooperative Capacity Building Platform. Node.js 20+/TypeScript, Fastify, PostgreSQL.
Built in parts against `NCCP_Production_Backend_System_Requirements.pdf`; the existing React frontend is the UI contract.

## Delivery plan

| Part | Scope | Status |
|-----:|-------|--------|
| 1 | Foundation: config, logging, errors, health, security headers/CORS/rate limit, migrations + **full PostgreSQL schema**, Docker, CI | delivered |
| 2 | Auth, users, RBAC (permissions seeded), sessions/refresh rotation, invitations, password reset, MFA, org scoping, audit writer | delivered (unverified, see docs/part-2-notes.md) |
| 3 | Institutions, trainers, trainees, programmes, batches | delivered (written, unverified, see docs/part-3-notes.md) |
| 4 | Enrolments, LMS, sessions, attendance, assessments | delivered (written, unverified, see docs/part-4-notes.md) |
| 4b | Brief v3 revision: localized LMS, QR / fingerprint-provider / optional face attendance, language preference | **this zip (written, unverified, see docs/part-4b-notes.md)** |
| 5 | Certificates + public verification | Delivered (5A rules + migration 0009, 5B service/routes, 5C PDF + integration tests). 48 fake-DB/unit tests pass; SQL/HTTP never run |
| 6 | Employers, jobs, applications, interviews, placements | 6A done (migration 0010, rules, match score); 6B, 6C pending |
| 7 | Notifications, files (S3), audit API, settings | |
| 8 | Dashboard aggregates / analytics endpoints | |
| 9 | Frontend API client + wiring of the five workspaces | |
| 10 | Seed data, e2e/security tests, backups, deployment docs | |

## Run locally

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run migrate
npm run dev              # http://localhost:8080/healthz  /readyz  /api/v1
```
Or everything: `docker compose up --build`.

## Scripts
`dev` · `build` · `start` · `typecheck` · `migrate` · `migrate:status` · `lint:sql` · `test`

## Conventions
- **Errors** always `{ "error": { code, message, requestId, details? } }`; 5xx never leak internals.
- **Request IDs**: inbound `X-Request-Id` accepted if well-formed, echoed on every response and in every log line.
- **Pagination**: cursor-based (`?limit=&cursor=`), response `{ data, page: { limit, nextCursor, hasMore } }`.
- **Concurrency**: every mutable table has `version` (bumped by trigger). Updates will use `If-Match`/version checks.
- **Soft delete** (`deleted_at`) on business entities; `audit_logs` is append-only (trigger-enforced).
- **Migrations**: `src/db/migrations/NNNN_*.sql`, forward-only, checksummed, advisory-locked. Never edit a shipped file.

See `docs/part-1-notes.md` for schema decisions and the frontend field mapping.
