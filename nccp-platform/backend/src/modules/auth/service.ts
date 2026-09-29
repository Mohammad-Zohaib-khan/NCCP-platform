import type { Db, Tx } from '../../db/pool.js'
import { withTransaction } from '../../db/pool.js'
import type { AppConfig } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import type { Mailer } from '../../lib/mailer.js'
import { writeAudit } from '../../audit/audit.js'
import { checkPasswordPolicy, dummyHash, hashPassword, needsRehash, verifyPassword } from '../../auth/password.js'
import { hashRecoveryCode, hashToken, newOpaqueToken, newRecoveryCode } from '../../auth/tokens.js'
import { signAccessToken } from '../../auth/jwt.js'
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from '../../auth/totp.js'
import { loadScope, mfaRequiredFor, type AuthContext } from '../../auth/context.js'
import { isRoleCode, ROLE_PERMISSIONS } from '../../auth/permissions.js'

export interface AuthDeps { db: Db; config: AppConfig; mailer: Mailer }
export interface ReqInfo { ip?: string; userAgent?: string; requestId?: string }

interface UserRow {
  id: string; email: string; full_name: string; role_code: string; status: string; password_hash: string | null
  failed_login_count: number; locked_until: Date | null; mfa_enabled: boolean; mfa_secret_enc: string | null
  mfa_last_step: string | null; email_verified_at: Date | null
}

export interface PublicUser {
  id: string; email: string; fullName: string; role: string; workspace: string
  mfaEnabled: boolean; mfaSetupRequired: boolean; permissions: readonly string[]
  institutionIds: string[]; employerIds: string[]
}
export interface TokenPair { accessToken: string; expiresIn: number; refreshToken: string; refreshExpiresAt: Date }
export type LoginResult =
  | { status: 'authenticated'; tokens: TokenPair; user: PublicUser }
  | { status: 'mfa_required'; challengeToken: string; expiresIn: number }

const GENERIC_LOGIN_ERROR = 'Invalid email or password'
const CHALLENGE_TTL_MIN = 5
const CHALLENGE_MAX_ATTEMPTS = 5
const ROTATION_GRACE_MS = 10_000

const WORKSPACE: Record<string, string> = { super_admin: 'admin', institution_admin: 'institution', trainer: 'trainer', trainee: 'trainee', employer: 'employer' }

async function toPublicUser(db: Db | Tx, u: Pick<UserRow, 'id' | 'email' | 'full_name' | 'role_code' | 'mfa_enabled'>): Promise<PublicUser> {
  const scope = await loadScope(db as Db, u.id)
  const role = isRoleCode(u.role_code) ? u.role_code : 'trainee'
  return {
    id: u.id, email: u.email, fullName: u.full_name, role, workspace: WORKSPACE[role] ?? role,
    mfaEnabled: u.mfa_enabled, mfaSetupRequired: mfaRequiredFor(role) && !u.mfa_enabled,
    permissions: ROLE_PERMISSIONS[role], ...scope,
  }
}

export function publicUserFromContext(a: AuthContext): PublicUser {
  return {
    id: a.userId, email: a.email, fullName: a.fullName, role: a.role, workspace: WORKSPACE[a.role] ?? a.role,
    mfaEnabled: a.mfaEnabled, mfaSetupRequired: a.mfaSetupRequired, permissions: ROLE_PERMISSIONS[a.role],
    institutionIds: a.institutionIds, employerIds: a.employerIds,
  }
}

export function createAuthService(deps: AuthDeps) {
  const { db, config, mailer } = deps
  const cfg = config.auth

  async function issueSession(tx: Db | Tx, user: Pick<UserRow, 'id' | 'role_code'>, info: ReqInfo, familyId?: string): Promise<{ tokens: TokenPair; sessionId: string }> {
    const { token, hash } = newOpaqueToken(48)
    const expiresAt = new Date(Date.now() + cfg.refreshTtlDays * 86_400_000)
    const r = await tx.query<{ id: string; family_id: string }>(
      `INSERT INTO user_sessions (user_id, family_id, refresh_token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, $4, $5, $6) RETURNING id, family_id`,
      [user.id, familyId ?? null, hash, info.userAgent?.slice(0, 500) ?? null, info.ip ?? null, expiresAt],
    )
    const sessionId = r.rows[0]!.id
    const accessToken = signAccessToken({ sub: user.id, sid: sessionId, role: user.role_code }, cfg.jwtSecret, cfg.accessTtlSeconds)
    return { sessionId, tokens: { accessToken, expiresIn: cfg.accessTtlSeconds, refreshToken: token, refreshExpiresAt: expiresAt } }
  }

  async function completeLogin(user: UserRow, info: ReqInfo, viaMfa: boolean): Promise<LoginResult> {
    const { tokens } = await withTransaction(db, async (tx) => {
      await tx.query(`UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [user.id])
      const s = await issueSession(tx, user, info)
      await writeAudit(tx, { action: 'auth.login', actorUserId: user.id, actorRole: user.role_code, entityType: 'user', entityId: user.id, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { mfa: viaMfa, sessionId: s.sessionId } })
      return s
    })
    return { status: 'authenticated', tokens, user: await toPublicUser(db, user) }
  }

  async function recordFailure(email: string, user: UserRow | undefined, info: ReqInfo, reason: string): Promise<void> {
    if (user) {
      const r = await db.query<{ failed_login_count: number; locked_until: Date | null }>(
        `UPDATE users SET failed_login_count = failed_login_count + 1,
                          locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
          WHERE id = $1 RETURNING failed_login_count, locked_until`,
        [user.id, cfg.maxFailedLogins, cfg.lockMinutes],
      )
      const locked = (r.rows[0]?.failed_login_count ?? 0) >= cfg.maxFailedLogins
      await writeAudit(db, { action: locked ? 'auth.account_locked' : 'auth.login', outcome: 'failure', actorUserId: user.id, actorRole: user.role_code, entityType: 'user', entityId: user.id, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { reason } })
    } else {
      // Unknown email: audit without storing the attempted address verbatim beyond a hash prefix.
      await writeAudit(db, { action: 'auth.login', outcome: 'failure', requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, changes: { reason, emailHash: hashToken(email.toLowerCase()).slice(0, 12) } })
    }
  }

  async function login(emailRaw: string, password: string, info: ReqInfo): Promise<LoginResult> {
    const email = emailRaw.trim().toLowerCase()
    const r = await db.query<UserRow>(`SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`, [email])
    const user = r.rows[0]
    // Always run one scrypt so timing does not reveal whether the account exists.
    const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash()))
    if (!user || !user.password_hash) { await recordFailure(email, undefined, info, 'unknown_user'); throw AppError.unauthenticated(GENERIC_LOGIN_ERROR) }
    if (user.locked_until && user.locked_until.getTime() > Date.now()) {
      await writeAudit(db, { action: 'auth.login', outcome: 'denied', actorUserId: user.id, actorRole: user.role_code, requestId: info.requestId, ip: info.ip, changes: { reason: 'locked' } })
      throw AppError.locked('Account temporarily locked after too many failed attempts. Try again later or reset your password.')
    }
    if (!ok) { await recordFailure(email, user, info, 'bad_password'); throw AppError.unauthenticated(GENERIC_LOGIN_ERROR) }
    if (user.status !== 'active') {
      await writeAudit(db, { action: 'auth.login', outcome: 'denied', actorUserId: user.id, actorRole: user.role_code, requestId: info.requestId, ip: info.ip, changes: { reason: `status_${user.status}` } })
      throw AppError.unauthenticated(GENERIC_LOGIN_ERROR)
    }
    if (needsRehash(user.password_hash)) {
      await db.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [user.id, await hashPassword(password)])
    }
    if (user.mfa_enabled) {
      const { token, hash } = newOpaqueToken(32)
      await db.query(`INSERT INTO mfa_challenges (user_id, token_hash, ip_address, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4))`, [user.id, hash, info.ip ?? null, CHALLENGE_TTL_MIN])
      return { status: 'mfa_required', challengeToken: token, expiresIn: CHALLENGE_TTL_MIN * 60 }
    }
    return completeLogin(user, info, false)
  }

  async function verifyMfaLogin(challengeToken: string, code: string, info: ReqInfo): Promise<LoginResult> {
    const hash = hashToken(challengeToken)
    const c = await db.query<{ id: string; user_id: string; attempts: number }>(
      `SELECT id, user_id, attempts FROM mfa_challenges WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`, [hash])
    const ch = c.rows[0]
    if (!ch || ch.attempts >= CHALLENGE_MAX_ATTEMPTS) throw AppError.unauthenticated('Verification expired; sign in again')
    const u = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`, [ch.user_id])
    const user = u.rows[0]
    if (!user || !user.mfa_secret_enc) throw AppError.unauthenticated('Verification expired; sign in again')
    await db.query(`UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id])

    const good = await checkSecondFactor(user, code)
    if (!good) {
      await writeAudit(db, { action: 'auth.mfa_verify', outcome: 'failure', actorUserId: user.id, actorRole: user.role_code, requestId: info.requestId, ip: info.ip })
      throw AppError.unauthenticated('Invalid verification code')
    }
    await db.query(`UPDATE mfa_challenges SET used_at = now() WHERE id = $1`, [ch.id])
    return completeLogin(user, info, true)
  }

  /** TOTP (with replay protection) or a one-time recovery code. */
  async function checkSecondFactor(user: UserRow, code: string): Promise<boolean> {
    const trimmed = code.trim()
    if (/^\d{6}$/.test(trimmed)) {
      const step = verifyTotp(decryptSecret(user.mfa_secret_enc!, cfg.mfaKey), trimmed)
      if (step === null) return false
      // Atomic replay guard: a step can only be accepted once.
      const r = await db.query(`UPDATE users SET mfa_last_step = $2 WHERE id = $1 AND (mfa_last_step IS NULL OR mfa_last_step < $2)`, [user.id, step])
      return (r.rowCount ?? 0) === 1
    }
    const r = await db.query(`UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, [user.id, hashRecoveryCode(trimmed)])
    return (r.rowCount ?? 0) === 1
  }

  async function refresh(refreshToken: string, info: ReqInfo): Promise<{ tokens: TokenPair; user: PublicUser }> {
    const hash = hashToken(refreshToken)
    type Outcome = { kind: 'ok'; tokens: TokenPair; user: UserRow } | { kind: 'fail'; reuse: boolean; userId?: string }
    const out = await withTransaction<Outcome>(db, async (tx) => {
      const s = await tx.query<{ id: string; user_id: string; family_id: string; expires_at: Date; revoked_at: Date | null; revoked_reason: string | null }>(
        `SELECT id, user_id, family_id, expires_at, revoked_at, revoked_reason FROM user_sessions WHERE refresh_token_hash = $1 FOR UPDATE`, [hash])
      const sess = s.rows[0]
      if (!sess) return { kind: 'fail', reuse: false }
      if (sess.revoked_at) {
        const recentlyRotated = sess.revoked_reason === 'rotated' && Date.now() - sess.revoked_at.getTime() < ROTATION_GRACE_MS
        if (recentlyRotated) return { kind: 'fail', reuse: false, userId: sess.user_id } // benign race (two tabs)
        // Token reuse => assume theft: revoke the whole rotation family.
        await tx.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'reuse_detected' WHERE family_id = $1 AND revoked_at IS NULL`, [sess.family_id])
        await writeAudit(tx, { action: 'auth.refresh_reuse_detected', outcome: 'denied', actorUserId: sess.user_id, requestId: info.requestId, ip: info.ip, userAgent: info.userAgent, entityType: 'session', entityId: sess.id })
        return { kind: 'fail', reuse: true, userId: sess.user_id }
      }
      if (sess.expires_at.getTime() <= Date.now()) return { kind: 'fail', reuse: false }
      const u = await tx.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`, [sess.user_id])
      const user = u.rows[0]
      if (!user) return { kind: 'fail', reuse: false }
      const next = await issueSession(tx, user, info, sess.family_id)
      await tx.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'rotated', replaced_by = $2 WHERE id = $1`, [sess.id, next.sessionId])
      return { kind: 'ok', tokens: next.tokens, user }
    })
    if (out.kind === 'fail') throw AppError.unauthenticated('Session expired; sign in again')
    return { tokens: out.tokens, user: await toPublicUser(db, out.user) }
  }

  async function logout(sessionId: string, actor: { userId: string; role: string }, info: ReqInfo): Promise<void> {
    await db.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL`, [sessionId])
    await writeAudit(db, { action: 'auth.logout', actorUserId: actor.userId, actorRole: actor.role, requestId: info.requestId, ip: info.ip })
  }

  /** Used by the refresh cookie logout path when only the refresh token is known. */
  async function logoutByRefreshToken(refreshToken: string): Promise<void> {
    await db.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE refresh_token_hash = $1 AND revoked_at IS NULL`, [hashToken(refreshToken)])
  }

  async function listSessions(userId: string, currentSessionId: string) {
    const r = await db.query(`SELECT id, user_agent, host(ip_address) AS ip, created_at, last_used_at, expires_at FROM user_sessions
                              WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY last_used_at DESC`, [userId])
    return r.rows.map((s) => ({ id: s.id as string, userAgent: s.user_agent as string | null, ip: s.ip as string | null, createdAt: s.created_at as Date, lastUsedAt: s.last_used_at as Date, current: s.id === currentSessionId }))
  }

  async function revokeSession(actor: AuthContext, sessionId: string, info: ReqInfo): Promise<void> {
    const r = await db.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'revoked_by_user' WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [sessionId, actor.userId])
    if ((r.rowCount ?? 0) === 0) throw AppError.notFound('Session')
    await writeAudit(db, { action: 'auth.session_revoke', actorUserId: actor.userId, actorRole: actor.role, entityType: 'session', entityId: sessionId, requestId: info.requestId, ip: info.ip })
  }

  // ---------- one-time-token flows ----------
  async function createUserToken(tx: Db | Tx, userId: string, purpose: 'invitation' | 'email_verification' | 'password_reset', ttlMinutes: number, createdBy?: string) {
    await tx.query(`UPDATE user_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]) // supersede older links
    const { token, hash } = newOpaqueToken(32)
    await tx.query(`INSERT INTO user_tokens (user_id, purpose, token_hash, created_by, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5))`, [userId, purpose, hash, createdBy ?? null, ttlMinutes])
    return token
  }

  /** Atomically consume a token; returns the user id or throws a single generic error (no oracle for expired vs unknown). */
  async function consumeToken(tx: Tx, token: string, purpose: string): Promise<string> {
    const r = await tx.query<{ user_id: string }>(
      `UPDATE user_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id`, [hashToken(token), purpose])
    const row = r.rows[0]
    if (!row) throw AppError.badRequest('This link is invalid or has expired')
    return row.user_id
  }

  async function sendInvitationEmail(email: string, fullName: string, token: string, hours: number): Promise<void> {
    await mailer.send({ to: email, subject: 'You have been invited to NCCP', text:
      `Hello ${fullName},\n\nYou have been invited to the NCCP platform. Set your password here (valid ${hours} hours):\n${config.appBaseUrl}/accept-invite?token=${token}\n\nIf you did not expect this, ignore this email.` })
  }
  const INVITE_TTL_MIN = 7 * 24 * 60
  async function resendInvitation(userId: string, actor: AuthContext, info: ReqInfo): Promise<void> {
    const u = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'invited'`, [userId])
    if (!u.rows[0]) throw AppError.notFound('Invited user')
    const token = await createUserToken(db, userId, 'invitation', INVITE_TTL_MIN, actor.userId)
    await sendInvitationEmail(u.rows[0].email, u.rows[0].full_name, token, INVITE_TTL_MIN / 60)
    await writeAudit(db, { action: 'user.invitation_resend', actorUserId: actor.userId, actorRole: actor.role, entityType: 'user', entityId: userId, requestId: info.requestId, ip: info.ip })
  }

  async function acceptInvitation(token: string, password: string, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const userId = await consumeToken(tx, token, 'invitation')
      const u = (await tx.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL AND status = 'invited' FOR UPDATE`, [userId])).rows[0]
      if (!u) throw AppError.badRequest('This link is invalid or has expired')
      const issues = checkPasswordPolicy(password, { email: u.email })
      if (issues.length) throw AppError.validation(issues.map((i) => ({ path: 'password', message: i.message })))
      await tx.query(`UPDATE users SET password_hash = $2, status = 'active', email_verified_at = now(), password_changed_at = now() WHERE id = $1`, [userId, await hashPassword(password)])
      await writeAudit(tx, { action: 'user.invitation_accept', actorUserId: userId, actorRole: u.role_code, entityType: 'user', entityId: userId, requestId: info.requestId, ip: info.ip })
    })
  }

  async function forgotPassword(emailRaw: string, info: ReqInfo): Promise<void> {
    // Always resolves the same way whether or not the account exists (no enumeration).
    const u = (await db.query<UserRow>(`SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL AND status = 'active'`, [emailRaw.trim().toLowerCase()])).rows[0]
    if (!u) return
    const token = await createUserToken(db, u.id, 'password_reset', 60)
    await mailer.send({ to: u.email, subject: 'Reset your NCCP password', text: `Reset your password (valid 1 hour):\n${config.appBaseUrl}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.` })
    await writeAudit(db, { action: 'auth.password_reset_request', actorUserId: u.id, actorRole: u.role_code, entityType: 'user', entityId: u.id, requestId: info.requestId, ip: info.ip })
  }

  async function resetPassword(token: string, password: string, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const userId = await consumeToken(tx, token, 'password_reset')
      const u = (await tx.query<UserRow>(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [userId])).rows[0]
      if (!u || !['active', 'locked'].includes(u.status)) throw AppError.badRequest('This link is invalid or has expired')
      const issues = checkPasswordPolicy(password, { email: u.email })
      if (issues.length) throw AppError.validation(issues.map((i) => ({ path: 'password', message: i.message })))
      await tx.query(`UPDATE users SET password_hash = $2, password_changed_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = $1`, [userId, await hashPassword(password)])
      await tx.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL`, [userId])
      await writeAudit(tx, { action: 'auth.password_reset', actorUserId: userId, actorRole: u.role_code, entityType: 'user', entityId: userId, requestId: info.requestId, ip: info.ip })
    })
  }

  async function changePassword(actor: AuthContext, current: string, next: string, info: ReqInfo): Promise<void> {
    const u = (await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [actor.userId])).rows[0]
    if (!u || !(await verifyPassword(current, u.password_hash))) throw AppError.validation([{ path: 'currentPassword', message: 'Current password is incorrect' }])
    const issues = checkPasswordPolicy(next, { email: u.email })
    if (issues.length) throw AppError.validation(issues.map((i) => ({ path: 'newPassword', message: i.message })))
    await withTransaction(db, async (tx) => {
      await tx.query(`UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1`, [u.id, await hashPassword(next)])
      await tx.query(`UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'password_change' WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL`, [u.id, actor.sessionId])
      await writeAudit(tx, { action: 'auth.password_change', actorUserId: u.id, actorRole: u.role_code, entityType: 'user', entityId: u.id, requestId: info.requestId, ip: info.ip })
    })
  }

  async function verifyEmail(token: string, info: ReqInfo): Promise<void> {
    await withTransaction(db, async (tx) => {
      const userId = await consumeToken(tx, token, 'email_verification')
      await tx.query(`UPDATE users SET email_verified_at = now(), status = CASE WHEN status = 'pending_verification' THEN 'active' ELSE status END WHERE id = $1`, [userId])
      await writeAudit(tx, { action: 'auth.email_verified', actorUserId: userId, entityType: 'user', entityId: userId, requestId: info.requestId, ip: info.ip })
    })
  }

  // ---------- MFA ----------
  async function beginMfaSetup(actor: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    if (actor.mfaEnabled) throw AppError.conflict('MFA is already enabled')
    const secret = newTotpSecret()
    await db.query(`UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1`, [actor.userId, encryptSecret(secret, cfg.mfaKey)])
    return { secret, otpauthUri: otpauthUri(secret, actor.email) }
  }

  async function confirmMfaSetup(actor: AuthContext, code: string, info: ReqInfo): Promise<{ recoveryCodes: string[] }> {
    const u = (await db.query<{ mfa_pending_secret_enc: string | null }>(`SELECT mfa_pending_secret_enc FROM users WHERE id = $1`, [actor.userId])).rows[0]
    if (!u?.mfa_pending_secret_enc) throw AppError.badRequest('Start MFA setup first')
    const step = verifyTotp(decryptSecret(u.mfa_pending_secret_enc, cfg.mfaKey), code.trim())
    if (step === null) throw AppError.validation([{ path: 'code', message: 'Invalid verification code' }])
    const codes = Array.from({ length: 10 }, () => newRecoveryCode())
    await withTransaction(db, async (tx) => {
      await tx.query(`UPDATE users SET mfa_enabled = true, mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_last_step = $2, mfa_enrolled_at = now() WHERE id = $1`, [actor.userId, step])
      await tx.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [actor.userId])
      for (const c of codes) await tx.query(`INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1,$2)`, [actor.userId, hashRecoveryCode(c)])
      await writeAudit(tx, { action: 'auth.mfa_enable', actorUserId: actor.userId, actorRole: actor.role, entityType: 'user', entityId: actor.userId, requestId: info.requestId, ip: info.ip })
    })
    return { recoveryCodes: codes } // shown exactly once
  }

  async function disableMfa(actor: AuthContext, password: string, code: string, info: ReqInfo): Promise<void> {
    if (mfaRequiredFor(actor.role)) throw AppError.forbidden('MFA is mandatory for your role and cannot be disabled')
    const u = (await db.query<UserRow>(`SELECT * FROM users WHERE id = $1`, [actor.userId])).rows[0]
    if (!u?.mfa_enabled) throw AppError.badRequest('MFA is not enabled')
    if (!(await verifyPassword(password, u.password_hash)) || !(await checkSecondFactor(u, code))) throw AppError.validation([{ path: 'code', message: 'Password or code is incorrect' }])
    await db.query(`UPDATE users SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_last_step = NULL WHERE id = $1`, [actor.userId])
    await db.query(`DELETE FROM mfa_recovery_codes WHERE user_id = $1`, [actor.userId])
    await writeAudit(db, { action: 'auth.mfa_disable', actorUserId: actor.userId, actorRole: actor.role, entityType: 'user', entityId: actor.userId, requestId: info.requestId, ip: info.ip })
  }

  return {
    login, verifyMfaLogin, refresh, logout, logoutByRefreshToken, listSessions, revokeSession,
    acceptInvitation, resendInvitation, forgotPassword, resetPassword, changePassword, verifyEmail,
    beginMfaSetup, confirmMfaSetup, disableMfa,
    createUserToken, sendInvitationEmail, INVITE_TTL_MIN,
    toPublicUser, publicUserFromContext,
  }
}
export type AuthService = ReturnType<typeof createAuthService>
