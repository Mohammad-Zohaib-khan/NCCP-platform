import { shared } from '../lib/plugin.js'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { AppConfig } from '../config/env.js'
import type { Db } from '../db/pool.js'
import { AppError } from '../lib/errors.js'
import { verifyAccessToken } from '../auth/jwt.js'
import { loadScope, mfaRequiredFor, requirePermission, type AuthContext } from '../auth/context.js'
import { isRoleCode, type Permission } from '../auth/permissions.js'
import { writeAuditSafe } from '../audit/audit.js'

declare module 'fastify' {
  interface FastifyRequest { auth: AuthContext | null }
  interface FastifyContextConfig {
    /** Route stays usable while MFA enrolment is still pending (only the MFA-setup endpoints set this). */
    allowMfaSetup?: boolean
  }
}

export interface AuthPluginDeps { db: Db; config: AppConfig }

/**
 * Decorates requests with `auth` and exposes `app.authenticate` (bearer access token + live session/user check)
 * and `app.authorize(permission)` (authenticate + server-side RBAC). Every protected route must use one of them.
 * The session/user lookup on each request is what makes logout, disable and password-reset take effect immediately
 * rather than after the access token expires.
 */
async function authPluginImpl(app: FastifyInstance, deps: AuthPluginDeps): Promise<void> {
  app.decorateRequest('auth', null)

  async function authenticate(req: FastifyRequest): Promise<AuthContext> {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const claims = token ? verifyAccessToken(token, deps.config.auth.jwtSecret) : null
    if (!claims) throw AppError.unauthenticated()

    const r = await deps.db.query<{ email: string; full_name: string; role_code: string; status: string; mfa_enabled: boolean; revoked_at: Date | null; expires_at: Date; last_used_at: Date }>(
      `SELECT u.email, u.full_name, u.role_code, u.status, u.mfa_enabled, s.revoked_at, s.expires_at, s.last_used_at
         FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2 AND u.deleted_at IS NULL`, [claims.sid, claims.sub])
    const row = r.rows[0]
    if (!row || row.revoked_at || row.expires_at.getTime() <= Date.now() || row.status !== 'active' || !isRoleCode(row.role_code)) throw AppError.unauthenticated()
    // The role in the DB is authoritative, never the one in the token.
    if (Date.now() - row.last_used_at.getTime() > 60_000) {
      void deps.db.query(`UPDATE user_sessions SET last_used_at = now() WHERE id = $1`, [claims.sid]).catch(() => undefined)
    }
    const scope = await loadScope(deps.db, claims.sub)
    const ctx: AuthContext = {
      userId: claims.sub, role: row.role_code, sessionId: claims.sid, fullName: row.full_name, email: row.email, ...scope,
      mfaEnabled: row.mfa_enabled, mfaSetupRequired: mfaRequiredFor(row.role_code) && !row.mfa_enabled,
    }
    if (ctx.mfaSetupRequired && !req.routeOptions.config.allowMfaSetup) throw AppError.forbidden('Multi-factor authentication setup is required before you can continue')
    req.auth = ctx
    return ctx
  }

  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => { await authenticate(req) })

  app.decorate('authorize', (...permissions: Permission[]) => async (req: FastifyRequest, _reply: FastifyReply) => {
    const ctx = await authenticate(req)
    try {
      for (const p of permissions) requirePermission(ctx, p)
    } catch (err) {
      await writeAuditSafe(deps.db, { action: 'access.denied', outcome: 'denied', actorUserId: ctx.userId, actorRole: ctx.role, requestId: req.id, ip: req.ip, changes: { method: req.method, route: req.routeOptions.url, needs: permissions } }, (e) => req.log.error({ err: e }, 'audit write failed'))
      throw err
    }
  })
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    authorize: (...permissions: Permission[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export const authPlugin = shared(authPluginImpl)
