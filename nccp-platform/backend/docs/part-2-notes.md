# Part 2 notes: authentication, users, RBAC, audit writer

## Verification status (read first)
Built in the same sandbox as Part 1: **no network, no PostgreSQL, dependencies not installed.**
- **Executed and passing here:** unit tests for password hashing/policy, HS256 JWT (incl. tampering and alg confusion), TOTP (RFC 6238 vectors), secret encryption, tokens/recovery codes, audit redaction, tenant-access helpers, the permission matrix, and a check that migration 0006 matches `permissions.ts` exactly. Migration structure lint passes (6 files, 41 tables).
- **Written but NOT executed:** everything that touches Fastify, zod or PostgreSQL: `service.ts`, `users.service.ts`, `routes.ts`, `plugins/auth.ts`, `app.ts` wiring, migration 0006 SQL, and `test/integration/auth.flow.test.ts` (12 end-to-end tests; skipped unless `RUN_DB_TESTS=1`; CI sets it).
- **Not type-checked:** `tsc` cannot run without `@types/node`, fastify and zod. Expect a few type errors on first `npm run typecheck`.
- Config tests (now 7) need `zod` and did not run.

## Bug fixed from Part 1
`errorHandler` and `requestContext` were registered as plain Fastify plugins. Fastify encapsulates plugins, so the custom error handler and the `X-Request-Id` header would **not** have applied to routes. They (and the new auth plugin) are now marked shared via `src/lib/plugin.ts` (the same `skip-override` mechanism `fastify-plugin` uses; no new dependency). This was never run in Part 1, so it would have shown up on first boot.

## Endpoints (all under /api/v1)
| Method + path | Auth | Notes |
|---|---|---|
| POST /auth/login | public, 10/min | generic error for unknown email or bad password; 423 when locked; returns `mfa_required` + challenge when MFA is on |
| POST /auth/mfa/verify | public, 10/min | TOTP or recovery code; TOTP step cannot be replayed |
| POST /auth/refresh | refresh cookie + `X-Requested-With: nccp-web` | rotates token; reuse revokes the whole family |
| POST /auth/logout | refresh cookie + CSRF header | 204 |
| GET /auth/me | bearer | role, workspace, permissions, institution/employer scope |
| GET/DELETE /auth/sessions[/:id] | bearer | list / revoke own sessions |
| POST /auth/accept-invite, /forgot-password, /reset-password, /verify-email | public, rate-limited | forgot-password always 202 |
| POST /auth/change-password | bearer | revokes all other sessions |
| POST /auth/mfa/setup, /confirm, /disable | bearer | disable refused for roles that require MFA |
| GET /users, GET /users/:id | `users:read` | scoped: super admin all; institution admin own institutions; employer own company; others self |
| POST /users/invite, /users/:id/resend-invitation | `users:invite` | institution admins can only invite trainer/trainee into their own institution |
| PATCH /users/:id | `users:update` + `If-Match` | optimistic concurrency, 412 on stale version |
| POST /users/:id/disable, /enable | `users:disable` | disable revokes sessions; cannot disable self |
| POST /users/:id/revoke-sessions | `sessions:revoke_any` | super admin |
| GET /roles | `roles:read` | roles with their permissions |

## Design decisions
- **Access token**: HS256 JWT, 15 min, in the `Authorization` header (kept in memory by the frontend). **Refresh token**: opaque, 14 days, httpOnly cookie scoped to `/api/v1/auth`, rotated on every use, only its SHA-256 is stored.
- **Every request re-checks the session and user in the DB** (one query), so logout, disable, password reset and role changes apply immediately. The role in the token is never trusted. If this query becomes a hotspot, add a short cache in Part 8/10.
- **Two-tab race**: a just-rotated refresh token replayed within 10 s returns 401 without revoking the family; after that, replay is treated as theft.
- **Lockout**: 5 failures locks for 15 min (configurable); reset on success or password reset.
- **MFA**: TOTP with recovery codes. Required for `super_admin` (`MFA_REQUIRED_ROLES` in `permissions.ts`): such a session can only reach `/auth/me` and the MFA-setup endpoints until enrolled.
- **Tenant isolation**: out-of-scope records return 404, not 403. Helpers: `assertInstitutionAccess`, `assertEmployerAccess`, `assertOwnRecord` in `auth/context.ts`; later modules must use them.
- **Audit**: `writeAudit(db|tx, entry)`; pass a transaction to make the entry atomic with the change. Secret-looking keys are redacted recursively. Denied permission checks are audited as `access.denied`. Unknown-email login failures store only a hash prefix of the address.
- **Password hashing**: Node `scrypt` (N=32768, r=8, p=1), because Argon2id needs a native package and could not be verified here. Hashes carry their parameters, so switching later is a login-time rehash.
- **Email**: `Mailer` interface with a dev log-only implementation. In staging/production it refuses to send (so links never reach production logs) until the SMTP mailer arrives in Part 7. Invitations therefore need Part 7 before real use; until then, invite links appear in dev logs.
- CSRF for cookie endpoints: custom header + Origin allow-list. If the frontend and API are on different *sites*, set `AUTH_COOKIE_SAMESITE=none` (forces Secure).

## New configuration
`AUTH_MFA_ENCRYPTION_KEY`, `AUTH_ACCESS_TTL_SECONDS`, `AUTH_REFRESH_TTL_DAYS`, `AUTH_MAX_FAILED_LOGINS`, `AUTH_LOCK_MINUTES`, `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAMESITE`, `APP_BASE_URL`. Production now also rejects identical JWT/cookie secrets and `AUTH_COOKIE_SECURE=false`. New dependency: `@fastify/cookie`.

## Not in Part 2 (by design)
- **No first super admin exists yet.** There is no self-registration and no seed; Part 10 adds the seed script. To try Part 2 locally, insert one user by hand or run the integration test seed.
- Trainee/employer self-registration and institution onboarding: Part 3 / Part 6.
- Email verification token issuance for changed emails: the verify endpoint exists, nothing issues those tokens yet.

## Please run first (in this order)
`npm install` → `npm run typecheck` → `npm run lint:sql` → `npm run migrate` (twice) → `RUN_DB_TESTS=1 npm test` → `npm run dev`. Send me any failures.
